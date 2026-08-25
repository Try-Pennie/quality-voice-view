import {
  parseAchieveFeedbackDashboard,
  type AchieveFeedbackDashboard,
  type AchieveRepresentativeFeedback,
} from './achieve-feedback-overview'

/** Supported completed-week windows in the Achieve management view. */
export type AchieveManagementWeeks = 2 | 4 | 6
export type AchieveOutcomePeriodKey = 'all_time' | 'mature_4_weeks' | 'mature_6_weeks'

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

export type AchieveFirstPayOutcomes = {
  readonly sourceAsOf: string
  readonly refreshedAt: string
  readonly maturityCutoff: string
  readonly periods: ReadonlyArray<AchieveFirstPayOutcomePeriod>
}

/** Form-led risk metadata for one representative and period. */
export type AchieveRepresentativeRisk = {
  readonly agentEmail: string
  readonly adjustedFormRisk: number | null
  readonly riskRank: number | null
}

/** One completed reporting period and its existing dashboard. */
export type AchieveManagementPeriod = {
  readonly weeks: AchieveManagementWeeks
  readonly startAt: string
  readonly endAt: string
  readonly dashboard: AchieveFeedbackDashboard
  readonly risks: ReadonlyArray<AchieveRepresentativeRisk>
}

/** Parsed canonical management report returned by the Achieve boundary. */
export type AchieveManagementReport = {
  readonly generatedAt: string
  readonly completedThrough: string
  readonly periods: ReadonlyArray<AchieveManagementPeriod>
  readonly persistentAgentEmails: ReadonlyArray<string>
  readonly outcomes: AchieveFirstPayOutcomes
}

/** Three period ranks shown beside a persistent high-risk representative. */
export type AchievePeriodRanks = Readonly<Record<AchieveManagementWeeks, number>>

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
    if (key !== 'all_time' && key !== 'mature_4_weeks' && key !== 'mature_6_weeks') invalidResponse()
    const startDate = period.startDate === null ? null : date(period.startDate)
    if ((key === 'all_time') !== (startDate === null)) invalidResponse()
    const agents = period.agents.map(parseOutcomeAgent)
    const ranks = agents.flatMap(agent => agent.rank === null ? [] : [agent.rank]).sort((left, right) => left - right)
    if (new Set(agents.map(agent => agent.agentEmail)).size !== agents.length || ranks.some((rank, index) => rank !== index + 1)) invalidResponse()
    return { key, startDate, endDate: date(period.endDate), agents }
  })
  const keys: ReadonlyArray<AchieveOutcomePeriodKey> = ['all_time', 'mature_4_weeks', 'mature_6_weeks']
  const sourceAsOf = date(outcomes.sourceAsOf)
  const maturityCutoff = date(outcomes.maturityCutoff)
  if (
    periods.length !== keys.length
    || keys.some(key => !periods.some(period => period.key === key))
    || maturityCutoff !== addUtcDays(sourceAsOf, -10)
    || periods.some(period => (
      period.endDate !== maturityCutoff
      || period.startDate !== (period.key === 'all_time' ? null : addUtcDays(maturityCutoff, period.key === 'mature_4_weeks' ? -27 : -41))
    ))
  ) invalidResponse()
  return {
    sourceAsOf,
    refreshedAt: timestamp(outcomes.refreshedAt),
    maturityCutoff,
    periods: keys.map(key => periods.find(period => period.key === key)).flatMap(period => period ? [period] : []),
  }
}

function parsePeriod(value: unknown): AchieveManagementPeriod {
  const period = record(value)
  if (!period || !Array.isArray(period.representatives)) invalidResponse()
  const dashboard = parseAchieveFeedbackDashboard(period.dashboard)
  const risks = period.representatives.map(raw => {
    const representative = record(raw)
    if (!representative || typeof representative.agentEmail !== 'string') invalidResponse()
    return {
      agentEmail: representative.agentEmail.trim().toLowerCase(),
      adjustedFormRisk: nullableNumber(representative.adjustedFormRisk),
      riskRank: nullableRank(representative.riskRank),
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
      return representative.totalSubmissions === 0
        ? risk.riskRank !== null || risk.adjustedFormRisk !== null
        : risk.riskRank === null || risk.adjustedFormRisk === null
    })
  ) invalidResponse()

  return {
    weeks: weeks(period.weeks),
    startAt: timestamp(period.startAt),
    endAt: timestamp(period.endAt),
    dashboard,
    risks,
  }
}

/** Parse and reconcile all periods and the persistent top-ten intersection. */
export function parseAchieveManagementReport(value: unknown): AchieveManagementReport {
  const report = record(value)
  if (!report || !Array.isArray(report.periods) || !Array.isArray(report.persistentAgentEmails)) invalidResponse()
  const periods = report.periods.map(parsePeriod).sort((left, right) => left.weeks - right.weeks)
  if (periods.length !== 3 || periods.some((period, index) => period.weeks !== ([2, 4, 6] as const)[index])) {
    invalidResponse()
  }
  const persistentAgentEmails = report.persistentAgentEmails.map(value => {
    if (typeof value !== 'string' || !value.includes('@')) invalidResponse()
    return value.trim().toLowerCase()
  })
  if (new Set(persistentAgentEmails).size !== persistentAgentEmails.length) invalidResponse()
  const expectedPersistent = periods[0].risks
    .filter(risk => risk.riskRank !== null && risk.riskRank <= 10)
    .map(risk => risk.agentEmail)
    .filter(email => periods.every(period => period.risks.some(
      risk => risk.agentEmail === email && risk.riskRank !== null && risk.riskRank <= 10,
    )))
    .sort()
  if (
    expectedPersistent.length !== persistentAgentEmails.length
    || expectedPersistent.some((email, index) => email !== [...persistentAgentEmails].sort()[index])
  ) invalidResponse()

  return {
    generatedAt: timestamp(report.generatedAt),
    completedThrough: timestamp(report.completedThrough),
    periods,
    persistentAgentEmails,
    outcomes: parseOutcomes(report.outcomes),
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

/** Return the persistent representatives in selected-period rank order. */
export function persistentAchieveRepresentatives(
  report: AchieveManagementReport,
  selectedWeeks: AchieveManagementWeeks,
): ReadonlyArray<AchieveRepresentativeFeedback> {
  const period = achieveManagementPeriod(report, selectedWeeks)
  const persistent = new Set(report.persistentAgentEmails)
  const rankByEmail = new Map(period.risks.map(risk => [risk.agentEmail, risk.riskRank]))
  return period.dashboard.representatives
    .filter(representative => persistent.has(representative.agentEmail))
    .sort((left, right) => (
      (rankByEmail.get(left.agentEmail) ?? Number.MAX_SAFE_INTEGER)
      - (rankByEmail.get(right.agentEmail) ?? Number.MAX_SAFE_INTEGER)
    ))
}

/** Return 2/4/6 ranks for each persistent representative. */
export function persistentAchieveRanks(
  report: AchieveManagementReport,
): ReadonlyMap<string, AchievePeriodRanks> {
  const byPeriod = new Map(report.periods.map(period => [
    period.weeks,
    new Map(period.risks.flatMap(risk => risk.riskRank === null ? [] : [[risk.agentEmail, risk.riskRank] as const])),
  ]))
  return new Map(report.persistentAgentEmails.flatMap(email => {
    const two = byPeriod.get(2)?.get(email)
    const four = byPeriod.get(4)?.get(email)
    const six = byPeriod.get(6)?.get(email)
    return two === undefined || four === undefined || six === undefined
      ? []
      : [[email, { 2: two, 4: four, 6: six }] as const]
  }))
}
