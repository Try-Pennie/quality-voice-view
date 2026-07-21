import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/*
  Speaker-turn transcript renderer.

  Regal transcripts arrive as plain text without reliable timestamps, so this
  component does the best presentational job possible without them:

  - Parses `Speaker: text` line prefixes into visually distinct turns.
  - Highlights alert evidence quotes via normalized text matching (no
    timestamps needed) so reviewers can spot the flagged moment while
    scrubbing the audio manually.
  - Falls back to the raw text block whenever the transcript doesn't parse
    confidently — never worse than the old <pre> rendering.
*/

type Turn = {
  speaker: string
  text: string
}

// A speaker label is a short prefix before a colon — "Agent:", "Customer:",
// "Speaker 1:", "John Smith:". Longer prefixes are almost certainly prose
// containing a colon, so we cap length and word count.
const SPEAKER_LINE = /^\s*([A-Za-z][A-Za-z0-9 .'_-]{0,30}?)\s*:\s*(.*)$/

function parseTurns(transcript: string): Turn[] | null {
  const lines = transcript.split(/\r?\n/)
  const turns: Turn[] = []
  let current: Turn | null = null
  let matchedLines = 0
  let contentLines = 0

  for (const line of lines) {
    if (!line.trim()) continue
    contentLines++
    const m = line.match(SPEAKER_LINE)
    const speaker = m?.[1]?.trim()
    const isSpeakerLine =
      !!m && !!speaker && speaker.split(/\s+/).length <= 3
    if (isSpeakerLine) {
      matchedLines++
      if (current) turns.push(current)
      current = { speaker: speaker!, text: m![2] ?? '' }
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line.trim()
    }
  }
  if (current) turns.push(current)

  // Only trust the parse when the transcript is mostly speaker-prefixed and
  // involves an actual back-and-forth. Otherwise render the raw fallback.
  const speakers = new Set(turns.map(t => t.speaker.toLowerCase()))
  if (
    turns.length < 4 ||
    speakers.size < 2 ||
    speakers.size > 6 ||
    matchedLines / Math.max(1, contentLines) < 0.6
  ) {
    return null
  }
  return turns
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Render `text`, wrapping any evidence quote it contains in a <mark>. Exact
 * (case-insensitive) substring match only — normalized containment without an
 * exact position falls back to flagging the whole turn via `turnFlagged`.
 */
function renderWithHighlights(text: string, evidence: string[]) {
  type Range = { start: number; end: number }
  const lower = text.toLowerCase()
  const ranges: Range[] = []
  for (const quote of evidence) {
    const q = quote.trim().toLowerCase()
    if (q.length < 12) continue
    let from = 0
    while (from < lower.length) {
      const idx = lower.indexOf(q, from)
      if (idx === -1) break
      ranges.push({ start: idx, end: idx + q.length })
      from = idx + q.length
    }
  }
  if (ranges.length === 0) return text

  ranges.sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      merged.push({ ...r })
    }
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  merged.forEach((r, i) => {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start))
    parts.push(
      <mark
        key={i}
        className="bg-pennie-yellow-light text-pennie-graphite rounded-sm px-0.5"
      >
        {text.slice(r.start, r.end)}
      </mark>,
    )
    cursor = r.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function turnContainsEvidence(turn: Turn, evidence: string[]): boolean {
  const t = normalize(turn.text)
  return evidence.some(q => {
    const nq = normalize(q)
    return nq.length >= 12 && t.includes(nq)
  })
}

const COLLAPSED_MAX_HEIGHT = 'max-h-96'

export function TranscriptView({
  transcript,
  evidence = [],
}: {
  transcript: string
  /** Evidence quotes from this call's alerts — highlighted via text match. */
  evidence?: string[]
}) {
  const [expanded, setExpanded] = useState(false)
  const turns = useMemo(() => parseTurns(transcript), [transcript])
  const cleanedEvidence = useMemo(
    () => evidence.map(e => e.trim()).filter(e => e.length >= 12),
    [evidence],
  )
  const hasHighlights = useMemo(
    () =>
      cleanedEvidence.length > 0 &&
      (turns
        ? turns.some(t => turnContainsEvidence(t, cleanedEvidence))
        : cleanedEvidence.some(q =>
            normalize(transcript).includes(normalize(q)),
          )),
    [turns, transcript, cleanedEvidence],
  )

  // Speaker → stable accent, assigned in order of first appearance. First
  // speaker (usually the agent) gets navy, second gets blue.
  const speakerStyles = useMemo(() => {
    if (!turns) return new Map<string, string>()
    const styles = [
      'text-pennie-navy',
      'text-pennie-blue-deeper',
      'text-pennie-indigo-dark',
      'text-pennie-graphite',
    ]
    const map = new Map<string, string>()
    for (const t of turns) {
      const key = t.speaker.toLowerCase()
      if (!map.has(key)) map.set(key, styles[map.size % styles.length])
    }
    return map
  }, [turns])

  return (
    <div>
      {hasHighlights && (
        <p className="mb-3 text-xs text-pennie-graphite/70 inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm bg-pennie-yellow-light border border-pennie-yellow-main"
            aria-hidden="true"
          />
          Highlighted passages were quoted as evidence by this call's alerts.
        </p>
      )}

      <div
        className={`bg-pennie-beige/60 rounded-2xl p-4 sm:p-5 overflow-y-auto ${
          expanded ? 'max-h-[70vh]' : COLLAPSED_MAX_HEIGHT
        }`}
      >
        {turns ? (
          <ol className="space-y-4">
            {turns.map((turn, i) => {
              const flagged = turnContainsEvidence(turn, cleanedEvidence)
              return (
                <li
                  key={i}
                  className={
                    flagged
                      ? '-mx-2 px-2 py-1.5 rounded-xl bg-pennie-yellow-light/50'
                      : ''
                  }
                >
                  <span
                    className={`block text-[11px] font-bold uppercase tracking-wider mb-0.5 ${
                      speakerStyles.get(turn.speaker.toLowerCase()) ??
                      'text-pennie-navy'
                    }`}
                  >
                    {turn.speaker}
                  </span>
                  <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">
                    {renderWithHighlights(turn.text, cleanedEvidence)}
                  </p>
                </li>
              )
            })}
          </ol>
        ) : (
          <pre className="whitespace-pre-wrap text-sm text-pennie-graphite font-sans leading-relaxed">
            {renderWithHighlights(transcript, cleanedEvidence)}
          </pre>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
      >
        {expanded ? 'Collapse transcript' : 'Expand transcript'}
        <ChevronDown
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
    </div>
  )
}
