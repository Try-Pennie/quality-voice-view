export const ACHIEVE_REPORT_WEEKS = [2, 4, 6] as const
export type AchieveReportWeeks = typeof ACHIEVE_REPORT_WEEKS[number]

const BUSINESS_TIME_ZONE = 'America/New_York'
const FORM_PRIOR_SAMPLE = 5
const MAX_REPRESENTATIVES = 500

type BoundaryRecord = Readonly<Record<string, unknown>>

/** One completed Monday-Sunday reporting window in Eastern Time. */
export type AchieveReportRange = {
  readonly weeks: AchieveReportWeeks
  readonly startAt: string
  readonly endAt: string
}

/** Result returned by an Achieve report RPC. */
export type AchieveDashboardLoadResult = {
  readonly data: unknown
  readonly error: unknown
}

export type AchieveOutcomePeriodKey = 'all_time' | 'mature_4_weeks' | 'mature_6_weeks'

/** One mature first-pay screening result compared with the same weeks' roster. */
export type AchieveFirstPayOutcomeAgent = {
  readonly agentName: string
  readonly agentEmail: string
  readonly n: number
  readonly failures: number
  readonly failureRate: number
  readonly expectedFailures: number | null
  readonly expectedSuccesses: number | null
  readonly expectedRate: number | null
  readonly deltaPp: number | null
  readonly z: number | null
  readonly rescinded: number
  readonly neverPaid: number
  readonly sampleQualified: boolean
  readonly rank: number | null
}

export type AchieveFirstPayOutcomePeriod = {
  readonly key: AchieveOutcomePeriodKey
  readonly startDate: string | null
  readonly endDate: string
  readonly agents: ReadonlyArray<AchieveFirstPayOutcomeAgent>
}

/** Fresh mature outcome snapshot shared unchanged by the portal and email. */
export type AchieveFirstPayOutcomes = {
  readonly sourceAsOf: string
  readonly refreshedAt: string
  readonly maturityCutoff: string
  readonly periods: ReadonlyArray<AchieveFirstPayOutcomePeriod>
}

/** Exactly attributed representative metrics and Form-led risk rank for one period. */
export type AchieveManagementRepresentative = {
  readonly agentName: string
  readonly agentEmail: string
  readonly totalSubmissions: number
  readonly good: number
  readonly fair: number
  readonly poor: number
  readonly other: number
  readonly fairPoorRate: number
  readonly adjustedFormRisk: number | null
  readonly riskRank: number | null
  readonly accent: number
  readonly backgroundNoise: number
  readonly connectionIssues: number
  readonly latestSubmittedAt: string | null
  readonly aiTotal: number
  readonly aiPass: number
  readonly aiFlagged: number
  readonly latestAiGradedAt: string | null
  readonly overlapCalls: number
  readonly bothClear: number
  readonly bothConcern: number
  readonly humanOnly: number
  readonly aiOnly: number
}

/** One period's existing dashboard plus management ranking metadata. */
export type AchieveManagementPeriod = AchieveReportRange & {
  readonly dashboard: BoundaryRecord
  readonly representatives: ReadonlyArray<AchieveManagementRepresentative>
}

/** Canonical payload shared by the /achieve view and weekly email. */
export type AchieveManagementReport = {
  readonly generatedAt: string
  readonly completedThrough: string
  readonly periods: ReadonlyArray<AchieveManagementPeriod>
  readonly persistentAgentEmails: ReadonlyArray<string>
  readonly outcomes: AchieveFirstPayOutcomes
}

/** Expected report-loading failures safe to expose as protocol error codes. */
export type AchieveManagementReportFailure =
  | 'dashboard_query_failed'
  | 'invalid_dashboard_response'
  | 'outcomes_query_failed'
  | 'invalid_outcomes_response'

/** Typed result for loading the canonical management report. */
export type AchieveManagementReportResult =
  | { readonly ok: true; readonly report: AchieveManagementReport }
  | { readonly ok: false; readonly reason: AchieveManagementReportFailure }

function record(value: unknown): BoundaryRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: The runtime checks establish the indexable record invariant; each
  // consumed field is refined separately below.
  return value as BoundaryRecord
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function metric(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null
}

function optionalMetric(value: unknown, minimum = 0): number | null | undefined {
  if (value === null) return null
  const parsed = metric(value, minimum)
  return parsed === null ? undefined : parsed
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
}

function datePartsInEastern(date: Date): { year: number; month: number; day: number; hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    weekday: value('weekday'),
  }
}

function easternOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? '0')
  const wallClockUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return Math.round((wallClockUtc - date.getTime()) / 60_000)
}

function easternMidnight(year: number, month: number, day: number): Date {
  const utcGuess = Date.UTC(year, month - 1, day)
  const firstPass = utcGuess - easternOffsetMinutes(new Date(utcGuess)) * 60_000
  return new Date(utcGuess - easternOffsetMinutes(new Date(firstPass)) * 60_000)
}

/** Return the 2/4/6 completed-week windows sharing one Monday 00:00 ET end. */
export function completedAchieveReportRanges(now: Date): ReadonlyArray<AchieveReportRange> {
  const eastern = datePartsInEastern(now)
  const calendar = new Date(Date.UTC(eastern.year, eastern.month - 1, eastern.day))
  const daysSinceMonday = (calendar.getUTCDay() + 6) % 7
  calendar.setUTCDate(calendar.getUTCDate() - daysSinceMonday)
  const endAt = easternMidnight(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate())

  return ACHIEVE_REPORT_WEEKS.map(weeks => {
    const startCalendar = new Date(calendar)
    startCalendar.setUTCDate(startCalendar.getUTCDate() - weeks * 7)
    return {
      weeks,
      startAt: easternMidnight(
        startCalendar.getUTCFullYear(),
        startCalendar.getUTCMonth() + 1,
        startCalendar.getUTCDate(),
      ).toISOString(),
      endAt: endAt.toISOString(),
    }
  })
}

/** True only during the scheduled Monday 9 AM Eastern delivery hour. */
export function isAchieveReportDeliveryHour(now: Date): boolean {
  const eastern = datePartsInEastern(now)
  return eastern.weekday === 'Mon' && eastern.hour === 9
}

function parseRepresentative(value: unknown): Omit<AchieveManagementRepresentative, 'adjustedFormRisk' | 'riskRank'> | null {
  const row = record(value)
  if (!row || typeof row.achieve_agent_name !== 'string' || typeof row.achieve_agent_email !== 'string') return null
  const totalSubmissions = count(row.total_submissions)
  const good = count(row.good)
  const fair = count(row.fair)
  const poor = count(row.poor)
  const other = count(row.other)
  const accent = count(row.accent)
  const backgroundNoise = count(row.background_noise)
  const connectionIssues = count(row.connection_issues)
  const latestSubmittedAt = optionalTimestamp(row.latest_submitted_at)
  const aiTotal = count(row.ai_total)
  const aiPass = count(row.ai_pass)
  const aiFlagged = count(row.ai_flagged)
  const latestAiGradedAt = optionalTimestamp(row.latest_ai_graded_at)
  const overlapCalls = count(row.overlap_calls)
  const bothClear = count(row.both_clear)
  const bothConcern = count(row.both_concern)
  const humanOnly = count(row.human_only)
  const aiOnly = count(row.ai_only)
  if (
    totalSubmissions === null || good === null || fair === null || poor === null || other === null
    || accent === null || backgroundNoise === null || connectionIssues === null || latestSubmittedAt === undefined
    || aiTotal === null || aiPass === null || aiFlagged === null || latestAiGradedAt === undefined
    || overlapCalls === null || bothClear === null || bothConcern === null || humanOnly === null || aiOnly === null
    || good + fair + poor + other !== totalSubmissions
    || aiPass + aiFlagged !== aiTotal
    || bothClear + bothConcern + humanOnly + aiOnly !== overlapCalls
    || [accent, backgroundNoise, connectionIssues].some(value => value > totalSubmissions)
    || overlapCalls > totalSubmissions || overlapCalls > aiTotal
    || (totalSubmissions === 0) !== (latestSubmittedAt === null)
    || (aiTotal === 0) !== (latestAiGradedAt === null)
  ) return null
  const agentEmail = row.achieve_agent_email.trim().toLowerCase()
  if (!agentEmail || !agentEmail.includes('@')) return null
  return {
    agentName: row.achieve_agent_name.trim() || agentEmail,
    agentEmail,
    totalSubmissions,
    good,
    fair,
    poor,
    other,
    fairPoorRate: totalSubmissions === 0 ? 0 : ((fair + poor) / totalSubmissions) * 100,
    accent,
    backgroundNoise,
    connectionIssues,
    latestSubmittedAt,
    aiTotal,
    aiPass,
    aiFlagged,
    latestAiGradedAt,
    overlapCalls,
    bothClear,
    bothConcern,
    humanOnly,
    aiOnly,
  }
}

function parseOutcomeAgent(value: unknown): AchieveFirstPayOutcomeAgent | null {
  const row = record(value)
  if (!row || typeof row.agent_name !== 'string' || typeof row.agent_email !== 'string') return null
  const n = count(row.n)
  const failures = count(row.failures)
  const failureRate = metric(row.failure_rate)
  const expectedFailures = optionalMetric(row.expected_failures)
  const expectedSuccesses = optionalMetric(row.expected_successes)
  const expectedRate = optionalMetric(row.expected_rate)
  const deltaPp = optionalMetric(row.delta_pp, Number.NEGATIVE_INFINITY)
  const z = optionalMetric(row.z, Number.NEGATIVE_INFINITY)
  const rescinded = count(row.rescinded)
  const neverPaid = count(row.never_paid)
  const rank = row.rank === null ? null : count(row.rank)
  const agentEmail = row.agent_email.trim().toLowerCase()
  if (
    n === null || n === 0 || failures === null || failureRate === null
    || expectedFailures === undefined || expectedSuccesses === undefined || expectedRate === undefined
    || deltaPp === undefined || z === undefined || rescinded === null || neverPaid === null
    || typeof row.sample_qualified !== 'boolean'
    || (rank !== null && rank < 1)
    || !agentEmail || !agentEmail.includes('@')
    || failures !== rescinded + neverPaid || failures > n
    || Math.abs(failureRate - failures * 100 / n) > 0.001
    || (!row.sample_qualified && rank !== null)
  ) return null
  const expectedValues = [expectedFailures, expectedSuccesses, expectedRate, deltaPp]
  if (
    expectedValues.some(item => item === null) && expectedValues.some(item => item !== null)
    || (z !== null && expectedRate === null)
    || failureRate > 100 || (expectedRate !== null && expectedRate > 100)
    || row.sample_qualified !== (expectedFailures !== null && expectedSuccesses !== null && expectedFailures >= 5 && expectedSuccesses >= 5)
  ) return null
  return {
    agentName: row.agent_name.trim() || agentEmail,
    agentEmail,
    n,
    failures,
    failureRate,
    expectedFailures,
    expectedSuccesses,
    expectedRate,
    deltaPp,
    z,
    rescinded,
    neverPaid,
    sampleQualified: row.sample_qualified,
    rank,
  }
}

function parseFirstPayOutcomes(value: unknown): AchieveFirstPayOutcomes | null {
  const payload = record(value)
  const sourceAsOf = isoDate(payload?.source_as_of)
  const maturityCutoff = isoDate(payload?.maturity_cutoff)
  const refreshedAt = optionalTimestamp(payload?.refreshed_at)
  if (!payload || sourceAsOf === null || maturityCutoff === null || refreshedAt === undefined || refreshedAt === null || !Array.isArray(payload.periods)) return null
  const periods = payload.periods.map(raw => {
    const period = record(raw)
    const startDate = period?.start_date === null ? null : isoDate(period?.start_date)
    const endDate = isoDate(period?.end_date)
    if (
      !period || !Array.isArray(period.agents) || endDate === null
      || (period.key !== 'all_time' && period.key !== 'mature_4_weeks' && period.key !== 'mature_6_weeks')
      || (period.key === 'all_time' ? startDate !== null : startDate === null)
    ) return null
    const agents = period.agents.map(parseOutcomeAgent)
    if (agents.some(agent => agent === null)) return null
    const validAgents = agents.flatMap(agent => agent === null ? [] : [agent])
    const ranks = validAgents.flatMap(agent => agent.rank === null ? [] : [agent.rank]).sort((left, right) => left - right)
    if (new Set(validAgents.map(agent => agent.agentEmail)).size !== validAgents.length || ranks.some((rank, index) => rank !== index + 1)) return null
    return { key: period.key, startDate, endDate, agents: validAgents }
  })
  if (periods.some(period => period === null)) return null
  const validPeriods = periods.flatMap(period => period === null ? [] : [period])
  const expectedKeys: ReadonlyArray<AchieveOutcomePeriodKey> = ['all_time', 'mature_4_weeks', 'mature_6_weeks']
  if (
    validPeriods.length !== 3
    || expectedKeys.some(key => !validPeriods.some(period => period.key === key))
    || maturityCutoff !== addUtcDays(sourceAsOf, -10)
    || validPeriods.some(period => (
      period.endDate !== maturityCutoff
      || period.startDate !== (period.key === 'all_time' ? null : addUtcDays(maturityCutoff, period.key === 'mature_4_weeks' ? -27 : -41))
    ))
  ) return null
  return { sourceAsOf, refreshedAt, maturityCutoff, periods: expectedKeys.map(key => validPeriods.find(period => period.key === key)).flatMap(period => period ? [period] : []) }
}

function scoreDashboard(
  range: AchieveReportRange,
  dashboardValue: unknown,
): AchieveManagementPeriod | null {
  const dashboard = record(dashboardValue)
  const representativePayload = record(dashboard?.representatives)
  const coverage = record(representativePayload?.coverage)
  if (!dashboard || !representativePayload || !Array.isArray(representativePayload.rows)) return null
  const loaded = count(coverage?.loaded)
  if (
    coverage?.cap_reached !== false
    || loaded !== representativePayload.rows.length
    || count(coverage?.total) !== loaded
    || count(coverage?.offset) !== 0
  ) return null

  const parsed = representativePayload.rows.map(parseRepresentative)
  if (parsed.some(representative => representative === null)) return null
  const representatives = parsed.flatMap(representative => representative === null ? [] : [representative])
  const totalForm = representatives.reduce((total, representative) => total + representative.totalSubmissions, 0)
  const totalConcern = representatives.reduce((total, representative) => total + representative.fair + representative.poor, 0)
  const overallConcernRate = totalForm === 0 ? 0 : totalConcern / totalForm

  const scored = representatives.map(representative => ({
    ...representative,
    adjustedFormRisk: representative.totalSubmissions === 0
      ? null
      : ((representative.fair + representative.poor + FORM_PRIOR_SAMPLE * overallConcernRate)
        / (representative.totalSubmissions + FORM_PRIOR_SAMPLE)) * 100,
    riskRank: null as number | null,
  }))
  const ranked = scored
    .filter(representative => representative.adjustedFormRisk !== null)
    .sort((left, right) => (
      (right.adjustedFormRisk ?? 0) - (left.adjustedFormRisk ?? 0)
      || right.totalSubmissions - left.totalSubmissions
      || left.agentEmail.localeCompare(right.agentEmail)
    ))
  const rankByEmail = new Map(ranked.map((representative, index) => [representative.agentEmail, index + 1]))

  return {
    ...range,
    dashboard,
    representatives: scored.map(representative => ({
      ...representative,
      riskRank: rankByEmail.get(representative.agentEmail) ?? null,
    })),
  }
}

/** Load, validate, score, and intersect the three completed-week dashboards. */
export async function loadAchieveManagementReport(
  loadDashboard: (range: AchieveReportRange) => Promise<AchieveDashboardLoadResult>,
  loadOutcomes: () => Promise<AchieveDashboardLoadResult>,
  now: Date,
): Promise<AchieveManagementReportResult> {
  const ranges = completedAchieveReportRanges(now)
  const [loaded, outcomeResult] = await Promise.all([
    Promise.all(ranges.map(async range => ({ range, result: await loadDashboard(range) }))),
    loadOutcomes(),
  ])
  if (loaded.some(item => item.result.error !== null)) {
    return { ok: false, reason: 'dashboard_query_failed' }
  }
  if (outcomeResult.error !== null) return { ok: false, reason: 'outcomes_query_failed' }
  const outcomes = parseFirstPayOutcomes(outcomeResult.data)
  if (!outcomes) return { ok: false, reason: 'invalid_outcomes_response' }

  const periods = loaded.map(item => scoreDashboard(item.range, item.result.data))
  if (periods.some(period => period === null)) {
    return { ok: false, reason: 'invalid_dashboard_response' }
  }
  const validPeriods = periods.flatMap(period => period === null ? [] : [period])
  const topTenSets = validPeriods.map(period => new Set(
    period.representatives
      .filter(representative => representative.riskRank !== null && representative.riskRank <= 10)
      .map(representative => representative.agentEmail),
  ))
  const firstTopTen = topTenSets[0] ?? new Set<string>()
  const persistentAgentEmails = [...firstTopTen]
    .filter(email => topTenSets.every(period => period.has(email)))
    .sort()

  return {
    ok: true,
    report: {
      generatedAt: now.toISOString(),
      completedThrough: ranges[0]?.endAt ?? now.toISOString(),
      periods: validPeriods,
      persistentAgentEmails,
      outcomes,
    },
  }
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

/** Return the completed Sunday as YYYY-MM-DD in Eastern Time. */
export function achieveReportWeekEnding(report: AchieveManagementReport): string {
  const date = new Date(Date.parse(report.completedThrough) - 1)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** Serialize every period's full representative list for the weekly attachment. */
export function achieveManagementReportCsv(report: AchieveManagementReport): string {
  const persistent = new Set(report.persistentAgentEmails)
  const bottomFiveTwoWeek = new Set(
    report.periods.find(period => period.weeks === 2)?.representatives
      .filter(representative => representative.riskRank !== null && representative.riskRank <= 5)
      .map(representative => representative.agentEmail) ?? [],
  )
  const headers = [
    'Period', 'Period start (UTC)', 'Period end (UTC)', 'Persistent high risk',
    'Bottom 5 last 2 weeks', 'Risk rank',
    'Representative', 'Email', 'Adjusted Form risk', 'Form sample', 'Form good', 'Form fair',
    'Form poor', 'Form other', 'Form Fair/Poor rate', 'Background noise', 'Accent / communication',
    'Connection issue', 'AI QA sample', 'AI QA pass', 'AI QA flagged', 'Overlap', 'Both clear',
    'Both concern', 'Human only', 'AI only',
  ]
  const rows = report.periods.flatMap(period => period.representatives.map(representative => [
    `${period.weeks} weeks`,
    period.startAt,
    period.endAt,
    persistent.has(representative.agentEmail) ? 'Yes' : 'No',
    bottomFiveTwoWeek.has(representative.agentEmail) ? 'Yes' : 'No',
    representative.riskRank ?? '',
    representative.agentName,
    representative.agentEmail,
    representative.adjustedFormRisk === null ? '' : `${representative.adjustedFormRisk.toFixed(1)}%`,
    representative.totalSubmissions,
    representative.good,
    representative.fair,
    representative.poor,
    representative.other,
    `${representative.fairPoorRate.toFixed(1)}%`,
    representative.backgroundNoise,
    representative.accent,
    representative.connectionIssues,
    representative.aiTotal,
    representative.aiPass,
    representative.aiFlagged,
    representative.overlapCalls,
    representative.bothClear,
    representative.bothConcern,
    representative.humanOnly,
    representative.aiOnly,
  ]))
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** Screening label; negative z means below roster, never a top-performer claim. */
export function achieveFirstPayOutcomeSignal(agent: AchieveFirstPayOutcomeAgent): string {
  if (!agent.sampleQualified) return 'Low sample'
  if (agent.z === null) return 'Normal'
  if (agent.z >= 3) return 'Extreme'
  if (agent.z >= 2) return 'Flag'
  if (agent.z >= 1.5) return 'Watch'
  if (agent.z < 0) return 'Below roster'
  return 'Normal'
}

/** Serialize all first-pay periods for the dedicated weekly attachment. */
export function achieveFirstPayOutcomesCsv(outcomes: AchieveFirstPayOutcomes): string {
  const headers = [
    'Period', 'Cohort start', 'Maturity cutoff', 'Source as of', 'Refreshed at', 'Rank', 'Signal',
    'Representative', 'Email', 'Mature enrollments', 'No deposit', 'No-deposit rate',
    'Roster expected failures', 'Roster expected successes', 'Roster expected rate', 'Delta pp', 'Z',
    'Rescinded', 'Never paid', 'Sample qualified',
  ]
  const rows = outcomes.periods.flatMap(period => period.agents.map(agent => [
    period.key, period.startDate ?? '', outcomes.maturityCutoff, outcomes.sourceAsOf, outcomes.refreshedAt,
    agent.rank ?? '', achieveFirstPayOutcomeSignal(agent), agent.agentName, agent.agentEmail, agent.n,
    agent.failures, `${agent.failureRate.toFixed(1)}%`, agent.expectedFailures?.toFixed(4) ?? '',
    agent.expectedSuccesses?.toFixed(4) ?? '', agent.expectedRate === null ? '' : `${agent.expectedRate.toFixed(1)}%`,
    agent.deltaPp?.toFixed(4) ?? '', agent.z?.toFixed(4) ?? '', agent.rescinded, agent.neverPaid,
    agent.sampleQualified,
  ]))
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** Maximum representative count requested from each existing dashboard RPC. */
export const ACHIEVE_REPORT_REPRESENTATIVE_LIMIT = MAX_REPRESENTATIVES
