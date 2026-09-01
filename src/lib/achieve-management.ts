import {
  parseAchieveFeedbackDashboard,
  type AchieveFeedbackDashboard,
  type AchieveRepresentativeFeedback,
} from './achieve-feedback-overview'

/** Supported completed-week windows in the Achieve management view. */
export type AchieveManagementWeeks = 2 | 4 | 6
export type AchieveOutcomePeriodKey = 'all_time' | 'mature_2_weeks' | 'mature_4_weeks' | 'mature_6_weeks' | 'mature_6_months'

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

export type AchieveFirstPayOutcomes = {
  readonly sourceAsOf: string
  readonly refreshedAt: string
  readonly maturityCutoff: string
  readonly periods: ReadonlyArray<AchieveFirstPayOutcomePeriod>
}

/** One effective termination with last activity and distinct new assignments. */
export type AchieveManagementTermination = {
  readonly agentName: string
  readonly agentEmail: string
  readonly terminatedAt: string
  readonly activitySourceAsOf: string
  readonly latestPostTermEnrollmentOn: string | null
  readonly enrollmentsPostTermination: number
}

/** Form-led risk metadata for one representative and period. */
export type AchieveRepresentativeRisk = {
  readonly agentEmail: string
  readonly adjustedFormRisk: number | null
  readonly riskRank: number | null
  readonly terminatedAt: string | null
}

/** One completed reporting period and its existing dashboard. */
export type AchieveManagementPeriod = {
  readonly weeks: AchieveManagementWeeks
  readonly startAt: string
  readonly endAt: string
  readonly dashboard: AchieveFeedbackDashboard
  readonly risks: ReadonlyArray<AchieveRepresentativeRisk>
}

export type AchieveNegativeReviewTrend = {
  readonly weeks: AchieveManagementWeeks
  readonly startAt: string
  readonly endAt: string
  readonly reviews: number
  readonly negativeReviews: number
  readonly previousStartAt: string
  readonly previousEndAt: string
  readonly previousReviews: number
  readonly previousNegativeReviews: number
}

/** Parsed canonical management report returned by the Achieve boundary. */
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

type BoundaryRecord = Readonly<Record<string, unknown>>

function invalidResponse(): never {
  throw new Error('invalid_achieve_management_response')
}

function record(value: unknown): BoundaryRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: Runtime checks establish the indexable record invariant; consumed
  // fields are parsed individually below.
  return value as BoundaryRecord
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalidResponse()
  return value
}

function weeks(value: unknown): AchieveManagementWeeks {
  if (value !== 2 && value !== 4 && value !== 6) invalidResponse()
  return value
}

function nullableNumber(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) invalidResponse()
  return value
}

function nullableRank(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalidResponse()
  return value
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalidResponse()
  return value
}

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidResponse()
  return value
}

function nullableFinite(value: unknown): number | null {
  return value === null ? null : finite(value)
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalidResponse()
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalidResponse()
  return value
}

function addUtcDays(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function addUtcMonths(value: string, months: number): string {
  const parsed = new Date(`${value}T00:00:00Z`)
  const day = parsed.getUTCDate()
  parsed.setUTCDate(1)
  parsed.setUTCMonth(parsed.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate()
  parsed.setUTCDate(Math.min(day, lastDay))
  return parsed.toISOString().slice(0, 10)
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
  const periodWeeks = key === 'mature_2_weeks' ? 2 : key === 'mature_4_weeks' ? 4 : 6
  return {
    startDate: addUtcDays(maturityCutoff, -(periodWeeks * 7 - 1)),
    previousStartDate: addUtcDays(maturityCutoff, -(periodWeeks * 14 - 1)),
    previousEndDate: addUtcDays(maturityCutoff, -(periodWeeks * 7)),
  }
}

function parseOutcomeAgent(value: unknown): AchieveFirstPayOutcomeAgent {
  const agent = record(value)
  if (!agent || typeof agent.agentName !== 'string' || typeof agent.agentEmail !== 'string' || typeof agent.sampleQualified !== 'boolean') invalidResponse()
  const parsed = {
    agentName: agent.agentName.trim(),
    agentEmail: agent.agentEmail.trim().toLowerCase(),
    n: count(agent.n),
    failures: count(agent.failures),
    failureRate: finite(agent.failureRate),
    expectedFailures: nullableFinite(agent.expectedFailures),
    expectedSuccesses: nullableFinite(agent.expectedSuccesses),
    expectedRate: nullableFinite(agent.expectedRate),
    deltaPp: nullableFinite(agent.deltaPp),
    z: nullableFinite(agent.z),
    rescinded: count(agent.rescinded),
    neverPaid: count(agent.neverPaid),
    sampleQualified: agent.sampleQualified,
    rank: nullableRank(agent.rank),
  }
  if (
    !parsed.agentName || !parsed.agentEmail.includes('@') || parsed.n === 0
    || parsed.failures !== parsed.rescinded + parsed.neverPaid || parsed.failures > parsed.n
    || Math.abs(parsed.failureRate - parsed.failures * 100 / parsed.n) > 0.001
    || (!parsed.sampleQualified && parsed.rank !== null)
  ) invalidResponse()
  const expected = [parsed.expectedFailures, parsed.expectedSuccesses, parsed.expectedRate, parsed.deltaPp]
  if (
    expected.some(item => item === null) && expected.some(item => item !== null)
    || (parsed.z !== null && parsed.expectedRate === null)
    || parsed.failureRate < 0 || parsed.failureRate > 100
    || (parsed.expectedFailures !== null && parsed.expectedFailures < 0)
    || (parsed.expectedSuccesses !== null && parsed.expectedSuccesses < 0)
    || (parsed.expectedRate !== null && (parsed.expectedRate < 0 || parsed.expectedRate > 100))
    || parsed.sampleQualified !== (parsed.expectedFailures !== null && parsed.expectedSuccesses !== null && parsed.expectedFailures >= 5 && parsed.expectedSuccesses >= 5)
  ) invalidResponse()
  return parsed
}

function parseOutcomes(value: unknown): AchieveFirstPayOutcomes {
  const outcomes = record(value)
  if (!outcomes || !Array.isArray(outcomes.periods)) invalidResponse()
  const periods = outcomes.periods.map((raw): AchieveFirstPayOutcomePeriod => {
    const period = record(raw)
    if (!period || !Array.isArray(period.agents)) invalidResponse()
    const key = period.key
    if (key !== 'all_time' && key !== 'mature_2_weeks' && key !== 'mature_4_weeks' && key !== 'mature_6_weeks' && key !== 'mature_6_months') invalidResponse()
    const startDate = period.startDate === null ? null : date(period.startDate)
    const previousStartDate = period.previousStartDate === null ? null : date(period.previousStartDate)
    const previousEndDate = period.previousEndDate === null ? null : date(period.previousEndDate)
    const n = count(period.n)
    const paid = count(period.paid)
    const previousN = period.previousN === null ? null : count(period.previousN)
    const previousPaid = period.previousPaid === null ? null : count(period.previousPaid)
    if (
      paid > n
      || (key === 'all_time'
        ? startDate !== null || previousStartDate !== null || previousEndDate !== null || previousN !== null || previousPaid !== null
        : startDate === null || previousStartDate === null || previousEndDate === null
          || (previousN === null) !== (previousPaid === null)
          || (previousN !== null && previousPaid !== null && previousPaid > previousN))
    ) invalidResponse()
    const agents = period.agents.map(parseOutcomeAgent)
    const ranks = agents.flatMap(agent => agent.rank === null ? [] : [agent.rank]).sort((left, right) => left - right)
    if (new Set(agents.map(agent => agent.agentEmail)).size !== agents.length || ranks.some((rank, index) => rank !== index + 1)) invalidResponse()
    if (
      agents.reduce((total, agent) => total + agent.n, 0) !== n
      || agents.reduce((total, agent) => total + agent.n - agent.failures, 0) !== paid
    ) invalidResponse()
    return { key, startDate, endDate: date(period.endDate), n, paid, previousStartDate, previousEndDate, previousN, previousPaid, agents }
  })
  const keys: ReadonlyArray<AchieveOutcomePeriodKey> = ['all_time', 'mature_2_weeks', 'mature_4_weeks', 'mature_6_weeks', 'mature_6_months']
  const sourceAsOf = date(outcomes.sourceAsOf)
  const maturityCutoff = date(outcomes.maturityCutoff)
  if (
    periods.length !== keys.length
    || keys.some(key => !periods.some(period => period.key === key))
    || maturityCutoff !== addUtcDays(sourceAsOf, -10)
    || periods.some(period => {
      const expected = expectedOutcomeBoundaries(period.key, maturityCutoff)
      return period.endDate !== maturityCutoff
        || period.startDate !== expected.startDate
        || period.previousStartDate !== expected.previousStartDate
        || period.previousEndDate !== expected.previousEndDate
    })
  ) invalidResponse()
  return {
    sourceAsOf,
    refreshedAt: timestamp(outcomes.refreshedAt),
    maturityCutoff,
    periods: keys.map(key => periods.find(period => period.key === key)).flatMap(period => period ? [period] : []),
  }
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null
  return timestamp(value)
}

function parseTermination(value: unknown): AchieveManagementTermination {
  const row = record(value)
  if (!row || typeof row.agentName !== 'string' || typeof row.agentEmail !== 'string') invalidResponse()
  const agentEmail = row.agentEmail.trim().toLowerCase()
  const terminatedAt = timestamp(row.terminatedAt)
  const activitySourceAsOf = date(row.activitySourceAsOf)
  const latestPostTermEnrollmentOn = row.latestPostTermEnrollmentOn === null ? null : date(row.latestPostTermEnrollmentOn)
  const enrollmentsPostTermination = count(row.enrollmentsPostTermination)
  if (
    !agentEmail.includes('@')
    || (enrollmentsPostTermination === 0) !== (latestPostTermEnrollmentOn === null)
    || (latestPostTermEnrollmentOn !== null && latestPostTermEnrollmentOn > activitySourceAsOf)
  ) invalidResponse()
  return {
    agentName: row.agentName.trim() || agentEmail,
    agentEmail,
    terminatedAt,
    activitySourceAsOf,
    latestPostTermEnrollmentOn,
    enrollmentsPostTermination,
  }
}

function parsePeriod(
  value: unknown,
  terminationByEmail: ReadonlyMap<string, AchieveManagementTermination>,
): AchieveManagementPeriod {
  const period = record(value)
  if (!period || !Array.isArray(period.representatives)) invalidResponse()
  const dashboard = parseAchieveFeedbackDashboard(period.dashboard)
  const risks = period.representatives.map(raw => {
    const representative = record(raw)
    if (!representative || typeof representative.agentEmail !== 'string') invalidResponse()
    const agentEmail = representative.agentEmail.trim().toLowerCase()
    const terminatedAt = nullableTimestamp(representative.terminatedAt)
    if (terminatedAt !== (terminationByEmail.get(agentEmail)?.terminatedAt ?? null)) invalidResponse()
    return {
      agentEmail,
      adjustedFormRisk: nullableNumber(representative.adjustedFormRisk),
      riskRank: nullableRank(representative.riskRank),
      terminatedAt,
    }
  })
  const dashboardEmails = dashboard.representatives.map(representative => representative.agentEmail).sort()
  const riskEmails = risks.map(risk => risk.agentEmail).sort()
  const ranks = risks.flatMap(risk => risk.riskRank === null ? [] : [risk.riskRank]).sort((left, right) => left - right)
  const riskByEmail = new Map(risks.map(risk => [risk.agentEmail, risk]))
  if (
    dashboardEmails.length !== riskEmails.length
    || dashboardEmails.some((email, index) => email !== riskEmails[index])
    || new Set(riskEmails).size !== riskEmails.length
    || ranks.some((rank, index) => rank !== index + 1)
    || dashboard.representatives.some(representative => {
      const risk = riskByEmail.get(representative.agentEmail)
      if (!risk) return true
      if (representative.totalSubmissions === 0) return risk.riskRank !== null || risk.adjustedFormRisk !== null
      return risk.terminatedAt === null
        ? risk.riskRank === null || risk.adjustedFormRisk === null
        : risk.riskRank !== null || risk.adjustedFormRisk === null
    })
  ) invalidResponse()

  return {
    weeks: weeks(period.weeks),
    startAt: timestamp(period.startAt),
    endAt: timestamp(period.endAt),
    dashboard: {
      ...dashboard,
      representatives: dashboard.representatives.map(representative => ({
        ...representative,
        terminatedAt: riskByEmail.get(representative.agentEmail)?.terminatedAt ?? null,
      })),
    },
    risks,
  }
}

function parseEmailList(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) invalidResponse()
  const emails = value.map(item => {
    if (typeof item !== 'string' || !item.includes('@')) invalidResponse()
    return item.trim().toLowerCase()
  })
  if (new Set(emails).size !== emails.length) invalidResponse()
  return emails
}

function rawNegativeOrder(left: AchieveRepresentativeFeedback, right: AchieveRepresentativeFeedback): number {
  return right.fairPoorRate - left.fairPoorRate
    || right.fairPoorCount - left.fairPoorCount
    || left.agentEmail.localeCompare(right.agentEmail)
}

function sameEmails(actual: ReadonlyArray<string>, expected: ReadonlyArray<string>): boolean {
  return actual.length === expected.length && actual.every((email, index) => email === expected[index])
}

/** Parse and reconcile all canonical report selectors and comparison lanes. */
export function parseAchieveManagementReport(value: unknown): AchieveManagementReport {
  const report = record(value)
  if (!report || !Array.isArray(report.periods) || !Array.isArray(report.reviewTrends) || !Array.isArray(report.terminations)) {
    invalidResponse()
  }
  const terminations = report.terminations.map(parseTermination)
  if (new Set(terminations.map(termination => termination.agentEmail)).size !== terminations.length) invalidResponse()
  const terminationByEmail = new Map(terminations.map(termination => [termination.agentEmail, termination]))
  const periods = report.periods.map(period => parsePeriod(period, terminationByEmail)).sort((left, right) => left.weeks - right.weeks)
  if (periods.length !== 3 || periods.some((period, index) => period.weeks !== ([2, 4, 6] as const)[index])) invalidResponse()
  const reviewTrends = report.reviewTrends.map((raw): AchieveNegativeReviewTrend => {
    const trend = record(raw)
    if (!trend) invalidResponse()
    const parsed = {
      weeks: weeks(trend.weeks),
      startAt: timestamp(trend.startAt),
      endAt: timestamp(trend.endAt),
      reviews: count(trend.reviews),
      negativeReviews: count(trend.negativeReviews),
      previousStartAt: timestamp(trend.previousStartAt),
      previousEndAt: timestamp(trend.previousEndAt),
      previousReviews: count(trend.previousReviews),
      previousNegativeReviews: count(trend.previousNegativeReviews),
    }
    if (
      parsed.negativeReviews > parsed.reviews || parsed.previousNegativeReviews > parsed.previousReviews
      || parsed.previousEndAt !== parsed.startAt
    ) invalidResponse()
    return parsed
  }).sort((left, right) => left.weeks - right.weeks)
  if (
    reviewTrends.length !== 3
    || reviewTrends.some((trend, index) => {
      const period = periods[index]
      if (!period || trend.weeks !== period.weeks || trend.startAt !== period.startAt || trend.endAt !== period.endAt) return true
      const reviews = period.dashboard.representatives.reduce((total, representative) => total + representative.totalSubmissions, 0)
      const negative = period.dashboard.representatives.reduce((total, representative) => total + representative.fairPoorCount, 0)
      return trend.reviews !== reviews || trend.negativeReviews !== negative
    })
  ) invalidResponse()
  const allTimeReviews = count(report.allTimeReviews)
  const allTimeNegativeReviews = count(report.allTimeNegativeReviews)
  if (allTimeNegativeReviews > allTimeReviews) invalidResponse()
  const highRiskAgentEmails = parseEmailList(report.highRiskAgentEmails)
  const bottomTenNegativeReviewAgentEmails = parseEmailList(report.bottomTenNegativeReviewAgentEmails)
  const bottomTenIntelligibilityAgentEmails = parseEmailList(report.bottomTenIntelligibilityAgentEmails)
  const bottomTenFirstPayAgentEmails = parseEmailList(report.bottomTenFirstPayAgentEmails)
  const four = periods.find(period => period.weeks === 4)
  if (!four) invalidResponse()
  const outcomes = parseOutcomes(report.outcomes)
  const matureSix = outcomes.periods.find(period => period.key === 'mature_6_weeks')
  if (!matureSix) invalidResponse()
  const expectedBottomTenNegative = four.dashboard.representatives
    .filter(representative => representative.terminatedAt === null && representative.totalSubmissions >= 3)
    .sort(rawNegativeOrder)
    .slice(0, 10)
    .map(representative => representative.agentEmail)
  const expectedBottomTenIntelligibility = four.dashboard.representatives
    .filter(representative => representative.terminatedAt === null && representative.flags.accent > 0)
    .sort((left, right) => right.flags.accent - left.flags.accent
      || right.fairPoorCount - left.fairPoorCount
      || left.agentEmail.localeCompare(right.agentEmail))
    .slice(0, 10)
    .map(representative => representative.agentEmail)
  const expectedBottomTenFirstPay = [...matureSix.agents]
    .filter(agent => agent.z !== null)
    .sort((left, right) => (right.z ?? Number.NEGATIVE_INFINITY) - (left.z ?? Number.NEGATIVE_INFINITY)
      || right.failures - left.failures
      || left.agentEmail.localeCompare(right.agentEmail))
    .slice(0, 10)
    .map(agent => agent.agentEmail)
  const negativeReviewSet = new Set(expectedBottomTenNegative)
  const intelligibilitySet = new Set(expectedBottomTenIntelligibility)
  const firstPaySet = new Set(expectedBottomTenFirstPay)
  const outcomeByEmail = new Map(matureSix.agents.map(agent => [agent.agentEmail, agent]))
  const listCount = (email: string) => Number(negativeReviewSet.has(email))
    + Number(intelligibilitySet.has(email)) + Number(firstPaySet.has(email))
  const expectedHighRisk = four.dashboard.representatives
    .filter(representative => representative.terminatedAt === null && (
      listCount(representative.agentEmail) >= 2
      || (firstPaySet.has(representative.agentEmail) && (outcomeByEmail.get(representative.agentEmail)?.z ?? Number.NEGATIVE_INFINITY) > 1.5)
    ))
    .sort((left, right) => listCount(right.agentEmail) - listCount(left.agentEmail)
      || (outcomeByEmail.get(right.agentEmail)?.z ?? Number.NEGATIVE_INFINITY)
        - (outcomeByEmail.get(left.agentEmail)?.z ?? Number.NEGATIVE_INFINITY)
      || left.agentEmail.localeCompare(right.agentEmail))
    .map(representative => representative.agentEmail)
  if (
    !sameEmails(highRiskAgentEmails, expectedHighRisk)
    || !sameEmails(bottomTenNegativeReviewAgentEmails, expectedBottomTenNegative)
    || !sameEmails(bottomTenIntelligibilityAgentEmails, expectedBottomTenIntelligibility)
    || !sameEmails(bottomTenFirstPayAgentEmails, expectedBottomTenFirstPay)
  ) invalidResponse()
  return {
    generatedAt: timestamp(report.generatedAt),
    completedThrough: timestamp(report.completedThrough),
    periods,
    reviewTrends,
    allTimeReviews,
    allTimeNegativeReviews,
    highRiskAgentEmails,
    bottomTenNegativeReviewAgentEmails,
    bottomTenIntelligibilityAgentEmails,
    bottomTenFirstPayAgentEmails,
    outcomes,
    terminations,
  }
}

/** Return the requested first-pay period from the canonical report. */
export function achieveOutcomePeriod(
  outcomes: AchieveFirstPayOutcomes,
  key: AchieveOutcomePeriodKey,
): AchieveFirstPayOutcomePeriod {
  const period = outcomes.periods.find(candidate => candidate.key === key)
  if (!period) throw new Error('missing_achieve_outcome_period')
  return period
}

/** Label a screening signal without treating negative z as performance proof. */
export function achieveOutcomeSignal(agent: AchieveFirstPayOutcomeAgent): string {
  if (!agent.sampleQualified) return 'Low sample'
  if (agent.z === null) return 'Normal'
  if (agent.z >= 3) return 'Extreme'
  if (agent.z >= 2) return 'Flag'
  if (agent.z >= 1.5) return 'Watch'
  if (agent.z < 0) return 'Below roster'
  return 'Normal'
}

/** Return one required period from an already parsed management report. */
export function achieveManagementPeriod(
  report: AchieveManagementReport,
  selectedWeeks: AchieveManagementWeeks,
): AchieveManagementPeriod {
  const period = report.periods.find(candidate => candidate.weeks === selectedWeeks)
  if (!period) throw new Error('missing_achieve_management_period')
  return period
}

/** Return selected representatives in the report selector's stable order. */
export function selectedAchieveRepresentatives(
  report: AchieveManagementReport,
  agentEmails: ReadonlyArray<string>,
  selectedWeeks: AchieveManagementWeeks = 4,
): ReadonlyArray<AchieveRepresentativeFeedback> {
  const byEmail = new Map(achieveManagementPeriod(report, selectedWeeks).dashboard.representatives
    .map(representative => [representative.agentEmail, representative]))
  return agentEmails.flatMap(email => {
    const representative = byEmail.get(email)
    return representative ? [representative] : []
  })
}
