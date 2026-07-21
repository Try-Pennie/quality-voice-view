// Fetch layer for the Achieve GOTA adoption page. Pure parsing/aggregation
// lives in gota-stats.ts (importable by the tsx self-check without supabase).

import { supabase } from '@/integrations/supabase/client'
import { fetchAllPaginated } from './supabase-helpers'
import { startOfBusinessDay, endOfBusinessDay } from './time-zone'
import type { UserScope } from './alert-queries'
import { GOTA_MODULE, parseGotaResult, type GotaEvaluation } from './gota-stats'

// Subset of the eavesly_alerts_with_feedback view this page selects. The view
// is in the generated Database types, so no `as any` client cast is needed.
type GotaViewRow = {
  call_id: string | null
  agent_email: string | null
  contact_name: string | null
  alert_created_at: string | null
  has_violation: boolean | null
  is_reviewed: boolean | null
  accurate: boolean | null
  result_json: unknown
}

export async function fetchGotaEvaluations(
  scope: UserScope,
  startDate: Date,
  endDate: Date,
): Promise<GotaEvaluation[]> {
  // Manager with no mapped agents (and not god-mode) sees nothing.
  if (!scope.isGodMode && scope.managedAgents.length === 0) return []

  const rows = await fetchAllPaginated<GotaViewRow>((from, to) => {
    let q = supabase
      .from('eavesly_alerts_with_feedback')
      .select(
        'call_id, agent_email, contact_name, alert_created_at, has_violation, is_reviewed, accurate, result_json',
      )
      .eq('module_name', GOTA_MODULE)
      .gte('alert_created_at', startOfBusinessDay(startDate).toISOString())
      .lte('alert_created_at', endOfBusinessDay(endDate).toISOString())
      .order('alert_created_at', { ascending: false })
      .range(from, to)
    if (!scope.isGodMode) q = q.in('agent_email', scope.managedAgents)
    return q
  })

  return rows
    .filter(row => row.call_id !== null && row.alert_created_at !== null)
    .map(row => ({
      call_id: row.call_id!,
      agent_email: row.agent_email,
      contact_name: row.contact_name,
      alert_created_at: row.alert_created_at!,
      has_violation: !!row.has_violation,
      is_reviewed: !!row.is_reviewed,
      accurate: row.accurate,
      result: parseGotaResult(row.result_json),
    }))
}
