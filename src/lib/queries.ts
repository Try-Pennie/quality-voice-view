import { supabase } from '@/integrations/supabase/client'
import type { CallWithQA } from '../types/database'
import { fetchAllPaginated } from './supabase-helpers'
import { startOfBusinessDay, endOfBusinessDay } from './time-zone'

// Fetch QA summaries in batches to avoid response size limits
async function fetchQASummaries(callIds: string[]) {
  const BATCH_SIZE = 300
  const batches: string[][] = []
  
  // Split callIds into batches
  for (let i = 0; i < callIds.length; i += BATCH_SIZE) {
    batches.push(callIds.slice(i, i + BATCH_SIZE))
  }
  
  // Fetch all batches in parallel
  const batchPromises = batches.map(async (batch) => {
    const { data, error } = await supabase
      .from('eavesly_transcription_qa')
      .select('call_id, overall_score, compliance_rating, customer_satisfaction_likely, manager_escalation')
      .in('call_id', batch)
    
    if (error) {
      console.error('Error fetching QA batch:', error)
      throw error
    }
    
    return data || []
  })
  
  const results = await Promise.all(batchPromises)
  return results.flat()
}

// Columns rendered on the dashboard list, plus `disposition` (disposition
// filter) and `campaign_name` (pitch-call risk band detection, PSAI-178).
const CALL_LIST_COLUMNS =
  'id, call_id, agent_email, agent_full_name, started_at, contact_phone, talk_time, handle_time, disposition, campaign_name'

export async function fetchDashboardData(
  startDate: Date,
  endDate: Date,
  selectedAgents: string[] = []
) {
  // 1) Fetch calls in range — paginated to bypass Supabase's 1000-row cap.
  const validAgents = selectedAgents.filter(email => email && email.trim())
  const calls = await fetchAllPaginated<any>((from, to) => {
    let q = supabase
      .from('eavesly_calls')
      .select(CALL_LIST_COLUMNS)
      .gte('started_at', startOfBusinessDay(startDate).toISOString())
      .lte('started_at', endOfBusinessDay(endDate).toISOString())
      .order('started_at', { ascending: false })
      .range(from, to)
    if (validAgents.length > 0) q = q.in('agent_email', validAgents)
    return q
  })
  if (calls.length === 0) return []

  // 2) Fetch QA summaries in batches (only essential fields for dashboard)
  const callIds = calls.map(c => c.call_id).filter(Boolean)
  const qaRows = await fetchQASummaries(callIds)
  const qaByCallId = new Map<string, any>(qaRows.map((q: any) => [q.call_id, q]))

  return calls.map(c => ({
    ...c,
    qa: qaByCallId.get(c.call_id) || null,
  })) as CallWithQA[]
}

export async function fetchUniqueAgents() {
  // Scoped to the last 30 days so we don't scan the full ~440k-row calls
  // table just to populate the filter dropdown. Any agent who's been
  // active in the last month shows up here.
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const data = await fetchAllPaginated<{
    agent_email: string
    agent_full_name: string | null
  }>((from, to) =>
    supabase
      .from('eavesly_calls')
      .select('agent_email, agent_full_name')
      .gte('started_at', since.toISOString())
      .not('agent_email', 'is', null)
      .not('agent_full_name', 'is', null)
      .order('started_at', { ascending: false })
      .range(from, to),
  )

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
  // Fetch base call row
  const { data: call, error: callError } = await supabase
    .from('eavesly_calls')
    .select('*')
    .eq('call_id', callId)
    .maybeSingle()

  if (callError) {
    console.error('Error fetching call detail (call):', callError)
    throw callError
  }
  if (!call) return null

  // Fetch QA row separately and merge
  const { data: qa, error: qaError } = await supabase
    .from('eavesly_transcription_qa')
    .select('*')
    .eq('call_id', callId)
    .maybeSingle()

  if (qaError) {
    console.error('Error fetching call detail (qa):', qaError)
    throw qaError
  }

  return {
    ...call,
    qa: qa || null,
  }
}
