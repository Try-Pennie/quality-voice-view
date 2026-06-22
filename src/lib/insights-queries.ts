// Data + pure helpers for the Management Insights weekly report.
//
// Privacy: this report is aggregate-only. It is built entirely from
// fetchTeamRollup (per-agent rollups + trend buckets from the daily-metrics
// MV) and fetchAlertBreakdown (module/agent violation counts). Neither
// surfaces transcripts, customer names/phones, recordings, or verbatim
// evidence. Agent/manager emails are used only as internal coaching IDs.
//
// All windows are Mon–Sun business weeks in ET. Window helpers return
// picker-state Dates whose LOCAL Y/M/D match the intended ET date, matching
// the convention in time-zone.ts / url-filters.ts — the fetch layer
// (toDateParam, startOfBusinessDay) converts to absolute moments.

import type { UserScope } from './alert-queries'
import { fetchAlertBreakdown, MODULE_LABELS, type AlertBreakdownCell } from './alert-queries'
import { fetchTeamRollup, type AgentRollup } from './team-queries'
import { ymdInBusinessTZ } from './time-zone'

// ---------- Windows ----------

export type InsightsWindow = {
  start: Date // local midnight, Y/M/D = Monday in ET
  end: Date // local end-of-day, Y/M/D = Sunday in ET
  label: string // e.g. "Jun 9 – 15, 2026"
}

function localMidnight(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Days since Monday (Mon=0 … Sun=6) for a local Date.
function daysSinceMonday(d: Date): number {
  return (d.getDay() + 6) % 7
}

function weekLabel(start: Date, end: Date): string {
  const m = (d: Date) => d.toLocaleString('en-US', { month: 'short' })
  const sameMonth = start.getMonth() === end.getMonth()
  const left = `${m(start)} ${start.getDate()}`
  const right = sameMonth ? `${end.getDate()}` : `${m(end)} ${end.getDate()}`
  return `${left} – ${right}, ${end.getFullYear()}`
}

function windowFromMonday(monday: Date): InsightsWindow {
  const start = localMidnight(monday)
  const sunday = addDays(start, 6)
  const end = new Date(sunday)
  end.setHours(23, 59, 59, 999)
  return { start, end, label: weekLabel(start, end) }
}

// "Today" as a local Date carrying the ET calendar date.
function todayInET(now: Date): Date {
  const [y, m, d] = ymdInBusinessTZ(now).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// The most recent fully-completed Mon–Sun week (i.e. last week, not the
// in-progress one). Default report window.
export function previousCompleteWeek(now: Date = new Date()): InsightsWindow {
  const today = todayInET(now)
  const thisMonday = addDays(today, -daysSinceMonday(today))
  return windowFromMonday(addDays(thisMonday, -7))
}

// The week immediately before the given week (for WoW).
export function priorWeekOf(week: InsightsWindow): InsightsWindow {
  return windowFromMonday(addDays(localMidnight(week.start), -7))
}

// Trailing N complete weeks ending the day before `week` starts (for the
// MoM-ish / trailing-month baseline). Defaults to 4 weeks.
export function baselineFor(week: InsightsWindow, weeks = 4): InsightsWindow {
  const start = localMidnight(addDays(week.start, -7 * weeks))
  const end = new Date(addDays(week.start, -1))
  end.setHours(23, 59, 59, 999)
  return { start, end, label: `${weeks}-week trailing` }
}

// Parse a ?week=YYYY-MM-DD param. Snaps to the Monday of that week so the
// URL is robust to any day passed in. Returns null on bad input.
export function weekFromParam(raw: string | null): InsightsWindow | null {
  if (!raw) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  if (isNaN(d.getTime())) return null
  return windowFromMonday(addDays(localMidnight(d), -daysSinceMonday(d)))
}

// YYYY-MM-DD of a window's Monday, for the ?week= URL param.
export function mondayParam(week: InsightsWindow): string {
  const d = localMidnight(week.start)
  const y = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

// ---------- Aggregation ----------

export type TeamAggregate = {
  agentCount: number // agents with > 0 calls
  callCount: number
  qaCount: number
  // null when no graded calls landed — avoids a misleading 0%.
  compliancePassRate: number | null
  csatHighRate: number | null
  escalationRate: number | null
  weeks: number // window length in weeks, for per-week normalization
}

// Volume-weighted team rates derived from the underlying pass/total counts
// (averaging per-agent rates would bias toward low-volume agents). Mirrors
// aggregateManagerRollups in team-queries.ts.
export function teamAggregate(rollups: AgentRollup[], weeks = 1): TeamAggregate {
  let compPass = 0
  let compTotal = 0
  let csatHigh = 0
  let csatTotal = 0
  let escalations = 0
  for (const r of rollups) {
    for (const p of r.trend_points) {
      compPass += p.compliance_pass
      compTotal += p.compliance_total
      csatHigh += p.csat_high
      csatTotal += p.csat_high + p.csat_medium + p.csat_low
      escalations += p.escalations
    }
  }
  const callCount = rollups.reduce((s, r) => s + r.call_count, 0)
  const qaCount = rollups.reduce((s, r) => s + r.qa_count, 0)
  return {
    agentCount: rollups.filter(r => r.call_count > 0).length,
    callCount,
    qaCount,
    compliancePassRate:
      compTotal > 0 ? Math.round((compPass / compTotal) * 100) : null,
    csatHighRate: csatTotal > 0 ? Math.round((csatHigh / csatTotal) * 100) : null,
    escalationRate: qaCount > 0 ? Math.round((escalations / qaCount) * 100) : null,
    weeks: Math.max(1, weeks),
  }
}

// ---------- Deltas ----------

export type Delta = {
  abs: number | null // current − prior (percentage points for rates)
  pct: number | null // relative % change, null when prior is 0/null
  dir: 'up' | 'down' | 'flat'
}

export function delta(
  current: number | null,
  prior: number | null,
  epsilon = 0.5,
): Delta {
  if (current == null || prior == null) return { abs: null, pct: null, dir: 'flat' }
  const abs = current - prior
  const pct = prior !== 0 ? (abs / prior) * 100 : null
  const dir = Math.abs(abs) < epsilon ? 'flat' : abs > 0 ? 'up' : 'down'
  return { abs, pct, dir }
}

// ---------- Watchlist + top agents ----------

export type WatchlistEntry = {
  agent_email: string
  agent_full_name: string | null
  call_count: number
  qa_count: number
  compliance_pass_rate: number
  compliance_delta_pts: number | null // WoW change, null if no prior data
  escalation_rate: number
  csat_high_rate: number
  unreviewed_alerts: number
  reasons: string[]
}

export type TopAgent = {
  agent_email: string
  agent_full_name: string | null
  call_count: number
  qa_count: number
  compliance_pass_rate: number
  csat_high_rate: number
}

// Minimum graded calls before an agent's QA-derived rates are stable enough to
// coach or rank on. Below this we don't flag or celebrate — too noisy.
const MIN_GRADED_CALLS_FOR_SIGNAL = 5

function unreviewedByAgent(cells: AlertBreakdownCell[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cells) {
    m.set(c.agent_email, (m.get(c.agent_email) ?? 0) + c.unreviewed)
  }
  return m
}

export function buildWatchlist(
  current: AgentRollup[],
  prior: AgentRollup[],
  alertCells: AlertBreakdownCell[],
  limit = 8,
): WatchlistEntry[] {
  const priorComplianceByAgent = new Map<string, number>()
  for (const r of prior) {
    if (r.call_count > 0) priorComplianceByAgent.set(r.agent_email, r.compliance_pass_rate)
  }
  const unreviewed = unreviewedByAgent(alertCells)

  const entries: WatchlistEntry[] = []
  for (const r of current) {
    if (r.qa_count < MIN_GRADED_CALLS_FOR_SIGNAL) continue
    const open = unreviewed.get(r.agent_email) ?? 0
    const priorCompliance = priorComplianceByAgent.get(r.agent_email)
    const complianceDelta =
      priorCompliance == null ? null : r.compliance_pass_rate - priorCompliance

    const reasons: string[] = []
    if (r.compliance_pass_rate < 80) reasons.push('Compliance below 80%')
    if (r.escalation_rate >= 10) reasons.push('Escalation rate ≥ 10%')
    if (r.csat_high_rate < 50) reasons.push('CSAT-high below 50%')
    if (complianceDelta != null && complianceDelta <= -10)
      reasons.push(`Compliance down ${Math.abs(complianceDelta)} pts WoW`)
    if (open > 0) reasons.push(`${open} unreviewed alert${open === 1 ? '' : 's'}`)

    if (reasons.length === 0) continue
    entries.push({
      agent_email: r.agent_email,
      agent_full_name: r.agent_full_name,
      call_count: r.call_count,
      qa_count: r.qa_count,
      compliance_pass_rate: r.compliance_pass_rate,
      compliance_delta_pts: complianceDelta,
      escalation_rate: r.escalation_rate,
      csat_high_rate: r.csat_high_rate,
      unreviewed_alerts: open,
      reasons,
    })
  }
  // Most reasons first, then lowest compliance — surfaces the agents who need
  // a manager's time most this week.
  entries.sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      a.compliance_pass_rate - b.compliance_pass_rate,
  )
  return entries.slice(0, limit)
}

export function buildTopAgents(current: AgentRollup[], limit = 5): TopAgent[] {
  return current
    .filter(r => r.qa_count >= MIN_GRADED_CALLS_FOR_SIGNAL)
    .sort(
      (a, b) =>
        b.compliance_pass_rate - a.compliance_pass_rate ||
        b.csat_high_rate - a.csat_high_rate ||
        b.call_count - a.call_count,
    )
    .slice(0, limit)
    .map(r => ({
      agent_email: r.agent_email,
      agent_full_name: r.agent_full_name,
      call_count: r.call_count,
      qa_count: r.qa_count,
      compliance_pass_rate: r.compliance_pass_rate,
      csat_high_rate: r.csat_high_rate,
    }))
}

// ---------- Alert / module pressure ----------

export type ModulePressure = {
  module: string
  label: string
  total: number
  unreviewed: number
  false_positives: number
  baselineWeeklyAvg: number // avg violations/week over the baseline window
  rising: boolean // current week > 1.5× baseline weekly avg
}

function pressureFromCells(cells: AlertBreakdownCell[]): Map<string, { total: number; unreviewed: number; fp: number }> {
  const m = new Map<string, { total: number; unreviewed: number; fp: number }>()
  for (const c of cells) {
    const cur = m.get(c.module) ?? { total: 0, unreviewed: 0, fp: 0 }
    cur.total += c.total
    cur.unreviewed += c.unreviewed
    cur.fp += c.false_positives
    m.set(c.module, cur)
  }
  return m
}

export function buildModulePressure(
  currentCells: AlertBreakdownCell[],
  baselineCells: AlertBreakdownCell[],
  baselineWeeks: number,
): ModulePressure[] {
  const current = pressureFromCells(currentCells)
  const baseline = pressureFromCells(baselineCells)
  const weeks = Math.max(1, baselineWeeks)
  const out: ModulePressure[] = []
  for (const [module, c] of current) {
    const baseTotal = baseline.get(module)?.total ?? 0
    const baselineWeeklyAvg = Math.round((baseTotal / weeks) * 10) / 10
    out.push({
      module,
      label: MODULE_LABELS[module] ?? module,
      total: c.total,
      unreviewed: c.unreviewed,
      false_positives: c.fp,
      baselineWeeklyAvg,
      rising: c.total > baselineWeeklyAvg * 1.5 && c.total >= 3,
    })
  }
  return out.sort((a, b) => b.total - a.total || b.unreviewed - a.unreviewed)
}

// ---------- Action insights ----------

export type Insight = {
  tone: 'positive' | 'warning' | 'neutral'
  title: string
  detail: string
}

function pts(d: Delta): string {
  if (d.abs == null) return '—'
  const v = Math.round(d.abs)
  return `${v > 0 ? '+' : ''}${v} pts`
}

// Deterministic insight cards from the assembled metrics. Directional copy
// only — AI signals are not validated truth, so nothing here asserts a cause.
export function buildInsights(
  current: TeamAggregate,
  prior: TeamAggregate,
  baseline: TeamAggregate,
  watchlist: WatchlistEntry[],
  modulePressure: ModulePressure[],
): Insight[] {
  const out: Insight[] = []

  const compWoW = delta(current.compliancePassRate, prior.compliancePassRate)
  const compMoM = delta(current.compliancePassRate, baseline.compliancePassRate)
  if (compWoW.dir === 'down' && (compWoW.abs ?? 0) <= -3) {
    out.push({
      tone: 'warning',
      title: `Compliance dipped ${pts(compWoW)} week over week`,
      detail: `Now ${current.compliancePassRate}% vs ${prior.compliancePassRate}% last week (${pts(compMoM)} vs the trailing-month rate). Worth a floor-wide refresher on the slipping checks.`,
    })
  } else if (compWoW.dir === 'up' && (compWoW.abs ?? 0) >= 3) {
    out.push({
      tone: 'positive',
      title: `Compliance up ${pts(compWoW)} week over week`,
      detail: `Now ${current.compliancePassRate}% vs ${prior.compliancePassRate}% last week. Reinforce whatever changed.`,
    })
  }

  const escWoW = delta(current.escalationRate, prior.escalationRate)
  if (escWoW.dir === 'up' && (escWoW.abs ?? 0) >= 3) {
    out.push({
      tone: 'warning',
      title: `Escalation rate climbing (${pts(escWoW)} WoW)`,
      detail: `${current.escalationRate}% of graded calls flagged for manager review, up from ${prior.escalationRate}%. Check whether a specific scenario is driving it.`,
    })
  }

  const csatWoW = delta(current.csatHighRate, prior.csatHighRate)
  if (csatWoW.dir === 'down' && (csatWoW.abs ?? 0) <= -3) {
    out.push({
      tone: 'warning',
      title: `Customer sentiment softening (${pts(csatWoW)} WoW)`,
      detail: `High-CSAT share at ${current.csatHighRate}% vs ${prior.csatHighRate}% last week.`,
    })
  }

  if (watchlist.length > 0) {
    out.push({
      tone: 'warning',
      title: `${watchlist.length} agent${watchlist.length === 1 ? '' : 's'} on the coaching watchlist`,
      detail: `Flagged on at least one of: low compliance, high escalation, soft CSAT, a sharp WoW drop, or unreviewed alerts. See the watchlist below for the specifics per agent.`,
    })
  }

  const rising = modulePressure.filter(m => m.rising)
  if (rising.length > 0) {
    const top = rising[0]
    out.push({
      tone: 'warning',
      title: `${top.label} alerts rising`,
      detail: `${top.total} this week vs a ${top.baselineWeeklyAvg}/week trailing average. AI alerts are directional — confirm in the alert queue before coaching.`,
    })
  }

  const volWoW = delta(current.callCount, prior.callCount, 1)
  if (volWoW.pct != null && Math.abs(volWoW.pct) >= 20) {
    out.push({
      tone: 'neutral',
      title: `Call volume ${volWoW.dir === 'up' ? 'up' : 'down'} ${Math.abs(Math.round(volWoW.pct))}% WoW`,
      detail: `${current.callCount} calls this week vs ${prior.callCount} last week. Read the rate metrics with the volume change in mind.`,
    })
  }

  if (out.length === 0) {
    out.push({
      tone: 'positive',
      title: 'Metrics steady week over week',
      detail: 'No compliance, escalation, CSAT, or alert metric moved materially. Keep reinforcing current habits.',
    })
  }
  return out
}

// ---------- Report assembly ----------

export type InsightsReport = {
  current: InsightsWindow
  prior: InsightsWindow
  baseline: InsightsWindow
  team: {
    current: TeamAggregate
    prior: TeamAggregate
    baseline: TeamAggregate
  }
  unreviewedAlerts: number
  totalAlerts: number
  watchlist: WatchlistEntry[]
  topAgents: TopAgent[]
  modulePressure: ModulePressure[]
  insights: Insight[]
}

export function assembleReport(input: {
  current: InsightsWindow
  prior: InsightsWindow
  baseline: InsightsWindow
  currentRollups: AgentRollup[]
  priorRollups: AgentRollup[]
  baselineRollups: AgentRollup[]
  currentAlerts: AlertBreakdownCell[]
  baselineAlerts: AlertBreakdownCell[]
}): InsightsReport {
  const baselineWeeks = Math.max(
    1,
    Math.round(
      (input.baseline.end.getTime() - input.baseline.start.getTime()) /
        (1000 * 60 * 60 * 24 * 7),
    ),
  )
  const teamCurrent = teamAggregate(input.currentRollups, 1)
  const teamPrior = teamAggregate(input.priorRollups, 1)
  const teamBaseline = teamAggregate(input.baselineRollups, baselineWeeks)

  const watchlist = buildWatchlist(
    input.currentRollups,
    input.priorRollups,
    input.currentAlerts,
  )
  const modulePressure = buildModulePressure(
    input.currentAlerts,
    input.baselineAlerts,
    baselineWeeks,
  )

  return {
    current: input.current,
    prior: input.prior,
    baseline: input.baseline,
    team: { current: teamCurrent, prior: teamPrior, baseline: teamBaseline },
    unreviewedAlerts: input.currentAlerts.reduce((s, c) => s + c.unreviewed, 0),
    totalAlerts: input.currentAlerts.reduce((s, c) => s + c.total, 0),
    watchlist,
    topAgents: buildTopAgents(input.currentRollups),
    modulePressure,
    insights: buildInsights(
      teamCurrent,
      teamPrior,
      teamBaseline,
      watchlist,
      modulePressure,
    ),
  }
}

// Orchestrates the four aggregate-safe reads in parallel and assembles the
// report. Errors propagate so the page fails visibly rather than rendering a
// false-clear report.
export async function fetchInsightsReport(
  scope: UserScope,
  current: InsightsWindow,
  prior: InsightsWindow,
  baseline: InsightsWindow,
): Promise<InsightsReport> {
  const [currentRollups, priorRollups, baselineRollups, currentAlerts, baselineAlerts] =
    await Promise.all([
      fetchTeamRollup(scope, current.start, current.end),
      fetchTeamRollup(scope, prior.start, prior.end),
      fetchTeamRollup(scope, baseline.start, baseline.end),
      fetchAlertBreakdown(scope, current.start, current.end, { excludeInaccurate: true }),
      fetchAlertBreakdown(scope, baseline.start, baseline.end, { excludeInaccurate: true }),
    ])
  return assembleReport({
    current,
    prior,
    baseline,
    currentRollups,
    priorRollups,
    baselineRollups,
    currentAlerts,
    baselineAlerts,
  })
}
