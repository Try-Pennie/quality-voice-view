import { supabase } from './supabase'
import type { CallWithQA } from '../types/database'

export async function fetchDashboardData(
  startDate: Date,
  endDate: Date,
  selectedAgents: string[] = []
) {
  let query = supabase
    .from('eavesly_calls')
    .select(`
      *,
      qa:eavesly_transcription_qa(*)
    `)
    .gte('started_at', startDate.toISOString())
    .lte('started_at', endDate.toISOString())
    .order('started_at', { ascending: false })

  if (selectedAgents.length > 0) {
    query = query.in('agent_email', selectedAgents)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching dashboard data:', error)
    return []
  }

  // Transform qa (might be array)
  return (data || []).map(call => ({
    ...call,
    qa: Array.isArray(call.qa) ? call.qa[0] : call.qa
  })) as CallWithQA[]
}

export async function fetchUniqueAgents() {
  const { data, error } = await supabase
    .from('eavesly_calls')
    .select('agent_email, agent_full_name')
    .not('agent_email', 'is', null)
    .not('agent_full_name', 'is', null)
    .limit(1000)

  if (error) {
    console.error('Error fetching agents:', error)
    return []
  }

  const uniqueAgents = Array.from(
    new Map(data.map(item => [item.agent_email, item])).values()
  )

  return uniqueAgents.sort((a, b) =>
    (a.agent_full_name || '').localeCompare(b.agent_full_name || '')
  )
}

export function calculateMetrics(calls: CallWithQA[]) {
  const totalCalls = calls.length
  const callsWithQA = calls.filter(c => c.qa)

  const callsRequiringAttention = calls.filter(c => {
    if (!c.qa) return false
    return (
      c.qa.manager_escalation === true ||
      c.qa.compliance_rating === 'fail' ||
      c.qa.overall_score === 'poor' ||
      c.qa.overall_score === 'needs_improvement' ||
      c.qa.customer_satisfaction_likely === 'low'
    )
  }).length

  const avgTalkTime = calls.reduce((sum, c) => sum + (c.talk_time || 0), 0) / totalCalls || 0
  const avgHandleTime = calls.reduce((sum, c) => sum + (c.handle_time || 0), 0) / totalCalls || 0

  const compliancePassCount = callsWithQA.filter(c =>
    c.qa?.compliance_rating === 'pass'
  ).length
  const compliancePassRate = callsWithQA.length > 0
    ? (compliancePassCount / callsWithQA.length) * 100
    : 0

  const highSatCount = callsWithQA.filter(c =>
    c.qa?.customer_satisfaction_likely === 'high'
  ).length
  const highSatRate = callsWithQA.length > 0
    ? (highSatCount / callsWithQA.length) * 100
    : 0

  return {
    totalCalls,
    callsRequiringAttention,
    avgTalkTime: Math.round(avgTalkTime),
    avgHandleTime: Math.round(avgHandleTime),
    compliancePassRate: Math.round(compliancePassRate),
    highSatRate: Math.round(highSatRate)
  }
}

export async function fetchCallDetail(callId: string) {
  const { data, error } = await supabase
    .from('eavesly_calls')
    .select(`
      *,
      qa:eavesly_transcription_qa(*)
    `)
    .eq('call_id', callId)
    .maybeSingle()

  if (error) {
    console.error('Error fetching call detail:', error)
    return null
  }

  if (!data) return null

  return {
    ...data,
    qa: Array.isArray(data.qa) ? data.qa[0] : data.qa
  }
}
