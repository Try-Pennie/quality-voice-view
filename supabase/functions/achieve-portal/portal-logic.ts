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

// Historical module backfills opt into a separate audit surface with the exact
// persisted marker `result_json.backfill.audit_only === true`. Parse the marker
// narrowly so malformed/string values never move ordinary rows out of metrics.
export function isAuditOnlyResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return false
  // SAFETY: The object check establishes an indexable boundary record; the
  // nested value is independently refined before it affects portal routing.
  const resultRecord = result as Record<string, unknown>
  const backfill = resultRecord.backfill
  if (typeof backfill !== 'object' || backfill === null || Array.isArray(backfill)) return false
  // SAFETY: The nested object check establishes an indexable boundary record.
  const backfillRecord = backfill as Record<string, unknown>
  return backfillRecord.audit_only === true
}

// Feedback is writable only for ordinary module results. This pure decision is
// also enforced by the submit_feedback server action; the UI is not a trust boundary.
export function canSubmitPortalFeedback(result: unknown): boolean {
  return !isAuditOnlyResult(result)
}

// A row belongs in the Needs-review queue when it is a graded violation.
// Withheld and explicit historical-backfill rows are audit-only.
export function isQueueRow(row: Json): boolean {
  return row?.has_violation === true &&
    !isWithheld(row?.result_json) &&
    !isAuditOnlyResult(row?.result_json)
}

// Partition once at the server boundary so audit-only rows cannot accidentally
// enter either the Needs-review queue or normal All calls metrics.
export function partitionPortalRows<T extends { result_json?: unknown }>(rows: readonly T[]): {
  normalRows: T[]
  auditRows: T[]
} {
  const normalRows: T[] = []
  const auditRows: T[] = []
  for (const row of rows) {
    if (isAuditOnlyResult(row.result_json)) auditRows.push(row)
    else normalRows.push(row)
  }
  return { normalRows, auditRows }
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
  matched_call_id?: string | null
  matched_eavesly_call_id?: string | null
  call_match_status?: string | null
  call_match_confidence?: string | null
  call_match_reason?: string | null
  call_match_provenance?: string | null
  call_match_method?: string | null
  call_match_evidence?: unknown
}

const CALL_MATCH_REASONS = [
  'legacy_module_match',
  'invalid_phone',
  'submitter_missing',
  'submitter_not_found',
  'submitter_ambiguous',
  'no_call_in_window',
  'call_ambiguous',
  'matched_phone_time_submitter',
  'matched_unique_qa_phone_time',
  'matched_transcript_agent_name',
  'matched_unique_phone_time_no_submitter',
] as const

const CALL_MATCH_METHODS = [
  'legacy_module_association',
  'phone_time_submitter',
  'unique_qa_phone_time',
  'transcript_agent_name_phone_time',
  'unique_phone_time_no_submitter',
] as const

export type AgentFeedbackQaStatus = 'qa_matched' | 'qa_audit' | 'qa_absent' | 'call_unmatched'

type CallMatchReason = typeof CALL_MATCH_REASONS[number]
type CallMatchMethod = typeof CALL_MATCH_METHODS[number]
type MatchEvidence = Readonly<Record<string, string | number | boolean | null>>

function parseCallMatchReason(value: unknown): CallMatchReason | null {
  if (typeof value !== 'string' || !(CALL_MATCH_REASONS as readonly string[]).includes(value)) return null
  // SAFETY: Membership in the readonly literal set establishes CallMatchReason.
  return value as CallMatchReason
}

function parseCallMatchMethod(value: unknown): CallMatchMethod | null {
  if (typeof value !== 'string' || !(CALL_MATCH_METHODS as readonly string[]).includes(value)) return null
  // SAFETY: Membership in the readonly literal set establishes CallMatchMethod.
  return value as CallMatchMethod
}

function parseMatchEvidence(value: unknown): MatchEvidence | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: The object check establishes an indexable boundary record. Only
  // aggregate numeric fields and two closed categorical fields are projected;
  // unknown strings/keys (including possible identifiers) are dropped.
  const raw = value as Record<string, unknown>
  const evidence: Record<string, string | number | boolean | null> = {}
  const numericKeys = [
    'matcher_version',
    'same_agent_phone_time_candidate_count',
    'qa_candidate_count',
    'transcript_name_candidate_count',
    'global_phone_time_candidate_count',
    'absolute_delta_seconds',
  ] as const
  for (const key of numericKeys) {
    const item = raw[key]
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) evidence[key] = item
  }
  if (raw.qa_scope === 'ordinary' || raw.qa_scope === 'audit_only' || raw.qa_scope === 'absent') {
    evidence.qa_scope = raw.qa_scope
  }
  if (raw.historical_association === true) evidence.historical_association = true
  return evidence
}

// Explicit projection for the approved partner feedback view. Internal call
// identifiers never leave the server. Callers supply the QA classification
// after checking exact Achieve module rows, so audit-only QA cannot be mistaken
// for an ordinary match.
export function buildAgentFeedbackView(
  row: AgentFeedbackRow,
  options: { includePhone?: boolean; qaStatus?: AgentFeedbackQaStatus } = {},
) {
  const hasModuleMatch = typeof row.matched_call_id === 'string' && row.matched_call_id.trim().length > 0
  const hasCallMatch = typeof row.matched_eavesly_call_id === 'string' && row.matched_eavesly_call_id.trim().length > 0
  const qaMatchStatus = options.qaStatus ?? (hasModuleMatch ? 'qa_matched' : hasCallMatch ? 'qa_absent' : 'call_unmatched')
  return {
    id: row.id,
    lead_phone_raw: options.includePhone ? row.lead_phone_raw ?? null : undefined,
    achieve_agent_name: row.achieve_agent_name ?? null,
    accent: row.accent ?? null,
    background_noise: row.background_noise ?? null,
    connection_issues: row.connection_issues ?? null,
    call_quality: row.call_quality ?? null,
    notes: row.notes ?? null,
    submitted_by: row.submitted_by || null,
    submitted_at: row.submitted_at,
    qa_match_status: qaMatchStatus,
    call_match_confidence: row.call_match_confidence === 'high' ? 'high' : null,
    call_match_reason: parseCallMatchReason(row.call_match_reason),
    call_match_provenance: row.call_match_provenance === 'deterministic' || row.call_match_provenance === 'inferred'
      ? row.call_match_provenance
      : null,
    call_match_method: parseCallMatchMethod(row.call_match_method),
    call_match_evidence: parseMatchEvidence(row.call_match_evidence),
  }
}

export type FeedbackRow = {
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

// Achieve/FDR representative resolved server-side through the Snowflake-backed
// Salesforce Lead ID -> Achieve client ID bridge.
export type WelcomeAgentIdentity = {
  achieve_agent_name: string
  achieve_agent_email: string
}

export type WelcomeAgentLookupRow = WelcomeAgentIdentity & {
  sfdc_lead_id: string
}

// Parse the service-only RPC projection before it enters portal assembly. A
// malformed row is ignored, leaving attribution explicitly unmatched.
export function parseWelcomeAgentLookupRow(value: unknown): WelcomeAgentLookupRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: The object check above establishes an indexable boundary record;
  // every field is independently refined below before the value is returned.
  const row = value as Record<string, unknown>
  if (typeof row.sfdc_lead_id !== 'string' || !row.sfdc_lead_id.trim()) return null
  if (typeof row.achieve_agent_name !== 'string' || !row.achieve_agent_name.trim()) return null
  if (typeof row.achieve_agent_email !== 'string' || !row.achieve_agent_email.trim()) return null
  return {
    sfdc_lead_id: row.sfdc_lead_id,
    achieve_agent_name: row.achieve_agent_name,
    achieve_agent_email: row.achieve_agent_email,
  }
}

// Assemble one partner-facing row. Explicit projection: internal identifiers
// (agent_email, sfdc_lead_id, assigned manager) never leave the server. Only the
// Achieve/FDR representative identity resolved from Achieve's own report is added.
export function buildPortalRow(
  row: Json,
  transcript: Json,
  feedback: FeedbackRow | undefined,
  agentFeedback: AgentFeedbackRow[] = [],
  welcomeAgent?: WelcomeAgentIdentity,
  agentFeedbackQaStatus: AgentFeedbackQaStatus = 'qa_matched',
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
    achieve_agent_name: welcomeAgent?.achieve_agent_name ?? null,
    achieve_agent_email: welcomeAgent?.achieve_agent_email ?? null,
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
    agent_feedback: agentFeedback.map(item => buildAgentFeedbackView(item, { qaStatus: agentFeedbackQaStatus })),
  }
}

function buildListResultJson(result: Json): Json {
  if (!result || isWithheld(result)) return sanitizeResultJson(result)

  const adherence = result.script_adherence
  const compactAdherence: Record<string, unknown> = {}
  if (adherence && typeof adherence === 'object' && !Array.isArray(adherence)) {
    for (const [key, value] of Object.entries(adherence)) {
      if (typeof value === 'boolean') compactAdherence[key] = value
    }
    if (typeof adherence.overall_script_adherence === 'string') {
      compactAdherence.overall_script_adherence = adherence.overall_script_adherence
    }
    if (Array.isArray(adherence.missing_elements)) {
      compactAdherence.missing_elements = adherence.missing_elements.filter(
        (value: unknown): value is string => typeof value === 'string',
      )
    }
  }

  const confidence = result.assessment_confidence
  const compactConfidence = confidence && typeof confidence === 'object' && !Array.isArray(confidence)
    ? {
        level: typeof confidence.level === 'string' ? confidence.level : null,
        score: typeof confidence.score === 'number' ? confidence.score : null,
      }
    : null
  const transfer = result.transfer_experience
  const compactTransfer = transfer && typeof transfer === 'object' && !Array.isArray(transfer)
    ? {
        poor_transfer: transfer.poor_transfer === true,
        reasons: Array.isArray(transfer.reasons)
          ? transfer.reasons.filter((value: unknown): value is string => typeof value === 'string')
          : [],
      }
    : null

  return {
    script_version: typeof result.script_version === 'string' ? result.script_version : null,
    script_adherence: compactAdherence,
    assessment_confidence: compactConfidence,
    transfer_experience: compactTransfer,
  }
}

function buildCompactAgentFeedback(row: AgentFeedbackRow, qaStatus: AgentFeedbackQaStatus) {
  const projected = buildAgentFeedbackView(row, { qaStatus })
  return {
    id: projected.id,
    accent: projected.accent,
    background_noise: projected.background_noise,
    connection_issues: projected.connection_issues,
    call_quality: projected.call_quality,
    submitted_at: projected.submitted_at,
    qa_match_status: projected.qa_match_status,
    call_match_confidence: projected.call_match_confidence,
    call_match_provenance: projected.call_match_provenance,
    call_match_method: projected.call_match_method,
    call_match_evidence: projected.call_match_evidence,
  }
}

// Initial-list projection: only fields needed by overview analytics, filters,
// and queue rows. Drawer-only text, links, evidence, and transcript content are
// deliberately absent rather than null so payload growth fails visibly.
export function buildPortalListRow(
  row: Json,
  feedback: FeedbackRow | undefined,
  agentFeedback: AgentFeedbackRow[] = [],
  welcomeAgent?: WelcomeAgentIdentity,
  agentFeedbackQaStatus: AgentFeedbackQaStatus = 'qa_matched',
) {
  const reviewedAt = feedback?.reviewed_at ?? row.reviewed_at ?? null
  return {
    module_result_id: row.module_result_id ?? row.id,
    alert_created_at: row.alert_created_at ?? row.created_at ?? new Date(0).toISOString(),
    call_id: row.call_id,
    module_name: row.module_name,
    violation_type: row.violation_type ?? 'achieve_welcome_call',
    has_violation: row.has_violation ?? false,
    contact_name: row.contact_name ?? null,
    contact_phone: row.contact_phone ?? null,
    achieve_agent_name: welcomeAgent?.achieve_agent_name ?? null,
    achieve_agent_email: welcomeAgent?.achieve_agent_email ?? null,
    result_json: buildListResultJson(row.result_json),
    reviewed_at: reviewedAt,
    is_reviewed: !!reviewedAt,
    agent_feedback: agentFeedback.map(item => buildCompactAgentFeedback(item, agentFeedbackQaStatus)),
  }
}

function aggregateRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function aggregateCount(row: Record<string, unknown> | null, key: string): number | null {
  const value = row?.[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

// The timeout-safe Edge path reads these aggregates in concurrent transactions.
// Reconcile the same invariants as the browser before returning either snapshot.
export function feedbackLeadershipSnapshotsAgree(overviewValue: unknown, representativesValue: unknown): boolean {
  const overview = aggregateRecord(overviewValue)
  const representatives = aggregateRecord(representativesValue)
  const coverage = aggregateRecord(representatives?.coverage)
  const rows = representatives?.rows
  const overviewCoverage = aggregateRecord(overview?.coverage)
  const qa = aggregateRecord(overview?.qa)
  const qaCoverage = aggregateRecord(qa?.coverage)
  const qaOutcomes = aggregateRecord(qa?.outcomes)
  const qaAlignment = aggregateRecord(qa?.alignment)
  if (!overview || !representatives || !coverage || !Array.isArray(rows)) return false

  const loaded = aggregateCount(coverage, 'loaded')
  const total = aggregateCount(coverage, 'total')
  const offset = aggregateCount(coverage, 'offset')
  const distinctAnyAgents = aggregateCount(overview, 'distinct_any_agents')
  if (
    loaded !== rows.length
    || total === null
    || total !== distinctAnyAgents
    || typeof coverage.cap_reached !== 'boolean'
    || offset === null
  ) return false

  const emails = new Set<string>()
  const formEmails = new Set<string>()
  const aiEmails = new Set<string>()
  let formTotal = 0
  let aiTotal = 0
  let aiPass = 0
  let aiFlagged = 0
  const alignment = {
    overlap_calls: 0,
    both_clear: 0,
    both_concern: 0,
    human_only: 0,
    ai_only: 0,
  }

  for (const value of rows) {
    const row = aggregateRecord(value)
    const email = typeof row?.achieve_agent_email === 'string'
      ? row.achieve_agent_email.trim().toLowerCase()
      : ''
    const rowFormTotal = aggregateCount(row, 'total_submissions')
    const rowAiTotal = aggregateCount(row, 'ai_total')
    const rowAiPass = aggregateCount(row, 'ai_pass')
    const rowAiFlagged = aggregateCount(row, 'ai_flagged')
    if (!email || emails.has(email) || [rowFormTotal, rowAiTotal, rowAiPass, rowAiFlagged].includes(null)) {
      return false
    }
    emails.add(email)
    if (rowFormTotal! > 0) formEmails.add(email)
    if (rowAiTotal! > 0) aiEmails.add(email)
    formTotal += rowFormTotal!
    aiTotal += rowAiTotal!
    aiPass += rowAiPass!
    aiFlagged += rowAiFlagged!
    for (const key of Object.keys(alignment) as Array<keyof typeof alignment>) {
      const count = aggregateCount(row, key)
      if (count === null) return false
      alignment[key] += count
    }
  }

  if (coverage.cap_reached || offset !== 0) return true

  return formTotal === aggregateCount(overviewCoverage, 'exact_agent_attributed')
    && aiTotal === aggregateCount(qaCoverage, 'exact_agent_attributed')
    && aiPass === aggregateCount(qaOutcomes, 'pass')
    && aiFlagged === aggregateCount(qaOutcomes, 'flagged')
    && formEmails.size === aggregateCount(overview, 'distinct_exact_agents')
    && aiEmails.size === aggregateCount(qa, 'distinct_exact_agents')
    && Object.entries(alignment).every(([key, value]) => value === aggregateCount(qaAlignment, key))
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
