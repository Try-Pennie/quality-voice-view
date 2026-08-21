import {
  parseAchieveFeedbackDashboard,
  type AchieveFeedbackDashboard,
  type AchieveRepresentativeFeedback,
} from './achieve-feedback-overview'

/** Supported completed-week windows in the Achieve management view. */
export type AchieveManagementWeeks = 2 | 4 | 6

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
  }
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
