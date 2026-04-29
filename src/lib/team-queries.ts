import { supabase } from '@/integrations/supabase/client'
import type {
  CallWithQA,
  QAJson,
  AlertWithFeedback,
} from '../types/database'
import type { UserScope } from './alert-queries'
import {
  aggregateCoachingThemes,
  aggregateTeamCoachingThemes,
  type CoachingThemes,
  type TeamCoachingThemes,
} from './coaching-aggregation'

const sb = supabase as any

// ---------- Types ----------

export type TrendPoint = {
  bucket: string // ISO date string for the bucket start
  label: string // human-readable label e.g. "Apr 21"
  call_count: number
  // null when no compliance-graded calls landed in this bucket — lets the
  // line chart render a gap instead of a misleading 0%.
  compliance_pass_rate: number | null
  compliance_pass: number // raw count, used for re-aggregation across agents
  compliance_total: number // raw count of pass+fail (excludes n/a)
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

// Shape returned by team_daily_metrics / agent_daily_metrics RPCs.
// Values come back as Postgres bigints which the JS driver renders as
// strings or numbers depending on size — coerce on read.
type DailyMetricRow = {
  agent_email: string
  agent_full_name: string | null
  bucket_day: string // YYYY-MM-DD
  call_count: number
  talk_time_sum: number
  talk_time_n: number
  qa_count: number
  compliance_pass_count: number
  compliance_total_count: number
  escalation_count: number
  csat_high_count: number
  csat_medium_count: number
  csat_low_count: number
  open_alerts: number
  unreviewed_alerts: number
}

// ---------- Helpers ----------

const ALERT_COUNT_COLUMNS =
  'call_id, module_name, agent_email, alert_created_at, has_violation, is_reviewed, accurate, action_taken, inaccuracy_reason, contact_name, contact_phone, call_summary, sfdc_lead_id, violation_type, alert_sent, feedback_id, feedback_by, feedback_comment, reviewed_at, message_count, last_message_at, acker_emails'

const RECENT_CALL_COLUMNS =
  'id, call_id, agent_email, agent_full_name, started_at, contact_phone, talk_time, handle_time'

const QA_SUMMARY_COLUMNS =
  'call_id, agent_email, overall_score, compliance_rating, customer_satisfaction_likely, manager_escalation, created_at'

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
        compliance_pass_rate: null,
        compliance_pass: 0,
        compliance_total: 0,
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

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v) || 0
  return 0
}

function normalizeDailyRow(r: any): DailyMetricRow {
  return {
    agent_email: r.agent_email,
    agent_full_name: r.agent_full_name ?? null,
    bucket_day: r.bucket_day,
    call_count: toNum(r.call_count),
    talk_time_sum: toNum(r.talk_time_sum),
    talk_time_n: toNum(r.talk_time_n),
    qa_count: toNum(r.qa_count),
    compliance_pass_count: toNum(r.compliance_pass_count),
    compliance_total_count: toNum(r.compliance_total_count),
    escalation_count: toNum(r.escalation_count),
    csat_high_count: toNum(r.csat_high_count),
    csat_medium_count: toNum(r.csat_medium_count),
    csat_low_count: toNum(r.csat_low_count),
    open_alerts: toNum(r.open_alerts),
    unreviewed_alerts: toNum(r.unreviewed_alerts),
  }
}

// Postgres `date` -> 'YYYY-MM-DD'. Use the local-tz year/month/day so the
// browser's window aligns with the MV's NY-time bucketing for east-coast
// users. Acceptable drift elsewhere.
function toDateParam(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function trendPointsFromDailyRows(
  rows: DailyMetricRow[],
  startDate: Date,
  endDate: Date,
): TrendPoint[] {
  const size = pickBucketSize(startDate, endDate)
  const buckets = buildEmptyBuckets(startDate, endDate, size)
  for (const r of rows) {
    const dayDate = new Date(r.bucket_day + 'T00:00:00')
    const key = bucketKey(dayDate, size)
    const point = buckets.get(key)
    if (!point) continue
    point.call_count += r.call_count
    point.compliance_pass += r.compliance_pass_count
    point.compliance_total += r.compliance_total_count
    point.csat_high += r.csat_high_count
    point.csat_medium += r.csat_medium_count
    point.csat_low += r.csat_low_count
    point.escalations += r.escalation_count
  }
  for (const point of buckets.values()) {
    // null (not 0) when no compliance-graded calls landed in this bucket so
    // the line chart renders a gap instead of a misleading 0%.
    point.compliance_pass_rate =
      point.compliance_total > 0
        ? Math.round((point.compliance_pass / point.compliance_total) * 100)
        : null
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.bucket.localeCompare(b.bucket),
  )
}

function rollupFromDailyRows(
  agentEmail: string,
  agentFullName: string | null,
  rows: DailyMetricRow[],
  trend: TrendPoint[],
): AgentRollup {
  const callCount = rows.reduce((s, r) => s + r.call_count, 0)
  const qaCount = rows.reduce((s, r) => s + r.qa_count, 0)
  const talkTimeSum = rows.reduce((s, r) => s + r.talk_time_sum, 0)
  const talkTimeN = rows.reduce((s, r) => s + r.talk_time_n, 0)
  const avgTalkTime = talkTimeN > 0 ? Math.round(talkTimeSum / talkTimeN) : 0

  const compPass = rows.reduce((s, r) => s + r.compliance_pass_count, 0)
  const compTotal = rows.reduce((s, r) => s + r.compliance_total_count, 0)
  const compliancePassRate =
    compTotal > 0 ? Math.round((compPass / compTotal) * 100) : 0

  const csatHigh = rows.reduce((s, r) => s + r.csat_high_count, 0)
  const csatMed = rows.reduce((s, r) => s + r.csat_medium_count, 0)
  const csatLow = rows.reduce((s, r) => s + r.csat_low_count, 0)
  const csatTotal = csatHigh + csatMed + csatLow
  const csatHighRate =
    csatTotal > 0 ? Math.round((csatHigh / csatTotal) * 100) : 0

  const escalations = rows.reduce((s, r) => s + r.escalation_count, 0)
  const escalationRate =
    qaCount > 0 ? Math.round((escalations / qaCount) * 100) : 0

  const openAlerts = rows.reduce((s, r) => s + r.open_alerts, 0)
  const unreviewedAlerts = rows.reduce((s, r) => s + r.unreviewed_alerts, 0)

  const needsAttention =
    callCount > 0 &&
    (compliancePassRate < 80 ||
      escalationRate >= 10 ||
      csatHighRate < 50 ||
      unreviewedAlerts > 0)

  return {
    agent_email: agentEmail,
    agent_full_name: agentFullName,
    call_count: callCount,
    qa_count: qaCount,
    avg_talk_time: avgTalkTime,
    compliance_pass_rate: compliancePassRate,
    csat_high_rate: csatHighRate,
    escalation_rate: escalationRate,
    open_alerts_count: openAlerts,
    unreviewed_alerts_count: unreviewedAlerts,
    trend_points: trend,
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

  const { data, error } = await sb.rpc('team_daily_metrics', {
    p_start: toDateParam(startDate),
    p_end: toDateParam(endDate),
  })
  if (error) {
    console.error('Error calling team_daily_metrics:', error)
    return []
  }

  const rows = ((data || []) as any[]).map(normalizeDailyRow)
  const byAgent = new Map<string, DailyMetricRow[]>()
  const nameByAgent = new Map<string, string | null>()
  for (const r of rows) {
    if (!r.agent_email) continue
    const arr = byAgent.get(r.agent_email) || []
    arr.push(r)
    byAgent.set(r.agent_email, arr)
    if (!nameByAgent.has(r.agent_email) || (r.agent_full_name && !nameByAgent.get(r.agent_email))) {
      nameByAgent.set(r.agent_email, r.agent_full_name)
    }
  }

  // Surface every agent in scope, even those with zero activity in the window,
  // so the leaderboard "All agents" view stays consistent with prior behavior.
  const allAgents = new Set<string>(byAgent.keys())
  if (!scope.isGodMode) for (const e of scope.managedAgents) allAgents.add(e)

  return Array.from(allAgents).map(email => {
    const agentRows = byAgent.get(email) || []
    const trend = trendPointsFromDailyRows(agentRows, startDate, endDate)
    return rollupFromDailyRows(email, nameByAgent.get(email) ?? null, agentRows, trend)
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
  // Metrics + trend come from the RPC (no row-cap surprises). Coaching themes
  // and recent-call detail still need raw rows, but they're sample-bounded
  // (<= 50 calls, <= 10 calls) so they're safe to fetch directly.
  const COACHING_SAMPLE_SIZE = 50
  const RECENT_CALL_SIZE = 10
  const sampleSize = Math.max(COACHING_SAMPLE_SIZE, RECENT_CALL_SIZE)

  const [metricsRes, sampleCallsRes, alerts] = await Promise.all([
    sb.rpc('agent_daily_metrics', {
      p_agent_email: agentEmail,
      p_start: toDateParam(startDate),
      p_end: toDateParam(endDate),
    }),
    sb
      .from('eavesly_calls')
      .select('call_id, agent_email, agent_full_name, talk_time, started_at')
      .eq('agent_email', agentEmail)
      .gte('started_at', startDate.toISOString())
      .lte('started_at', endDate.toISOString())
      .order('started_at', { ascending: false })
      .limit(sampleSize),
    fetchAgentAlertCounts([agentEmail], startDate, endDate),
  ])

  if (metricsRes.error) {
    console.error('Error calling agent_daily_metrics:', metricsRes.error)
    return null
  }
  const dailyRows = ((metricsRes.data || []) as any[]).map(normalizeDailyRow)
  const sampleCalls = ((sampleCallsRes.data || []) as any[])
  const agentFullName =
    dailyRows.find(r => r.agent_full_name)?.agent_full_name ??
    sampleCalls.find(c => c.agent_full_name)?.agent_full_name ??
    null

  const coachingCallIds = sampleCalls
    .slice(0, COACHING_SAMPLE_SIZE)
    .map(c => c.call_id)
    .filter(Boolean) as string[]
  const recentCallRows = sampleCalls.slice(0, RECENT_CALL_SIZE)
  const recentCallIds = recentCallRows.map(c => c.call_id).filter(Boolean) as string[]

  const [qaJsonRows, qaSummaryRows, fullCallRows] = await Promise.all([
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
    recentCallIds.length === 0
      ? Promise.resolve<any[]>([])
      : (async () => {
          const { data } = await sb
            .from('eavesly_transcription_qa')
            .select(QA_SUMMARY_COLUMNS)
            .in('call_id', recentCallIds)
          return (data || []) as any[]
        })(),
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

  let recentCallsFull: CallWithQA[] = []
  if (recentCallIds.length) {
    const fullCallById = new Map<string, any>(
      fullCallRows.map(c => [c.call_id, c]),
    )
    const qaByCallId = new Map<string, any>(
      qaSummaryRows.map(q => [q.call_id, q]),
    )
    recentCallsFull = recentCallRows.map(c => {
      const full = fullCallById.get(c.call_id) || c
      return {
        ...full,
        qa: qaByCallId.get(c.call_id) || null,
      } as CallWithQA
    })
  }

  const trend = trendPointsFromDailyRows(dailyRows, startDate, endDate)
  const rollup = rollupFromDailyRows(agentEmail, agentFullName, dailyRows, trend)

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

// ---- Per-manager rollups (god-mode breakout) ----

export type ManagerRollup = {
  manager_email: string
  manager_full_name: string | null
  agent_count: number
  agent_emails: string[]
  call_count: number
  compliance_pass_rate: number // 0-100
  csat_high_rate: number // 0-100
  escalation_rate: number // 0-100
  open_alerts_count: number
  unreviewed_alerts_count: number
  top_agent: AgentRollup | null
  needs_attention: boolean
}

// Look up display names for a set of manager emails by checking whether each
// manager also appears as an agent in eavesly_calls (most do — managers often
// take calls themselves). Returns a Map<email, full_name>.
export async function fetchManagerNames(
  emails: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (emails.length === 0) return result
  const CHUNK = 100
  for (let i = 0; i < emails.length; i += CHUNK) {
    const chunk = emails.slice(i, i + CHUNK)
    const { data, error } = await sb
      .from('eavesly_calls')
      .select('agent_email, agent_full_name')
      .in('agent_email', chunk)
      .not('agent_full_name', 'is', null)
      .limit(2000)
    if (error) {
      console.error('Error fetching manager names:', error)
      continue
    }
    for (const row of (data || []) as any[]) {
      if (!result.has(row.agent_email) && row.agent_full_name) {
        result.set(row.agent_email, row.agent_full_name)
      }
    }
  }
  return result
}

// Pull manager → agent mapping. Cheap (a few hundred rows). Returns the raw
// pairs so callers can group by either side.
export async function fetchAgentManagerMapping(): Promise<
  { manager_email: string; agent_email: string }[]
> {
  const { data, error } = await sb
    .from('agent_manager_mapping')
    .select('manager_email, agent_email')
  if (error) {
    console.error('Error fetching agent_manager_mapping:', error)
    return []
  }
  return ((data || []) as any[]).map(r => ({
    manager_email: r.manager_email,
    agent_email: r.agent_email,
  }))
}

// Group agent rollups by manager and recompute aggregates correctly
// (volume-weighted, not averaged across agents).
export function aggregateManagerRollups(
  rollups: AgentRollup[],
  mapping: { manager_email: string; agent_email: string }[],
  managerNames: Map<string, string> = new Map(),
): ManagerRollup[] {
  const managerByAgent = new Map<string, string>()
  for (const m of mapping) managerByAgent.set(m.agent_email, m.manager_email)

  // Pre-bucket agents per manager. Agents not in the mapping fall into
  // "Unassigned" so god-mode users still see them.
  const buckets = new Map<string, AgentRollup[]>()
  for (const r of rollups) {
    const mgr = managerByAgent.get(r.agent_email) || '__unassigned__'
    const arr = buckets.get(mgr) || []
    arr.push(r)
    buckets.set(mgr, arr)
  }

  const results: ManagerRollup[] = []
  for (const [manager_email, agents] of buckets) {
    const callCount = agents.reduce((s, a) => s + a.call_count, 0)
    if (callCount === 0 && manager_email === '__unassigned__') continue
    // Re-derive compliance from underlying counts via trend_points
    let compPass = 0
    let compTotal = 0
    let escalations = 0
    let csatHigh = 0
    let csatTotal = 0
    for (const a of agents) {
      for (const p of a.trend_points) {
        compPass += p.compliance_pass
        compTotal += p.compliance_total
        escalations += p.escalations
        csatHigh += p.csat_high
        csatTotal += p.csat_high + p.csat_medium + p.csat_low
      }
    }
    const compliance_pass_rate =
      compTotal > 0 ? Math.round((compPass / compTotal) * 100) : 0
    const csat_high_rate =
      csatTotal > 0 ? Math.round((csatHigh / csatTotal) * 100) : 0
    const escalation_rate =
      callCount > 0 ? Math.round((escalations / callCount) * 100) : 0
    const open_alerts_count = agents.reduce((s, a) => s + a.open_alerts_count, 0)
    const unreviewed_alerts_count = agents.reduce(
      (s, a) => s + a.unreviewed_alerts_count,
      0,
    )
    const topAgent = agents
      .filter(a => a.call_count > 0)
      .sort((x, y) => y.compliance_pass_rate - x.compliance_pass_rate)[0]
    const needs_attention =
      callCount > 0 &&
      (compliance_pass_rate < 80 ||
        escalation_rate >= 10 ||
        csat_high_rate < 50 ||
        unreviewed_alerts_count > 0)
    results.push({
      manager_email,
      manager_full_name: managerNames.get(manager_email) ?? null,
      agent_count: agents.length,
      agent_emails: agents.map(a => a.agent_email),
      call_count: callCount,
      compliance_pass_rate,
      csat_high_rate,
      escalation_rate,
      open_alerts_count,
      unreviewed_alerts_count,
      top_agent: topAgent || null,
      needs_attention,
    })
  }
  return results.sort((a, b) => b.call_count - a.call_count)
}

// Fetch coaching themes aggregated across the manager's team.
// Samples the most recent N calls per agent so high-volume agents don't
// dominate the theme ranking and so the qa_json fetch stays bounded.
export async function fetchTeamCoachingThemes(
  scope: UserScope,
  startDate: Date,
  endDate: Date,
  perAgentSample = 30,
): Promise<TeamCoachingThemes> {
  const empty: TeamCoachingThemes = {
    strengths: [],
    improvements: [],
    coachingPoints: [],
    trainingRecs: [],
  }
  if (!scope.isGodMode && scope.managedAgents.length === 0) return empty

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
          console.error('Error fetching godmode agents for themes:', error)
          return []
        }
        return Array.from(
          new Set(((data || []) as any[]).map(r => r.agent_email)),
        )
      })()
    : scope.managedAgents

  if (agentEmails.length === 0) return empty

  // Fetch per-agent most-recent call_ids in parallel.
  const callsPerAgent = await Promise.all(
    agentEmails.map(async email => {
      const { data, error } = await sb
        .from('eavesly_calls')
        .select('call_id')
        .eq('agent_email', email)
        .gte('started_at', startDate.toISOString())
        .lte('started_at', endDate.toISOString())
        .order('started_at', { ascending: false })
        .limit(perAgentSample)
      if (error) {
        console.error(`Error fetching recent calls for ${email}:`, error)
        return { email, callIds: [] as string[] }
      }
      const callIds = ((data || []) as any[])
        .map(c => c.call_id)
        .filter(Boolean) as string[]
      return { email, callIds }
    }),
  )

  const callIdToAgent = new Map<string, string>()
  const allCallIds: string[] = []
  for (const { email, callIds } of callsPerAgent) {
    for (const id of callIds) {
      callIdToAgent.set(id, email)
      allCallIds.push(id)
    }
  }

  if (allCallIds.length === 0) return empty

  // Batch fetch qa_json across the sampled call_ids.
  const qaJsonRows = await fetchInBatches<{ call_id: string; qa_json: QAJson | null }>(
    allCallIds,
    50,
    async batch => {
      const { data, error } = await sb
        .from('eavesly_transcription_qa')
        .select('call_id, qa_json')
        .in('call_id', batch)
      if (error) {
        console.error('Error fetching team qa_json batch:', error)
        return []
      }
      return (data || []) as any[]
    },
  )

  const byAgent = new Map<string, QAJson[]>()
  for (const r of qaJsonRows) {
    if (!r.qa_json) continue
    const email = callIdToAgent.get(r.call_id)
    if (!email) continue
    const arr = byAgent.get(email) || []
    arr.push(r.qa_json)
    byAgent.set(email, arr)
  }

  return aggregateTeamCoachingThemes(
    Array.from(byAgent.entries()).map(([agent_email, qaJson]) => ({
      agent_email,
      qaJson,
    })),
  )
}

// Aggregate per-agent trend points into a single team-level series.
// Sums raw counts per bucket across agents and re-derives compliance_pass_rate
// from pass/total counts (averaging per-agent rates would be biased by volume).
export function aggregateTeamTrend(rollups: AgentRollup[]): TrendPoint[] {
  const byBucket = new Map<string, TrendPoint>()
  for (const r of rollups) {
    for (const p of r.trend_points) {
      const existing = byBucket.get(p.bucket)
      if (!existing) {
        byBucket.set(p.bucket, { ...p })
      } else {
        existing.call_count += p.call_count
        existing.compliance_pass += p.compliance_pass
        existing.compliance_total += p.compliance_total
        existing.csat_high += p.csat_high
        existing.csat_medium += p.csat_medium
        existing.csat_low += p.csat_low
        existing.escalations += p.escalations
      }
    }
  }
  for (const point of byBucket.values()) {
    // Match trendPointsFromDailyRows: null when no compliance-graded calls
    // landed so the line chart renders a gap instead of a misleading 0%.
    point.compliance_pass_rate =
      point.compliance_total > 0
        ? Math.round((point.compliance_pass / point.compliance_total) * 100)
        : null
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    a.bucket.localeCompare(b.bucket),
  )
}
