import { supabase } from '@/integrations/supabase/client'
import type { AchieveAgentFeedback } from './achieve-queries'

// Internal-dashboard reads of Pennie agent feedback (achieve_agent_feedback):
// form submissions from Pennie agents rating the Achieve welcome-call rep,
// synced from the "Achieve Welcome Call" Google Sheet and matched to calls by
// phone + submission time. Direct authenticated-role query, same pattern as
// the rest of the internal dashboard (read policy added in
// 20260722190000_achieve_agent_feedback_internal_read). The external /achieve
// portal reads this data through the achieve-portal edge function instead.

// achieve_agent_feedback isn't in the generated Database<> types yet — cast at
// the boundary, same pragmatic approach as alert-queries.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any

export async function fetchAgentFeedbackForCall(
  callId: string,
): Promise<AchieveAgentFeedback[]> {
  const columns =
    'id, lead_phone_raw, achieve_agent_name, accent, background_noise, connection_issues, call_quality, notes, submitted_by, submitted_at'
  // matched_eavesly_call_id includes high-confidence call matches whose Achieve
  // module row is missing. The legacy lookup preserves visibility while older
  // rows remain pending their next normal sync/rematch cycle.
  const [callMatchResult, moduleMatchResult] = await Promise.all([
    sb
      .from('achieve_agent_feedback')
      .select(columns)
      .eq('matched_eavesly_call_id', callId)
      .order('submitted_at', { ascending: true }),
    sb
      .from('achieve_agent_feedback')
      .select(columns)
      .eq('matched_call_id', callId)
      .order('submitted_at', { ascending: true }),
  ])
  const error = callMatchResult.error ?? moduleMatchResult.error
  if (error) {
    console.error('Error fetching agent feedback for call:', error)
    throw error
  }

  const byId = new Map<number, AchieveAgentFeedback>()
  for (const row of [...(callMatchResult.data ?? []), ...(moduleMatchResult.data ?? [])]) {
    byId.set(row.id, row as AchieveAgentFeedback)
  }
  return Array.from(byId.values()).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
}
