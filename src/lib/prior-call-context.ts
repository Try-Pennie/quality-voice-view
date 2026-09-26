/**
 * Boundary parser for the server-owned `_prior_call_context` snapshot (contract v1,
 * policy `full_qa_prior_stage_credit_v1`) on a pinned Full QA source result.
 * Credits are prior AI assessments: never transcript-verified, never manager-confirmed.
 * The UI renders only this persisted snapshot; it never fetches or rebuilds history.
 */

export type PriorStageCredit = 'assessed_complete' | 'not_complete' | 'conflicting'
export type PriorQaStatus = 'found' | 'missing' | 'invalid' | 'ambiguous' | 'unavailable'
export type PriorUnavailableReason = 'no_lead_id' | 'identity_unproven' | 'chronology_unproven' | 'dependency_failure'

export type PriorCallStage = {
  readonly step: number
  readonly aiStatus: 'complete' | 'partial' | 'missing' | 'not_applicable'
  readonly aiListedCompleted: boolean
  readonly aiListedAttempted: boolean
  readonly aiLocation: string | null
  readonly credit: PriorStageCredit
  readonly evidence: readonly unknown[]
}

export type PriorCall = {
  readonly callId: string
  readonly startedAt: string
  readonly disposition: string | null
  readonly notes: string | null
  readonly callSummary: string | null
  readonly qaStatus: PriorQaStatus
  readonly qaCreatedAt: string | null
  readonly qaRowId: number | null
  readonly stages: readonly PriorCallStage[]
}

export type PriorStageCreditRecord = {
  readonly step: number
  readonly sourceCallId: string
  readonly sourceStartedAt: string
  readonly sourceQaCreatedAt: string
  readonly sourceQaRowId: number
  readonly aiLocation: string | null
  readonly evidence: readonly unknown[]
}

export type PriorCallContext =
  | { readonly kind: 'absent' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unavailable'; readonly reason: PriorUnavailableReason | null }
  | { readonly kind: 'none' }
  | { readonly kind: 'included'; readonly totalPriorCalls: number; readonly priorCalls: readonly PriorCall[]; readonly credits: readonly PriorStageCreditRecord[] }

type Rec = Record<string, unknown>
const rec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const optText = (value: unknown): value is string | null => value === null || typeof value === 'string'
const iso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const step = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6
const oneOf = <T extends string>(values: readonly T[]) => (value: unknown): value is T => values.some(item => item === value)
const rowId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const clean = (value: string | null) => value?.trim() ? value.trim() : null

const isAiStatus = oneOf(['complete', 'partial', 'missing', 'not_applicable'] as const)
const isCredit = oneOf(['assessed_complete', 'not_complete', 'conflicting'] as const)
const isQaStatus = oneOf(['found', 'missing', 'invalid', 'ambiguous', 'unavailable'] as const)
const isReason = oneOf(['no_lead_id', 'identity_unproven', 'chronology_unproven', 'dependency_failure'] as const)

function parseStage(input: unknown): PriorCallStage | null {
  if (!rec(input) || !step(input.step) || !isAiStatus(input.ai_status) || typeof input.ai_listed_completed !== 'boolean'
    || typeof input.ai_listed_attempted !== 'boolean' || !optText(input.ai_location) || !isCredit(input.credit) || !Array.isArray(input.evidence)) return null
  // Conservative: an assessed-complete credit must agree with all three raw prior fields it is derived from.
  if (input.credit === 'assessed_complete' && (input.ai_status !== 'complete' || !input.ai_listed_completed || !input.ai_listed_attempted)) return null
  return { step: input.step, aiStatus: input.ai_status, aiListedCompleted: input.ai_listed_completed, aiListedAttempted: input.ai_listed_attempted,
    aiLocation: clean(input.ai_location), credit: input.credit, evidence: input.evidence }
}

function parsePriorCall(input: unknown): PriorCall | null {
  if (!rec(input) || typeof input.call_id !== 'string' || !input.call_id || !iso(input.started_at)
    || !optText(input.disposition) || !optText(input.notes) || !optText(input.call_summary)
    || !isQaStatus(input.qa_status) || !Array.isArray(input.stages)) return null
  const qaSource = input.qa_source
  if (qaSource !== null && (!rec(qaSource) || !iso(qaSource.created_at) || !rowId(qaSource.row_id))) return null
  const stages = input.stages.map(parseStage).filter((value): value is PriorCallStage => value !== null)
  // Only a found prior QA row with a pinned source can carry stages; one entry per step.
  if (stages.length !== input.stages.length || ((input.qa_status !== 'found' || !rec(qaSource)) && stages.length > 0)
    || new Set(stages.map(stage => stage.step)).size !== stages.length) return null
  return { callId: input.call_id, startedAt: input.started_at, disposition: clean(input.disposition), notes: clean(input.notes),
    callSummary: clean(input.call_summary), qaStatus: input.qa_status, qaCreatedAt: rec(qaSource) && iso(qaSource.created_at) ? qaSource.created_at : null,
    qaRowId: rec(qaSource) && rowId(qaSource.row_id) ? qaSource.row_id : null, stages }
}

function parseCredit(input: unknown): PriorStageCreditRecord | null {
  if (!rec(input) || !step(input.step) || input.basis !== 'prior_ai_assessment' || input.transcript_verified !== false
    || input.manager_confirmed !== false || typeof input.source_call_id !== 'string' || !iso(input.source_started_at)
    || !iso(input.source_qa_created_at) || !optText(input.ai_location) || !Array.isArray(input.evidence) || !rowId(input.source_qa_row_id)) return null
  return { step: input.step, sourceCallId: input.source_call_id, sourceStartedAt: input.source_started_at,
    sourceQaCreatedAt: input.source_qa_created_at,
    sourceQaRowId: input.source_qa_row_id, aiLocation: clean(input.ai_location), evidence: input.evidence }
}

/** Parse `source._prior_call_context`. A missing key is historical (pre-v1), not "no history". */
export function parsePriorCallContext(source: unknown): PriorCallContext {
  if (!rec(source) || !('_prior_call_context' in source)) return { kind: 'absent' }
  const input = source._prior_call_context
  if (!rec(input) || input.version !== 1 || input.policy !== 'full_qa_prior_stage_credit_v1') return { kind: 'malformed' }
  if (input.status === 'unavailable') return isReason(input.reason) ? { kind: 'unavailable', reason: input.reason }
    : input.reason === null ? { kind: 'unavailable', reason: null } : { kind: 'malformed' }
  if (input.status === 'none') return { kind: 'none' }
  if (input.status !== 'included' || !Array.isArray(input.prior_calls) || !Array.isArray(input.stage_credits)
    || !Number.isSafeInteger(input.total_prior_calls) || !rec(input.current_call) || !iso(input.current_call.started_at)) return { kind: 'malformed' }
  const currentStart = Date.parse(input.current_call.started_at)
  const calls = input.prior_calls.map(parsePriorCall).filter((value): value is PriorCall => value !== null)
  const credits = input.stage_credits.map(parseCredit).filter((value): value is PriorStageCreditRecord => value !== null)
  if (calls.length !== input.prior_calls.length || credits.length !== input.stage_credits.length
    || Number(input.total_prior_calls) < calls.length
    || new Set(calls.map(call => call.callId)).size !== calls.length
    || calls.some(call => Date.parse(call.startedAt) >= currentStart)) return { kind: 'malformed' }
  // Every credit must reference exactly its listed prior call and QA source, backed by an assessed-complete stage; one credit per step.
  const backed = credits.every(credit => calls.some(call => call.callId === credit.sourceCallId && call.qaStatus === 'found'
    && Date.parse(call.startedAt) === Date.parse(credit.sourceStartedAt)
    && call.qaCreatedAt !== null && Date.parse(call.qaCreatedAt) === Date.parse(credit.sourceQaCreatedAt)
    && call.qaRowId !== null && call.qaRowId === credit.sourceQaRowId
    && call.stages.some(item => item.step === credit.step && item.credit === 'assessed_complete')))
  if (!backed || new Set(credits.map(credit => credit.step)).size !== credits.length) return { kind: 'malformed' }
  return { kind: 'included', totalPriorCalls: Number(input.total_prior_calls), priorCalls: calls, credits }
}

/**
 * The one waiver rule shared by summary and criterion display, mirroring the backend applicability
 * condition: a credited step counts as done earlier only when this call did not attempt it at all —
 * current status not complete/partial and step absent from sections_attempted and sections_completed.
 * Unprovable attempt data yields no waiver. Scores are never changed.
 */
export function applicablePriorCredit(prior: PriorCallContext, source: unknown, stepNumber: number, currentStatus: unknown): PriorStageCreditRecord | null {
  if (prior.kind !== 'included' || currentStatus === 'complete' || currentStatus === 'partial') return null
  const credit = prior.credits.find(item => item.step === stepNumber)
  const scorecard = rec(source) ? source.sales_process_scorecard : undefined
  if (!credit || !rec(scorecard) || !Array.isArray(scorecard.sections_attempted) || !Array.isArray(scorecard.sections_completed)) return null
  return scorecard.sections_attempted.includes(stepNumber) || scorecard.sections_completed.includes(stepNumber) ? null : credit
}
