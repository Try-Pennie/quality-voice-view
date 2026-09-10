/** A literal match in the original text, with exclusive end offset. */
export type TextRange = { readonly start: number; readonly end: number }

/** Speaker turns retain all nonblank content; ambiguous input stays raw. */
export function parseTranscriptTurns(transcript: string): { speaker: string; text: string }[] | null {
  const turns: { speaker: string; text: string }[] = []
  let contentLines = 0
  let matchedLines = 0
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue
    contentLines++
    const match = line.match(/^\s*(?:\[([^\]\r\n]{1,32})\]|([A-Za-z][A-Za-z0-9 .'_-]{0,30}))\s*:\s*(.*)$/)
    const speaker = (match?.[1] ?? match?.[2])?.trim()
    if (speaker && speaker.split(/\s+/).length <= 3) {
      turns.push({ speaker, text: match?.[3] ?? '' })
      matchedLines++
    } else {
      const current = turns[turns.length - 1]
      // Never silently drop a preamble in pursuit of a pretty speaker parse.
      if (!current) return null
      current.text += `\n${line}`
    }
  }
  const speakers = new Set(turns.map(turn => turn.speaker.toLowerCase()))
  return turns.length >= 4 && speakers.size >= 2 && speakers.size <= 6 &&
    matchedLines / Math.max(1, contentLines) >= 0.6 ? turns : null
}

/** Case-insensitive literal matching with whitespace tolerance, never fuzzy matching.
 * Regex metacharacters in quotes/search are escaped. Offsets always refer to source text.
 */
export function findTranscriptRanges(text: string, needles: readonly string[]): TextRange[] {
  const ranges: TextRange[] = []
  for (const needle of new Set(needles.map(value => value.trim()).filter(value => value.length > 0))) {
    const escaped = needle.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    for (const match of text.matchAll(new RegExp(escaped, 'giu'))) {
      ranges.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** Parse only actual evidence quote fields from stored module JSON.
 * Separate full-QA/structured quotes must not be concatenated into an unmatchable quote.
 */
export function extractEvidenceQuotes(violationType: string, result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const quotes: string[] = []
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length >= 12) quotes.push(value.trim())
  }
  if (violationType === 'manager_escalation') {
    if ('call_overview' in result && result.call_overview && typeof result.call_overview === 'object' &&
      'manager_focus_areas' in result.call_overview && Array.isArray(result.call_overview.manager_focus_areas)) {
      for (const area of result.call_overview.manager_focus_areas) {
        if (area && typeof area === 'object' && 'quote' in area) add(area.quote)
      }
    }
  } else if (['budget_compliance', 'litigation_check', 'program_expectations', 'gota_check'].includes(violationType)) {
    if ('key_evidence_quote' in result) add(result.key_evidence_quote)
    if ('evidence' in result && Array.isArray(result.evidence)) {
      for (const item of result.evidence) {
        if (item && typeof item === 'object' && 'quote' in item) add(item.quote)
      }
    }
  }
  // Warm-transfer's violation_reason is an explanation, not a verbatim quote.
  return [...new Set(quotes)]
}
