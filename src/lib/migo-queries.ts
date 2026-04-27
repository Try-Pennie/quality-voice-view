import { supabase } from '@/integrations/supabase/client'
import type { UserScope } from './alert-queries'

const sb = supabase as any

export type MigoCoverage = {
  configured: boolean
  briefed_calls: number
  unbriefed_calls: number
  briefed_compliance_rate: number | null
  unbriefed_compliance_rate: number | null
  briefed_escalation_rate: number | null
  unbriefed_escalation_rate: number | null
}

export const EMPTY_COVERAGE: MigoCoverage = {
  configured: false,
  briefed_calls: 0,
  unbriefed_calls: 0,
  briefed_compliance_rate: null,
  unbriefed_compliance_rate: null,
  briefed_escalation_rate: null,
  unbriefed_escalation_rate: null,
}

export async function fetchMigoCoverage(
  scope: UserScope,
  agentEmails: string[],
  startDate: Date,
  endDate: Date,
): Promise<MigoCoverage> {
  if (!scope.isGodMode && agentEmails.length === 0) return EMPTY_COVERAGE

  const { data, error } = await sb.functions.invoke('migo-coverage', {
    body: {
      agent_emails: agentEmails,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
  })
  if (error) {
    console.error('migo-coverage invoke error:', error)
    return EMPTY_COVERAGE
  }
  return (data ?? EMPTY_COVERAGE) as MigoCoverage
}
