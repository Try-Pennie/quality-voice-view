import { FunctionRegion } from '@supabase/supabase-js'
import { supabase } from '@/integrations/supabase/client'
import {
  parseAchieveFeedbackDashboard,
  parseAchieveRepresentativeFeedbackDetails,
  type AchieveFeedbackDashboard,
  type AchieveRepresentativeFeedbackDetails,
} from '@/lib/achieve-feedback-overview'
import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '@/types/database'

export const ACHIEVE_MODULE_NAME = 'achieve_welcome_call_qa'
export const ACHIEVE_PASSWORD_SESSION_KEY = 'achieve_portal_password'
export const ACHIEVE_LIST_QUERY_KEY = ['achieve-portal-data'] as const
export const ACHIEVE_FEEDBACK_QUERY_KEY = ['achieve-feedback-dashboard'] as const
export const ACHIEVE_REPRESENTATIVE_FEEDBACK_QUERY_KEY = ['achieve-representative-feedback'] as const

const showDemoData = import.meta.env.VITE_ACHIEVE_DEMO_DATA === 'true'

export type AchieveAgentFeedback = {
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
  qa_match_status?: 'qa_matched' | 'qa_audit' | 'qa_absent' | 'call_unmatched'
  call_match_confidence?: 'high' | null
  call_match_reason?:
    | 'legacy_module_match'
    | 'invalid_phone'
    | 'submitter_missing'
    | 'submitter_not_found'
    | 'submitter_ambiguous'
    | 'no_call_in_window'
    | 'call_ambiguous'
    | 'matched_phone_time_submitter'
    | 'matched_unique_qa_phone_time'
    | 'matched_transcript_agent_name'
    | 'matched_unique_phone_time_no_submitter'
    | null
  call_match_provenance?: 'deterministic' | 'inferred' | null
  call_match_method?:
    | 'legacy_module_association'
    | 'phone_time_submitter'
    | 'unique_qa_phone_time'
    | 'transcript_agent_name_phone_time'
    | 'unique_phone_time_no_submitter'
    | null
  call_match_evidence?: Readonly<Record<string, string | number | boolean | null>> | null
}

export type AchievePortalRow = AlertWithFeedback & {
  achieve_agent_name: string | null
  achieve_agent_email: string | null
  trimmed_transcript?: string | null
  agent_feedback?: AchieveAgentFeedback[]
}

export type AchieveCoverage = {
  total: number
  loaded: number
  cap: number
  capReached: boolean
}

export type AchievePortalData = {
  alerts: AchievePortalRow[]
  allCalls: AchievePortalRow[]
  coverage: AchieveCoverage
}

export type AchieveAuditData = {
  rows: AchievePortalRow[]
  coverage: AchieveCoverage
}

export type AchieveFeedbackTotals = {
  deterministicMatched: number
  inferredMatched: number
  auditQaAvailable: number
  trueQaAbsent: number
  unresolved: number
}

export type AchieveExceptionCoverage = {
  total: number
  loaded: number
  capReached: boolean
}

export type AchieveFeedbackExceptions = {
  trueQaAbsentAgentFeedback: AchieveAgentFeedback[]
  unresolvedAgentFeedback: AchieveAgentFeedback[]
  totals: AchieveFeedbackTotals
  limitPerList: number
  trueQaAbsentCoverage: AchieveExceptionCoverage
  unresolvedCoverage: AchieveExceptionCoverage
}

export type AchieveReviewFeedbackInput = {
  call_id: string
  reviewer_email: string
  accurate: boolean
  action_taken?: AlertActionTaken | null
  inaccuracy_reason?: AlertInaccuracyReason | null
  comment?: string | null
}

export class AchievePortalRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
  ) {
    super(code)
    this.name = 'AchievePortalRequestError'
  }
}

type BoundaryRecord = Readonly<Record<string, unknown>>

function record(value: unknown): BoundaryRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as BoundaryRecord
    : null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseMatchEvidence(value: unknown): Readonly<Record<string, string | number | boolean | null>> | null {
  const raw = record(value)
  if (!raw) return null
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

function parseAgentFeedback(value: unknown): AchieveAgentFeedback | null {
  const item = record(value)
  if (!item || typeof item.id !== 'number' || typeof item.submitted_at !== 'string') return null
  const status = item.qa_match_status
  const reason = item.call_match_reason
  const method = item.call_match_method
  return {
    id: item.id,
    lead_phone_raw: nullableString(item.lead_phone_raw),
    achieve_agent_name: nullableString(item.achieve_agent_name),
    accent: nullableBoolean(item.accent),
    background_noise: nullableBoolean(item.background_noise),
    connection_issues: nullableBoolean(item.connection_issues),
    call_quality: nullableString(item.call_quality),
    notes: nullableString(item.notes),
    submitted_by: nullableString(item.submitted_by),
    submitted_at: item.submitted_at,
    qa_match_status: status === 'qa_matched' || status === 'qa_audit' || status === 'qa_absent' || status === 'call_unmatched'
      ? status
      : undefined,
    call_match_confidence: item.call_match_confidence === 'high' ? 'high' : null,
    call_match_reason:
      reason === 'legacy_module_match' || reason === 'invalid_phone' || reason === 'submitter_missing'
      || reason === 'submitter_not_found' || reason === 'submitter_ambiguous' || reason === 'no_call_in_window'
      || reason === 'call_ambiguous' || reason === 'matched_phone_time_submitter'
      || reason === 'matched_unique_qa_phone_time' || reason === 'matched_transcript_agent_name'
      || reason === 'matched_unique_phone_time_no_submitter'
        ? reason
        : null,
    call_match_provenance: item.call_match_provenance === 'deterministic' || item.call_match_provenance === 'inferred'
      ? item.call_match_provenance
      : null,
    call_match_method:
      method === 'legacy_module_association' || method === 'phone_time_submitter'
      || method === 'unique_qa_phone_time' || method === 'transcript_agent_name_phone_time'
      || method === 'unique_phone_time_no_submitter'
        ? method
        : null,
    call_match_evidence: parseMatchEvidence(item.call_match_evidence),
  }
}

function parseAgentFeedbackRows(value: unknown): AchieveAgentFeedback[] {
  if (!Array.isArray(value)) throw new AchievePortalRequestError('invalid_response', null)
  return value.map(item => {
    const parsed = parseAgentFeedback(item)
    if (!parsed) throw new AchievePortalRequestError('invalid_response', null)
    return parsed
  })
}

function parseActionTaken(value: unknown): AlertActionTaken | null {
  return value === 'coached' || value === 'escalated' || value === 'follow_up_later' || value === 'no_action_needed'
    ? value
    : null
}

function parseInaccuracyReason(value: unknown): AlertInaccuracyReason | null {
  return value === 'soft_inquiry_misclassified' || value === 'wrong_context' || value === 'evidence_misquoted'
    || value === 'policy_does_not_apply' || value === 'addressed_off_call' || value === 'covered_not_verbatim'
    || value === 'call_dropped_incomplete' || value === 'other'
    ? value
    : null
}

function parsePortalRow(value: unknown): AchievePortalRow | null {
  const row = record(value)
  if (!row || typeof row.module_result_id !== 'number' || row.module_result_id <= 0) return null
  if (typeof row.alert_created_at !== 'string' || typeof row.call_id !== 'string') return null
  if (typeof row.module_name !== 'string' || typeof row.has_violation !== 'boolean') return null
  const agentFeedback = row.agent_feedback === undefined
    ? []
    : parseAgentFeedbackRows(row.agent_feedback)
  return {
    module_result_id: row.module_result_id,
    alert_created_at: row.alert_created_at,
    alert_sent_at: nullableString(row.alert_sent_at),
    call_id: row.call_id,
    module_name: row.module_name,
    violation_type: typeof row.violation_type === 'string' ? row.violation_type : 'achieve_welcome_call',
    has_violation: row.has_violation,
    alert_sent: row.alert_sent === true,
    agent_email: null,
    contact_name: nullableString(row.contact_name),
    contact_phone: nullableString(row.contact_phone),
    recording_link: nullableString(row.recording_link),
    transcript_url: nullableString(row.transcript_url),
    call_summary: nullableString(row.call_summary),
    sfdc_lead_id: null,
    processing_time_ms: typeof row.processing_time_ms === 'number' ? row.processing_time_ms : null,
    result_json: record(row.result_json) ?? {},
    assigned_manager_email: null,
    feedback_id: typeof row.feedback_id === 'number' ? row.feedback_id : null,
    feedback_by: nullableString(row.feedback_by),
    accurate: nullableBoolean(row.accurate),
    action_taken: parseActionTaken(row.action_taken),
    inaccuracy_reason: parseInaccuracyReason(row.inaccuracy_reason),
    feedback_comment: nullableString(row.feedback_comment),
    reviewed_at: nullableString(row.reviewed_at),
    is_reviewed: row.is_reviewed === true,
    message_count: 0,
    last_message_at: null,
    acker_emails: [],
    achieve_agent_name: nullableString(row.achieve_agent_name),
    achieve_agent_email: nullableString(row.achieve_agent_email),
    trimmed_transcript: nullableString(row.trimmed_transcript),
    agent_feedback: agentFeedback,
  }
}

function parseRows(value: unknown): AchievePortalRow[] {
  if (!Array.isArray(value)) throw new AchievePortalRequestError('invalid_response', null)
  const rows: AchievePortalRow[] = []
  for (const item of value) {
    const parsed = parsePortalRow(item)
    // Dropping one malformed row would silently corrupt overview denominators.
    // Treat the response atomically instead.
    if (!parsed) throw new AchievePortalRequestError('invalid_response', null)
    rows.push(parsed)
  }
  return rows
}

function parseNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function parseCoverage(value: unknown): AchieveCoverage {
  const coverage = record(value)
  const total = parseNonNegativeInteger(coverage?.total)
  const loaded = parseNonNegativeInteger(coverage?.loaded)
  const cap = parseNonNegativeInteger(coverage?.cap)
  if (total === null || loaded === null || cap === null || typeof coverage?.cap_reached !== 'boolean') {
    throw new AchievePortalRequestError('invalid_response', null)
  }
  if (loaded > total || loaded > cap || coverage.cap_reached !== (total > loaded)) {
    throw new AchievePortalRequestError('invalid_response', null)
  }
  return { total, loaded, cap, capReached: coverage.cap_reached }
}

function errorContext(error: unknown): { status: number | null; json?: () => Promise<unknown> } {
  const item = record(error)
  const context = record(item?.context)
  return {
    status: typeof context?.status === 'number' ? context.status : null,
    json: typeof context?.json === 'function' ? context.json.bind(context) as () => Promise<unknown> : undefined,
  }
}

async function invokePortal(
  action: string,
  extra: Readonly<Record<string, unknown>> = {},
  suppliedPassword?: string,
): Promise<unknown> {
  const password = suppliedPassword ?? sessionStorage.getItem(ACHIEVE_PASSWORD_SESSION_KEY) ?? ''
  const { data, error } = await supabase.functions.invoke('achieve-portal', {
    body: { password, action, ...extra },
    // This function performs several database round trips. Keep execution near
    // the us-east-2 database instead of the external reviewer's location.
    region: FunctionRegion.UsEast1,
  })
  if (!error) return data

  const context = errorContext(error)
  let code = context.status === 401 ? 'invalid_password' : 'request_failed'
  if (context.json) {
    try {
      const responseBody = record(await context.json())
      if (typeof responseBody?.error === 'string') code = responseBody.error
    } catch {
      // The status-derived code remains the safe boundary fallback.
    }
  }
  if (context.status === 401 && suppliedPassword === undefined) {
    sessionStorage.removeItem(ACHIEVE_PASSWORD_SESSION_KEY)
    window.location.reload()
  }
  throw new AchievePortalRequestError(code, context.status)
}

function parseListResponse(value: unknown): AchievePortalData {
  const response = record(value)
  if (!response) throw new AchievePortalRequestError('invalid_response', null)
  const allCalls = parseRows(response.all_calls)
  const alerts = allCalls.filter(row =>
    row.has_violation
    && row.result_json?.grading_skipped !== true
    && row.result_json?.transcript_segment?.used_full_transcript_fallback !== true,
  )
  return {
    alerts,
    allCalls,
    coverage: parseCoverage(response.coverage),
  }
}

function demoPortalData(): AchievePortalData {
  return {
    alerts: achieveDemoAlerts,
    allCalls: achieveDemoAlerts,
    coverage: { total: achieveDemoAlerts.length, loaded: achieveDemoAlerts.length, cap: 1000, capReached: false },
  }
}

function withDemoFallback(data: AchievePortalData): AchievePortalData {
  return showDemoData && data.allCalls.length === 0 ? demoPortalData() : data
}

function canUseDemoFallback(error: unknown): boolean {
  // Demo payloads cover list/service failures, never an incorrect password.
  return !(error instanceof AchievePortalRequestError && error.code === 'invalid_password')
}

// The new frontend uses list_overview; legacy list remains reserved for the
// already-deployed frontend during the backend-first compatibility rollout.
export async function unlockAchievePortal(password: string): Promise<AchievePortalData> {
  try {
    return withDemoFallback(parseListResponse(await invokePortal('list_overview', {}, password)))
  } catch (error) {
    if (showDemoData && canUseDemoFallback(error)) return demoPortalData()
    throw error
  }
}

export async function fetchAchievePortalData(): Promise<AchievePortalData> {
  try {
    return withDemoFallback(parseListResponse(await invokePortal('list_overview')))
  } catch (error) {
    console.error('Error fetching Achieve portal data:', error)
    if (showDemoData && canUseDemoFallback(error)) return demoPortalData()
    throw error
  }
}

/** Fetch complete Form + ordinary AI QA exact-representative rollups. */
export async function fetchAchieveFeedbackDashboard(): Promise<AchieveFeedbackDashboard> {
  const response = await invokePortal('get_feedback_overview')
  try {
    return parseAchieveFeedbackDashboard(response)
  } catch {
    throw new AchievePortalRequestError('invalid_response', null)
  }
}

/** Fetch sanitized Form notes and AI call summaries for one exact representative. */
export async function fetchAchieveRepresentativeFeedback(
  agentEmail: string,
): Promise<AchieveRepresentativeFeedbackDetails> {
  const response = await invokePortal('list_feedback_for_rep', { agent_email: agentEmail })
  try {
    return parseAchieveRepresentativeFeedbackDetails(response)
  } catch {
    throw new AchievePortalRequestError('invalid_response', null)
  }
}

export async function fetchAchievePortalDetail(moduleResultId: number): Promise<AchievePortalRow> {
  if (showDemoData && moduleResultId < 0) {
    const demoRow = achieveDemoAlerts.find(row => row.module_result_id === moduleResultId)
    if (demoRow) return demoRow
    throw new AchievePortalRequestError('not_found', 404)
  }
  const response = record(await invokePortal('detail', { module_result_id: moduleResultId }))
  const row = parsePortalRow(response?.row)
  if (!row) throw new AchievePortalRequestError('invalid_response', null)
  return row
}

export async function fetchAchieveAuditData(): Promise<AchieveAuditData> {
  const response = record(await invokePortal('list_audit'))
  if (!response) throw new AchievePortalRequestError('invalid_response', null)
  const rows = parseRows(response.rows)
  return { rows, coverage: parseCoverage(response.coverage) }
}

export async function fetchAchieveFeedbackExceptions(): Promise<AchieveFeedbackExceptions> {
  const response = record(await invokePortal('list_feedback_exceptions'))
  const totals = record(response?.totals)
  const coverage = record(response?.coverage)
  const absentCoverage = record(coverage?.true_qa_absent)
  const unresolvedCoverage = record(coverage?.unresolved)
  if (!response || !totals || !coverage || !absentCoverage || !unresolvedCoverage) {
    throw new AchievePortalRequestError('invalid_response', null)
  }

  const deterministicMatched = parseNonNegativeInteger(totals.deterministic_matched)
  const inferredMatched = parseNonNegativeInteger(totals.inferred_matched)
  const auditQaAvailable = parseNonNegativeInteger(totals.audit_qa_available)
  const trueQaAbsent = parseNonNegativeInteger(totals.true_qa_absent)
  const unresolved = parseNonNegativeInteger(totals.unresolved)
  const limitPerList = parseNonNegativeInteger(coverage.limit_per_list)
  const absentTotal = parseNonNegativeInteger(absentCoverage.total)
  const absentLoaded = parseNonNegativeInteger(absentCoverage.loaded)
  const unresolvedTotal = parseNonNegativeInteger(unresolvedCoverage.total)
  const unresolvedLoaded = parseNonNegativeInteger(unresolvedCoverage.loaded)
  if (
    deterministicMatched === null || inferredMatched === null || auditQaAvailable === null
    || trueQaAbsent === null || unresolved === null || limitPerList === null
    || absentTotal !== trueQaAbsent || unresolvedTotal !== unresolved
    || absentLoaded === null || unresolvedLoaded === null
    || typeof absentCoverage.cap_reached !== 'boolean' || typeof unresolvedCoverage.cap_reached !== 'boolean'
    || absentCoverage.cap_reached !== (absentTotal > absentLoaded)
    || unresolvedCoverage.cap_reached !== (unresolvedTotal > unresolvedLoaded)
  ) {
    throw new AchievePortalRequestError('invalid_response', null)
  }

  const trueQaAbsentAgentFeedback = parseAgentFeedbackRows(response.true_qa_absent_agent_feedback)
  const unresolvedAgentFeedback = parseAgentFeedbackRows(response.unresolved_agent_feedback)
  if (
    trueQaAbsentAgentFeedback.length !== absentLoaded
    || unresolvedAgentFeedback.length !== unresolvedLoaded
    || absentLoaded > limitPerList
    || unresolvedLoaded > limitPerList
  ) {
    throw new AchievePortalRequestError('invalid_response', null)
  }

  return {
    trueQaAbsentAgentFeedback,
    unresolvedAgentFeedback,
    totals: {
      deterministicMatched,
      inferredMatched,
      auditQaAvailable,
      trueQaAbsent,
      unresolved,
    },
    limitPerList,
    trueQaAbsentCoverage: {
      total: absentTotal,
      loaded: absentLoaded,
      capReached: absentCoverage.cap_reached,
    },
    unresolvedCoverage: {
      total: unresolvedTotal,
      loaded: unresolvedLoaded,
      capReached: unresolvedCoverage.cap_reached,
    },
  }
}

export async function submitAchieveReviewFeedback(
  input: AchieveReviewFeedbackInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await invokePortal('submit_feedback', {
      feedback: {
        call_id: input.call_id,
        reviewer_email: input.reviewer_email.trim(),
        accurate: input.accurate,
        action_taken: input.accurate ? input.action_taken ?? null : null,
        inaccuracy_reason: !input.accurate ? input.inaccuracy_reason ?? null : null,
        comment: input.comment?.trim() || null,
      },
    })
    return { ok: true }
  } catch (error) {
    console.error('Error submitting Achieve QA feedback:', error)
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

const achieveDemoAlert: AchievePortalRow = {
  module_result_id: -1,
  alert_created_at: '2026-06-29T18:00:00.000Z',
  alert_sent_at: null,
  call_id: 'WT8ace5e457629417521644859dcb187ca',
  module_name: ACHIEVE_MODULE_NAME,
  violation_type: 'script_adherence',
  has_violation: true,
  alert_sent: false,
  agent_email: 'demo-achieve@example.invalid',
  contact_name: 'Demo client',
  contact_phone: null,
  recording_link: null,
  transcript_url: null,
  call_summary: 'DEMO DATA: Client completed FDR enrollment handoff and welcome call; app/dashboard setup was completed and program basics were reviewed, but the agent never gave the required "recorded for quality and training purposes" disclosure.',
  sfdc_lead_id: null,
  achieve_agent_name: 'Max Reynolds',
  achieve_agent_email: 'max.reynolds@example.invalid',
  processing_time_ms: null,
  result_json: {
    demo_data: true,
    script_version: 'fdr_wholesale_db_pilot_v1',
    script_adherence: {
      greeting_and_identity_completed: true,
      recording_disclosure_provided: false,
      company_credibility_covered: true,
      call_agenda_provided: true,
      dedicated_account_deposits_explained: true,
      creditor_negotiation_explained: true,
      settlement_authorizations_explained: true,
      dashboard_account_setup_covered: true,
      tools_and_resources_covered: true,
      closing_and_support_provided: true,
      overall_script_adherence: 'substantial',
      missing_elements: ['recording_disclosure'],
      key_evidence_quotes: [
        'My name again is Max. I am a client success advocate, and I\'m excited to get to help you get started with your program today.',
        'Starting today, instead of making monthly payments to your enrolled creditors, you\'ll be making automatic deposits into your dedicated account.',
        'Before I let you go, I do have the Freedom Debt Relief customer service number in case you\'d like to write that down. Call at any time you have questions in the future.',
      ],
      violation: true,
      violation_reason: 'Compliance gap: the agent never gave the verbatim recording_disclosure ("this call will be recorded for quality and training purposes"). All other required welcome-call elements were covered.',
    },
    assessment_confidence: {
      score: 0.86,
      level: 'high',
      rationale: 'DEMO DATA: Transcript clearly captured all required welcome-call elements with verbatim agent quotes; audio quality and segmentation were clean.',
      limitations: [
        'DEMO DATA: Client side of the call was partially inaudible during the payment-process explanation.',
      ],
    },
    transcript_segment: {
      segment_type: 'fdr_disclosure_and_welcome_call',
      start_line: 42,
      marker: 'My name again is Max. I am a client success advocate',
      segmentation_confidence: 'high',
      segmentation_score: 0.91,
      used_full_transcript_fallback: false,
    },
  },
  assigned_manager_email: null,
  feedback_id: null,
  feedback_by: null,
  accurate: null,
  action_taken: null,
  inaccuracy_reason: null,
  feedback_comment: null,
  reviewed_at: null,
  is_reviewed: false,
  message_count: 0,
  last_message_at: null,
  acker_emails: [],
  trimmed_transcript: null,
}

const achievePoorTransferDemoAlert: AchievePortalRow = {
  ...achieveDemoAlert,
  module_result_id: -2,
  alert_created_at: '2026-06-29T18:15:00.000Z',
  call_id: 'WTpoortransferfulldemo0000000000000001',
  contact_name: 'Demo transfer client',
  call_summary: 'DEMO DATA: The required welcome-call script was fully completed. During the handoff, the client returned to an automated phone menu before later reaching another live agent.',
  result_json: {
    demo_data: true,
    script_version: 'fdr_wholesale_db_pilot_v1',
    script_adherence: {
      greeting_and_identity_completed: true,
      recording_disclosure_provided: true,
      company_credibility_covered: true,
      call_agenda_provided: true,
      dedicated_account_deposits_explained: true,
      creditor_negotiation_explained: true,
      settlement_authorizations_explained: true,
      dashboard_account_setup_covered: true,
      tools_and_resources_covered: true,
      closing_and_support_provided: true,
      overall_script_adherence: 'full',
      missing_elements: [],
      key_evidence_quotes: [
        'This call will be recorded for quality and training purposes.',
        'Before I let you go, our Program Success Team is here for you seven days a week.',
      ],
      violation: false,
    },
    transfer_experience: {
      poor_transfer: true,
      reasons: ['live_rep_then_ivr_reentry_then_live_rep'],
      ivr_reentry_lines: [121],
      agent_attempts: [
        {
          line: 116,
          name_asr: 'Marissa',
          quote: 'I am going to connect you with the next specialist now.',
        },
        {
          line: 134,
          name_asr: 'Danial',
          quote: 'Hi, this is Daniel. I can help you from here.',
        },
      ],
      evidence: [
        { line: 121, quote: 'Please say or enter your selection from the following menu.' },
        { line: 134, quote: 'Hi, this is Daniel. I can help you from here.' },
      ],
      detection_version: 'achieve_poor_transfer_v1',
    },
    assessment_confidence: {
      score: 0.93,
      level: 'high',
      rationale: 'DEMO DATA: The partner-leg transcript clearly shows a return to an automated menu before a later live agent joined.',
      limitations: [
        'DEMO DATA: Agent names are ASR-derived and may not match the intended spelling.',
      ],
    },
    transcript_segment: {
      segment_type: 'fdr_disclosure_and_welcome_call',
      start_line: 82,
      marker: 'This call will be recorded for quality and training purposes',
      segmentation_confidence: 'high',
      segmentation_score: 0.95,
      used_full_transcript_fallback: false,
    },
  },
  trimmed_transcript: [
    'Agent: This call will be recorded for quality and training purposes.',
    'Agent: Before I let you go, our Program Success Team is here for you seven days a week.',
    'Agent: I am going to connect you with the next specialist now.',
    'Automated menu: Please say or enter your selection from the following menu.',
    'Agent: Hi, this is Daniel. I can help you from here.',
  ].join('\n'),
}

const achieveDemoAlerts = [achieveDemoAlert, achievePoorTransferDemoAlert]
