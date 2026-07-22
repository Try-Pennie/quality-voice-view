// Pure logic for the achieve-portal edge function — no Deno APIs so it can be
// self-checked with `npx tsx supabase/functions/achieve-portal/portal-logic.check.ts`.
//
// The server boundary owns three safety rules the browser previously enforced:
//   1. Transcripts are trimmed to the graded Achieve/FDR segment (or withheld)
//      before they ever leave the server.
//   2. Withheld rows (grading_skipped / pre-hardening full-transcript fallback)
//      keep only the guard flags — their free text can reference non-Achieve
//      content and must not reach the partner's browser at all.
//   3. Feedback writes are validated and force-scoped to the Achieve module.

export const ACHIEVE_MODULE_NAME = 'achieve_welcome_call_qa'

// Hard ceiling so a bad segment boundary can never ship an unbounded blob.
export const MAX_TRANSCRIPT_CHARS = 60_000

export const ACTION_TAKEN_VALUES = [
  'coached',
  'escalated',
  'follow_up_later',
  'no_action_needed',
] as const

// Must match the eavesly_alert_feedback_inaccuracy_reason_check DB constraint.
export const INACCURACY_REASON_VALUES = [
  'soft_inquiry_misclassified',
  'wrong_context',
  'evidence_misquoted',
  'policy_does_not_apply',
  'addressed_off_call',
  'covered_not_verbatim',
  'call_dropped_incomplete',
  'other',
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export function isWithheld(result: Json): boolean {
  return !!result?.grading_skipped ||
    result?.transcript_segment?.used_full_transcript_fallback === true
}

// Calls mis-transferred to Beyond Finance (a competitor of Achieve) are graded-
// skipped with this reason by eavesly. Showing Achieve a call that went to a
// competitor is a conflict of interest, so these rows are dropped from the
// portal entirely — they appear in neither the alerts queue nor all_calls.
export function isCompetitorTransfer(result: Json): boolean {
  return result?.skip_reason === 'competitor_transfer'
}

// A row belongs in the Needs-review queue when it is a graded violation.
// Withheld rows (skipped / pre-hardening fallback) are audit-only.
export function isQueueRow(row: Json): boolean {
  return row?.has_violation === true && !isWithheld(row?.result_json)
}

// Same guard chain the portal UI used client-side: no segment metadata, an
// explicit fallback, or a skipped grade all mean the boundary is unreliable —
// return '' rather than an unbounded transcript.
export function trimTranscript(originalTranscript: string | null | undefined, result: Json): string {
  const transcript = originalTranscript
  if (!transcript?.trim()) return ''
  const seg = result?.transcript_segment
  if (!seg || seg.used_full_transcript_fallback || result?.grading_skipped || seg.segment_found === false) return ''
  const startLine = seg.start_line
  const endLine = seg.end_line
  if (typeof startLine !== 'number' || !Number.isInteger(startLine)) return ''
  if (endLine !== undefined && (typeof endLine !== 'number' || !Number.isInteger(endLine))) return ''

  // Boundaries are inclusive, 0-based line indexes stamped by the eavesly
  // segmenter. Rows created before end_line was introduced retain the legacy
  // start-to-end behavior.
  const transcriptLines = transcript.split(/\r?\n/)
  const safeStartLine = Math.max(0, startLine)
  if (typeof endLine === 'number' && (endLine < safeStartLine || endLine >= transcriptLines.length)) return ''
  const trimmed = transcriptLines
    .slice(safeStartLine, typeof endLine === 'number' ? endLine + 1 : undefined)
    .join('\n')
    .trim()
  if (trimmed.length > MAX_TRANSCRIPT_CHARS) {
    return `${trimmed.slice(0, MAX_TRANSCRIPT_CHARS)}\n… [transcript truncated]`
  }
  return trimmed
}

// Withheld rows keep only the flags the UI needs to render its "Not graded" /
// "details withheld" states; everything else (quotes, violation reason,
// confidence rationale, …) stays on the server.
export function sanitizeResultJson(result: Json): Json {
  if (!result) return result ?? null
  if (result.grading_skipped) {
    return {
      grading_skipped: true,
      skip_reason: typeof result.skip_reason === 'string' ? result.skip_reason : null,
      script_version: typeof result.script_version === 'string' ? result.script_version : null,
    }
  }
  if (result.transcript_segment?.used_full_transcript_fallback === true) {
    return {
      script_version: typeof result.script_version === 'string' ? result.script_version : null,
      transcript_segment: { used_full_transcript_fallback: true },
    }
  }
  return result
}

// Pennie agent form feedback (achieve_agent_feedback), matched to a call by
// phone + submission time. Multiple submissions can reference one call (e.g.
// a re-transfer after a failed handoff), so views are arrays.
export type AgentFeedbackRow = {
  id: number
  lead_phone_raw?: string | null
  achieve_agent_name: string | null
  accent: boolean | null
  background_noise: boolean | null
  connection_issues: boolean | null
  call_quality: string | null
  notes: string | null
  submitted_by: string | null
  submitted_at: string
}

// Explicit projection for the partner-facing payload. lead_phone_raw is only
// included for unmatched entries (there is no call row to identify them by).
export function buildAgentFeedbackView(row: AgentFeedbackRow, includePhone = false) {
  return {
    id: row.id,
    lead_phone_raw: includePhone ? row.lead_phone_raw ?? null : undefined,
    achieve_agent_name: row.achieve_agent_name ?? null,
    accent: row.accent ?? null,
    background_noise: row.background_noise ?? null,
    connection_issues: row.connection_issues ?? null,
    call_quality: row.call_quality ?? null,
    notes: row.notes ?? null,
    submitted_by: row.submitted_by || null,
    submitted_at: row.submitted_at,
  }
}

type FeedbackRow = {
  id: number
  call_id: string
  module_name: string
  manager_email: string | null
  accurate: boolean | null
  action_taken: string | null
  inaccuracy_reason: string | null
  comment: string | null
  reviewed_at: string | null
}

// Assemble one partner-facing row. Explicit projection: internal identifiers
// (agent_email, sfdc_lead_id, assigned manager) never leave the server.
export function buildPortalRow(
  row: Json,
  transcript: Json,
  feedback: FeedbackRow | undefined,
  agentFeedback: AgentFeedbackRow[] = [],
) {
  const withheld = isWithheld(row.result_json)
  return {
    module_result_id: row.module_result_id ?? row.id,
    alert_created_at: row.alert_created_at ?? row.created_at ?? new Date(0).toISOString(),
    alert_sent_at: row.alert_sent_at ?? null,
    call_id: row.call_id,
    module_name: row.module_name,
    violation_type: row.violation_type ?? 'achieve_welcome_call',
    has_violation: row.has_violation ?? false,
    alert_sent: row.alert_sent ?? false,
    agent_email: null,
    contact_name: row.contact_name ?? null,
    contact_phone: row.contact_phone ?? null,
    recording_link: row.recording_link ?? transcript?.recording_link ?? null,
    transcript_url: row.transcript_url ?? transcript?.transcription_link ?? null,
    call_summary: withheld ? null : row.call_summary ?? null,
    sfdc_lead_id: null,
    processing_time_ms: row.processing_time_ms ?? null,
    result_json: sanitizeResultJson(row.result_json),
    assigned_manager_email: null,
    feedback_id: feedback?.id ?? row.feedback_id ?? null,
    feedback_by: feedback?.manager_email ?? row.feedback_by ?? null,
    accurate: feedback?.accurate ?? row.accurate ?? null,
    action_taken: feedback?.action_taken ?? row.action_taken ?? null,
    inaccuracy_reason: feedback?.inaccuracy_reason ?? row.inaccuracy_reason ?? null,
    feedback_comment: feedback?.comment ?? row.feedback_comment ?? null,
    reviewed_at: feedback?.reviewed_at ?? row.reviewed_at ?? null,
    is_reviewed: !!(feedback?.reviewed_at ?? row.reviewed_at),
    message_count: 0,
    last_message_at: null,
    acker_emails: [],
    trimmed_transcript: trimTranscript(transcript?.original_transcript, row.result_json) || null,
    agent_feedback: agentFeedback.map(f => buildAgentFeedbackView(f)),
  }
}

export type ValidatedFeedback = {
  call_id: string
  module_name: string
  manager_email: string
  accurate: boolean
  action_taken: string | null
  inaccuracy_reason: string | null
  comment: string | null
}

export function validateFeedback(input: Json): { ok: true; payload: ValidatedFeedback } | { ok: false; error: string } {
  const callId = typeof input?.call_id === 'string' ? input.call_id.trim() : ''
  if (!callId || callId.length > 128) return { ok: false, error: 'invalid_call_id' }

  const email = typeof input?.reviewer_email === 'string' ? input.reviewer_email.trim() : ''
  if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: 'invalid_reviewer_email' }
  }

  if (typeof input?.accurate !== 'boolean') return { ok: false, error: 'invalid_accurate' }

  let actionTaken: string | null = null
  let inaccuracyReason: string | null = null
  if (input.accurate) {
    actionTaken = typeof input.action_taken === 'string' ? input.action_taken : 'no_action_needed'
    if (!(ACTION_TAKEN_VALUES as readonly string[]).includes(actionTaken)) {
      return { ok: false, error: 'invalid_action_taken' }
    }
  } else {
    inaccuracyReason = typeof input.inaccuracy_reason === 'string' ? input.inaccuracy_reason : 'other'
    if (!(INACCURACY_REASON_VALUES as readonly string[]).includes(inaccuracyReason)) {
      return { ok: false, error: 'invalid_inaccuracy_reason' }
    }
  }

  const rawComment = typeof input?.comment === 'string' ? input.comment.trim() : ''
  if (rawComment.length > 4000) return { ok: false, error: 'comment_too_long' }

  return {
    ok: true,
    payload: {
      call_id: callId,
      module_name: ACHIEVE_MODULE_NAME, // force-scoped: the client never picks the module
      manager_email: email,
      accurate: input.accurate,
      action_taken: actionTaken,
      inaccuracy_reason: inaccuracyReason,
      comment: rawComment || null,
    },
  }
}
