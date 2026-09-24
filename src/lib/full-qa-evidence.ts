/** The criterion fields needed to project evidence identities. */
type FullQaEvidenceCriterion = {
  readonly key: string
  readonly label: string
  readonly evidencePath: string
}

/** A manager judgment about whether one saved evidence occurrence supports one saved claim. */
export type FullQaEvidenceFeedback = {
  readonly referenceId: string
  readonly disposition: 'correct' | 'incorrect' | 'partly_correct'
  readonly comment: string | null
}

/** One source-bound evidence occurrence and its explicit claim association. */
export type FullQaEvidenceReference = {
  readonly referenceId: string
  readonly claimKind: 'criterion' | 'critical_flag' | 'general_focus'
  readonly claimKey: string
  readonly claimLabel: string
  readonly sourcePath: string
  readonly evidenceKind: 'quote' | 'note' | 'missing'
  readonly text: string | null
  readonly speaker: string | null
  readonly context: string | null
  readonly processStep: string | null
}

type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false }

type EvidenceEntry = {
  readonly evidenceKind: FullQaEvidenceReference['evidenceKind']
  readonly text: string | null
  readonly speaker: string | null
  readonly context: string | null
  readonly processStep: string | null
}

function record(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function trimEvidenceText(input: string): string {
  return input.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')
}

function text(input: unknown): string | null {
  if (typeof input !== 'string') return null
  return trimEvidenceText(input) || null
}

function valueAtPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => record(value) ? value[key] : undefined, input)
}

function evidenceEntry(input: unknown): EvidenceEntry {
  if (typeof input === 'string' && text(input)) {
    return { evidenceKind: 'note', text: text(input), speaker: null, context: null, processStep: null }
  }
  if (!record(input)) {
    return { evidenceKind: 'missing', text: null, speaker: null, context: null, processStep: null }
  }
  const quote = text(input.quote)
  const savedContext = text(input.context)
  if (quote) {
    return { evidenceKind: 'quote', text: quote, speaker: text(input.speaker), context: savedContext, processStep: text(input.process_step) }
  }
  if (savedContext) {
    return { evidenceKind: 'note', text: savedContext, speaker: text(input.speaker), context: null, processStep: text(input.process_step) }
  }
  return { evidenceKind: 'missing', text: null, speaker: text(input.speaker), context: null, processStep: text(input.process_step) }
}

function occurrences(input: unknown, basePath: string): readonly { readonly value: unknown; readonly sourcePath: string }[] {
  if (Array.isArray(input)) {
    return input.length
      ? input.map((value, index) => ({ value, sourcePath: `${basePath}[${index}]` }))
      : [{ value: null, sourcePath: `${basePath}[missing]` }]
  }
  return [{ value: input ?? null, sourcePath: input == null ? `${basePath}[missing]` : basePath }]
}

function reference(
  sourceFingerprint: string,
  claimKind: FullQaEvidenceReference['claimKind'],
  claimKey: string,
  claimLabel: string,
  sourcePath: string,
  occurrence: number,
  input: unknown,
): FullQaEvidenceReference {
  return {
    referenceId: `fqae1|${sourceFingerprint}|${claimKind}|${claimKey}|${occurrence}`,
    claimKind,
    claimKey,
    claimLabel,
    sourcePath,
    ...evidenceEntry(input),
  }
}

/** Project every saved evidence occurrence without quote-based deduping or inferred claim links. */
export function projectFullQaEvidence(
  source: unknown,
  criteria: readonly FullQaEvidenceCriterion[],
  sourceFingerprint: string,
): readonly FullQaEvidenceReference[] {
  const projected: FullQaEvidenceReference[] = []
  for (const criterion of criteria) {
    for (const [index, entry] of occurrences(valueAtPath(source, criterion.evidencePath), criterion.evidencePath).entries()) {
      projected.push(reference(sourceFingerprint, 'criterion', criterion.key, criterion.label,
        entry.sourcePath, index, entry.value))
    }
  }

  const criticalFlags = valueAtPath(source, 'compliance_scorecard.critical_red_flag_hits')
  if (Array.isArray(criticalFlags)) {
    for (const [flagIndex, flag] of criticalFlags.entries()) {
      const claimLabel = record(flag) ? text(flag.red_flag) ?? 'Unlabeled critical flag' : 'Unlabeled critical flag'
      const evidence = record(flag) ? flag.evidence : null
      const basePath = `compliance_scorecard.critical_red_flag_hits[${flagIndex}].evidence`
      for (const [index, entry] of occurrences(evidence, basePath).entries()) {
        projected.push(reference(sourceFingerprint, 'critical_flag', String(flagIndex), claimLabel,
          entry.sourcePath, index, entry.value))
      }
    }
  }

  const focusAreas = valueAtPath(source, 'call_overview.manager_focus_areas')
  if (focusAreas != null) {
    const basePath = 'call_overview.manager_focus_areas'
    const areas = Array.isArray(focusAreas)
      ? focusAreas.map((value, index) => ({ value, sourcePath: `${basePath}[${index}]` }))
      : [{ value: focusAreas, sourcePath: basePath }]
    for (const [index, entry] of areas.entries()) {
      projected.push(reference(sourceFingerprint, 'general_focus', String(index), 'General review focus (no specific claim saved)',
        entry.sourcePath, 0, entry.value))
    }
  }
  return projected
}

/** Parse server-issued evidence references and reject incomplete or duplicate identities. */
export function parseFullQaEvidenceReferences(input: unknown): ParseResult<readonly FullQaEvidenceReference[]> {
  if (!Array.isArray(input)) return { ok: false }
  const references: FullQaEvidenceReference[] = []
  for (const item of input) {
    if (!record(item)) return { ok: false }
    const { reference_id: referenceId, claim_kind: claimKind, claim_key: claimKey, claim_label: claimLabel,
      source_path: sourcePath, evidence_kind: evidenceKind, text: evidenceText, speaker, context, process_step: processStep } = item
    if (typeof referenceId !== 'string'
      || (claimKind !== 'criterion' && claimKind !== 'critical_flag' && claimKind !== 'general_focus')
      || typeof claimKey !== 'string' || typeof claimLabel !== 'string' || typeof sourcePath !== 'string'
      || (evidenceKind !== 'quote' && evidenceKind !== 'note' && evidenceKind !== 'missing')
      || (evidenceText !== null && typeof evidenceText !== 'string') || (speaker !== null && typeof speaker !== 'string')
      || (context !== null && typeof context !== 'string') || (processStep !== null && typeof processStep !== 'string')) return { ok: false }
    references.push({ referenceId, claimKind, claimKey, claimLabel, sourcePath, evidenceKind,
      text: typeof evidenceText === 'string' ? evidenceText : null,
      speaker: typeof speaker === 'string' ? speaker : null,
      context: typeof context === 'string' ? context : null,
      processStep: typeof processStep === 'string' ? processStep : null })
  }
  if (new Set(references.map(item => item.referenceId)).size !== references.length) return { ok: false }
  return { ok: true, value: references }
}

/** Parse persisted evidence feedback. Comments are optional and bounded by Unicode code points. */
export function parseFullQaEvidenceFeedback(input: unknown): ParseResult<readonly FullQaEvidenceFeedback[]> {
  if (!Array.isArray(input)) return { ok: false }
  const feedback: FullQaEvidenceFeedback[] = []
  for (const item of input) {
    if (!record(item)) return { ok: false }
    const { reference_id: referenceId, disposition, comment } = item
    if (typeof referenceId !== 'string'
      || (disposition !== 'correct' && disposition !== 'incorrect' && disposition !== 'partly_correct')
      || !(comment === null || (typeof comment === 'string' && Array.from(comment.trim()).length <= 4000))) return { ok: false }
    feedback.push({ referenceId, disposition, comment: typeof comment === 'string' ? comment.trim() || null : null })
  }
  if (new Set(feedback.map(item => item.referenceId)).size !== feedback.length) return { ok: false }
  return { ok: true, value: feedback }
}

/** Validate and normalize draft feedback against the exact references issued for this source. */
export function parseFullQaEvidenceFeedbackDraft(
  references: readonly FullQaEvidenceReference[],
  input: readonly FullQaEvidenceFeedback[],
): ParseResult<readonly FullQaEvidenceFeedback[]> {
  const reviewable = new Set(references.filter(item => item.evidenceKind !== 'missing').map(item => item.referenceId))
  if (new Set(input.map(item => item.referenceId)).size !== input.length || input.some(item => !reviewable.has(item.referenceId))) return { ok: false }
  return parseFullQaEvidenceFeedback(input.map(item => ({ reference_id: item.referenceId, disposition: item.disposition, comment: item.comment })))
}
