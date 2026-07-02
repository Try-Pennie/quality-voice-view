import { supabase } from '@/integrations/supabase/client'
import { fetchAllPaginated } from './supabase-helpers'
import { startOfBusinessDay, endOfBusinessDay } from './time-zone'
import type { UserScope } from './alert-queries'
import type {
  AlertWithFeedback,
  AlertActionTaken,
  AlertInaccuracyReason,
} from '@/types/database'

// The generated Database<> type doesn't include this new view yet; cast at the
// boundary, matching alert-queries.ts.
const sb = supabase as any

export type AuditCategory = 'ended_live_lead' | 'phantom_conversation'

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  ended_live_lead: 'Ended a live lead',
  phantom_conversation: 'Phantom conversation',
}

export type DispositionAuditRow = AlertWithFeedback & {
  current_disposition: string | null
  suggested_disposition: string | null
  model_conversation_happened: string | null
  model_confidence: number | null
  audit_category: AuditCategory
}

export type AuditFilters = {
  startDate: Date
  endDate: Date
  category?: AuditCategory
}

// List columns exclude result_json/recording_link/transcript_url — those load on
// demand when the drawer opens (fetchDispositionAuditOne), same as the alerts list.
const AUDIT_LIST_COLUMNS = [
  'call_id',
  'module_name',
  'violation_type',
  'alert_created_at',
  'agent_email',
  'contact_name',
  'contact_phone',
  'call_summary',
  'sfdc_lead_id',
  'current_disposition',
  'suggested_disposition',
  'model_conversation_happened',
  'model_confidence',
  'audit_category',
  'is_reviewed',
  'accurate',
  'action_taken',
  'inaccuracy_reason',
  'feedback_by',
  'feedback_comment',
  'reviewed_at',
].join(',')

export async function fetchDispositionAudit(
  filters: AuditFilters,
  scope: UserScope,
): Promise<DispositionAuditRow[]> {
  if (!scope.isGodMode && scope.managedAgents.length === 0) return []

  return fetchAllPaginated<DispositionAuditRow>((from, to) => {
    let q = sb
      .from('eavesly_disposition_audit')
      .select(AUDIT_LIST_COLUMNS)
      .gte('alert_created_at', startOfBusinessDay(filters.startDate).toISOString())
      .lte('alert_created_at', endOfBusinessDay(filters.endDate).toISOString())
      .order('alert_created_at', { ascending: false })
      .range(from, to)
    if (filters.category) q = q.eq('audit_category', filters.category)
    if (!scope.isGodMode) q = q.in('agent_email', scope.managedAgents)
    return q
  })
}

export async function fetchDispositionAuditOne(
  callId: string,
): Promise<DispositionAuditRow | null> {
  const { data, error } = await sb
    .from('eavesly_disposition_audit')
    .select('*')
    .eq('call_id', callId)
    .eq('module_name', 'disposition_review')
    .maybeSingle()
  if (error) {
    console.error('Error fetching audit row:', error)
    throw error
  }
  return (data as DispositionAuditRow) ?? null
}

export type AuditFeedbackInput = {
  call_id: string
  manager_email: string
  accurate: boolean
  action_taken?: AlertActionTaken | null
  inaccuracy_reason?: AlertInaccuracyReason | null
  comment?: string | null
}

// Direct upsert to eavesly_alert_feedback. We intentionally bypass
// submitAlertFeedback() (which blocks suppressed modules) — this page is the
// sanctioned place to capture disposition_review feedback. onConflict matches the
// table's (call_id, module_name) unique constraint. These rows become the
// disposition_review ground-truth the module otherwise lacks.
export async function submitAuditFeedback(
  input: AuditFeedbackInput,
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    call_id: input.call_id,
    module_name: 'disposition_review',
    manager_email: input.manager_email,
    accurate: input.accurate,
    action_taken: input.accurate ? input.action_taken ?? null : null,
    inaccuracy_reason: !input.accurate ? input.inaccuracy_reason ?? null : null,
    comment: input.comment?.trim() || null,
    reviewed_at: new Date().toISOString(),
  }
  const { error } = await sb
    .from('eavesly_alert_feedback')
    .upsert(payload, { onConflict: 'call_id,module_name' })
  if (error) {
    console.error('Error submitting audit feedback:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// disposition_review result_json shape differs from the other modules, so it needs
// its own extractors (the alert-queries extractEvidence/extractReason switch has no
// disposition case).
export function auditEvidence(
  result: any,
): { speaker?: string; quote?: string; rationale?: string }[] {
  const ev = result?.evidence
  return Array.isArray(ev) ? ev : []
}

export function auditReasoning(result: any): string {
  return result?.reasoning_summary || ''
}
