import {
  parseAchieveFeedbackDashboard,
  type AchieveFeedbackDashboard,
  type AchieveRepresentativeFeedback,
} from './achieve-feedback-overview'

/** Supported completed-week windows in the Achieve management view. */
export type AchieveManagementWeeks = 2 | 4 | 6

/** One effective termination and any exactly attributed activity after it. */
export type AchieveManagementTermination = {
  readonly agentName: string
  readonly agentEmail: string
  readonly terminatedAt: string
  readonly activity: boolean
  readonly latestActivityOn: string | null
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

/** Parsed canonical management report returned by the Achieve boundary. */
export type AchieveManagementReport = {
  readonly generatedAt: string
  readonly completedThrough: string
  readonly periods: ReadonlyArray<AchieveManagementPeriod>
  readonly persistentAgentEmails: ReadonlyArray<string>
  readonly terminations: ReadonlyArray<AchieveManagementTermination>
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

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null
  return timestamp(value)
}

function parseTermination(value: unknown): AchieveManagementTermination {
  const row = record(value)
  if (!row || typeof row.agentName !== 'string' || typeof row.agentEmail !== 'string') invalidResponse()
  const agentEmail = row.agentEmail.trim().toLowerCase()
  const latestActivityOn = nullableTimestamp(row.latestActivityOn)
  const terminatedAt = timestamp(row.terminatedAt)
  if (
    !agentEmail.includes('@')
    || typeof row.activity !== 'boolean'
    || row.activity !== (latestActivityOn !== null)
  ) invalidResponse()
  return {
    agentName: row.agentName.trim() || agentEmail,
    agentEmail,
    terminatedAt,
    activity: row.activity,
    latestActivityOn,
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
      return representative.totalSubmissions === 0
        ? risk.riskRank !== null || risk.adjustedFormRisk !== null
        : risk.riskRank === null || risk.adjustedFormRisk === null
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

/** Parse and reconcile all periods and the persistent top-ten intersection. */
export function parseAchieveManagementReport(value: unknown): AchieveManagementReport {
  const report = record(value)
  if (
    !report || !Array.isArray(report.periods) || !Array.isArray(report.persistentAgentEmails)
    || !Array.isArray(report.terminations)
  ) invalidResponse()
  const terminations = report.terminations.map(parseTermination)
  if (new Set(terminations.map(termination => termination.agentEmail)).size !== terminations.length) invalidResponse()
  const terminationByEmail = new Map(terminations.map(termination => [termination.agentEmail, termination]))
  const periods = report.periods
    .map(period => parsePeriod(period, terminationByEmail))
    .sort((left, right) => left.weeks - right.weeks)
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
    terminations,
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
