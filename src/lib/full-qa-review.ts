import type { AlertActionTaken, AlertInaccuracyReason } from '../types/database'
import { classifyInternalReviewMutationError, type InternalReviewMutationResult } from './internal-alert-review'
import { supabase } from '../integrations/supabase/client'

type Rpc = (name: string, input: Readonly<Record<string, unknown>>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>
// SAFETY: Supabase's generated Database type does not contain this proposed migration yet; every returned value is parsed below.
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc
const TEXT_MIN = 12
const TEXT_MAX = 4000

/** A score persisted by the Full QA contract. Scores are strings or booleans, never numeric. */
export type FullQaScore = string | boolean

/** One of the 23 persisted Full QA criteria in the immutable catalog manifest. */
export type FullQaCriterion = {
  readonly key: string
  readonly label: string
  readonly section: string
  readonly rule: string
  readonly scorePath: string
  readonly evidencePath: string
  readonly domain: readonly FullQaScore[]
  readonly findingCategory: FullQaFindingCategory
}

/** Explicit review treatment for one criterion. */
export type FullQaCriterionCorrection = {
  readonly criterionKey: string
  readonly disposition: 'confirmed' | 'corrected' | 'needs_context'
  readonly correctedValue: FullQaScore | null
  readonly reason: string | null
}

/** Categories for distinct underlying findings; duplicate score fields do not create findings. */
export type FullQaFindingCategory =
  | 'compliance'
  | 'customer_experience'
  | 'sales_process'
  | 'program_expectations'
  | 'severe_customer_mistreatment'

/** A manager-confirmed distinct finding. It remains independent from alert validity. */
export type FullQaFinding = {
  readonly findingId: string
  readonly category: FullQaFindingCategory
  readonly relatedCriteria: readonly string[]
  readonly summary: string
  readonly evidence: string
}

/** Saved Full QA review revision returned by the scoped context RPC. */
export type FullQaSavedReview = {
  readonly feedbackRevision: number
  readonly corrections: readonly FullQaCriterionCorrection[]
  readonly findings: readonly FullQaFinding[]
  readonly escalationJustified: boolean
  readonly escalationReason: string
  readonly inaccuracyReason: AlertInaccuracyReason | null
  readonly actionTaken: AlertActionTaken | null
  readonly actionDetails: string | null
  readonly savedBy: string
  readonly savedAt: string
}

/** Candidate-only rule proposal. Acceptance does not publish the production rubric. */
export type FullQaRuleProposal = {
  readonly id: number
  readonly criterionKey: string
  readonly proposedRule: string
  readonly why: string
  readonly proposedBy: string
  readonly proposedAt: string
  readonly decision: 'pending' | 'accepted_for_evaluation' | 'rejected'
  readonly decidedBy: string | null
  readonly decidedAt: string | null
  readonly decisionReason: string | null
}

/** Parsed scoped payload used by the Full QA review UI. */
export type FullQaReviewContext = {
  readonly sourceFingerprint: string
  readonly sourceResult: unknown
  readonly sourcePromptSha256: string | null
  readonly referencePromptSha256: string
  readonly sourceReferenceKind: 'known' | 'legacy_current_reference' | 'unknown_hash'
  readonly criteriaReferenceKind: 'exact_evaluation_rubric' | 'current_reference_only' | 'current_field_map_only'
  readonly rubricPromptText: string | null
  readonly criteria: readonly FullQaCriterion[]
  readonly review: FullQaSavedReview | null
  readonly proposals: readonly FullQaRuleProposal[]
}

/** Draft accepted by the Full QA review RPC. */
export type FullQaReviewDraft = {
  readonly corrections: readonly FullQaCriterionCorrection[]
  readonly findings: readonly FullQaFinding[]
  readonly escalationJustified: boolean
  readonly escalationReason: string
  readonly inaccuracyReason: AlertInaccuracyReason | null
  readonly actionTaken: AlertActionTaken | null
  readonly actionDetails: string | null
}

/** One row from the complete scoped recurrence RPC. */
export type FullQaOccurrence = {
  readonly occurrenceKind: 'finding' | 'needs_context' | 'legacy_unmapped'
  readonly callId: string
  readonly feedbackRevision: number
  readonly callStartedAt: string | null
  readonly windowBasis: 'call_started_at' | 'alert_created_at_fallback'
  readonly status: 'approved' | 'pending' | 'changes_requested' | 'legacy_unmapped'
  readonly confirmed: boolean
  readonly findingId: string | null
  readonly category: FullQaFindingCategory | null
  readonly relatedCriteria: readonly string[]
  readonly summary: string | null
  readonly evidence: string | null
  readonly criterionKey: string | null
  readonly reason: string | null
  readonly actionTaken: AlertActionTaken | null
  readonly actionDetails: string | null
  readonly reviewSavedAt: string
  readonly coachingReviewProxySavedAt: string | null
  readonly coachingTiming: 'after_recorded_coached_review' | 'before_or_same_as_recorded_coached_review' | 'no_prior_recorded_coaching' | 'unknown'
}

type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

const CATEGORIES: readonly FullQaFindingCategory[] = ['compliance', 'customer_experience', 'sales_process', 'program_expectations', 'severe_customer_mistreatment']
const ACTIONS: readonly AlertActionTaken[] = ['coached', 'escalated', 'follow_up_later', 'no_action_needed']
const REASONS: readonly AlertInaccuracyReason[] = ['soft_inquiry_misclassified', 'wrong_context', 'evidence_misquoted', 'policy_does_not_apply', 'addressed_off_call', 'covered_not_verbatim', 'call_dropped_incomplete', 'other']

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function timestamp(input: unknown): input is string {
  return typeof input === 'string' && Number.isFinite(Date.parse(input))
}

function positiveInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0
}

function nullableString(input: unknown): input is string | null {
  return input === null || typeof input === 'string'
}

function category(input: unknown): input is FullQaFindingCategory {
  return typeof input === 'string' && CATEGORIES.some(value => value === input)
}

function action(input: unknown): input is AlertActionTaken {
  return typeof input === 'string' && ACTIONS.some(value => value === input)
}

function reason(input: unknown): input is AlertInaccuracyReason {
  return typeof input === 'string' && REASONS.some(value => value === input)
}

function score(input: unknown): input is FullQaScore {
  return typeof input === 'string' || typeof input === 'boolean'
}

function parseCriterion(input: unknown): FullQaCriterion | null {
  if (!record(input) || typeof input.key !== 'string' || typeof input.label !== 'string' || typeof input.section !== 'string'
    || typeof input.rule !== 'string' || typeof input.score_path !== 'string' || typeof input.evidence_path !== 'string'
    || !Array.isArray(input.domain) || input.domain.length < 2 || !input.domain.every(score) || !category(input.finding_category)) return null
  return { key: input.key, label: input.label, section: input.section, rule: input.rule, scorePath: input.score_path,
    evidencePath: input.evidence_path, domain: input.domain, findingCategory: input.finding_category }
}

function parseCorrection(input: unknown): FullQaCriterionCorrection | null {
  if (!record(input)) return null
  const correctedValue = input.corrected_value
  const correctionReason = input.reason
  if (typeof input.criterion_key !== 'string'
    || (input.disposition !== 'confirmed' && input.disposition !== 'corrected' && input.disposition !== 'needs_context')
    || !nullableString(correctionReason)) return null
  let parsedCorrectedValue: FullQaScore | null
  if (correctedValue === null) parsedCorrectedValue = null
  else if (score(correctedValue)) parsedCorrectedValue = correctedValue
  else return null
  return { criterionKey: input.criterion_key, disposition: input.disposition, correctedValue: parsedCorrectedValue, reason: correctionReason }
}

function parseFinding(input: unknown): FullQaFinding | null {
  if (!record(input) || typeof input.finding_id !== 'string' || !category(input.category)
    || !Array.isArray(input.related_criteria) || !input.related_criteria.every(value => typeof value === 'string')
    || typeof input.summary !== 'string' || typeof input.evidence !== 'string') return null
  return { findingId: input.finding_id, category: input.category, relatedCriteria: input.related_criteria, summary: input.summary, evidence: input.evidence }
}

function parseReview(input: unknown): FullQaSavedReview | null | false {
  if (input === null) return null
  if (!record(input)) return false
  const actionTaken = input.action_taken
  const savedBy = input.saved_by
  const escalationReason = input.escalation_reason
  const inaccuracyReason = input.escalation_inaccuracy_reason
  if (!positiveInteger(input.feedback_revision) || !Array.isArray(input.corrections) || !Array.isArray(input.findings)
    || typeof input.escalation_justified !== 'boolean' || typeof escalationReason !== 'string'
    || !(inaccuracyReason === null || reason(inaccuracyReason))
    || !nullableString(input.action_details) || typeof savedBy !== 'string' || !timestamp(input.saved_at)) return false
  let parsedAction: AlertActionTaken | null
  if (actionTaken === null) parsedAction = null
  else if (action(actionTaken)) parsedAction = actionTaken
  else return false
  const corrections = input.corrections.map(parseCorrection)
  const findings = input.findings.map(parseFinding)
  if (corrections.some(value => value === null) || findings.some(value => value === null)) return false
  return { feedbackRevision: input.feedback_revision, corrections: corrections.filter((value): value is FullQaCriterionCorrection => value !== null),
    findings: findings.filter((value): value is FullQaFinding => value !== null), escalationJustified: input.escalation_justified,
    escalationReason, inaccuracyReason: reason(inaccuracyReason) ? inaccuracyReason : null,
    actionTaken: parsedAction, actionDetails: input.action_details,
    savedBy, savedAt: input.saved_at }
}

function parseProposal(input: unknown): FullQaRuleProposal | null {
  if (!record(input)) return null
  const decidedAt = input.decided_at
  if (!positiveInteger(input.id) || typeof input.criterion_key !== 'string' || typeof input.proposed_rule !== 'string'
    || typeof input.why !== 'string' || typeof input.proposed_by !== 'string' || !timestamp(input.proposed_at)
    || (input.decision !== 'pending' && input.decision !== 'accepted_for_evaluation' && input.decision !== 'rejected')
    || !nullableString(input.decided_by) || !nullableString(input.decision_reason)) return null
  let parsedDecidedAt: string | null
  if (decidedAt === null) parsedDecidedAt = null
  else if (timestamp(decidedAt)) parsedDecidedAt = decidedAt
  else return null
  return { id: input.id, criterionKey: input.criterion_key, proposedRule: input.proposed_rule, why: input.why,
    proposedBy: input.proposed_by, proposedAt: input.proposed_at, decision: input.decision, decidedBy: input.decided_by,
    decidedAt: parsedDecidedAt, decisionReason: input.decision_reason }
}

/** Parse the scoped Full QA context RPC without trusting serialized JSON. */
export function parseFullQaReviewContext(input: unknown): ParseResult<FullQaReviewContext> {
  if (!record(input) || typeof input.source_fingerprint !== 'string' || input.source_fingerprint.length !== 64
    || !nullableString(input.source_prompt_sha256) || typeof input.reference_prompt_sha256 !== 'string'
    || (input.source_reference_kind !== 'known' && input.source_reference_kind !== 'legacy_current_reference' && input.source_reference_kind !== 'unknown_hash')
    || (input.criteria_reference_kind !== 'exact_evaluation_rubric' && input.criteria_reference_kind !== 'current_reference_only' && input.criteria_reference_kind !== 'current_field_map_only')
    || !nullableString(input.rubric_prompt_text) || !Array.isArray(input.criteria_manifest) || !Array.isArray(input.proposals)) return { ok: false, message: 'The Full QA review context is unavailable.' }
  const criteria = input.criteria_manifest.map(parseCriterion)
  const proposals = input.proposals.map(parseProposal)
  const review = parseReview(input.review)
  if (criteria.length !== 23 || criteria.some(value => value === null) || proposals.some(value => value === null) || review === false) {
    return { ok: false, message: 'The Full QA review context is invalid.' }
  }
  return { ok: true, value: { sourceFingerprint: input.source_fingerprint, sourceResult: input.source_result_json,
    sourcePromptSha256: input.source_prompt_sha256, referencePromptSha256: input.reference_prompt_sha256,
    sourceReferenceKind: input.source_reference_kind, criteriaReferenceKind: input.criteria_reference_kind,
    rubricPromptText: input.rubric_prompt_text, criteria: criteria.filter((value): value is FullQaCriterion => value !== null),
    review, proposals: proposals.filter((value): value is FullQaRuleProposal => value !== null) } }
}

/** Read an original AI score or evidence through a catalog-owned dotted path. */
export function valueAtPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => record(value) ? value[key] : undefined, input)
}

/** Create the initial 23 criterion treatments without converting unavailable context into pass/fail. */
export function initialFullQaCorrections(context: FullQaReviewContext): readonly FullQaCriterionCorrection[] {
  if (context.review) return context.review.corrections
  return context.criteria.map(criterion => {
    const original = valueAtPath(context.sourceResult, criterion.scorePath)
    return criterion.domain.some(value => value === original)
      ? { criterionKey: criterion.key, disposition: 'confirmed' as const, correctedValue: original as FullQaScore, reason: null }
      : { criterionKey: criterion.key, disposition: 'needs_context' as const, correctedValue: null, reason: '' }
  })
}

function bounded(text: string | null): boolean {
  const length = text?.trim().length ?? 0
  return length >= TEXT_MIN && length <= TEXT_MAX
}

/** Validate a Full QA draft before the mutation seam. Findings remain explicit and independent of score corrections. */
export function parseFullQaReviewDraft(context: FullQaReviewContext, input: FullQaReviewDraft): ParseResult<FullQaReviewDraft> {
  if (input.corrections.length !== 23 || new Set(input.corrections.map(item => item.criterionKey)).size !== 23) return { ok: false, message: 'Review all 23 criteria.' }
  for (const correction of input.corrections) {
    const criterion = context.criteria.find(item => item.key === correction.criterionKey)
    const original = criterion ? valueAtPath(context.sourceResult, criterion.scorePath) : undefined
    if (!criterion) return { ok: false, message: 'A criterion is not part of this rubric.' }
    if (correction.disposition === 'confirmed' && (correction.correctedValue !== original || correction.reason !== null)) return { ok: false, message: `${criterion.label} must retain the original AI value when confirmed.` }
    if (correction.disposition === 'corrected' && (!criterion.domain.some(value => value === correction.correctedValue) || correction.correctedValue === original || !bounded(correction.reason))) return { ok: false, message: `${criterion.label} needs a different value and a reason.` }
    if (correction.disposition === 'needs_context' && (correction.correctedValue !== null || !bounded(correction.reason))) return { ok: false, message: `${criterion.label} needs a context explanation.` }
  }
  for (const finding of input.findings) {
    if (!category(finding.category) || new Set(finding.relatedCriteria).size !== finding.relatedCriteria.length || finding.relatedCriteria.length < 1
      || finding.relatedCriteria.some(key => !context.criteria.some(item => item.key === key)) || !bounded(finding.summary) || !bounded(finding.evidence)) {
      return { ok: false, message: 'Each distinct finding needs a category, related criteria, summary, and evidence.' }
    }
  }
  const complianceCount = input.findings.filter(finding => finding.category === 'compliance').length
  const severe = input.findings.some(finding => finding.category === 'severe_customer_mistreatment')
  if (input.escalationJustified && complianceCount < 2 && !severe) return { ok: false, message: 'Escalation requires two distinct compliance findings or an explicit severe-customer-mistreatment finding.' }
  if (!bounded(input.escalationReason)) return { ok: false, message: 'Explain the escalation judgment.' }
  if (input.escalationJustified ? input.inaccuracyReason !== null : !input.inaccuracyReason || !reason(input.inaccuracyReason)) return { ok: false, message: 'Choose why escalation was not justified.' }
  if (input.findings.length === 0 && (input.actionTaken !== null || input.actionDetails?.trim())) return { ok: false, message: 'Actions apply only to retained findings.' }
  if (input.findings.length > 0 && (!input.actionTaken || !action(input.actionTaken) || !bounded(input.actionDetails))) return { ok: false, message: 'Record the coaching or follow-up for retained findings.' }
  return { ok: true, value: { ...input, escalationReason: input.escalationReason.trim(), actionDetails: input.actionDetails?.trim() ?? null,
    corrections: input.corrections.map(item => ({ ...item, reason: item.reason?.trim() ?? null })),
    findings: input.findings.map(item => ({ ...item, summary: item.summary.trim(), evidence: item.evidence.trim() })) } }
}

/** Fetch the rubric, immutable reviewed source, current revision, and proposals through one scoped RPC. */
export async function fetchFullQaReviewContext(callId: string): Promise<FullQaReviewContext> {
  const { data, error } = await rpc('get_full_qa_review_context', { p_call_id: callId })
  if (error) throw error
  const parsed = parseFullQaReviewContext(data)
  if (parsed.ok === false) throw new Error(parsed.message)
  return parsed.value
}

function correctionsToRpc(corrections: readonly FullQaCriterionCorrection[]) {
  return corrections.map(item => ({ criterion_key: item.criterionKey, disposition: item.disposition, corrected_value: item.correctedValue, reason: item.reason }))
}

function findingsToRpc(findings: readonly FullQaFinding[]) {
  return findings.map(item => ({ finding_id: item.findingId, category: item.category, related_criteria: item.relatedCriteria, summary: item.summary, evidence: item.evidence }))
}

/** Save one exact source/revision-guarded Full QA review revision. */
export async function submitFullQaReview(input: { readonly callId: string; readonly expectedRevision: number; readonly expectedDecisionId: number | null; readonly expectedSourceFingerprint: string; readonly draft: FullQaReviewDraft }) {
  try {
    const { data, error } = await rpc('submit_full_qa_review', { p_call_id: input.callId, p_expected_revision: input.expectedRevision,
      p_expected_decision_id: input.expectedDecisionId, p_expected_source_fingerprint: input.expectedSourceFingerprint,
      p_corrections: correctionsToRpc(input.draft.corrections), p_findings: findingsToRpc(input.draft.findings),
      p_escalation_justified: input.draft.escalationJustified, p_escalation_reason: input.draft.escalationReason,
      p_inaccuracy_reason: input.draft.inaccuracyReason, p_action: input.draft.actionTaken, p_action_details: input.draft.actionDetails })
    if (error) return { ok: false as const, error: classifyInternalReviewMutationError(error) }
    if (!record(data) || !positiveInteger(data.feedback_id) || !positiveInteger(data.review_revision) || !timestamp(data.reviewed_at) || typeof data.idempotent !== 'boolean') {
      return { ok: false as const, error: { _tag: 'Unavailable' as const, message: 'The review service returned an invalid response.' } }
    }
    return { ok: true as const, value: { feedbackId: data.feedback_id, reviewRevision: data.review_revision, reviewedAt: data.reviewed_at, idempotent: data.idempotent } }
  } catch (cause: unknown) { return { ok: false as const, error: classifyInternalReviewMutationError(cause) }
  }
}

/** Submit a candidate-only rule proposal against the current criterion snapshot. */
export async function proposeFullQaRule(input: { readonly callId: string; readonly feedbackRevision: number; readonly criterionKey: string; readonly proposedRule: string; readonly why: string }): Promise<InternalReviewMutationResult<{ readonly proposalId: number }>> {
  try {
    const { data, error } = await rpc('propose_full_qa_rule', { p_call_id: input.callId, p_feedback_revision: input.feedbackRevision,
      p_criterion_key: input.criterionKey, p_proposed_rule: input.proposedRule, p_why: input.why })
    if (error) return { ok: false, error: classifyInternalReviewMutationError(error) }
    if (!record(data) || !positiveInteger(data.proposal_id)) return { ok: false, error: { _tag: 'Unavailable', message: 'The proposal service returned an invalid response.' } }
    return { ok: true, value: { proposalId: data.proposal_id } }
  } catch (cause: unknown) { return { ok: false, error: classifyInternalReviewMutationError(cause) }
  }
}

/** Decide a candidate rule once. Acceptance means evaluation approval, not publication. */
export async function decideFullQaRuleProposal(input: { readonly proposalId: number; readonly decision: 'accepted_for_evaluation' | 'rejected'; readonly reason: string }): Promise<InternalReviewMutationResult<{ readonly proposalId: number; readonly decision: 'accepted_for_evaluation' | 'rejected' }>> {
  try {
    const { data, error } = await rpc('decide_full_qa_rule_proposal', { p_proposal_id: input.proposalId, p_expected_decision: 'pending', p_decision: input.decision, p_reason: input.reason })
    if (error) return { ok: false, error: classifyInternalReviewMutationError(error) }
    if (!record(data) || !positiveInteger(data.proposal_id) || (data.decision !== 'accepted_for_evaluation' && data.decision !== 'rejected')) {
      return { ok: false, error: { _tag: 'Unavailable', message: 'The proposal service returned an invalid response.' } }
    }
    return { ok: true, value: { proposalId: data.proposal_id, decision: data.decision } }
  } catch (cause: unknown) { return { ok: false, error: classifyInternalReviewMutationError(cause) }
  }
}

/** Fetch complete reconciliable finding, needs-context, and legacy occurrence rows for an agent/window. */
export async function fetchFullQaOccurrences(agentEmail: string, start: Date, end: Date): Promise<readonly FullQaOccurrence[]> {
  const { data, error } = await rpc('full_qa_finding_occurrences', { p_agent_email: agentEmail, p_start: start.toISOString(), p_end: end.toISOString() })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('The Full QA occurrence service returned an invalid response.')
  return data.map((input: unknown): FullQaOccurrence => {
    if (!record(input) || (input.occurrence_kind !== 'finding' && input.occurrence_kind !== 'needs_context' && input.occurrence_kind !== 'legacy_unmapped')
      || typeof input.call_id !== 'string' || !positiveInteger(input.feedback_revision) || !(input.call_started_at === null || timestamp(input.call_started_at))
      || (input.window_basis !== 'call_started_at' && input.window_basis !== 'alert_created_at_fallback')
      || (input.status !== 'approved' && input.status !== 'pending' && input.status !== 'changes_requested' && input.status !== 'legacy_unmapped')
      || typeof input.confirmed !== 'boolean' || !timestamp(input.review_saved_at)
      || (input.occurrence_kind === 'finding' && !category(input.category))
      || (input.confirmed && (input.occurrence_kind !== 'finding' || input.status !== 'approved'))) throw new Error('The Full QA occurrence service returned an invalid row.')
    const reviewSavedAt = input.review_saved_at
    const rawCallStartedAt = input.call_started_at
    if (!timestamp(reviewSavedAt)) throw new Error('The Full QA occurrence service returned an invalid date.')
    let callStartedAt: string | null
    if (rawCallStartedAt === null) callStartedAt = null
    else if (timestamp(rawCallStartedAt)) callStartedAt = rawCallStartedAt
    else throw new Error('The Full QA occurrence service returned an invalid call date.')
    return { occurrenceKind: input.occurrence_kind, callId: input.call_id, feedbackRevision: input.feedback_revision,
      callStartedAt, windowBasis: input.window_basis, status: input.status, confirmed: input.confirmed,
      findingId: typeof input.finding_id === 'string' ? input.finding_id : null, category: category(input.category) ? input.category : null,
      relatedCriteria: Array.isArray(input.related_criteria) ? input.related_criteria.filter((value): value is string => typeof value === 'string') : [],
      summary: typeof input.summary === 'string' ? input.summary : null, evidence: typeof input.evidence === 'string' ? input.evidence : null,
      criterionKey: typeof input.criterion_key === 'string' ? input.criterion_key : null, reason: typeof input.reason === 'string' ? input.reason : null,
      actionTaken: action(input.action_taken) ? input.action_taken : null, actionDetails: typeof input.action_details === 'string' ? input.action_details : null,
      reviewSavedAt, coachingReviewProxySavedAt: timestamp(input.coaching_review_proxy_saved_at) ? input.coaching_review_proxy_saved_at : null,
      coachingTiming: input.coaching_timing === 'after_recorded_coached_review' || input.coaching_timing === 'before_or_same_as_recorded_coached_review'
        || input.coaching_timing === 'no_prior_recorded_coaching' || input.coaching_timing === 'unknown' ? input.coaching_timing : 'unknown' }
  })
}
