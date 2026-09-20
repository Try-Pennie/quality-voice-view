import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { findTranscriptRanges, parseTranscriptTurns } from '@/lib/transcript-evidence'

/** Searchable speaker turns with literal evidence navigation; no inferred audio timestamps. */
export function TranscriptView({ transcript, evidence = [], constrainHeight = true, focusRequest = 0, renderAudioLink }: {
  transcript: string
  evidence?: string[]
  constrainHeight?: boolean
  /** Explicit navigation request, not focus on every data refresh. */
  focusRequest?: number
  /** Optional verified timing; unmatched turns retain the original text without a link. */
  renderAudioLink?: (quote: string) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(-1)
  const searchId = useId()
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusRequest > 0) {
      searchRef.current?.focus({ preventScroll: true })
      searchRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    }
  }, [focusRequest])
  const turns = useMemo(() => parseTranscriptTurns(transcript), [transcript])
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
    if (position < 0) return
    contentRef.current?.querySelector(`[data-transcript-match="${position}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [position, blocks])

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
            return <li key={index}>
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                {block.speaker && <span className="block text-[11px] font-bold uppercase tracking-wider mb-0.5 text-pennie-navy">{block.speaker}</span>}
                {renderAudioLink?.(block.text)}
              </div>
              <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">{parts}</p>
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
