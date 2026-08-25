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

/** Result returned by an Achieve reporting RPC. */
export type AchieveReportLoadResult = {
  readonly data: unknown
  readonly error: unknown
}

/** One effective termination and any exactly attributed activity after it. */
export type AchieveManagementTermination = {
  readonly agentName: string
  readonly agentEmail: string
  readonly terminatedAt: string
  readonly activity: boolean
  readonly latestActivityOn: string | null
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
  readonly terminatedAt: string | null
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
  readonly terminations: ReadonlyArray<AchieveManagementTermination>
}

/** Expected report-loading failures safe to expose as protocol error codes. */
export type AchieveManagementReportFailure =
  | 'dashboard_query_failed'
  | 'invalid_dashboard_response'
  | 'termination_query_failed'
  | 'invalid_termination_response'

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

function parseTermination(value: unknown): AchieveManagementTermination | null {
  const row = record(value)
  if (!row || typeof row.agent_name !== 'string' || typeof row.agent_email !== 'string') return null
  const terminatedAt = optionalTimestamp(row.terminated_at)
  const latestActivityOn = optionalTimestamp(row.latest_activity_on)
  const agentEmail = row.agent_email.trim().toLowerCase()
  if (
    terminatedAt === null || terminatedAt === undefined
    || typeof row.activity !== 'boolean' || latestActivityOn === undefined
    || !agentEmail || !agentEmail.includes('@')
    || row.activity !== (latestActivityOn !== null)
  ) return null
  return {
    agentName: row.agent_name.trim() || agentEmail,
    agentEmail,
    terminatedAt,
    activity: row.activity,
    latestActivityOn,
  }
}

function parseRepresentative(value: unknown): Omit<AchieveManagementRepresentative, 'adjustedFormRisk' | 'riskRank' | 'terminatedAt'> | null {
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

function scoreDashboard(
  range: AchieveReportRange,
  dashboardValue: unknown,
  terminationByEmail: ReadonlyMap<string, AchieveManagementTermination>,
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
    terminatedAt: terminationByEmail.get(representative.agentEmail)?.terminatedAt ?? null,
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
  loadDashboard: (range: AchieveReportRange) => Promise<AchieveReportLoadResult>,
  loadTerminations: (endAt: string) => Promise<AchieveReportLoadResult>,
  now: Date,
): Promise<AchieveManagementReportResult> {
  const ranges = completedAchieveReportRanges(now)
  const [loaded, terminationResult] = await Promise.all([
    Promise.all(ranges.map(async range => ({ range, result: await loadDashboard(range) }))),
    loadTerminations(now.toISOString()),
  ])
  if (loaded.some(item => item.result.error !== null)) {
    return { ok: false, reason: 'dashboard_query_failed' }
  }
  if (terminationResult.error !== null) return { ok: false, reason: 'termination_query_failed' }
  if (!Array.isArray(terminationResult.data)) return { ok: false, reason: 'invalid_termination_response' }
  const parsedTerminations = terminationResult.data.map(parseTermination)
  if (parsedTerminations.some(termination => termination === null)) {
    return { ok: false, reason: 'invalid_termination_response' }
  }
  const terminations = parsedTerminations.flatMap(termination => termination === null ? [] : [termination])
  if (new Set(terminations.map(termination => termination.agentEmail)).size !== terminations.length) {
    return { ok: false, reason: 'invalid_termination_response' }
  }
  const terminationByEmail = new Map(terminations.map(termination => [termination.agentEmail, termination]))

  const periods = loaded.map(item => scoreDashboard(item.range, item.result.data, terminationByEmail))
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
      terminations,
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
  const terminationByEmail = new Map(report.terminations.map(termination => [termination.agentEmail, termination]))
  const headers = [
    'Period', 'Period start (UTC)', 'Period end (UTC)', 'Persistent high risk',
    'Bottom 5 last 2 weeks', 'Risk rank', 'Terminated at (UTC)',
    'Activity after termination', 'Latest activity report date',
    'Representative', 'Email', 'Adjusted Form risk', 'Form sample', 'Form good', 'Form fair',
    'Form poor', 'Form other', 'Form Fair/Poor rate', 'Background noise', 'Accent / communication',
    'Connection issue', 'AI QA sample', 'AI QA pass', 'AI QA flagged', 'Overlap', 'Both clear',
    'Both concern', 'Human only', 'AI only',
  ]
  const rows = report.periods.flatMap(period => period.representatives.map(representative => {
    const termination = terminationByEmail.get(representative.agentEmail)
    return [
      `${period.weeks} weeks`,
      period.startAt,
      period.endAt,
      persistent.has(representative.agentEmail) ? 'Yes' : 'No',
      bottomFiveTwoWeek.has(representative.agentEmail) ? 'Yes' : 'No',
      representative.riskRank ?? '',
      representative.terminatedAt ?? '',
      termination?.activity ? 'Yes' : 'No',
      termination?.latestActivityOn ?? '',
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
    ]
  }))
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** Maximum representative count requested from each existing dashboard RPC. */
export const ACHIEVE_REPORT_REPRESENTATIVE_LIMIT = MAX_REPRESENTATIVES
