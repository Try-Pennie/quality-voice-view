/** Submission-level rating counts from the complete Pennie-agent Form source. */
export type AchieveFeedbackRatings = {
  readonly good: number
  readonly fair: number
  readonly poor: number
  readonly other: number
}

/** Reported call-condition counts from the complete Pennie-agent Form source. */
export type AchieveFeedbackFlags = {
  readonly accent: number
  readonly backgroundNoise: number
  readonly connectionIssues: number
  readonly withNotes: number
}

/** Coverage of call association and exact daily-report representative attribution. */
export type AchieveFeedbackCoverage = {
  readonly callAssociated: number
  readonly exactAgentAttributed: number
  readonly agentUnavailable: number
  readonly unresolved: number
}

/** Exact reasons for Form submissions that still have no safe call association. */
export type AchieveUnresolvedReasons = {
  readonly callAmbiguous: number
  readonly noCallInWindow: number
  readonly invalidPhone: number
  readonly submitterNotFound: number
  readonly other: number
}

/** Complete aggregate for a selected Pennie-agent Form period. */
export type AchieveFeedbackOverview = {
  readonly generatedAt: string
  readonly scope: {
    readonly firstSubmittedAt: string | null
    readonly lastSubmittedAt: string | null
    readonly totalSubmissions: number
  }
  readonly ratings: AchieveFeedbackRatings
  readonly flags: AchieveFeedbackFlags
  readonly coverage: AchieveFeedbackCoverage
  readonly unresolvedReasons: AchieveUnresolvedReasons
  readonly distinctExactAgents: number
}

/** Submission-level feedback rollup for one exact Achieve representative. */
export type AchieveRepresentativeFeedback = {
  readonly agentName: string
  readonly agentEmail: string
  readonly totalSubmissions: number
  readonly ratings: AchieveFeedbackRatings
  readonly flags: Omit<AchieveFeedbackFlags, 'withNotes'>
  readonly latestSubmittedAt: string
  readonly fairPoorCount: number
  readonly fairPoorRate: number
}

/** Coverage metadata for the bounded representative list. */
export type AchieveRepresentativeCoverage = {
  readonly total: number
  readonly loaded: number
  readonly limit: number
  readonly offset: number
  readonly capReached: boolean
}

/** Complete leadership payload returned by the authenticated Achieve boundary. */
export type AchieveFeedbackDashboard = {
  readonly overview: AchieveFeedbackOverview
  readonly representatives: ReadonlyArray<AchieveRepresentativeFeedback>
  readonly representativeCoverage: AchieveRepresentativeCoverage
}

/** Sample-aware review state; it is a triage aid, not an employment decision. */
export type AchieveRepresentativeReviewStatus = 'needs_review' | 'below_threshold' | 'low_sample'

const REVIEW_MINIMUM_SAMPLE = 5
const REVIEW_FAIR_POOR_RATE = 25

type BoundaryRecord = Readonly<Record<string, unknown>>

function recordValue(value: unknown): BoundaryRecord | null {
  // SAFETY: The object/array/null checks establish the only indexable-record
  // invariant used by this boundary parser. Every field is parsed separately.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as BoundaryRecord
    : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function requiredCount(record: BoundaryRecord | null, key: string): number {
  const value = nonNegativeInteger(record?.[key])
  if (value === null) throw new Error('invalid_achieve_feedback_response')
  return value
}

function requiredString(record: BoundaryRecord | null, key: string): string {
  const value = record?.[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('invalid_achieve_feedback_response')
  }
  return value
}

function requiredTimestamp(record: BoundaryRecord | null, key: string): string {
  const value = requiredString(record, key)
  if (!Number.isFinite(Date.parse(value))) throw new Error('invalid_achieve_feedback_response')
  return value
}

function nullableTimestamp(record: BoundaryRecord | null, key: string): string | null {
  const value = record?.[key]
  if (value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('invalid_achieve_feedback_response')
  }
  return value
}

function parseRatings(value: unknown): AchieveFeedbackRatings {
  const ratings = recordValue(value)
  return {
    good: requiredCount(ratings, 'good'),
    fair: requiredCount(ratings, 'fair'),
    poor: requiredCount(ratings, 'poor'),
    other: requiredCount(ratings, 'other'),
  }
}

function parseOverview(value: unknown): AchieveFeedbackOverview {
  const overview = recordValue(value)
  const scope = recordValue(overview?.scope)
  const flags = recordValue(overview?.flags)
  const coverage = recordValue(overview?.coverage)
  const unresolved = recordValue(overview?.unresolved_reasons)
  const totalSubmissions = requiredCount(scope, 'total_submissions')
  const firstSubmittedAt = nullableTimestamp(scope, 'first_submitted_at')
  const lastSubmittedAt = nullableTimestamp(scope, 'last_submitted_at')
  const ratings = parseRatings(overview?.ratings)
  const parsedFlags: AchieveFeedbackFlags = {
    accent: requiredCount(flags, 'accent'),
    backgroundNoise: requiredCount(flags, 'background_noise'),
    connectionIssues: requiredCount(flags, 'connection_issues'),
    withNotes: requiredCount(flags, 'with_notes'),
  }
  const parsedCoverage: AchieveFeedbackCoverage = {
    callAssociated: requiredCount(coverage, 'call_associated'),
    exactAgentAttributed: requiredCount(coverage, 'exact_agent_attributed'),
    agentUnavailable: requiredCount(coverage, 'agent_unavailable'),
    unresolved: requiredCount(coverage, 'unresolved'),
  }
  const unresolvedReasons: AchieveUnresolvedReasons = {
    callAmbiguous: requiredCount(unresolved, 'call_ambiguous'),
    noCallInWindow: requiredCount(unresolved, 'no_call_in_window'),
    invalidPhone: requiredCount(unresolved, 'invalid_phone'),
    submitterNotFound: requiredCount(unresolved, 'submitter_not_found'),
    other: requiredCount(unresolved, 'other'),
  }
  const distinctExactAgents = requiredCount(overview, 'distinct_exact_agents')

  const ratingTotal = ratings.good + ratings.fair + ratings.poor + ratings.other
  const unresolvedTotal = unresolvedReasons.callAmbiguous + unresolvedReasons.noCallInWindow
    + unresolvedReasons.invalidPhone + unresolvedReasons.submitterNotFound + unresolvedReasons.other
  if (
    ratingTotal !== totalSubmissions
    || parsedCoverage.callAssociated + parsedCoverage.unresolved !== totalSubmissions
    || parsedCoverage.exactAgentAttributed + parsedCoverage.agentUnavailable !== parsedCoverage.callAssociated
    || unresolvedTotal !== parsedCoverage.unresolved
    || Object.values(parsedFlags).some(count => count > totalSubmissions)
    || (totalSubmissions === 0 && (firstSubmittedAt !== null || lastSubmittedAt !== null))
    || (totalSubmissions > 0 && (firstSubmittedAt === null || lastSubmittedAt === null))
  ) {
    throw new Error('invalid_achieve_feedback_response')
  }

  return {
    generatedAt: requiredTimestamp(overview, 'generated_at'),
    scope: { firstSubmittedAt, lastSubmittedAt, totalSubmissions },
    ratings,
    flags: parsedFlags,
    coverage: parsedCoverage,
    unresolvedReasons,
    distinctExactAgents,
  }
}

function parseRepresentative(value: unknown): AchieveRepresentativeFeedback {
  const row = recordValue(value)
  const totalSubmissions = requiredCount(row, 'total_submissions')
  if (totalSubmissions === 0) throw new Error('invalid_achieve_feedback_response')
  const ratings: AchieveFeedbackRatings = {
    good: requiredCount(row, 'good'),
    fair: requiredCount(row, 'fair'),
    poor: requiredCount(row, 'poor'),
    other: requiredCount(row, 'other'),
  }
  const flags = {
    accent: requiredCount(row, 'accent'),
    backgroundNoise: requiredCount(row, 'background_noise'),
    connectionIssues: requiredCount(row, 'connection_issues'),
  }
  if (
    ratings.good + ratings.fair + ratings.poor + ratings.other !== totalSubmissions
    || Object.values(flags).some(count => count > totalSubmissions)
  ) {
    throw new Error('invalid_achieve_feedback_response')
  }
  const fairPoorCount = ratings.fair + ratings.poor
  return {
    agentName: requiredString(row, 'achieve_agent_name'),
    agentEmail: requiredString(row, 'achieve_agent_email').toLowerCase(),
    totalSubmissions,
    ratings,
    flags,
    latestSubmittedAt: requiredTimestamp(row, 'latest_submitted_at'),
    fairPoorCount,
    fairPoorRate: (fairPoorCount / totalSubmissions) * 100,
  }
}

function parseRepresentativeCoverage(value: unknown): AchieveRepresentativeCoverage {
  const coverage = recordValue(value)
  const total = requiredCount(coverage, 'total')
  const loaded = requiredCount(coverage, 'loaded')
  const limit = requiredCount(coverage, 'limit')
  const offset = requiredCount(coverage, 'offset')
  const capReached = coverage?.cap_reached
  if (
    typeof capReached !== 'boolean'
    || limit < 1
    || loaded > limit
    || offset + loaded > total
    || capReached !== (offset + loaded < total)
  ) {
    throw new Error('invalid_achieve_feedback_response')
  }
  return { total, loaded, limit, offset, capReached }
}

/**
 * Parse and cross-check the complete leadership response before UI code sees
 * it. Contradictory counts fail atomically so the dashboard never shows a
 * plausible-looking partial denominator.
 */
export function parseAchieveFeedbackDashboard(value: unknown): AchieveFeedbackDashboard {
  const response = recordValue(value)
  const representativePayload = recordValue(response?.representatives)
  if (!response || !representativePayload || !Array.isArray(representativePayload.rows)) {
    throw new Error('invalid_achieve_feedback_response')
  }

  const overview = parseOverview(response.overview)
  const representatives = representativePayload.rows.map(parseRepresentative)
  const representativeCoverage = parseRepresentativeCoverage(representativePayload.coverage)
  const uniqueEmails = new Set(representatives.map(representative => representative.agentEmail))
  if (
    representatives.length !== representativeCoverage.loaded
    || uniqueEmails.size !== representatives.length
    || representativeCoverage.total !== overview.distinctExactAgents
  ) {
    throw new Error('invalid_achieve_feedback_response')
  }

  if (!representativeCoverage.capReached && representativeCoverage.offset === 0) {
    const attributedSubmissions = representatives.reduce(
      (total, representative) => total + representative.totalSubmissions,
      0,
    )
    if (attributedSubmissions !== overview.coverage.exactAgentAttributed) {
      throw new Error('invalid_achieve_feedback_response')
    }
  }

  return { overview, representatives, representativeCoverage }
}

/** Return the proposed sample-aware meeting-triage status for one representative. */
export function achieveRepresentativeReviewStatus(
  representative: AchieveRepresentativeFeedback,
): AchieveRepresentativeReviewStatus {
  if (representative.totalSubmissions < REVIEW_MINIMUM_SAMPLE) return 'low_sample'
  return representative.fairPoorRate >= REVIEW_FAIR_POOR_RATE ? 'needs_review' : 'below_threshold'
}

/** Search exact representative rollups and optionally require the five-submission sample floor. */
export function filterAchieveRepresentatives(
  representatives: ReadonlyArray<AchieveRepresentativeFeedback>,
  search: string,
  minimumSampleOnly: boolean,
): AchieveRepresentativeFeedback[] {
  const normalizedSearch = search.trim().toLowerCase()
  return representatives.filter(representative => {
    if (minimumSampleOnly && representative.totalSubmissions < REVIEW_MINIMUM_SAMPLE) return false
    if (!normalizedSearch) return true
    return representative.agentName.toLowerCase().includes(normalizedSearch)
      || representative.agentEmail.includes(normalizedSearch)
  })
}
