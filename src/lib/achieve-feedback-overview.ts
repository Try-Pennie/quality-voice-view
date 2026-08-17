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

/** Coverage of Form call association and exact representative attribution. */
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

/** Ordinary AI QA coverage, with attribution gaps kept in its own denominator. */
export type AchieveAiCoverage = {
  readonly allGraded: number
  readonly exactAgentAttributed: number
  readonly agentUnavailable: number
}

/** Exactly attributed ordinary AI QA outcomes. */
export type AchieveAiOutcomes = {
  readonly pass: number
  readonly flagged: number
}

/** Call-level human/AI comparison after excluding Other-only Form feedback. */
export type AchieveFeedbackAlignment = {
  readonly overlapCalls: number
  readonly bothClear: number
  readonly bothConcern: number
  readonly humanOnly: number
  readonly aiOnly: number
}

/** Global ordinary AI QA metrics. */
export type AchieveAiOverview = {
  readonly coverage: AchieveAiCoverage
  readonly outcomes: AchieveAiOutcomes
  readonly alignment: AchieveFeedbackAlignment
  readonly distinctExactAgents: number
}

/** Complete Form and AI aggregate for the WC Agent Summary. */
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
  readonly distinctAnyAgents: number
  readonly qa: AchieveAiOverview
}

/** Form and AI rollup for one exactly attributed Achieve representative. */
export type AchieveRepresentativeFeedback = {
  readonly agentName: string
  readonly agentEmail: string
  readonly totalSubmissions: number
  readonly ratings: AchieveFeedbackRatings
  readonly flags: Omit<AchieveFeedbackFlags, 'withNotes'>
  readonly latestSubmittedAt: string | null
  readonly fairPoorCount: number
  readonly fairPoorRate: number
  readonly ai: AchieveAiOutcomes & {
    readonly total: number
    readonly latestGradedAt: string | null
  }
  readonly alignment: AchieveFeedbackAlignment
}

/** Coverage metadata for a bounded representative or detail list. */
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

/** Closed rating values for one individual Pennie Form submission. */
export type AchieveRepresentativeFeedbackRating = 'good' | 'fair' | 'poor' | 'other'

/** Sanitized individual Form submission attributed to one exact representative. */
export type AchieveRepresentativeFeedbackDetail = {
  readonly id: number
  readonly submittedAt: string
  readonly rating: AchieveRepresentativeFeedbackRating
  readonly flags: {
    readonly accent: boolean
    readonly backgroundNoise: boolean
    readonly connectionIssues: boolean
  }
  readonly notes: string | null
  readonly submittedBy: string | null
}

/** Lightweight ordinary QA call summary; detail is loaded separately by result ID. */
export type AchieveRepresentativeQaSummary = {
  readonly moduleResultId: number
  readonly gradedAt: string
  readonly outcome: 'pass' | 'flagged'
}

/** Bounded Form notes and AI call summaries returned by the authenticated boundary. */
export type AchieveRepresentativeFeedbackDetails = {
  readonly rows: ReadonlyArray<AchieveRepresentativeFeedbackDetail>
  readonly coverage: AchieveRepresentativeCoverage
  readonly qaRows: ReadonlyArray<AchieveRepresentativeQaSummary>
  readonly qaCoverage: AchieveRepresentativeCoverage
}

/** Sample-aware Form review state; AI never changes this triage status. */
export type AchieveRepresentativeReviewStatus = 'needs_review' | 'below_threshold' | 'low_sample'

const REVIEW_MINIMUM_SAMPLE = 5
const REVIEW_FAIR_POOR_RATE = 25
const INVALID_RESPONSE = 'invalid_achieve_feedback_response'

type BoundaryRecord = Readonly<Record<string, unknown>>

function recordValue(value: unknown): BoundaryRecord | null {
  // SAFETY: The object/array/null checks establish the indexable-record
  // invariant. Every boundary field is parsed separately below.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as BoundaryRecord
    : null
}

function invalidResponse(): never {
  throw new Error(INVALID_RESPONSE)
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function requiredCount(record: BoundaryRecord | null, key: string): number {
  return nonNegativeInteger(record?.[key]) ?? invalidResponse()
}

function requiredString(record: BoundaryRecord | null, key: string): string {
  const value = record?.[key]
  if (typeof value !== 'string' || value.trim().length === 0) invalidResponse()
  return value
}

function requiredTimestamp(record: BoundaryRecord | null, key: string): string {
  const value = requiredString(record, key)
  if (!Number.isFinite(Date.parse(value))) invalidResponse()
  return value
}

function nullableTimestamp(record: BoundaryRecord | null, key: string): string | null {
  const value = record?.[key]
  if (value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalidResponse()
  return value
}

function nullableNonEmptyString(record: BoundaryRecord | null, key: string): string | null {
  const value = record?.[key]
  if (value === null) return null
  if (typeof value !== 'string' || value.trim().length === 0) invalidResponse()
  return value
}

function requiredBoolean(record: BoundaryRecord | null, key: string): boolean {
  const value = record?.[key]
  if (typeof value !== 'boolean') invalidResponse()
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

function parseAlignment(value: unknown): AchieveFeedbackAlignment {
  const alignment = recordValue(value)
  const parsed = {
    overlapCalls: requiredCount(alignment, 'overlap_calls'),
    bothClear: requiredCount(alignment, 'both_clear'),
    bothConcern: requiredCount(alignment, 'both_concern'),
    humanOnly: requiredCount(alignment, 'human_only'),
    aiOnly: requiredCount(alignment, 'ai_only'),
  }
  if (parsed.bothClear + parsed.bothConcern + parsed.humanOnly + parsed.aiOnly !== parsed.overlapCalls) {
    invalidResponse()
  }
  return parsed
}

function parseOverview(value: unknown): AchieveFeedbackOverview {
  const overview = recordValue(value)
  const scope = recordValue(overview?.scope)
  const flags = recordValue(overview?.flags)
  const coverage = recordValue(overview?.coverage)
  const unresolved = recordValue(overview?.unresolved_reasons)
  const qa = recordValue(overview?.qa)
  const qaCoverage = recordValue(qa?.coverage)
  const qaOutcomes = recordValue(qa?.outcomes)
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
  const aiCoverage: AchieveAiCoverage = {
    allGraded: requiredCount(qaCoverage, 'all_graded'),
    exactAgentAttributed: requiredCount(qaCoverage, 'exact_agent_attributed'),
    agentUnavailable: requiredCount(qaCoverage, 'agent_unavailable'),
  }
  const outcomes: AchieveAiOutcomes = {
    pass: requiredCount(qaOutcomes, 'pass'),
    flagged: requiredCount(qaOutcomes, 'flagged'),
  }
  const alignment = parseAlignment(qa?.alignment)
  const distinctExactAgents = requiredCount(overview, 'distinct_exact_agents')
  const distinctAnyAgents = requiredCount(overview, 'distinct_any_agents')
  const distinctAiAgents = requiredCount(qa, 'distinct_exact_agents')

  const unresolvedTotal = Object.values(unresolvedReasons).reduce((total, count) => total + count, 0)
  if (
    Object.values(ratings).reduce((total, count) => total + count, 0) !== totalSubmissions
    || parsedCoverage.callAssociated + parsedCoverage.unresolved !== totalSubmissions
    || parsedCoverage.exactAgentAttributed + parsedCoverage.agentUnavailable !== parsedCoverage.callAssociated
    || unresolvedTotal !== parsedCoverage.unresolved
    || Object.values(parsedFlags).some(count => count > totalSubmissions)
    || aiCoverage.exactAgentAttributed + aiCoverage.agentUnavailable !== aiCoverage.allGraded
    || outcomes.pass + outcomes.flagged !== aiCoverage.exactAgentAttributed
    || alignment.overlapCalls > aiCoverage.exactAgentAttributed
    || distinctExactAgents > parsedCoverage.exactAgentAttributed
    || distinctAiAgents > aiCoverage.exactAgentAttributed
    || distinctAnyAgents < Math.max(distinctExactAgents, distinctAiAgents)
    || distinctAnyAgents > distinctExactAgents + distinctAiAgents
    || (totalSubmissions === 0 && (firstSubmittedAt !== null || lastSubmittedAt !== null))
    || (totalSubmissions > 0 && (firstSubmittedAt === null || lastSubmittedAt === null))
  ) invalidResponse()

  return {
    generatedAt: requiredTimestamp(overview, 'generated_at'),
    scope: { firstSubmittedAt, lastSubmittedAt, totalSubmissions },
    ratings,
    flags: parsedFlags,
    coverage: parsedCoverage,
    unresolvedReasons,
    distinctExactAgents,
    distinctAnyAgents,
    qa: { coverage: aiCoverage, outcomes, alignment, distinctExactAgents: distinctAiAgents },
  }
}

function parseRepresentative(value: unknown): AchieveRepresentativeFeedback {
  const row = recordValue(value)
  const totalSubmissions = requiredCount(row, 'total_submissions')
  const ratings = parseRatings({
    good: row?.good,
    fair: row?.fair,
    poor: row?.poor,
    other: row?.other,
  })
  const flags = {
    accent: requiredCount(row, 'accent'),
    backgroundNoise: requiredCount(row, 'background_noise'),
    connectionIssues: requiredCount(row, 'connection_issues'),
  }
  const latestSubmittedAt = nullableTimestamp(row, 'latest_submitted_at')
  const ai = {
    total: requiredCount(row, 'ai_total'),
    pass: requiredCount(row, 'ai_pass'),
    flagged: requiredCount(row, 'ai_flagged'),
    latestGradedAt: nullableTimestamp(row, 'latest_ai_graded_at'),
  }
  const alignment = parseAlignment(row)
  if (
    Object.values(ratings).reduce((total, count) => total + count, 0) !== totalSubmissions
    || Object.values(flags).some(count => count > totalSubmissions)
    || ai.pass + ai.flagged !== ai.total
    || totalSubmissions + ai.total === 0
    || alignment.overlapCalls > totalSubmissions
    || alignment.overlapCalls > ai.total
    || (totalSubmissions === 0) !== (latestSubmittedAt === null)
    || (ai.total === 0) !== (ai.latestGradedAt === null)
  ) invalidResponse()

  const fairPoorCount = ratings.fair + ratings.poor
  return {
    agentName: requiredString(row, 'achieve_agent_name'),
    agentEmail: requiredString(row, 'achieve_agent_email').toLowerCase(),
    totalSubmissions,
    ratings,
    flags,
    latestSubmittedAt,
    fairPoorCount,
    fairPoorRate: totalSubmissions === 0 ? 0 : (fairPoorCount / totalSubmissions) * 100,
    ai,
    alignment,
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
  ) invalidResponse()
  return { total, loaded, limit, offset, capReached }
}

/** Parse and reconcile the complete Form + AI leadership response. */
export function parseAchieveFeedbackDashboard(value: unknown): AchieveFeedbackDashboard {
  const response = recordValue(value)
  const representativePayload = recordValue(response?.representatives)
  if (!response || !representativePayload || !Array.isArray(representativePayload.rows)) invalidResponse()

  const overview = parseOverview(response.overview)
  const representatives = representativePayload.rows.map(parseRepresentative)
  const representativeCoverage = parseRepresentativeCoverage(representativePayload.coverage)
  const uniqueEmails = new Set(representatives.map(representative => representative.agentEmail))
  if (
    representatives.length !== representativeCoverage.loaded
    || uniqueEmails.size !== representatives.length
    || representativeCoverage.total !== overview.distinctAnyAgents
  ) invalidResponse()

  if (!representativeCoverage.capReached && representativeCoverage.offset === 0) {
    const formEmails = new Set(representatives.filter(row => row.totalSubmissions > 0).map(row => row.agentEmail))
    const aiEmails = new Set(representatives.filter(row => row.ai.total > 0).map(row => row.agentEmail))
    const formTotal = representatives.reduce((total, row) => total + row.totalSubmissions, 0)
    const aiTotal = representatives.reduce((total, row) => total + row.ai.total, 0)
    const aiPass = representatives.reduce((total, row) => total + row.ai.pass, 0)
    const aiFlagged = representatives.reduce((total, row) => total + row.ai.flagged, 0)
    const alignment = representatives.reduce<AchieveFeedbackAlignment>((total, row) => ({
      overlapCalls: total.overlapCalls + row.alignment.overlapCalls,
      bothClear: total.bothClear + row.alignment.bothClear,
      bothConcern: total.bothConcern + row.alignment.bothConcern,
      humanOnly: total.humanOnly + row.alignment.humanOnly,
      aiOnly: total.aiOnly + row.alignment.aiOnly,
    }), { overlapCalls: 0, bothClear: 0, bothConcern: 0, humanOnly: 0, aiOnly: 0 })
    if (
      formTotal !== overview.coverage.exactAgentAttributed
      || aiTotal !== overview.qa.coverage.exactAgentAttributed
      || aiPass !== overview.qa.outcomes.pass
      || aiFlagged !== overview.qa.outcomes.flagged
      || formEmails.size !== overview.distinctExactAgents
      || aiEmails.size !== overview.qa.distinctExactAgents
      || uniqueEmails.size !== overview.distinctAnyAgents
      || Object.keys(alignment).some(key => alignment[key as keyof AchieveFeedbackAlignment] !== overview.qa.alignment[key as keyof AchieveFeedbackAlignment])
    ) invalidResponse()
  }

  return { overview, representatives, representativeCoverage }
}

function parseRepresentativeFeedbackDetail(value: unknown): AchieveRepresentativeFeedbackDetail {
  const row = recordValue(value)
  const id = requiredCount(row, 'feedback_id')
  const rating = row?.rating
  if (id < 1 || (rating !== 'good' && rating !== 'fair' && rating !== 'poor' && rating !== 'other')) invalidResponse()
  return {
    id,
    submittedAt: requiredTimestamp(row, 'submitted_at'),
    rating,
    flags: {
      accent: requiredBoolean(row, 'accent'),
      backgroundNoise: requiredBoolean(row, 'background_noise'),
      connectionIssues: requiredBoolean(row, 'connection_issues'),
    },
    notes: nullableNonEmptyString(row, 'notes'),
    submittedBy: nullableNonEmptyString(row, 'submitted_by'),
  }
}

function parseRepresentativeQaSummary(value: unknown): AchieveRepresentativeQaSummary {
  const row = recordValue(value)
  const moduleResultId = requiredCount(row, 'module_result_id')
  const outcome = row?.outcome
  if (moduleResultId < 1 || (outcome !== 'pass' && outcome !== 'flagged')) invalidResponse()
  return { moduleResultId, gradedAt: requiredTimestamp(row, 'graded_at'), outcome }
}

/** Parse one representative's bounded Form notes and ordinary QA summaries. */
export function parseAchieveRepresentativeFeedbackDetails(value: unknown): AchieveRepresentativeFeedbackDetails {
  const response = recordValue(value)
  if (!response || !Array.isArray(response.rows) || !Array.isArray(response.qa_rows)) invalidResponse()
  const rows = response.rows.map(parseRepresentativeFeedbackDetail)
  const qaRows = response.qa_rows.map(parseRepresentativeQaSummary)
  const coverage = parseRepresentativeCoverage(response.coverage)
  const qaCoverage = parseRepresentativeCoverage(response.qa_coverage)
  if (
    rows.length !== coverage.loaded
    || new Set(rows.map(row => row.id)).size !== rows.length
    || qaRows.length !== qaCoverage.loaded
    || new Set(qaRows.map(row => row.moduleResultId)).size !== qaRows.length
  ) invalidResponse()
  return { rows, coverage, qaRows, qaCoverage }
}

/** Return the Form-only sample-aware meeting-triage status. */
export function achieveRepresentativeReviewStatus(
  representative: AchieveRepresentativeFeedback,
): AchieveRepresentativeReviewStatus {
  if (representative.totalSubmissions < REVIEW_MINIMUM_SAMPLE) return 'low_sample'
  return representative.fairPoorRate >= REVIEW_FAIR_POOR_RATE ? 'needs_review' : 'below_threshold'
}

const CSV_REVIEW_STATUS: Readonly<Record<AchieveRepresentativeReviewStatus, string>> = {
  needs_review: 'Form review',
  below_threshold: 'Below Form threshold',
  low_sample: 'Low Form sample',
}

const REPRESENTATIVE_CSV_HEADERS = [
  'Representative', 'Email', 'Latest activity (UTC)', 'Form review status',
  'Form sample', 'Form good', 'Form fair', 'Form poor', 'Form other', 'Form Fair/Poor count', 'Form Fair/Poor rate',
  'Background noise', 'Accent / communication', 'Connection issue',
  'AI QA sample', 'AI QA pass', 'AI QA flagged',
  'Overlap calls', 'Both clear', 'Both concern', 'Human only', 'AI only',
] as const

function csvCell(value: string | number): string {
  const text = String(value)
  const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

/** Serialize the displayed representative rollups without exposing call identifiers. */
export function achieveRepresentativesCsv(
  representatives: ReadonlyArray<AchieveRepresentativeFeedback>,
): string {
  const rows = representatives.map(representative => {
    const latestActivity = [representative.latestSubmittedAt, representative.ai.latestGradedAt]
      .filter((timestamp): timestamp is string => timestamp !== null)
      .reduce<string | null>((latest, timestamp) => (
        latest === null || Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest
      ), null)
    return [
      representative.agentName,
      representative.agentEmail,
      latestActivity ?? '',
      CSV_REVIEW_STATUS[achieveRepresentativeReviewStatus(representative)],
      representative.totalSubmissions,
      representative.ratings.good,
      representative.ratings.fair,
      representative.ratings.poor,
      representative.ratings.other,
      representative.fairPoorCount,
      `${representative.fairPoorRate.toFixed(1)}%`,
      representative.flags.backgroundNoise,
      representative.flags.accent,
      representative.flags.connectionIssues,
      representative.ai.total,
      representative.ai.pass,
      representative.ai.flagged,
      representative.alignment.overlapCalls,
      representative.alignment.bothClear,
      representative.alignment.bothConcern,
      representative.alignment.humanOnly,
      representative.alignment.aiOnly,
    ]
  })
  return `\uFEFF${[REPRESENTATIVE_CSV_HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** Search exact representative rollups and optionally require five Form submissions. */
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
