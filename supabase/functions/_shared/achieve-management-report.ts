export const ACHIEVE_REPORT_WEEKS = [2, 4, 6] as const
export type AchieveReportWeeks = typeof ACHIEVE_REPORT_WEEKS[number]

const BUSINESS_TIME_ZONE = 'America/New_York'
const MAX_REPRESENTATIVES = 500

type BoundaryRecord = Readonly<Record<string, unknown>>

/** One dashboard query window; null start means all available history. */
export type AchieveDashboardRange = {
  readonly startAt: string | null
  readonly endAt: string
}

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

export type AchieveOutcomePeriodKey = 'all_time' | 'mature_2_weeks' | 'mature_4_weeks' | 'mature_6_weeks' | 'mature_6_months'

/** Minimum mature enrollments required for the six-month Bottom 10 list. */
export const ACHIEVE_FIRST_PAY_BOTTOM_LIST_MIN_ENROLLMENTS = 10

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
  readonly n: number
  readonly paid: number
  readonly previousStartDate: string | null
  readonly previousEndDate: string | null
  readonly previousN: number | null
  readonly previousPaid: number | null
  readonly agents: ReadonlyArray<AchieveFirstPayOutcomeAgent>
}

/** Fresh mature outcome snapshot shared unchanged by the portal and email. */
export type AchieveFirstPayOutcomes = {
  readonly sourceAsOf: string
  readonly refreshedAt: string
  readonly maturityCutoff: string
  readonly periods: ReadonlyArray<AchieveFirstPayOutcomePeriod>
}

/** One effective termination with last WC activity and distinct new assignments after it. */
export type AchieveManagementTermination = {
  readonly agentName: string
  readonly agentEmail: string
  readonly terminatedAt: string
  readonly activitySourceAsOf: string
  readonly latestPostTermEnrollmentOn: string | null
  readonly enrollmentsPostTermination: number
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

/** One organizational negative-review lane and its true non-overlapping predecessor. */
export type AchieveNegativeReviewTrend = {
  readonly weeks: AchieveReportWeeks
  readonly startAt: string
  readonly endAt: string
  readonly reviews: number
  readonly negativeReviews: number
  readonly previousStartAt: string
  readonly previousEndAt: string
  readonly previousReviews: number
  readonly previousNegativeReviews: number
}

/** Canonical payload shared by the /achieve view, email, and CSV projections. */
export type AchieveManagementReport = {
  readonly generatedAt: string
  readonly completedThrough: string
  readonly periods: ReadonlyArray<AchieveManagementPeriod>
  readonly reviewTrends: ReadonlyArray<AchieveNegativeReviewTrend>
  readonly allTimeReviews: number
  readonly allTimeNegativeReviews: number
  readonly highRiskAgentEmails: ReadonlyArray<string>
  readonly bottomTenNegativeReviewAgentEmails: ReadonlyArray<string>
  readonly bottomTenIntelligibilityAgentEmails: ReadonlyArray<string>
  readonly bottomTenFirstPayAgentEmails: ReadonlyArray<string>
  readonly outcomes: AchieveFirstPayOutcomes
  readonly terminations: ReadonlyArray<AchieveManagementTermination>
}

/** Expected report-loading failures safe to expose as protocol error codes. */
export type AchieveManagementReportFailure =
  | 'dashboard_query_failed'
  | 'invalid_dashboard_response'
  | 'outcomes_query_failed'
  | 'invalid_outcomes_response'
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

function addUtcMonths(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString().slice(0, 10)
}

function expectedOutcomeBoundaries(key: AchieveOutcomePeriodKey, maturityCutoff: string): {
  readonly startDate: string | null
  readonly previousStartDate: string | null
  readonly previousEndDate: string | null
} {
  if (key === 'all_time') return { startDate: null, previousStartDate: null, previousEndDate: null }
  if (key === 'mature_6_months') return {
    startDate: addUtcDays(addUtcMonths(maturityCutoff, -6), 1),
    previousStartDate: addUtcDays(addUtcMonths(maturityCutoff, -12), 1),
    previousEndDate: addUtcMonths(maturityCutoff, -6),
  }
  const weeks = key === 'mature_2_weeks' ? 2 : key === 'mature_4_weeks' ? 4 : 6
  return {
    startDate: addUtcDays(maturityCutoff, -(weeks * 7 - 1)),
    previousStartDate: addUtcDays(maturityCutoff, -(weeks * 14 - 1)),
    previousEndDate: addUtcDays(maturityCutoff, -(weeks * 7)),
  }
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
  const activitySourceAsOf = isoDate(row.activity_source_as_of)
  const latestPostTermEnrollmentOn = row.latest_post_term_enrollment_on === null
    ? null
    : isoDate(row.latest_post_term_enrollment_on)
  const enrollmentsPostTermination = count(row.enrollments_post_termination)
  const agentEmail = row.agent_email.trim().toLowerCase()
  if (
    terminatedAt === null || terminatedAt === undefined || activitySourceAsOf === null
    || (row.latest_post_term_enrollment_on !== null && latestPostTermEnrollmentOn === null)
    || enrollmentsPostTermination === null || !agentEmail || !agentEmail.includes('@')
    || (enrollmentsPostTermination === 0) !== (latestPostTermEnrollmentOn === null)
    || (latestPostTermEnrollmentOn !== null && latestPostTermEnrollmentOn > activitySourceAsOf)
  ) return null
  return {
    agentName: row.agent_name.trim() || agentEmail,
    agentEmail,
    terminatedAt,
    activitySourceAsOf,
    latestPostTermEnrollmentOn,
    enrollmentsPostTermination,
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
    const previousStartDate = period?.previous_start_date === null ? null : isoDate(period?.previous_start_date)
    const previousEndDate = period?.previous_end_date === null ? null : isoDate(period?.previous_end_date)
    const n = count(period?.n)
    const paid = count(period?.paid)
    const previousN = period?.previous_n === null ? null : count(period?.previous_n)
    const previousPaid = period?.previous_paid === null ? null : count(period?.previous_paid)
    if (
      !period || !Array.isArray(period.agents) || endDate === null || n === null || paid === null || paid > n
      || (period.key !== 'all_time' && period.key !== 'mature_2_weeks' && period.key !== 'mature_4_weeks' && period.key !== 'mature_6_weeks' && period.key !== 'mature_6_months')
      || (period.key === 'all_time'
        ? startDate !== null || previousStartDate !== null || previousEndDate !== null || previousN !== null || previousPaid !== null
        : startDate === null || previousStartDate === null || previousEndDate === null
          || (previousN === null) !== (previousPaid === null)
          || (previousN !== null && previousPaid !== null && previousPaid > previousN))
    ) return null
    const agents = period.agents.map(parseOutcomeAgent)
    if (agents.some(agent => agent === null)) return null
    const validAgents = agents.flatMap(agent => agent === null ? [] : [agent])
    const ranks = validAgents.flatMap(agent => agent.rank === null ? [] : [agent.rank]).sort((left, right) => left - right)
    if (new Set(validAgents.map(agent => agent.agentEmail)).size !== validAgents.length || ranks.some((rank, index) => rank !== index + 1)) return null
    if (
      validAgents.reduce((total, agent) => total + agent.n, 0) !== n
      || validAgents.reduce((total, agent) => total + agent.n - agent.failures, 0) !== paid
    ) return null
    return { key: period.key, startDate, endDate, n, paid, previousStartDate, previousEndDate, previousN, previousPaid, agents: validAgents }
  })
  if (periods.some(period => period === null)) return null
  const validPeriods = periods.flatMap(period => period === null ? [] : [period])
  const expectedKeys: ReadonlyArray<AchieveOutcomePeriodKey> = ['all_time', 'mature_2_weeks', 'mature_4_weeks', 'mature_6_weeks', 'mature_6_months']
  if (
    validPeriods.length !== expectedKeys.length
    || expectedKeys.some(key => !validPeriods.some(period => period.key === key))
    || maturityCutoff !== addUtcDays(sourceAsOf, -10)
    || validPeriods.some(period => {
      const expected = expectedOutcomeBoundaries(period.key, maturityCutoff)
      return period.endDate !== maturityCutoff
        || period.startDate !== expected.startDate
        || period.previousStartDate !== expected.previousStartDate
        || period.previousEndDate !== expected.previousEndDate
    })
  ) return null
  return { sourceAsOf, refreshedAt, maturityCutoff, periods: expectedKeys.map(key => validPeriods.find(period => period.key === key)).flatMap(period => period ? [period] : []) }
}

type ParsedRepresentative = Omit<AchieveManagementRepresentative, 'adjustedFormRisk' | 'riskRank' | 'terminatedAt'>

type ParsedDashboard = {
  readonly dashboard: BoundaryRecord
  readonly representatives: ReadonlyArray<ParsedRepresentative>
}

function parseDashboard(value: unknown): ParsedDashboard | null {
  const dashboard = record(value)
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
  return {
    dashboard,
    representatives: parsed.flatMap(representative => representative === null ? [] : [representative]),
  }
}

function scoreDashboard(
  range: AchieveReportRange,
  dashboardValue: unknown,
  terminationByEmail: ReadonlyMap<string, AchieveManagementTermination>,
): AchieveManagementPeriod | null {
  const parsed = parseDashboard(dashboardValue)
  if (!parsed) return null
  const scored = parsed.representatives.map(representative => ({
    ...representative,
    terminatedAt: terminationByEmail.get(representative.agentEmail)?.terminatedAt ?? null,
    adjustedFormRisk: representative.totalSubmissions === 0 ? null : representative.fairPoorRate,
    riskRank: null as number | null,
  }))
  const ranked = scored
    .filter(representative => representative.adjustedFormRisk !== null && representative.terminatedAt === null)
    .sort((left, right) => (
      right.fairPoorRate - left.fairPoorRate
      || (right.fair + right.poor) - (left.fair + left.poor)
      || left.agentEmail.localeCompare(right.agentEmail)
    ))
  const rankByEmail = new Map(ranked.map((representative, index) => [representative.agentEmail, index + 1]))
  return {
    ...range,
    dashboard: parsed.dashboard,
    representatives: scored.map(representative => ({
      ...representative,
      riskRank: rankByEmail.get(representative.agentEmail) ?? null,
    })),
  }
}

function previousRange(range: AchieveReportRange): AchieveReportRange {
  const prior = completedAchieveReportRanges(new Date(Date.parse(range.startAt) + 3_600_000))
    .find(candidate => candidate.weeks === range.weeks)
  return prior ?? range
}

function reviewCounts(representatives: ReadonlyArray<ParsedRepresentative>): { reviews: number; negativeReviews: number } {
  return representatives.reduce((total, representative) => ({
    reviews: total.reviews + representative.totalSubmissions,
    negativeReviews: total.negativeReviews + representative.fair + representative.poor,
  }), { reviews: 0, negativeReviews: 0 })
}

/** Load and validate the canonical report, including true prior-period dashboards. */
export async function loadAchieveManagementReport(
  loadDashboard: (range: AchieveDashboardRange) => Promise<AchieveReportLoadResult>,
  loadOutcomes: () => Promise<AchieveReportLoadResult>,
  loadTerminations: (endAt: string) => Promise<AchieveReportLoadResult>,
  now: Date,
): Promise<AchieveManagementReportResult> {
  const ranges = completedAchieveReportRanges(now)
  const priorRanges = ranges.map(previousRange)
  const completedThrough = ranges[0]?.endAt ?? now.toISOString()
  const loaded = []
  for (const range of ranges) loaded.push({ range, result: await loadDashboard(range) })
  const loadedPrior = []
  for (const range of priorRanges) loadedPrior.push({ range, result: await loadDashboard(range) })
  const loadedAllTime = await loadDashboard({ startAt: null, endAt: completedThrough })
  const [outcomeResult, terminationResult] = await Promise.all([
    loadOutcomes(),
    loadTerminations(now.toISOString()),
  ])
  if (
    loaded.some(item => item.result.error !== null)
    || loadedPrior.some(item => item.result.error !== null)
    || loadedAllTime.error !== null
  ) return { ok: false, reason: 'dashboard_query_failed' }
  if (outcomeResult.error !== null) return { ok: false, reason: 'outcomes_query_failed' }
  const outcomes = parseFirstPayOutcomes(outcomeResult.data)
  if (!outcomes) return { ok: false, reason: 'invalid_outcomes_response' }
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
  const priorDashboards = loadedPrior.map(item => parseDashboard(item.result.data))
  const allTimeDashboard = parseDashboard(loadedAllTime.data)
  if (periods.some(period => period === null) || priorDashboards.some(dashboard => dashboard === null) || !allTimeDashboard) {
    return { ok: false, reason: 'invalid_dashboard_response' }
  }
  const validPeriods = periods.flatMap(period => period === null ? [] : [period])
  const validPriorDashboards = priorDashboards.flatMap(dashboard => dashboard === null ? [] : [dashboard])
  const reviewTrends = validPeriods.map((period, index) => {
    const current = reviewCounts(period.representatives)
    const previous = reviewCounts(validPriorDashboards[index]?.representatives ?? [])
    const priorRange = priorRanges[index] ?? period
    return {
      weeks: period.weeks,
      startAt: period.startAt,
      endAt: period.endAt,
      ...current,
      previousStartAt: priorRange.startAt,
      previousEndAt: priorRange.endAt,
      previousReviews: previous.reviews,
      previousNegativeReviews: previous.negativeReviews,
    }
  })
  const twoWeek = validPeriods.find(period => period.weeks === 2)
  const fourWeek = validPeriods.find(period => period.weeks === 4)
  const sixWeek = validPeriods.find(period => period.weeks === 6)
  if (!twoWeek || !fourWeek || !sixWeek) return { ok: false, reason: 'invalid_dashboard_response' }
  const matureSix = outcomes.periods.find(period => period.key === 'mature_6_weeks')
  if (!matureSix) return { ok: false, reason: 'invalid_outcomes_response' }
  const bottomTenNegativeReviewAgentEmails = fourWeek.representatives
    .filter(representative => representative.terminatedAt === null && representative.totalSubmissions >= 3)
    .sort((left, right) => right.fairPoorRate - left.fairPoorRate
      || (right.fair + right.poor) - (left.fair + left.poor)
      || left.agentEmail.localeCompare(right.agentEmail))
    .slice(0, 10)
    .map(representative => representative.agentEmail)
  const bottomTenIntelligibilityAgentEmails = fourWeek.representatives
    .filter(representative => representative.terminatedAt === null && representative.accent > 0)
    .sort((left, right) => right.accent - left.accent
      || (right.fair + right.poor) - (left.fair + left.poor)
      || left.agentEmail.localeCompare(right.agentEmail))
    .slice(0, 10)
    .map(representative => representative.agentEmail)
  const bottomTenFirstPayAgentEmails = [...matureSix.agents]
    .filter(agent => agent.z !== null)
    .sort((left, right) => (right.z ?? Number.NEGATIVE_INFINITY) - (left.z ?? Number.NEGATIVE_INFINITY)
      || right.failures - left.failures
      || left.agentEmail.localeCompare(right.agentEmail))
    .slice(0, 10)
    .map(agent => agent.agentEmail)
  const negativeReviewSet = new Set(bottomTenNegativeReviewAgentEmails)
  const intelligibilitySet = new Set(bottomTenIntelligibilityAgentEmails)
  const firstPaySet = new Set(bottomTenFirstPayAgentEmails)
  const outcomeByEmail = new Map(matureSix.agents.map(agent => [agent.agentEmail, agent]))
  const listCount = (email: string) => Number(negativeReviewSet.has(email))
    + Number(intelligibilitySet.has(email)) + Number(firstPaySet.has(email))
  const highRiskAgentEmails = fourWeek.representatives
    .filter(representative => representative.terminatedAt === null && (
      listCount(representative.agentEmail) >= 2
      || (firstPaySet.has(representative.agentEmail) && (outcomeByEmail.get(representative.agentEmail)?.z ?? Number.NEGATIVE_INFINITY) > 1.5)
    ))
    .sort((left, right) => listCount(right.agentEmail) - listCount(left.agentEmail)
      || (outcomeByEmail.get(right.agentEmail)?.z ?? Number.NEGATIVE_INFINITY)
        - (outcomeByEmail.get(left.agentEmail)?.z ?? Number.NEGATIVE_INFINITY)
      || left.agentEmail.localeCompare(right.agentEmail))
    .map(representative => representative.agentEmail)
  const allTime = reviewCounts(allTimeDashboard.representatives)
  return {
    ok: true,
    report: {
      generatedAt: now.toISOString(),
      completedThrough,
      periods: validPeriods,
      reviewTrends,
      allTimeReviews: allTime.reviews,
      allTimeNegativeReviews: allTime.negativeReviews,
      highRiskAgentEmails,
      bottomTenNegativeReviewAgentEmails,
      bottomTenIntelligibilityAgentEmails,
      bottomTenFirstPayAgentEmails,
      outcomes,
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
  const highRisk = new Set(report.highRiskAgentEmails)
  const bottomTenNegative = new Set(report.bottomTenNegativeReviewAgentEmails)
  const bottomTenIntelligibility = new Set(report.bottomTenIntelligibilityAgentEmails)
  const bottomTenFirstPay = new Set(report.bottomTenFirstPayAgentEmails)
  const sixMonth = report.outcomes.periods.find(period => period.key === 'mature_6_months')
  const allTime = report.outcomes.periods.find(period => period.key === 'all_time')
  const sixMonthByEmail = new Map(sixMonth?.agents.map(agent => [agent.agentEmail, agent]) ?? [])
  const allTimeByEmail = new Map(allTime?.agents.map(agent => [agent.agentEmail, agent]) ?? [])
  const bottomTenSixMonthFirstPay = new Set([...(sixMonth?.agents ?? [])]
    .filter(agent => agent.n >= ACHIEVE_FIRST_PAY_BOTTOM_LIST_MIN_ENROLLMENTS && agent.z !== null)
    .sort((left, right) => (right.z ?? Number.NEGATIVE_INFINITY) - (left.z ?? Number.NEGATIVE_INFINITY)
      || right.failures - left.failures
      || left.agentEmail.localeCompare(right.agentEmail))
    .slice(0, 10)
    .map(agent => agent.agentEmail))
  const terminationByEmail = new Map(report.terminations.map(termination => [termination.agentEmail, termination]))
  const headers = [
    'Period', 'Period start (UTC)', 'Period end (UTC)', 'High Risk Triangulation',
    'Bottom 10 negative reviews', 'Bottom 10 intelligibility', 'Bottom 10 mature 6-week first pay',
    'Bottom 10 mature 6-month first pay', '6-month mature enrollments', '6-month no deposit',
    '6-month no-deposit rate', '6-month z', 'All-time mature enrollments', 'All-time no deposit',
    'All-time no-deposit rate', 'All-time z', 'All-time rescinded', 'All-time never paid',
    'Risk rank', 'Terminated at (UTC)', 'Enrollments After Termination', 'Latest Post-Term Enrollment', 'Termination Activity Source As Of',
    'Representative', 'Email', 'Form negative rate', 'Form sample', 'Form good', 'Form fair',
    'Form poor', 'Form other', 'Form Fair/Poor rate', 'Background noise', 'Accent / communication', 'Connection issue',
    'AI QA sample', 'AI QA pass', 'AI QA flagged', 'Overlap', 'Both clear',
    'Both concern', 'Human only', 'AI only',
  ]
  const rows = report.periods.flatMap(period => period.representatives.map(representative => {
    const termination = terminationByEmail.get(representative.agentEmail)
    const sixMonthOutcome = sixMonthByEmail.get(representative.agentEmail)
    const allTimeOutcome = allTimeByEmail.get(representative.agentEmail)
    return [
      `${period.weeks} weeks`,
      period.startAt,
      period.endAt,
      highRisk.has(representative.agentEmail) ? 'Yes' : 'No',
      bottomTenNegative.has(representative.agentEmail) ? 'Yes' : 'No',
      bottomTenIntelligibility.has(representative.agentEmail) ? 'Yes' : 'No',
      bottomTenFirstPay.has(representative.agentEmail) ? 'Yes' : 'No',
      bottomTenSixMonthFirstPay.has(representative.agentEmail) ? 'Yes' : 'No',
      sixMonthOutcome?.n ?? '',
      sixMonthOutcome?.failures ?? '',
      sixMonthOutcome ? `${sixMonthOutcome.failureRate.toFixed(1)}%` : '',
      sixMonthOutcome?.z?.toFixed(4) ?? '',
      allTimeOutcome?.n ?? '',
      allTimeOutcome?.failures ?? '',
      allTimeOutcome ? `${allTimeOutcome.failureRate.toFixed(1)}%` : '',
      allTimeOutcome?.z?.toFixed(4) ?? '',
      allTimeOutcome?.rescinded ?? '',
      allTimeOutcome?.neverPaid ?? '',
      representative.riskRank ?? '',
      representative.terminatedAt ?? '',
      termination?.enrollmentsPostTermination ?? 0,
      termination?.latestPostTermEnrollmentOn ?? '',
      termination?.activitySourceAsOf ?? '',
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
    'Period', 'Cohort start', 'Maturity cutoff', 'Organization enrollments', 'Organization paid',
    'Previous cohort start', 'Previous cohort end', 'Previous enrollments', 'Previous paid',
    'Source as of', 'Refreshed at', 'Rank', 'Signal', 'Representative', 'Email', 'Mature enrollments', 'No deposit', 'No-deposit rate',
    'Roster expected failures', 'Roster expected successes', 'Roster expected rate', 'Delta pp', 'Z',
    'Rescinded', 'Never paid', 'Sample qualified',
  ]
  const rows = outcomes.periods.flatMap(period => period.agents.map(agent => [
    period.key, period.startDate ?? '', outcomes.maturityCutoff, period.n, period.paid,
    period.previousStartDate ?? '', period.previousEndDate ?? '', period.previousN ?? '', period.previousPaid ?? '',
    outcomes.sourceAsOf, outcomes.refreshedAt, agent.rank ?? '', achieveFirstPayOutcomeSignal(agent), agent.agentName, agent.agentEmail, agent.n,
    agent.failures, `${agent.failureRate.toFixed(1)}%`, agent.expectedFailures?.toFixed(4) ?? '',
    agent.expectedSuccesses?.toFixed(4) ?? '', agent.expectedRate === null ? '' : `${agent.expectedRate.toFixed(1)}%`,
    agent.deltaPp?.toFixed(4) ?? '', agent.z?.toFixed(4) ?? '', agent.rescinded, agent.neverPaid,
    agent.sampleQualified,
  ]))
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** Maximum representative count requested from each existing dashboard RPC. */
export const ACHIEVE_REPORT_REPRESENTATIVE_LIMIT = MAX_REPRESENTATIVES
