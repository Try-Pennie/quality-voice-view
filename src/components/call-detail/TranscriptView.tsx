import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { findEvidenceOccurrences, findTranscriptRanges, parseTranscriptTurns } from '@/lib/transcript-evidence'
import { createAudioQuoteMatcher, type RecordingTiming } from '@/lib/recording-timestamps'

/** Searchable speaker turns with literal evidence navigation; no inferred audio timestamps. */
export function TranscriptView({ transcript, evidence = [], constrainHeight = true, focusRequest = 0, selectedEvidence, onReturnToReview, audioElement, recordingTiming, renderAudioLink }: {
  transcript: string
  evidence?: string[]
  constrainHeight?: boolean
  /** Explicit navigation request, not focus on every data refresh. */
  focusRequest?: number
  /** Source-pinned evidence selected outside the transcript. It never becomes free-text search. */
  selectedEvidence?: { readonly referenceId: string; readonly quote: string; readonly speaker?: string; readonly label: string } | null
  /** Returns to the exact review occurrence represented by selectedEvidence. */
  onReturnToReview?: (referenceId: string) => void
  audioElement?: HTMLAudioElement | null
  recordingTiming?: RecordingTiming | null
  /** Optional verified timing; unmatched turns retain the original text without a link. */
  renderAudioLink?: (quote: string, speaker?: string) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [navigationMode, setNavigationMode] = useState<'evidence' | 'search'>('evidence')
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
  const navigatingSearch = searching && navigationMode === 'search'
  const selectedQuote = selectedEvidence?.quote.trim() ?? ''
  const selectedOccurrences = useMemo(() => selectedQuote && !navigatingSearch
    ? findEvidenceOccurrences(turns ?? [{ speaker: '', text: transcript }], selectedQuote, selectedEvidence?.speaker) : null,
  [turns, transcript, selectedQuote, selectedEvidence?.speaker, navigatingSearch])
  const blocks = useMemo(() => {
    const needles = navigatingSearch ? [search]
      : selectedQuote ? [selectedQuote]
        : evidence.filter(quote => quote.trim().length >= 12)
    let offset = 0
    return (turns ?? [{ speaker: '', text: transcript }]).map((turn, turnIndex) => {
      const ranges = selectedOccurrences
        ? selectedOccurrences.flatMap((occurrence, matchId) => occurrence.filter(range => range.turnIndex === turnIndex).map(range => ({ ...range, matchId })))
        : findTranscriptRanges(turn.text, needles).map((range, matchIndex) => ({ ...range, matchId: offset + matchIndex }))
      offset += ranges.length
      return { ...turn, ranges }
    })
  }, [transcript, turns, search, navigatingSearch, selectedQuote, selectedOccurrences, evidence])
  const count = selectedOccurrences ? selectedOccurrences.length : blocks.reduce((total, block) => total + block.ranges.length, 0)
  const searchCount = useMemo(() => {
    if (!searching) return 0
    let total = 0
    for (const turn of turns ?? [{ speaker: '', text: transcript }]) total += findTranscriptRanges(turn.text, [search]).length
    return total
  }, [search, searching, transcript, turns])
  const position = active >= 0 && active < count ? active : -1

  useEffect(() => {
    setSearch('')
    setNavigationMode('evidence')
    setActive(-1)
  }, [transcript])

  useEffect(() => {
    if (focusRequest <= 0) return
    if (selectedEvidence) {
      setNavigationMode('evidence')
      setActive(0)
      return
    }
    searchRef.current?.focus({ preventScroll: true })
    searchRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [focusRequest, selectedEvidence])

  useEffect(() => {
    if (position < 0) return
    const match = contentRef.current?.querySelector<HTMLElement>(`[data-transcript-match="${position}"]`)
    match?.scrollIntoView({ block: 'nearest' })
    if (selectedEvidence && !navigatingSearch && focusRequest > 0) match?.focus({ preventScroll: true })
  }, [position, search, focusRequest, selectedEvidence, navigatingSearch])

  const advance = (delta: number) => {
    if (searching && !navigatingSearch) {
      setNavigationMode('search')
      setActive(delta > 0 ? 0 : Math.max(0, searchCount - 1))
      return
    }
    if (!count) return
    setActive(position < 0 ? (delta > 0 ? 0 : count - 1) : (position + delta + count) % count)
  }
  const buttonClass = 'pennie-focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-pennie-graphite transition-colors duration-150 hover:bg-pennie-beige disabled:cursor-not-allowed disabled:opacity-30'
  const status = count > 0
    ? `${position >= 0 ? `${position + 1} of ` : ''}${count} ${navigatingSearch ? 'search matches' : selectedEvidence ? 'matching passages for the selected evidence' : 'evidence passages'}`
    : navigatingSearch ? 'No search matches.'
      : selectedEvidence ? 'The selected evidence has no literal match in this transcript. Review the saved passage in the review pane; it may be paraphrased or come from another source.'
        : evidence.length ? 'No evidence passage is selected. Choose a passage in Review or search the call.'
          : 'No verbatim evidence quotes are available. Search to inspect the call.'

  return (
    <div className="space-y-3">
      <div className={`space-y-1 ${constrainHeight ? '' : 'sticky top-0 z-10 bg-pennie-beige pb-2'}`}>
      {selectedEvidence && <aside aria-label="Selected evidence" data-evidence-reference={selectedEvidence.referenceId} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-pennie-blue-deeper bg-pennie-blue-light px-3 text-pennie-navy">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-pennie-blue-deeper">Selected evidence</p>
          <p className="truncate text-sm font-semibold">{selectedEvidence.label}</p>
        </div>
        {onReturnToReview && <button type="button" onClick={() => onReturnToReview(selectedEvidence.referenceId)} className="pennie-focus-ring inline-flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-xs font-semibold text-pennie-blue-deeper hover:bg-white/70">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to evidence
        </button>}
      </aside>}
      <div className="flex items-center gap-1 rounded-2xl border border-border bg-pennie-white p-1 focus-within:border-pennie-blue-deeper">
        <Search className="ml-2 hidden h-4 w-4 shrink-0 text-pennie-graphite/60 sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <label htmlFor={searchId} className="sr-only">Search transcript</label>
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            value={search}
            maxLength={256}
            onChange={event => { setSearch(event.target.value); setNavigationMode('search'); setActive(0) }}
            onFocus={() => { if (searching && !navigatingSearch) { setNavigationMode('search'); setActive(0) } }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                advance(event.shiftKey ? -1 : 1)
              }
            }}
            placeholder="Search transcript"
            className="pennie-focus-ring min-h-[44px] w-full rounded-xl border-0 bg-transparent px-2 py-2 text-base sm:text-sm [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        <button type="button" className={buttonClass} disabled={searching ? !searchCount : !count} onClick={() => advance(-1)} aria-label={searching ? 'Previous match' : 'Previous evidence'} title={searching ? 'Previous match (Shift+Enter)' : 'Previous evidence'}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={buttonClass} disabled={searching ? !searchCount : !count} onClick={() => advance(1)} aria-label={searching ? 'Next match' : 'Next evidence'} title={searching ? 'Next match (Enter)' : 'Next evidence'}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        {searching && <button type="button" className={buttonClass} aria-label="Show evidence" title="Clear search and show evidence" onClick={() => { setSearch(''); setNavigationMode('evidence'); setActive(selectedEvidence ? 0 : -1) }}><X className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
      </div>
      <p className="text-xs text-pennie-graphite" role="status">
        {status}
        {navigatingSearch && <span className="sr-only"> · Enter / Shift+Enter moves between matches.</span>}
      </p>
      {recordingTiming?.original_transcript === transcript && <p className="sr-only">Timestamps appear only for verified audio matches. The current passage highlights while playing; scrolling stays in your control.</p>}
      <div ref={contentRef} id={contentId} className={`py-2 ${constrainHeight ? `overflow-y-auto ${expanded ? 'max-h-[70vh]' : 'max-h-96'}` : ''}`}>
        <ol className="space-y-4">
          {blocks.map((block, index) => {
            const parts: ReactNode[] = []
            let cursor = 0
            block.ranges.forEach((range, matchIndex) => {
              if (range.start > cursor) parts.push(block.text.slice(cursor, range.start))
              const matchId = range.matchId
              const current = matchId === position
              parts.push(<mark
                key={matchIndex}
                tabIndex={current && selectedEvidence && !navigatingSearch ? -1 : undefined}
                data-transcript-match={matchId}
                data-evidence-reference={selectedEvidence && !navigatingSearch ? selectedEvidence.referenceId : undefined}
                aria-current={current ? 'true' : undefined}
                className={`${navigatingSearch ? 'bg-pennie-blue-main' : 'bg-pennie-yellow-main'} pennie-focus-ring scroll-mb-4 scroll-mt-24 text-pennie-graphite ${current ? 'underline decoration-pennie-blue-deeper decoration-2 underline-offset-4' : ''}`}
              >{block.text.slice(range.start, range.end)}</mark>)
              cursor = range.end
            })
            parts.push(block.text.slice(cursor))
            const isAgent = /^(handling agent|agent)$/i.test(block.speaker.trim())
            return <li key={index} aria-current={index === playingTurn ? 'true' : undefined}
              className={`min-w-0 rounded-2xl border-2 px-4 py-3 ${block.speaker ? `w-fit max-w-[92%] sm:max-w-[85%] ${isAgent ? 'ml-auto rounded-br-lg bg-pennie-blue-light' : 'mr-auto rounded-bl-lg bg-pennie-white'}` : 'w-full bg-pennie-white'} ${index === playingTurn ? 'border-pennie-blue-deeper' : 'border-pennie-navy/15'}`}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3">
                {block.speaker && <span className="text-xs font-semibold capitalize text-pennie-navy">{block.speaker}</span>}
                {renderAudioLink?.(block.text, block.speaker)}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-pennie-graphite">{parts}</p>
              {index === playingTurn && <span className="sr-only">Playing this passage</span>}
            </li>
          })}
        </ol>
      </div>
      {constrainHeight && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={contentId} className="pennie-focus-ring inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-pennie-blue-deeper underline-offset-4 hover:underline">
        {expanded ? 'Collapse transcript' : 'Expand transcript'}
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>}
    </div>
  )
}
