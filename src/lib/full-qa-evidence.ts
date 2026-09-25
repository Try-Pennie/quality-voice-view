/** The criterion fields needed to project legacy evidence identities. */
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

/** One exact whole-turn passage from the immutable candidate source. */
export type FullQaSourcePassage = {
  readonly turnId: string
  readonly ordinal: number
  readonly rawStart: number
  readonly rawEnd: number
  readonly textStart: number
  readonly textEnd: number
  readonly text: string
  readonly speakerSourceLabel: string
  readonly speakerRole: 'handling_agent' | 'customer' | 'transfer_agent' | 'other'
}

/** One source-bound evidence occurrence and its explicit claim association. */
export type FullQaEvidenceReference = {
  readonly referenceId: string
  readonly claimKind: 'criterion' | 'critical_flag' | 'general_focus' | 'source_finding'
  readonly claimKey: string
  readonly claimLabel: string
  readonly sourcePath: string
  readonly evidenceKind: 'quote' | 'note' | 'missing' | 'source_passages' | 'omission'
  readonly text: string | null
  readonly speaker: string | null
  readonly context: string | null
  readonly processStep: string | null
  readonly sourcePassages: readonly FullQaSourcePassage[]
}

/** One parsed six-rule candidate finding. Its assessment remains explicitly unverified. */
export type FullQaSourceFinding = {
  readonly claimId: string
  readonly ruleKey: FullQaSourceRuleKey
  readonly findingType: 'statement' | 'omission'
  readonly assessment: string
  readonly evidenceOccurrences: readonly { readonly evidenceId: string; readonly supportingTurnIds: readonly string[] }[]
}

/** The parsed immutable source-candidate envelope used by the staging UI. */
export type FullQaSourceCandidate = {
  readonly transcript: string
  readonly modelProvider: string
  readonly modelId: string
  readonly sourceId: string
  readonly sourceRevision: string
  readonly sourceFingerprint: string
  readonly transcriptSha256: string
  readonly turns: readonly FullQaSourcePassage[]
  readonly findings: readonly FullQaSourceFinding[]
}

type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false }

type EvidenceEntry = {
  readonly evidenceKind: FullQaEvidenceReference['evidenceKind']
  readonly text: string | null
  readonly speaker: string | null
  readonly context: string | null
  readonly processStep: string | null
}

type FullQaSourceRuleKey = keyof typeof SOURCE_RULE_LABELS

const SOURCE_RULE_LABELS = {
  call_recording_disclosure: 'Call recording disclosure',
  credit_pull_consent: 'Credit pull consent',
  outcome_guarantee: 'Outcome guarantee',
  program_misrepresentation: 'Program misrepresentation',
  negative_customer_treatment: 'Negative customer treatment',
  unresolved_customer_confusion: 'Unresolved customer confusion',
} as const
const OMISSION_RULES: readonly FullQaSourceRuleKey[] = ['call_recording_disclosure', 'credit_pull_consent']
const SOURCE_FINGERPRINT = /^[a-f0-9]{64}$/
const CLAIM_ID = /^fqac1_[a-f0-9]{64}$/
const EVIDENCE_ID = /^fqae1_[a-f0-9]{64}$/

function record(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function exactKeys(input: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(input).sort()
  return actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key)
}

function integer(input: unknown, min = 0): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= min
}

function sourceRule(input: unknown): input is FullQaSourceRuleKey {
  return typeof input === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_RULE_LABELS, input)
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

function legacyReference(
  sourceFingerprint: string,
  claimKind: 'criterion' | 'critical_flag' | 'general_focus',
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
    sourcePassages: [],
  }
}

function sourceRole(input: unknown): input is FullQaSourcePassage['speakerRole'] {
  return input === 'handling_agent' || input === 'customer' || input === 'transfer_agent' || input === 'other'
}

function parseSourcePassage(input: unknown, transcript: string, sourceFingerprint: string, expectedOrdinal: number): FullQaSourcePassage | null {
  if (!record(input) || !exactKeys(input, ['ordinal', 'raw_start', 'raw_end', 'raw_text', 'text_start', 'text_end', 'text', 'speaker', 'turn_id'])
    || input.ordinal !== expectedOrdinal || !integer(input.raw_start) || !integer(input.raw_end) || !integer(input.text_start) || !integer(input.text_end)
    || typeof input.raw_text !== 'string' || typeof input.text !== 'string' || typeof input.turn_id !== 'string' || !record(input.speaker)
    || !exactKeys(input.speaker, ['source_label', 'role', 'attribution_basis']) || typeof input.speaker.source_label !== 'string'
    || !sourceRole(input.speaker.role)
    || input.speaker.attribution_basis !== 'caller_supplied_not_identity_proof') return null
  const expectedTurnId = `turn_v1_${sourceFingerprint}_${String(expectedOrdinal).padStart(6, '0')}`
  const lineMatch = /^(\s*)\[([^\]\r\n]+)\](\s*):(\s*)(.+)$/.exec(input.raw_text)
  if (input.turn_id !== expectedTurnId || input.raw_start > input.raw_end || input.text_start < input.raw_start || input.text_end > input.raw_end
    || input.text_start > input.text_end || transcript.slice(input.raw_start, input.raw_end) !== input.raw_text
    || transcript.slice(input.text_start, input.text_end) !== input.text || !lineMatch
    || lineMatch[2] !== input.speaker.source_label || lineMatch[5] !== input.text
    || input.text_start !== input.raw_start + (lineMatch[1]?.length ?? 0) + 1 + input.speaker.source_label.length + 1
      + (lineMatch[3]?.length ?? 0) + 1 + (lineMatch[4]?.length ?? 0)
    || (input.raw_start > 0 && transcript[input.raw_start - 1] !== '\n')
    || (input.raw_end < transcript.length && transcript[input.raw_end] !== '\n' && !(transcript[input.raw_end] === '\r' && transcript[input.raw_end + 1] === '\n'))) return null
  return {
    turnId: input.turn_id,
    ordinal: input.ordinal,
    rawStart: input.raw_start,
    rawEnd: input.raw_end,
    textStart: input.text_start,
    textEnd: input.text_end,
    text: input.text,
    speakerSourceLabel: input.speaker.source_label,
    speakerRole: input.speaker.role,
  }
}

/** Parse the strict source_candidate wrapper and validate exact source offsets and references. */
export function parseFullQaSourceCandidate(source: unknown): ParseResult<FullQaSourceCandidate | null> {
  if (!record(source) || !Object.prototype.hasOwnProperty.call(source, 'source_candidate')) return { ok: true, value: null }
  const envelope = source.source_candidate
  if (!record(envelope) || !exactKeys(envelope, ['candidate', 'transcript']) || typeof envelope.transcript !== 'string'
    || envelope.transcript.length < 1 || envelope.transcript.length > 200_000 || !record(envelope.candidate)
    || !exactKeys(envelope.candidate, ['metadata', 'source', 'findings'])) return { ok: false }
  const candidate = envelope.candidate
  const metadata = candidate.metadata
  const indexedSource = candidate.source
  const rawFindings = candidate.findings
  if (!record(metadata) || !exactKeys(metadata, ['schema_version', 'index_version', 'prompt_version', 'prompt_sha256', 'rubric_version', 'model', 'provenance', 'prompt_role'])
    || metadata.schema_version !== 'full_qa_evidence_candidate_v1' || metadata.index_version !== 'full_qa_transcript_index_v1'
    || metadata.prompt_version !== 'full_qa_evidence_candidate_prompt_v1' || metadata.rubric_version !== 'full_qa_high_risk_subset_v1'
    || typeof metadata.prompt_sha256 !== 'string' || !SOURCE_FINGERPRINT.test(metadata.prompt_sha256)
    || metadata.provenance !== 'unverified_submission' || metadata.prompt_role !== 'contract_reference_not_execution_attestation'
    || !record(metadata.model) || !exactKeys(metadata.model, ['provider', 'model_id', 'declared_by'])
    || typeof metadata.model.provider !== 'string' || metadata.model.provider.trim().length < 1 || metadata.model.provider.length > 200
    || typeof metadata.model.model_id !== 'string' || metadata.model.model_id.trim().length < 1 || metadata.model.model_id.length > 500
    || metadata.model.declared_by !== 'caller' || !record(indexedSource)
    || !exactKeys(indexedSource, ['index_version', 'source_id', 'source_revision', 'source_fingerprint', 'transcript_sha256', 'offset_unit', 'raw_start', 'raw_end', 'turns'])
    || indexedSource.index_version !== 'full_qa_transcript_index_v1' || typeof indexedSource.source_id !== 'string'
    || indexedSource.source_id.trim().length < 1 || indexedSource.source_id.length > 500 || typeof indexedSource.source_revision !== 'string'
    || indexedSource.source_revision.trim().length < 1 || indexedSource.source_revision.length > 500
    || typeof indexedSource.source_fingerprint !== 'string' || !SOURCE_FINGERPRINT.test(indexedSource.source_fingerprint)
    || typeof indexedSource.transcript_sha256 !== 'string' || !SOURCE_FINGERPRINT.test(indexedSource.transcript_sha256)
    || indexedSource.offset_unit !== 'utf16_code_unit' || indexedSource.raw_start !== 0 || indexedSource.raw_end !== envelope.transcript.length
    || !Array.isArray(indexedSource.turns) || indexedSource.turns.length < 1 || indexedSource.turns.length > 2_000
    || !Array.isArray(rawFindings) || rawFindings.length > 50) return { ok: false }

  const expectedLines: { readonly rawStart: number; readonly rawEnd: number; readonly rawText: string }[] = []
  let lineStart = 0
  while (lineStart < envelope.transcript.length) {
    const newline = envelope.transcript.indexOf('\n', lineStart)
    const lineEnd = newline < 0 ? envelope.transcript.length : newline
    const rawEnd = envelope.transcript.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd
    const rawText = envelope.transcript.slice(lineStart, rawEnd)
    if (rawText.trim()) expectedLines.push({ rawStart: lineStart, rawEnd, rawText })
    if (newline < 0) break
    lineStart = newline + 1
  }
  if (expectedLines.length !== indexedSource.turns.length) return { ok: false }
  const turns: FullQaSourcePassage[] = []
  for (const [index, input] of indexedSource.turns.entries()) {
    const passage = parseSourcePassage(input, envelope.transcript, indexedSource.source_fingerprint, index)
    const expected = expectedLines[index]
    if (!passage || !expected || passage.rawStart !== expected.rawStart || passage.rawEnd !== expected.rawEnd
      || envelope.transcript.slice(passage.rawStart, passage.rawEnd) !== expected.rawText) return { ok: false }
    turns.push(passage)
  }
  const turnById = new Map(turns.map(turn => [turn.turnId, turn]))
  const findings: FullQaSourceFinding[] = []
  const claimIds = new Set<string>()
  const evidenceIds = new Set<string>()
  const findingKeys = new Set<string>()
  let citationCount = 0
  for (const rawFinding of rawFindings) {
    if (!record(rawFinding) || !exactKeys(rawFinding, ['claim_id', 'claim', 'evidence_occurrences', 'reviewed_source'])
      || typeof rawFinding.claim_id !== 'string' || !CLAIM_ID.test(rawFinding.claim_id) || claimIds.has(rawFinding.claim_id)
      || !record(rawFinding.claim) || !exactKeys(rawFinding.claim, ['rule_key', 'finding_type', 'text', 'interpretation'])
      || !sourceRule(rawFinding.claim.rule_key) || (rawFinding.claim.finding_type !== 'statement' && rawFinding.claim.finding_type !== 'omission')
      || typeof rawFinding.claim.text !== 'string' || rawFinding.claim.text !== rawFinding.claim.text.trim()
      || rawFinding.claim.text.length < 1 || rawFinding.claim.text.length > 2_000
      || rawFinding.claim.interpretation !== 'unverified_ai_assessment_not_source_evidence'
      || !Array.isArray(rawFinding.evidence_occurrences)) return { ok: false }
    const findingType = rawFinding.claim.finding_type
    if ((findingType === 'statement' && (rawFinding.evidence_occurrences.length < 1 || rawFinding.evidence_occurrences.length > 20 || rawFinding.reviewed_source !== null))
      || (findingType === 'omission' && (rawFinding.evidence_occurrences.length !== 0 || !OMISSION_RULES.includes(rawFinding.claim.rule_key)))) return { ok: false }
    if (findingType === 'omission') {
      const reviewed = rawFinding.reviewed_source
      if (!record(reviewed) || !exactKeys(reviewed, ['source_fingerprint', 'transcript_sha256', 'raw_start', 'raw_end', 'interpretation'])
        || reviewed.source_fingerprint !== indexedSource.source_fingerprint || reviewed.transcript_sha256 !== indexedSource.transcript_sha256
        || reviewed.raw_start !== 0 || reviewed.raw_end !== envelope.transcript.length
        || reviewed.interpretation !== 'ai_omission_hypothesis_scoped_to_supplied_source_not_proof_of_absence') return { ok: false }
    }
    const occurrences: { evidenceId: string; supportingTurnIds: string[] }[] = []
    const seenTurns = new Set<string>()
    let previousOrdinal = -1
    for (const rawOccurrence of rawFinding.evidence_occurrences) {
      if (!record(rawOccurrence) || !exactKeys(rawOccurrence, ['evidence_id', 'supporting_turn_ids'])
        || typeof rawOccurrence.evidence_id !== 'string' || !EVIDENCE_ID.test(rawOccurrence.evidence_id) || evidenceIds.has(rawOccurrence.evidence_id)
        || !Array.isArray(rawOccurrence.supporting_turn_ids) || rawOccurrence.supporting_turn_ids.length < 1 || rawOccurrence.supporting_turn_ids.length > 20
        || !rawOccurrence.supporting_turn_ids.every(turnId => typeof turnId === 'string')) return { ok: false }
      const supportingTurnIds = rawOccurrence.supporting_turn_ids
      for (const turnId of supportingTurnIds) {
        citationCount += 1
        const turn = turnById.get(turnId)
        if (citationCount > 1_000 || !turn || seenTurns.has(turnId) || turn.ordinal <= previousOrdinal) return { ok: false }
        seenTurns.add(turnId)
        previousOrdinal = turn.ordinal
      }
      evidenceIds.add(rawOccurrence.evidence_id)
      occurrences.push({ evidenceId: rawOccurrence.evidence_id, supportingTurnIds })
    }
    const findingKey = JSON.stringify([findingType, rawFinding.claim.rule_key, occurrences.map(item => item.supportingTurnIds)])
    if (findingKeys.has(findingKey)) return { ok: false }
    findingKeys.add(findingKey)
    claimIds.add(rawFinding.claim_id)
    findings.push({ claimId: rawFinding.claim_id, ruleKey: rawFinding.claim.rule_key, findingType,
      assessment: rawFinding.claim.text, evidenceOccurrences: occurrences })
  }
  return { ok: true, value: { transcript: envelope.transcript, modelProvider: metadata.model.provider, modelId: metadata.model.model_id,
    sourceId: indexedSource.source_id, sourceRevision: indexedSource.source_revision, sourceFingerprint: indexedSource.source_fingerprint,
    transcriptSha256: indexedSource.transcript_sha256, turns, findings } }
}

function projectSourceCandidate(candidate: FullQaSourceCandidate, sourceFingerprint: string): readonly FullQaEvidenceReference[] {
  const turns = new Map(candidate.turns.map(turn => [turn.turnId, turn]))
  const references: FullQaEvidenceReference[] = []
  for (const [findingIndex, finding] of candidate.findings.entries()) {
    if (finding.findingType === 'omission') {
      references.push({ referenceId: `fqae1|${sourceFingerprint}|source_finding|${finding.claimId}|omission`, claimKind: 'source_finding',
        claimKey: finding.claimId, claimLabel: SOURCE_RULE_LABELS[finding.ruleKey], sourcePath: `source_candidate.candidate.findings[${findingIndex}].reviewed_source`,
        evidenceKind: 'omission', text: finding.assessment, speaker: null, context: null, processStep: finding.ruleKey, sourcePassages: [] })
      continue
    }
    for (const [occurrenceIndex, occurrence] of finding.evidenceOccurrences.entries()) {
      references.push({ referenceId: `fqae1|${sourceFingerprint}|source_finding|${finding.claimId}|${occurrence.evidenceId}`,
        claimKind: 'source_finding', claimKey: finding.claimId, claimLabel: SOURCE_RULE_LABELS[finding.ruleKey],
        sourcePath: `source_candidate.candidate.findings[${findingIndex}].evidence_occurrences[${occurrenceIndex}]`,
        evidenceKind: 'source_passages', text: finding.assessment, speaker: null, context: null, processStep: finding.ruleKey,
        sourcePassages: occurrence.supportingTurnIds.flatMap(turnId => {
          const turn = turns.get(turnId)
          return turn ? [turn] : []
        }) })
    }
  }
  return references
}

/** Project every saved evidence occurrence without quote-based deduping or inferred claim links. */
export function projectFullQaEvidence(
  source: unknown,
  criteria: readonly FullQaEvidenceCriterion[],
  sourceFingerprint: string,
): readonly FullQaEvidenceReference[] {
  const parsedCandidate = parseFullQaSourceCandidate(source)
  if (parsedCandidate.ok === false) return []
  if (parsedCandidate.value) return projectSourceCandidate(parsedCandidate.value, sourceFingerprint)

  const projected: FullQaEvidenceReference[] = []
  for (const criterion of criteria) {
    for (const [index, entry] of occurrences(valueAtPath(source, criterion.evidencePath), criterion.evidencePath).entries()) {
      projected.push(legacyReference(sourceFingerprint, 'criterion', criterion.key, criterion.label,
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
        projected.push(legacyReference(sourceFingerprint, 'critical_flag', String(flagIndex), claimLabel,
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
      projected.push(legacyReference(sourceFingerprint, 'general_focus', String(index), 'General review focus (no specific claim saved)',
        entry.sourcePath, 0, entry.value))
    }
  }
  return projected
}

function parseSourcePassages(input: unknown): FullQaSourcePassage[] | null {
  if (!Array.isArray(input)) return null
  const passages: FullQaSourcePassage[] = []
  for (const passage of input) {
    if (!record(passage) || !exactKeys(passage, ['turn_id', 'ordinal', 'raw_start', 'raw_end', 'text_start', 'text_end', 'text', 'speaker_source_label', 'speaker_role'])
      || typeof passage.turn_id !== 'string' || !integer(passage.ordinal) || !integer(passage.raw_start) || !integer(passage.raw_end)
      || !integer(passage.text_start) || !integer(passage.text_end) || typeof passage.text !== 'string'
      || typeof passage.speaker_source_label !== 'string' || !sourceRole(passage.speaker_role)) return null
    passages.push({ turnId: passage.turn_id, ordinal: passage.ordinal, rawStart: passage.raw_start, rawEnd: passage.raw_end,
      textStart: passage.text_start, textEnd: passage.text_end, text: passage.text, speakerSourceLabel: passage.speaker_source_label,
      speakerRole: passage.speaker_role })
  }
  return passages
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
      || (claimKind !== 'criterion' && claimKind !== 'critical_flag' && claimKind !== 'general_focus' && claimKind !== 'source_finding')
      || typeof claimKey !== 'string' || typeof claimLabel !== 'string' || typeof sourcePath !== 'string'
      || (evidenceKind !== 'quote' && evidenceKind !== 'note' && evidenceKind !== 'missing' && evidenceKind !== 'source_passages' && evidenceKind !== 'omission')
      || (evidenceText !== null && typeof evidenceText !== 'string') || (speaker !== null && typeof speaker !== 'string')
      || (context !== null && typeof context !== 'string') || (processStep !== null && typeof processStep !== 'string')) return { ok: false }
    const sourcePassages = parseSourcePassages(item.source_passages ?? [])
    if (!sourcePassages || (evidenceKind === 'source_passages' && (claimKind !== 'source_finding' || sourcePassages.length < 1 || typeof evidenceText !== 'string'))
      || (evidenceKind === 'omission' && (claimKind !== 'source_finding' || sourcePassages.length !== 0 || typeof evidenceText !== 'string'))
      || ((evidenceKind === 'quote' || evidenceKind === 'note' || evidenceKind === 'missing') && sourcePassages.length !== 0)) return { ok: false }
    references.push({ referenceId, claimKind, claimKey, claimLabel, sourcePath, evidenceKind,
      text: typeof evidenceText === 'string' ? evidenceText : null,
      speaker: typeof speaker === 'string' ? speaker : null,
      context: typeof context === 'string' ? context : null,
      processStep: typeof processStep === 'string' ? processStep : null,
      sourcePassages })
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
