import { supabase } from '@/integrations/supabase/client'
import { findTranscriptRanges, parseTranscriptTurns } from './transcript-evidence'

/** Audio-only timing cache; the original transcript and QA remain authoritative. */
export type RecordingTiming = {
  readonly recording_reference: string
  readonly original_transcript: string
  readonly duration: number
  readonly words: readonly { readonly text: string; readonly start: number; readonly end: number }[]
}

function parseRecordingTiming(value: unknown): RecordingTiming | null {
  if (!value || typeof value !== 'object' || !('recording_reference' in value) || !('duration' in value) || !('words' in value) || !('original_transcript' in value)) return null
  const { recording_reference, original_transcript, duration, words } = value
  if (typeof recording_reference !== 'string' || !recording_reference || recording_reference.length > 2048 ||
    typeof original_transcript !== 'string' || !original_transcript.trim() || original_transcript.length > 200000 ||
    typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 36000 ||
    !Array.isArray(words) || !words.length || words.length > 100000) return null
  const parsed: { text: string; start: number; end: number }[] = []
  for (const word of words) {
    if (!word || typeof word !== 'object' || typeof word.text !== 'string' || !word.text || word.text.length > 1000 ||
      typeof word.start !== 'number' || !Number.isFinite(word.start) || word.start < 0 ||
      typeof word.end !== 'number' || !Number.isFinite(word.end) || word.end < word.start || word.end > duration + 0.1) return null
    parsed.push({ text: word.text, start: word.start, end: word.end })
  }
  return { recording_reference, original_transcript, duration, words: parsed }
}

/** Scoped server RPC; missing/failed timing must never block review or audio playback. */
export async function fetchRecordingTiming(callId: string, moduleName: string): Promise<RecordingTiming | null> {
  // SAFETY: generated DB types predate this RPC. Unknown results are parsed below.
  const client = supabase as unknown as { rpc(name: 'get_recording_word_timestamps', args: { p_call_id: string; p_module_name: string }): PromiseLike<{ data: unknown; error: unknown }> }
  const { data, error } = await client.rpc('get_recording_word_timestamps', { p_call_id: callId, p_module_name: moduleName })
  if (error || data === null) return null
  return parseRecordingTiming(data)
}

function tokens(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().replace(/’/g, "'").split(/\s+/)
    .map(word => word.replace(/^[“”"(),.!?:;]+|[“”"(),.!?:;]+$/g, ''))
    .filter(word => word.length > 0)
}

/** Pre-index once per recording and memoize each quote, including misses. Only a
 * unique literal sequence in BOTH the original transcript and STT receives a time.
 * Evidence-only spoken-spelling mode accepts gonna/going-to spelling, but also
 * requires the full saved quote to match literally once in the original.
 * No fillers removed, semantic/fuzzy alignment, partial quotes, or guessed times.
 */
export function createAudioQuoteMatcher(timing: RecordingTiming, mode: 'literal' | 'spoken-spelling' = 'literal'): (quote: string) => { readonly start: number; readonly end: number } | null {
  // Expand both sides, never removing words, negation, signs or amounts.
  const matchTokens = (text: string) => tokens(text).flatMap(word => mode === 'spoken-spelling' && word === 'gonna' ? ['going', 'to'] : [word])
  // A sentinel prevents a quote from crossing speaker turns after labels are removed.
  const turns = parseTranscriptTurns(timing.original_transcript) ?? [{ text: timing.original_transcript }]
  const rawOriginal = turns.map(turn => turn.text).join('\u0000')
  const original = turns.flatMap(turn => [...matchTokens(turn.text), '\u0000'])
  const words = timing.words.flatMap(word => matchTokens(word.text).map(token => ({ token, start: word.start, end: word.end })))
  const cache = new Map<string, { readonly start: number; readonly end: number } | null>()
  const positionsFor = (haystack: readonly string[]) => {
    const positions = new Map<string, number[]>()
    haystack.forEach((word, index) => {
      const existing = positions.get(word)
      if (existing) existing.push(index)
      else positions.set(word, [index])
    })
    return positions
  }
  const uniqueIndex = (haystack: readonly string[], positions: ReadonlyMap<string, readonly number[]>, needle: readonly string[]) => {
    let found = -1
    for (const index of positions.get(needle[0]) ?? []) {
      if (!needle.every((token, offset) => haystack[index + offset] === token)) continue
      if (found >= 0) return -1
      found = index
    }
    return found
  }
  const audioTokens = words.map(word => word.token)
  const originalPositions = positionsFor(original)
  const audioPositions = positionsFor(audioTokens)
  return quote => {
    if (cache.has(quote)) return cache.get(quote) ?? null
    if (mode === 'spoken-spelling' && findTranscriptRanges(rawOriginal, [quote]).length !== 1) {
      cache.set(quote, null)
      return null
    }
    const needle = matchTokens(quote)
    const originalIndex = uniqueIndex(original, originalPositions, needle)
    const index = quote.trim().split(/\s+/).length >= 4 && needle.length >= 4 && quote.trim().length >= 12 && originalIndex >= 0 ? uniqueIndex(audioTokens, audioPositions, needle) : -1
    const range = index < 0 ? [] : words.slice(index, index + needle.length)
    const time = range.length && !range.some((word, offset) => offset > 0 && (word.start < range[offset - 1].start || word.end < range[offset - 1].end))
      ? { start: range[0].start, end: range[range.length - 1].end } : null
    cache.set(quote, time)
    return time
  }
}
