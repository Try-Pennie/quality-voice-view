import { supabase } from '@/integrations/supabase/client'
import { resolveRecordingUrl } from './recording-url'
import type { CallListRow } from './calls-queries'

/** KPIs for explicitly exported rows; SQL uses the same denominators for on-screen summaries. */
export function calculateMetrics(calls: readonly CallListRow[]) {
  const totalCalls = calls.length
  const callsWithQA = calls.filter(c => c.qa)
  const callsRequiringAttention = calls.filter(c => c.qa && (
    c.qa.manager_escalation === true || c.qa.compliance_rating === 'fail'
    || c.qa.overall_score === 'poor' || c.qa.overall_score === 'needs_improvement'
    || c.qa.customer_satisfaction_likely === 'low'
  )).length
  const avgTalkTime = calls.reduce((sum, c) => sum + (c.talk_time || 0), 0) / totalCalls || 0
  const avgHandleTime = calls.reduce((sum, c) => sum + (c.handle_time || 0), 0) / totalCalls || 0
  const compliancePassRate = callsWithQA.length
    ? callsWithQA.filter(c => c.qa?.compliance_rating === 'pass').length / callsWithQA.length * 100 : 0
  const highSatRate = callsWithQA.length
    ? callsWithQA.filter(c => c.qa?.customer_satisfaction_likely === 'high').length / callsWithQA.length * 100 : 0
  return { totalCalls, callsRequiringAttention, avgTalkTime: Math.round(avgTalkTime),
    avgHandleTime: Math.round(avgHandleTime), compliancePassRate: Math.round(compliancePassRate), highSatRate: Math.round(highSatRate) }
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

  const recording = await resolveRecordingUrl(qa?.recording_link)
  return {
    ...call,
    qa: qa ? {
      ...qa,
      recording_reference: qa.recording_link,
      recording_link: recording.ok ? recording.url : null,
      recording_error: !recording.ok,
    } : null,
  }
}
