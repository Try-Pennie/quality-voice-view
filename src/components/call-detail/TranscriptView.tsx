import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { findTranscriptRanges, parseTranscriptTurns } from '@/lib/transcript-evidence'
import { createAudioQuoteMatcher, type RecordingTiming } from '@/lib/recording-timestamps'

/** Searchable speaker turns with literal evidence navigation; no inferred audio timestamps. */
export function TranscriptView({ transcript, evidence = [], constrainHeight = true, focusRequest = 0, searchQuote = '', audioElement, recordingTiming, renderAudioLink }: {
  transcript: string
  evidence?: string[]
  constrainHeight?: boolean
  /** Explicit navigation request, not focus on every data refresh. */
  focusRequest?: number
  /** A literal quote to find on an explicit focus request, never on playback updates. */
  searchQuote?: string
  audioElement?: HTMLAudioElement | null
  recordingTiming?: RecordingTiming | null
  /** Optional verified timing; unmatched turns retain the original text without a link. */
  renderAudioLink?: (quote: string, speaker?: string) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(-1)
  const searchId = useId()
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const turns = useMemo(() => parseTranscriptTurns(transcript), [transcript])
  const timedTurns = useMemo(() => {
    // A refreshed original transcript must not inherit another revision's highlighting.
    if (!recordingTiming || recordingTiming.original_transcript !== transcript) return []
    const match = createAudioQuoteMatcher(recordingTiming)
    return (turns ?? [{ text: transcript }]).map(turn => match(turn.text))
  }, [recordingTiming, transcript, turns])
  const [playingTurn, setPlayingTurn] = useState(-1)
  useEffect(() => {
    const clear = () => setPlayingTurn(-1)
    if (!audioElement || !recordingTiming) { clear(); return }
    const update = () => {
      if (audioElement.paused || audioElement.ended || audioElement.seeking || audioElement.error || audioElement.readyState < 3 ||
        !Number.isFinite(audioElement.duration) || Math.abs(audioElement.duration - recordingTiming.duration) > Math.max(2, recordingTiming.duration * 0.005)) { clear(); return }
      const matches = timedTurns.flatMap((range, index) => range && audioElement.currentTime >= range.start && audioElement.currentTime < range.end ? [index] : [])
      setPlayingTurn(matches.length === 1 ? matches[0] : -1)
    }
    const updates = ['timeupdate', 'playing', 'seeked', 'durationchange']
    const stops = ['pause', 'ended', 'waiting', 'seeking', 'error', 'emptied']
    updates.forEach(event => audioElement.addEventListener(event, update))
    stops.forEach(event => audioElement.addEventListener(event, clear))
    update()
    return () => {
      updates.forEach(event => audioElement.removeEventListener(event, update))
      stops.forEach(event => audioElement.removeEventListener(event, clear))
    }
  }, [audioElement, recordingTiming, timedTurns])
  const searching = search.trim().length > 0
  const blocks = useMemo(() => {
    const needles = searching ? [search] : evidence.filter(quote => quote.trim().length >= 12)
    let offset = 0
    return (turns ?? [{ speaker: '', text: transcript }]).map(turn => {
      const ranges = findTranscriptRanges(turn.text, needles)
      const block = { ...turn, ranges, offset }
      offset += ranges.length
      return block
    })
  }, [transcript, turns, search, searching, evidence])
  const count = blocks.reduce((total, block) => total + block.ranges.length, 0)
  const position = active >= 0 && active < count ? active : -1

  useEffect(() => {
    setSearch('')
    setActive(-1)
  }, [transcript])

  useEffect(() => {
    if (focusRequest <= 0) return
    if (searchQuote) { setSearch(searchQuote); setActive(0) }
    searchRef.current?.focus({ preventScroll: true })
    if (!searchQuote) searchRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [focusRequest, searchQuote])

  useEffect(() => {
    if (position < 0) return
    contentRef.current?.querySelector(`[data-transcript-match="${position}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [position, search, focusRequest])

  const advance = (delta: number) => {
    if (!count) return
    setActive(position < 0 ? (delta > 0 ? 0 : count - 1) : (position + delta + count) % count)
  }
  const buttonClass = 'pennie-focus-ring min-h-[40px] min-w-[40px] px-3 rounded-full border border-border text-xs font-semibold text-pennie-blue-deeper disabled:opacity-40'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <label htmlFor={searchId} className="pennie-label block mb-1">Search transcript</label>
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            value={search}
            maxLength={256}
            onChange={event => { setSearch(event.target.value); setActive(0) }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                advance(event.shiftKey ? -1 : 1)
              }
            }}
            placeholder="Find a word or exact phrase…"
            className="w-full min-h-[40px] px-3 py-2 rounded-full border border-border bg-pennie-white text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40"
          />
        </div>
        <button type="button" className={buttonClass} disabled={!count} onClick={() => advance(-1)} aria-label={searching ? 'Previous match' : 'Previous evidence'}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={!count} onClick={() => advance(1)} aria-label={searching ? 'Next match' : 'Next evidence'}>
          {searching ? 'Next match' : 'Next evidence'}<ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
        {searching && <button type="button" className={buttonClass} onClick={() => { setSearch(''); setActive(-1) }}>Show evidence</button>}
      </div>
      <p className="text-xs text-pennie-graphite/70" role="status">
        {count > 0
          ? `${position >= 0 ? `${position + 1} of ` : ''}${count} ${searching ? 'search matches' : 'evidence passages'}`
          : searching ? 'No search matches.' : evidence.length ? 'No literal evidence match in this transcript. Review the context; the quote may be paraphrased or from another call.' : 'No verbatim evidence quotes available. Search to inspect the call.'}
        {searching && ' · Enter / Shift+Enter moves between matches.'}
      </p>
      {recordingTiming?.original_transcript === transcript && <p className="text-xs text-pennie-graphite/70">Timestamps appear only for verified audio matches. The current passage highlights while playing; scrolling stays in your control.</p>}
      <div ref={contentRef} id={contentId} className={`bg-pennie-beige/60 rounded-2xl p-4 sm:p-5 ${constrainHeight ? `overflow-y-auto ${expanded ? 'max-h-[70vh]' : 'max-h-96'}` : ''}`}>
        <ol className="space-y-4">
          {blocks.map((block, index) => {
            const parts: ReactNode[] = []
            let cursor = 0
            block.ranges.forEach((range, matchIndex) => {
              if (range.start > cursor) parts.push(block.text.slice(cursor, range.start))
              const matchId = block.offset + matchIndex
              parts.push(<mark
                key={matchIndex}
                data-transcript-match={matchId}
                aria-current={matchId === position ? 'true' : undefined}
                className={`${searching ? 'bg-pennie-blue-light' : 'bg-pennie-yellow-light'} text-pennie-graphite rounded-sm ${matchId === position ? 'outline outline-2 outline-pennie-blue-deeper' : ''}`}
              >{block.text.slice(range.start, range.end)}</mark>)
              cursor = range.end
            })
            parts.push(block.text.slice(cursor))
            return <li key={index} aria-current={index === playingTurn ? 'true' : undefined}
              className={`border-l-2 pl-3 py-1 rounded-r-lg ${index === playingTurn ? 'border-pennie-blue-deeper bg-pennie-blue-light' : 'border-transparent'}`}>
              {block.speaker && <span className="block text-[11px] font-bold uppercase tracking-wider mb-1 text-pennie-navy">{block.speaker}</span>}
              <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">{parts}</p>
              {index === playingTurn && <span className="sr-only">Playing this passage</span>}
              {renderAudioLink?.(block.text, block.speaker)}
            </li>
          })}
        </ol>
      </div>
      {constrainHeight && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={contentId} className="pennie-focus-ring min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4">
        {expanded ? 'Collapse transcript' : 'Expand transcript'}
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>}
    </div>
  )
}
