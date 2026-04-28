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
import { fetchAllPaginated } from './supabase-helpers'
import {
  startOfBusinessDay,
  endOfBusinessDay,
  ymdInBusinessTZ,
} from './time-zone'

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
  // Bucket on Eastern time so trends stay aligned with the business day,
  // not the viewer's local timezone.
  const ymd = ymdInBusinessTZ(date) // "YYYY-MM-DD"
  if (size !== 'week') return ymd
  // Snap to the Monday of the ET week. Day-of-week for a calendar date is
  // timezone-independent, so we can use a local Date for the math.
  const [y, m, d] = ymd.split('-').map(Number)
  const cal = new Date(y, m - 1, d)
  const diff = (cal.getDay() + 6) % 7
  cal.setDate(cal.getDate() - diff)
  return `${cal.getFullYear()}-${String(cal.getMonth() + 1).padStart(2, '0')}-${String(cal.getDate()).padStart(2, '0')}`
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
  // Picker-state Dates carry the intended ET Y/M/D in their local components.
  // We iterate calendar days using getFullYear/Month/Date — which is timezone-
  // independent — so cursor keys match the ET keys produced by bucketKey for
  // each QA row's started_at.
  const cursor = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  )
  const stop = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  )
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  while (cursor <= stop) {
    let key = ymd(cursor)
    if (size === 'week') {
      const monday = new Date(cursor)
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
      key = ymd(monday)
    }
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

type QASummaryRow = {
  call_id: string
  agent_email: string | null
  overall_score: string | null
  compliance_rating: string | null
  customer_satisfaction_likely: string | null
  manager_escalation: boolean | null
  created_at: string
  // Joined in from eavesly_calls before bucketing — `created_at` reflects
  // when the QA row was inserted (often a batched backfill timestamp), not
  // when the call actually happened, so we bucket on the call's started_at.
  started_at?: string | null
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
    // Prefer the call's started_at (set by the caller) over the QA row's
    // created_at — the latter is a DB insert timestamp and skews to whenever
    // the QA pipeline ran, not when the call took place.
    const ts = qa.started_at || qa.created_at
    const key = bucketKey(new Date(ts), size)
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
    point.compliance_pass = pc?.pass ?? 0
    point.compliance_total = pc?.total ?? 0
    point.compliance_pass_rate =
      pc && pc.total > 0 ? Math.round((pc.pass / pc.total) * 100) : null
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
        // Paginate so we capture every active agent in the window, not just
        // those appearing in the most recent 1000 rows.
        const rows = await fetchAllPaginated<{ agent_email: string }>(
          (from, to) =>
            sb
              .from('eavesly_calls')
              .select('agent_email')
              .gte('started_at', startOfBusinessDay(startDate).toISOString())
              .lte('started_at', endOfBusinessDay(endDate).toISOString())
              .not('agent_email', 'is', null)
              .order('started_at', { ascending: false })
              .range(from, to),
        )
        return Array.from(new Set(rows.map(r => r.agent_email)))
      })()
    : scope.managedAgents

  if (agentEmails.length === 0) return []

  // 2. Fire calls + alerts in parallel — alerts only depends on agentEmails.
  // Calls fetch paginates because Supabase caps each response at 1000 rows;
  // a multi-day window across many agents easily exceeds that.
  const [calls, alertRows] = await Promise.all([
    fetchInBatches(agentEmails, 100, async batch =>
      fetchAllPaginated<any>((from, to) =>
        sb
          .from('eavesly_calls')
          .select('call_id, agent_email, agent_full_name, talk_time, started_at')
          .in('agent_email', batch)
          .gte('started_at', startOfBusinessDay(startDate).toISOString())
          .lte('started_at', endOfBusinessDay(endDate).toISOString())
          .order('started_at', { ascending: false })
          .range(from, to),
      ),
    ),
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

  // Enrich QA rows with the call's started_at so trend bucketing keys off
  // the actual call time rather than the QA pipeline insert timestamp.
  const startedAtByCallId = new Map<string, string>()
  for (const c of calls) {
    if (c.call_id && c.started_at) startedAtByCallId.set(c.call_id, c.started_at)
  }
  for (const q of qaRows) {
    q.started_at = startedAtByCallId.get(q.call_id) ?? null
  }

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
  return fetchInBatches<AlertWithFeedback>(agentEmails, 100, async batch =>
    fetchAllPaginated<AlertWithFeedback>((from, to) =>
      sb
        .from('eavesly_alerts_with_feedback')
        .select(ALERT_COUNT_COLUMNS)
        .in('agent_email', batch)
        .gte('alert_created_at', startOfBusinessDay(startDate).toISOString())
        .lte('alert_created_at', endOfBusinessDay(endDate).toISOString())
        .order('alert_created_at', { ascending: false })
        .range(from, to),
    ),
  )
}

export async function fetchAgentProfile(
  agentEmail: string,
  startDate: Date,
  endDate: Date,
): Promise<AgentProfile | null> {
  // Calls in window — paginated to bypass Supabase's 1000-row response cap.
  const calls = await fetchAllPaginated<any>((from, to) =>
    sb
      .from('eavesly_calls')
      .select('call_id, agent_email, agent_full_name, talk_time, started_at')
      .eq('agent_email', agentEmail)
      .gte('started_at', startOfBusinessDay(startDate).toISOString())
      .lte('started_at', endOfBusinessDay(endDate).toISOString())
      .order('started_at', { ascending: false })
      .range(from, to),
  )
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

  // Enrich QA rows with the call's started_at so trend bucketing keys off
  // call time, not the QA pipeline insert timestamp.
  const startedAtByCallId = new Map<string, string>()
  for (const c of calls) {
    if (c.call_id && c.started_at) startedAtByCallId.set(c.call_id, c.started_at)
  }
  for (const q of qaRows) {
    q.started_at = startedAtByCallId.get(q.call_id) ?? null
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
          .gte('started_at', startOfBusinessDay(startDate).toISOString())
          .lte('started_at', endOfBusinessDay(endDate).toISOString())
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
        .gte('started_at', startOfBusinessDay(startDate).toISOString())
        .lte('started_at', endOfBusinessDay(endDate).toISOString())
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
    point.compliance_pass_rate =
      point.compliance_total > 0
        ? Math.round((point.compliance_pass / point.compliance_total) * 100)
        : null
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    a.bucket.localeCompare(b.bucket),
  )
}
