import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '../types/database'

/** Text limits shared by the form and database migration. */
export const INTERNAL_REVIEW_TEXT_LIMITS = { min: 12, max: 4000 } as const

/** A valid internal real/false manager decision ready for the RPC boundary. */
export type InternalReviewDraft =
  | {
      readonly verdict: true
      readonly action: AlertActionTaken
      readonly reason: null
      readonly violationDetails: string
      readonly actionDetails: string
      readonly falseAlarmDetails: null
    }
  | {
      readonly verdict: false
      readonly action: null
      readonly reason: AlertInaccuracyReason
      readonly violationDetails: null
      readonly actionDetails: null
      readonly falseAlarmDetails: string
    }

/** Unrefined values owned by the structured review form. */
export type InternalReviewDraftInput = {
  readonly verdict: boolean | null
  readonly action: AlertActionTaken | null
  readonly reason: AlertInaccuracyReason | null
  readonly violationDetails: string | null
  readonly actionDetails: string | null
  readonly falseAlarmDetails: string | null
}

type ParseFailure = {
  readonly _tag: 'InvalidInternalReview'
  readonly message: string
}

/** Expected failure returned by an internal review mutation. */
export type InternalReviewMutationError = {
  readonly _tag: 'StaleReview' | 'InvalidReview' | 'Forbidden' | 'Unavailable'
  readonly message: string
}

/** Typed mutation outcome consumed by review UI workflows. */
export type InternalReviewMutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: InternalReviewMutationError }

/** Small typed result used at serialized and form boundaries. */
export type InternalReviewParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ParseFailure }

/** A parsed successful manager-submit RPC response. */
export type SubmitReviewRpcResult = {
  readonly _tag: 'ReviewSubmitted'
  readonly feedbackId: number
  readonly reviewRevision: number
  readonly reviewedAt: string
  readonly idempotent: boolean
}

/** A parsed successful super-admin decision RPC response. */
export type DecisionRpcResult = {
  readonly _tag: 'ReviewDecided'
  readonly decisionId: number
  readonly feedbackRevision: number
  readonly decision: 'approved' | 'changes_requested'
  readonly decidedAt: string
  readonly idempotent: boolean
}

/** Parsed immutable first-review snapshot. Nullable details support historic rows. */
export type InitialManagerReview = {
  readonly managerEmail: string
  readonly accurate: boolean
  readonly actionTaken: AlertActionTaken | null
  readonly inaccuracyReason: AlertInaccuracyReason | null
  readonly comment: string | null
  readonly violationDetails: string | null
  readonly actionDetails: string | null
  readonly reviewedAt: string
}

const ACTIONS: readonly AlertActionTaken[] = [
  'coached', 'escalated', 'follow_up_later', 'no_action_needed',
]
const REASONS: readonly AlertInaccuracyReason[] = [
  'soft_inquiry_misclassified', 'wrong_context', 'evidence_misquoted',
  'policy_does_not_apply', 'addressed_off_call', 'covered_not_verbatim',
  'call_dropped_incomplete', 'other',
]

function failure(message: string): InternalReviewParseResult<never> {
  return { ok: false, error: { _tag: 'InvalidInternalReview', message } }
}

function parseRequiredText(value: string | null, label: string): InternalReviewParseResult<string> {
  const text = value?.trim() ?? ''
  if (text.length < INTERNAL_REVIEW_TEXT_LIMITS.min || text.length > INTERNAL_REVIEW_TEXT_LIMITS.max) {
    return failure(`${label} must be ${INTERNAL_REVIEW_TEXT_LIMITS.min}–${INTERNAL_REVIEW_TEXT_LIMITS.max} characters.`)
  }
  return { ok: true, value: text }
}

/** Parse a form draft and clear fields that are inapplicable to its verdict. */
export function parseInternalReviewDraft(input: InternalReviewDraftInput): InternalReviewParseResult<InternalReviewDraft> {
  if (input.verdict === null) return failure('Choose warranted or unnecessary.')

  if (input.verdict) {
    if (!input.action || !ACTIONS.includes(input.action)) return failure('Choose how the issue was addressed.')
    if (input.reason !== null || input.falseAlarmDetails?.trim()) return failure('Unnecessary-alert fields do not apply to a warranted alert.')
    const violation = parseRequiredText(input.violationDetails, 'What happened')
    if (violation.ok === false) return { ok: false, error: violation.error }
    const action = parseRequiredText(input.actionDetails, 'Action details')
    if (action.ok === false) return { ok: false, error: action.error }
    if (violation.value.toLowerCase() === action.value.toLowerCase()) {
      return failure('What happened and the action taken must be distinct.')
    }
    return {
      ok: true,
      value: {
        verdict: true,
        action: input.action,
        reason: null,
        violationDetails: violation.value,
        actionDetails: action.value,
        falseAlarmDetails: null,
      },
    }
  }

  if (!input.reason || !REASONS.includes(input.reason)) return failure('Choose why the alert was unnecessary.')
  if (input.action !== null || input.violationDetails?.trim() || input.actionDetails?.trim()) {
    return failure('Warranted-alert fields do not apply to an unnecessary alert.')
  }
  const explanation = parseRequiredText(input.falseAlarmDetails, 'False-alarm explanation')
  if (explanation.ok === false) return { ok: false, error: explanation.error }
  return {
    ok: true,
    value: {
      verdict: false,
      action: null,
      reason: input.reason,
      violationDetails: null,
      actionDetails: null,
      falseAlarmDetails: explanation.value,
    },
  }
}

function isRecord(input: unknown): input is object {
  return typeof input === 'object' && input !== null
}

/** Classify unknown Supabase/network failures without trusting decoded objects. */
export function classifyInternalReviewMutationError(input: unknown): InternalReviewMutationError {
  const rawMessage = isRecord(input) && 'message' in input && typeof input.message === 'string'
    ? input.message
    : ''
  if (rawMessage.includes('EAVESLY_STALE_REVIEW') || rawMessage.includes('EAVESLY_DECISION_CONFLICT')
    || rawMessage.includes('EAVESLY_STALE_FULL_QA_SOURCE') || rawMessage.includes('EAVESLY_RULE_PROPOSAL_DECISION_CONFLICT')) {
    return { _tag: 'StaleReview', message: 'This review changed while you were working. Your draft is still here.' }
  }
  if (rawMessage.includes('EAVESLY_INVALID_FEEDBACK') || rawMessage.includes('EAVESLY_INVALID_DECISION')
    || rawMessage.includes('EAVESLY_INVALID_FULL_QA_REVIEW') || rawMessage.includes('EAVESLY_INVALID_FULL_QA_EVIDENCE_FEEDBACK')
    || rawMessage.includes('EAVESLY_INVALID_RULE_PROPOSAL')) {
    return { _tag: 'InvalidReview', message: 'Review details did not meet the required format.' }
  }
  if (rawMessage.includes('EAVESLY_FORBIDDEN') || rawMessage.includes('EAVESLY_UNAUTHENTICATED')) {
    return { _tag: 'Forbidden', message: 'You no longer have permission to update this review.' }
  }
  return { _tag: 'Unavailable', message: 'The review service is unavailable. Your draft is still here; try again.' }
}

function isPositiveInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0
}

function isTimestamp(input: unknown): input is string {
  return typeof input === 'string' && Number.isFinite(Date.parse(input))
}

function isNullableString(input: unknown): input is string | null {
  return input === null || typeof input === 'string'
}

function isAction(input: unknown): input is AlertActionTaken {
  return typeof input === 'string' && ACTIONS.some(action => action === input)
}

function isReason(input: unknown): input is AlertInaccuracyReason {
  return typeof input === 'string' && REASONS.some(reason => reason === input)
}

/** Merge detail data without allowing an older request to overwrite newer review state. */
export function mergeAlertDetailsWithoutReviewRegression(
  current: AlertWithFeedback,
  incoming: AlertWithFeedback,
): AlertWithFeedback {
  const currentRevision = current.review_revision ?? 0
  const incomingRevision = incoming.review_revision ?? 0
  const currentHasNewerDecision = currentRevision === incomingRevision &&
    (current.current_decision_id ?? 0) > 0 && (incoming.current_decision_id ?? 0) <= 0
  if (currentRevision <= incomingRevision && !currentHasNewerDecision) return incoming
  return {
    ...incoming,
    feedback_id: current.feedback_id,
    feedback_by: current.feedback_by,
    accurate: current.accurate,
    action_taken: current.action_taken,
    inaccuracy_reason: current.inaccuracy_reason,
    feedback_comment: current.feedback_comment,
    reviewed_at: current.reviewed_at,
    is_reviewed: current.is_reviewed,
    violation_details: current.violation_details,
    action_details: current.action_details,
    review_revision: current.review_revision,
    initial_manager_review: current.initial_manager_review,
    current_decision_id: current.current_decision_id,
    current_decision: current.current_decision,
    current_decision_by: current.current_decision_by,
    current_decision_instructions: current.current_decision_instructions,
    current_decided_at: current.current_decided_at,
    current_decision_source: current.current_decision_source,
  }
}

/** Parse unknown JSON returned by `submit_internal_alert_feedback`. */
export function parseSubmitReviewRpcResult(input: unknown): InternalReviewParseResult<SubmitReviewRpcResult> {
  if (!isRecord(input)
    || !('feedback_id' in input) || !isPositiveInteger(input.feedback_id)
    || !('review_revision' in input) || !isPositiveInteger(input.review_revision)
    || !('reviewed_at' in input) || !isTimestamp(input.reviewed_at)
    || !('idempotent' in input) || typeof input.idempotent !== 'boolean') {
    return failure('The review service returned an invalid response.')
  }
  return {
    ok: true,
    value: {
      _tag: 'ReviewSubmitted',
      feedbackId: input.feedback_id,
      reviewRevision: input.review_revision,
      reviewedAt: input.reviewed_at,
      idempotent: input.idempotent,
    },
  }
}

/** Parse unknown JSON returned by `decide_internal_alert_feedback`. */
export function parseDecisionRpcResult(input: unknown): InternalReviewParseResult<DecisionRpcResult> {
  if (!isRecord(input)
    || !('decision_id' in input) || !isPositiveInteger(input.decision_id)
    || !('feedback_revision' in input) || !isPositiveInteger(input.feedback_revision)
    || !('decision' in input) || (input.decision !== 'approved' && input.decision !== 'changes_requested')
    || !('decided_at' in input) || !isTimestamp(input.decided_at)
    || !('idempotent' in input) || typeof input.idempotent !== 'boolean') {
    return failure('The approval service returned an invalid response.')
  }
  return {
    ok: true,
    value: {
      _tag: 'ReviewDecided',
      decisionId: input.decision_id,
      feedbackRevision: input.feedback_revision,
      decision: input.decision,
      decidedAt: input.decided_at,
      idempotent: input.idempotent,
    },
  }
}

/** Parse the persisted immutable first-review JSON before displaying it. */
export function parseInitialManagerReview(input: unknown): InternalReviewParseResult<InitialManagerReview> {
  if (!isRecord(input)
    || !('manager_email' in input) || typeof input.manager_email !== 'string' || !input.manager_email.trim()
    || !('accurate' in input) || typeof input.accurate !== 'boolean'
    || !('action_taken' in input) || !(input.action_taken === null || isAction(input.action_taken))
    || !('inaccuracy_reason' in input) || !(input.inaccuracy_reason === null || isReason(input.inaccuracy_reason))
    || !('comment' in input) || !isNullableString(input.comment)
    || !('violation_details' in input) || !isNullableString(input.violation_details)
    || !('action_details' in input) || !isNullableString(input.action_details)
    || !('reviewed_at' in input) || !isTimestamp(input.reviewed_at)) {
    return failure('The original review snapshot is unavailable.')
  }
  const managerEmail = input.manager_email
  const accurate = input.accurate
  const actionTaken = input.action_taken
  const inaccuracyReason = input.inaccuracy_reason
  const comment = input.comment
  const violationDetails = input.violation_details
  const actionDetails = input.action_details
  const reviewedAt = input.reviewed_at
  if (typeof managerEmail !== 'string' || typeof accurate !== 'boolean'
    || !(actionTaken === null || isAction(actionTaken))
    || !(inaccuracyReason === null || isReason(inaccuracyReason))
    || !isNullableString(comment) || !isNullableString(violationDetails)
    || !isNullableString(actionDetails) || !isTimestamp(reviewedAt)) {
    return failure('The original review snapshot is unavailable.')
  }
  return {
    ok: true,
    value: {
      managerEmail,
      accurate,
      actionTaken: isAction(actionTaken) ? actionTaken : null,
      inaccuracyReason: isReason(inaccuracyReason) ? inaccuracyReason : null,
      comment,
      violationDetails,
      actionDetails,
      reviewedAt,
    },
  }
}
