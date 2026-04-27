import { supabase } from '@/integrations/supabase/client'
import type {
  CallWithQA,
  QAJson,
  AlertWithFeedback,
} from '../types/database'
import type { UserScope } from './alert-queries'
import { aggregateCoachingThemes, type CoachingThemes } from './coaching-aggregation'

const sb = supabase as any

// ---------- Types ----------

export type TrendPoint = {
  bucket: string // ISO date string for the bucket start
  label: string // human-readable label e.g. "Apr 21"
  call_count: number
  compliance_pass_rate: number // 0-100
  csat_high: number
  csat_medium: number
  csat_low: number
  escalations: number
}

export type AgentRollup = {
  agent_email: string
  agent_full_name: string | null
  call_count: number
  qa_count: number
  avg_talk_time: number
  compliance_pass_rate: number // 0-100
  csat_high_rate: number // 0-100
  escalation_rate: number // 0-100
  open_alerts_count: number
  unreviewed_alerts_count: number
  trend_points: TrendPoint[]
  needs_attention: boolean
}

export type AgentProfile = {
  agent_email: string
  agent_full_name: string | null
  rollup: AgentRollup
  trend: TrendPoint[]
  coaching_themes: CoachingThemes
  alerts: AlertWithFeedback[]
  recent_calls: CallWithQA[]
}

// ---------- Helpers ----------

const QA_SUMMARY_COLUMNS =
  'call_id, agent_email, overall_score, compliance_rating, customer_satisfaction_likely, manager_escalation, created_at'

const ALERT_COUNT_COLUMNS =
  'call_id, module_name, agent_email, alert_created_at, has_violation, is_reviewed, accurate, action_taken, inaccuracy_reason, contact_name, contact_phone, call_summary, sfdc_lead_id, violation_type, alert_sent, feedback_id, feedback_by, feedback_comment, reviewed_at'

const RECENT_CALL_COLUMNS =
  'id, call_id, agent_email, agent_full_name, started_at, contact_phone, talk_time, handle_time'

async function fetchInBatches<T>(
  values: string[],
  batchSize: number,
  query: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (values.length === 0) return []
  const batches: string[][] = []
  for (let i = 0; i < values.length; i += batchSize) {
    batches.push(values.slice(i, i + batchSize))
  }
  const results = await Promise.all(batches.map(query))
  return results.flat()
}

function pickBucketSize(startDate: Date, endDate: Date): 'day' | 'week' {
  const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  return days <= 14 ? 'day' : 'week'
}

function bucketKey(date: Date, size: 'day' | 'week'): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  if (size === 'week') {
    // Start of week (Monday)
    const day = d.getDay()
    const diff = (day + 6) % 7
    d.setDate(d.getDate() - diff)
  }
  return d.toISOString().slice(0, 10)
}

function bucketLabel(iso: string, size: 'day' | 'week'): string {
  const d = new Date(iso + 'T00:00:00')
  const month = d.toLocaleString('en-US', { month: 'short' })
  return size === 'day'
    ? `${month} ${d.getDate()}`
    : `Wk ${month} ${d.getDate()}`
}

function buildEmptyBuckets(
  startDate: Date,
  endDate: Date,
  size: 'day' | 'week',
): Map<string, TrendPoint> {
  const map = new Map<string, TrendPoint>()
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)
  while (cursor <= endDate) {
    const key = bucketKey(cursor, size)
    if (!map.has(key)) {
      map.set(key, {
        bucket: key,
        label: bucketLabel(key, size),
        call_count: 0,
        compliance_pass_rate: 0,
        csat_high: 0,
        csat_medium: 0,
        csat_low: 0,
        escalations: 0,
      })
    }
    if (size === 'day') cursor.setDate(cursor.getDate() + 1)
    else cursor.setDate(cursor.getDate() + 7)
  }
  return map
}

type QASummaryRow = {
  call_id: string
  agent_email: string | null
  overall_score: string | null
  compliance_rating: string | null
  customer_satisfaction_likely: string | null
  manager_escalation: boolean | null
  created_at: string
}

function buildTrendPoints(
  qaRows: QASummaryRow[],
  startDate: Date,
  endDate: Date,
): TrendPoint[] {
  const size = pickBucketSize(startDate, endDate)
  const buckets = buildEmptyBuckets(startDate, endDate, size)
  // Track pass/fail counts per bucket separately for accurate rate calc
  const passCounts = new Map<string, { pass: number; total: number }>()

  for (const qa of qaRows) {
    const key = bucketKey(new Date(qa.created_at), size)
    const point = buckets.get(key)
    if (!point) continue
    point.call_count += 1
    if (qa.manager_escalation) point.escalations += 1
    if (qa.customer_satisfaction_likely === 'high') point.csat_high += 1
    else if (qa.customer_satisfaction_likely === 'medium') point.csat_medium += 1
    else if (qa.customer_satisfaction_likely === 'low') point.csat_low += 1
    const pc = passCounts.get(key) || { pass: 0, total: 0 }
    if (qa.compliance_rating === 'pass' || qa.compliance_rating === 'fail') {
      pc.total += 1
      if (qa.compliance_rating === 'pass') pc.pass += 1
    }
    passCounts.set(key, pc)
  }

  for (const [key, point] of buckets) {
    const pc = passCounts.get(key)
    point.compliance_pass_rate =
      pc && pc.total > 0 ? Math.round((pc.pass / pc.total) * 100) : 0
  }

  return Array.from(buckets.values()).sort((a, b) =>
    a.bucket.localeCompare(b.bucket),
  )
}

function computeRollup(
  agentEmail: string,
  agentFullName: string | null,
  calls: { talk_time: number | null }[],
  qaRows: QASummaryRow[],
  alertCounts: { open: number; unreviewed: number },
  trendPoints: TrendPoint[],
): AgentRollup {
  const callCount = calls.length
  const qaCount = qaRows.length
  const avgTalkTime =
    callCount > 0
      ? Math.round(calls.reduce((s, c) => s + (c.talk_time || 0), 0) / callCount)
      : 0
  const compRated = qaRows.filter(
    q => q.compliance_rating === 'pass' || q.compliance_rating === 'fail',
  )
  const compPass = compRated.filter(q => q.compliance_rating === 'pass').length
  const compliancePassRate =
    compRated.length > 0 ? Math.round((compPass / compRated.length) * 100) : 0

  const csatRated = qaRows.filter(q => q.customer_satisfaction_likely)
  const csatHigh = csatRated.filter(
    q => q.customer_satisfaction_likely === 'high',
  ).length
  const csatHighRate =
    csatRated.length > 0 ? Math.round((csatHigh / csatRated.length) * 100) : 0

  const escalations = qaRows.filter(q => q.manager_escalation === true).length
  const escalationRate =
    qaCount > 0 ? Math.round((escalations / qaCount) * 100) : 0

  // "Needs attention" mirrors the call-level rule but at the agent level:
  // any below-bar metric flips the flag.
  const needsAttention =
    callCount > 0 &&
    (compliancePassRate < 80 ||
      escalationRate >= 10 ||
      csatHighRate < 50 ||
      alertCounts.unreviewed > 0)

  return {
    agent_email: agentEmail,
    agent_full_name: agentFullName,
    call_count: callCount,
    qa_count: qaCount,
    avg_talk_time: avgTalkTime,
    compliance_pass_rate: compliancePassRate,
    csat_high_rate: csatHighRate,
    escalation_rate: escalationRate,
    open_alerts_count: alertCounts.open,
    unreviewed_alerts_count: alertCounts.unreviewed,
    trend_points: trendPoints,
    needs_attention: needsAttention,
  }
}

// ---------- Public queries ----------

export async function fetchTeamRollup(
  scope: UserScope,
  startDate: Date,
  endDate: Date,
): Promise<AgentRollup[]> {
  if (!scope.isGodMode && scope.managedAgents.length === 0) return []

  // 1. Resolve agentEmails immediately so alerts can fetch in parallel with
  // the calls query. For non-godmode this is just scope.managedAgents — we
  // derive display names from the calls fetch itself, skipping a roundtrip.
  // For godmode we still need a discovery query to know the universe.
  const agentEmails: string[] = scope.isGodMode
    ? await (async () => {
        const { data, error } = await sb
          .from('eavesly_calls')
          .select('agent_email')
          .gte('started_at', startDate.toISOString())
          .lte('started_at', endDate.toISOString())
          .not('agent_email', 'is', null)
          .limit(2000)
        if (error) {
          console.error('Error fetching godmode agents:', error)
          return []
        }
        return Array.from(
          new Set(((data || []) as any[]).map(r => r.agent_email)),
        )
      })()
    : scope.managedAgents

  if (agentEmails.length === 0) return []

  // 2. Fire calls + alerts in parallel — alerts only depends on agentEmails.
  const [calls, alertRows] = await Promise.all([
    fetchInBatches(agentEmails, 100, async batch => {
      const { data, error } = await sb
        .from('eavesly_calls')
        .select('call_id, agent_email, agent_full_name, talk_time, started_at')
        .in('agent_email', batch)
        .gte('started_at', startDate.toISOString())
        .lte('started_at', endDate.toISOString())
        .limit(5000)
      if (error) {
        console.error('Error fetching team calls batch:', error)
        return []
      }
      return (data || []) as any[]
    }),
    fetchAgentAlertCounts(agentEmails, startDate, endDate),
  ])

  // Build agents with names derived from calls (no extra query).
  const nameByEmail = new Map<string, string | null>()
  for (const c of calls) {
    if (c.agent_email && !nameByEmail.has(c.agent_email)) {
      nameByEmail.set(c.agent_email, c.agent_full_name ?? null)
    }
  }
  const agents = agentEmails.map(email => ({
    agent_email: email,
    agent_full_name: nameByEmail.get(email) ?? null,
  }))

  // 3. Fetch QA summaries for those calls in batches.
  const callIds = calls.map(c => c.call_id).filter(Boolean) as string[]
  const qaRows = await fetchInBatches<QASummaryRow>(callIds, 300, async batch => {
    const { data, error } = await sb
      .from('eavesly_transcription_qa')
      .select(QA_SUMMARY_COLUMNS)
      .in('call_id', batch)
    if (error) {
      console.error('Error fetching team QA batch:', error)
      return []
    }
    return (data || []) as QASummaryRow[]
  })

  // 5. Group everything by agent_email and compute rollups.
  const callsByAgent = new Map<string, any[]>()
  for (const c of calls) {
    const arr = callsByAgent.get(c.agent_email) || []
    arr.push(c)
    callsByAgent.set(c.agent_email, arr)
  }
  const qaByAgent = new Map<string, QASummaryRow[]>()
  for (const q of qaRows) {
    if (!q.agent_email) continue
    const arr = qaByAgent.get(q.agent_email) || []
    arr.push(q)
    qaByAgent.set(q.agent_email, arr)
  }
  const alertsByAgent = new Map<string, { open: number; unreviewed: number }>()
  for (const a of alertRows) {
    if (!a.agent_email) continue
    const counts = alertsByAgent.get(a.agent_email) || { open: 0, unreviewed: 0 }
    if (a.has_violation) counts.open += 1
    if (a.has_violation && !a.is_reviewed) counts.unreviewed += 1
    alertsByAgent.set(a.agent_email, counts)
  }

  return agents.map(a => {
    const agentCalls = callsByAgent.get(a.agent_email) || []
    const agentQA = qaByAgent.get(a.agent_email) || []
    const counts = alertsByAgent.get(a.agent_email) || { open: 0, unreviewed: 0 }
    const trend = buildTrendPoints(agentQA, startDate, endDate)
    return computeRollup(
      a.agent_email,
      a.agent_full_name,
      agentCalls,
      agentQA,
      counts,
      trend,
    )
  })
}

export async function fetchAgentAlertCounts(
  agentEmails: string[],
  startDate: Date,
  endDate: Date,
): Promise<AlertWithFeedback[]> {
  if (agentEmails.length === 0) return []
  return fetchInBatches<AlertWithFeedback>(agentEmails, 100, async batch => {
    const { data, error } = await sb
      .from('eavesly_alerts_with_feedback')
      .select(ALERT_COUNT_COLUMNS)
      .in('agent_email', batch)
      .gte('alert_created_at', startDate.toISOString())
      .lte('alert_created_at', endDate.toISOString())
      .limit(2000)
    if (error) {
      console.error('Error fetching agent alerts batch:', error)
      return []
    }
    return (data || []) as AlertWithFeedback[]
  })
}

export async function fetchAgentProfile(
  agentEmail: string,
  startDate: Date,
  endDate: Date,
): Promise<AgentProfile | null> {
  // Calls in window
  const { data: callsData, error: callsError } = await sb
    .from('eavesly_calls')
    .select('call_id, agent_email, agent_full_name, talk_time, started_at')
    .eq('agent_email', agentEmail)
    .gte('started_at', startDate.toISOString())
    .lte('started_at', endDate.toISOString())
    .order('started_at', { ascending: false })
    .limit(5000)
  if (callsError) {
    console.error('Error fetching agent calls:', callsError)
    return null
  }
  const calls = (callsData || []) as any[]
  const agentFullName = calls.find(c => c.agent_full_name)?.agent_full_name ?? null
  const callIds = calls.map(c => c.call_id).filter(Boolean) as string[]

  // QA summaries (light) for ALL calls in window — drives metrics + trend.
  // qa_json (heavy) only for the most recent CALL_LIMIT calls — drives
  // coaching themes. Sampling keeps the payload bounded for high-volume
  // agents while still producing a representative theme ranking.
  const COACHING_SAMPLE_SIZE = 50
  const coachingCallIds = calls.slice(0, COACHING_SAMPLE_SIZE)
    .map(c => c.call_id)
    .filter(Boolean) as string[]

  // Fire QA summaries, coaching qa_json, alerts, and recent-call detail in parallel.
  const recentCallRows = calls.slice(0, 10)
  const recentCallIds = recentCallRows.map(c => c.call_id).filter(Boolean) as string[]

  const [qaRows, qaJsonRows, alerts, fullCallRows] = await Promise.all([
    fetchInBatches<QASummaryRow>(callIds, 300, async batch => {
      const { data, error } = await sb
        .from('eavesly_transcription_qa')
        .select(QA_SUMMARY_COLUMNS)
        .in('call_id', batch)
      if (error) {
        console.error('Error fetching agent QA batch:', error)
        return []
      }
      return (data || []) as QASummaryRow[]
    }),
    coachingCallIds.length === 0
      ? Promise.resolve<{ call_id: string; qa_json: QAJson | null }[]>([])
      : fetchInBatches<{ call_id: string; qa_json: QAJson | null }>(
          coachingCallIds,
          50,
          async batch => {
            const { data, error } = await sb
              .from('eavesly_transcription_qa')
              .select('call_id, qa_json')
              .in('call_id', batch)
            if (error) {
              console.error('Error fetching agent qa_json batch:', error)
              return []
            }
            return (data || []) as any[]
          },
        ),
    fetchAgentAlertCounts([agentEmail], startDate, endDate),
    recentCallIds.length === 0
      ? Promise.resolve<any[]>([])
      : (async () => {
          const { data } = await sb
            .from('eavesly_calls')
            .select(RECENT_CALL_COLUMNS)
            .in('call_id', recentCallIds)
          return (data || []) as any[]
        })(),
  ])

  const coachingThemes = aggregateCoachingThemes(
    qaJsonRows.map(r => r.qa_json).filter((j): j is QAJson => !!j),
  )

  const alertCounts = alerts.reduce(
    (acc, a) => {
      if (a.has_violation) acc.open += 1
      if (a.has_violation && !a.is_reviewed) acc.unreviewed += 1
      return acc
    },
    { open: 0, unreviewed: 0 },
  )

  let recentCallsFull: CallWithQA[] = []
  if (recentCallIds.length) {
    const fullCallById = new Map<string, any>(
      fullCallRows.map(c => [c.call_id, c]),
    )
    const qaByCallId = new Map<string, any>(qaRows.map(q => [q.call_id, q]))
    recentCallsFull = recentCallRows.map(c => {
      const full = fullCallById.get(c.call_id) || c
      return {
        ...full,
        qa: qaByCallId.get(c.call_id) || null,
      } as CallWithQA
    })
  }

  const trend = buildTrendPoints(qaRows, startDate, endDate)
  const rollup = computeRollup(
    agentEmail,
    agentFullName,
    calls,
    qaRows,
    alertCounts,
    trend,
  )

  return {
    agent_email: agentEmail,
    agent_full_name: agentFullName,
    rollup,
    trend,
    coaching_themes: coachingThemes,
    alerts,
    recent_calls: recentCallsFull,
  }
}
