import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
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
  const buttonClass = 'pennie-focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-pennie-graphite transition-colors duration-150 hover:bg-pennie-beige disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-1 rounded-2xl border border-border bg-pennie-white p-1 focus-within:border-pennie-blue-deeper ${constrainHeight ? '' : 'sticky top-0 z-10'}`}>
        <Search className="ml-2 hidden h-4 w-4 shrink-0 text-pennie-graphite/60 sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <label htmlFor={searchId} className="sr-only">Search transcript</label>
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
            placeholder="Search transcript"
            className="pennie-focus-ring w-full min-h-[44px] rounded-xl border-0 bg-transparent px-2 py-2 text-base sm:text-sm [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        <button type="button" className={buttonClass} disabled={!count} onClick={() => advance(-1)} aria-label={searching ? 'Previous match' : 'Previous evidence'} title={searching ? 'Previous match (Shift+Enter)' : 'Previous evidence'}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" className={buttonClass} disabled={!count} onClick={() => advance(1)} aria-label={searching ? 'Next match' : 'Next evidence'} title={searching ? 'Next match (Enter)' : 'Next evidence'}>
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
        {searching && <button type="button" className={buttonClass} aria-label="Show evidence" title="Clear search and show evidence" onClick={() => { setSearch(''); setActive(-1) }}><X className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
      <p className="text-xs text-pennie-graphite/70" role="status">
        {count > 0
          ? `${position >= 0 ? `${position + 1} of ` : ''}${count} ${searching ? 'search matches' : 'evidence passages'}`
          : searching ? 'No search matches.' : evidence.length ? 'No literal evidence match in this transcript. Review the context; the quote may be paraphrased or from another call.' : 'No verbatim evidence quotes available. Search to inspect the call.'}
        {searching && <span className="sr-only"> · Enter / Shift+Enter moves between matches.</span>}
      </p>
      {recordingTiming?.original_transcript === transcript && <p className="sr-only">Timestamps appear only for verified audio matches. The current passage highlights while playing; scrolling stays in your control.</p>}
      <div ref={contentRef} id={contentId} className={`py-2 ${constrainHeight ? `overflow-y-auto ${expanded ? 'max-h-[70vh]' : 'max-h-96'}` : ''}`}>
        <ol className="space-y-5">
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
                className={`${searching ? 'bg-pennie-blue-light' : 'bg-pennie-yellow-light'} text-pennie-graphite scroll-mt-24 scroll-mb-4 ${matchId === position ? 'underline decoration-pennie-blue-deeper decoration-2 underline-offset-4' : ''}`}
              >{block.text.slice(range.start, range.end)}</mark>)
              cursor = range.end
            })
            parts.push(block.text.slice(cursor))
            return <li key={index} aria-current={index === playingTurn ? 'true' : undefined}
              className={`border-l-2 px-3 py-2 rounded-r-xl ${index === playingTurn ? 'border-pennie-blue-deeper bg-pennie-blue-light' : 'border-transparent'}`}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3">
                {block.speaker && <span className="text-xs font-semibold capitalize text-pennie-navy">{block.speaker}</span>}
                {renderAudioLink?.(block.text, block.speaker)}
              </div>
              <p className="text-sm text-pennie-graphite leading-7 whitespace-pre-wrap">{parts}</p>
              {index === playingTurn && <span className="sr-only">Playing this passage</span>}
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
