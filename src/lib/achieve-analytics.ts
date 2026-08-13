import { deriveChecklist } from './achieve-checklist'
import { parseTransferExperience } from './achieve-transfer-experience'

/** Rating categories reported by Pennie agents for matched calls. */
export type AchieveAgentRating = 'Good' | 'Fair' | 'Poor' | 'Other'

/** Feedback-backed filters available on the Achieve leadership workbench. */
export type AchieveAnalyticsFilters = {
  readonly accent: boolean
  readonly backgroundNoise: boolean
  readonly connectionIssue: boolean
  readonly rating: AchieveAgentRating | null
}

/** The filter state used when no feedback-backed constraints are active. */
export const EMPTY_ACHIEVE_FILTERS: AchieveAnalyticsFilters = {
  accent: false,
  backgroundNoise: false,
  connectionIssue: false,
  rating: null,
}

/** Minimal boundary shape consumed from the external portal payload. */
export type AchieveAnalyticsRow = {
  readonly alert_created_at?: unknown
  readonly has_violation?: unknown
  readonly is_reviewed?: unknown
  readonly result_json?: unknown
  readonly agent_feedback?: unknown
}

/** One UTC trend bucket with separate AI QA and Pennie-agent series values. */
export type AchieveTrendBucket = {
  readonly key: string
  readonly label: string
  readonly ai: {
    readonly scoredCalls: number
    readonly passedCalls: number
    readonly flaggedCalls: number
  }
  readonly agent: {
    readonly matchedCalls: number
    readonly ratings: Readonly<Record<AchieveAgentRating, number>>
  }
}

/** Stable UTC trend output for the available dated rows. */
export type AchieveTrends = {
  readonly granularity: 'day' | 'week'
  readonly timeZone: 'UTC'
  readonly buckets: ReadonlyArray<AchieveTrendBucket>
}

/** Aggregate counts for available recent/loaded Achieve calls. */
export type AchieveAnalyticsSummary = {
  readonly loadedCalls: number
  readonly ai: {
    readonly scoredCalls: number
    readonly notGradedCalls: number
    readonly passedCalls: number
    readonly flaggedCalls: number
    readonly passRate: number | null
    readonly scriptIssueCalls: number
    readonly poorTransferCalls: number
    readonly missedElements: ReadonlyArray<{ readonly key: string; readonly label: string; readonly count: number }>
  }
  readonly agent: {
    readonly matchedCalls: number
    readonly submissions: number
    readonly ratings: Readonly<Record<AchieveAgentRating, number>>
    readonly flags: {
      readonly accent: number
      readonly backgroundNoise: number
      readonly connectionIssue: number
    }
  }
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  // SAFETY: the runtime object/array/null checks establish the only Record
  // invariant used below; every individual field is still parsed from unknown.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function resultFor(row: AchieveAnalyticsRow): Readonly<Record<string, unknown>> {
  return recordValue(row.result_json) ?? {}
}

function feedbackFor(row: AchieveAnalyticsRow): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!Array.isArray(row.agent_feedback)) return []
  return row.agent_feedback.flatMap(value => {
    const feedback = recordValue(value)
    return feedback === null ? [] : [feedback]
  })
}

/** Normalize free-text Pennie agent call-quality values into reporting categories. */
export function normalizeAchieveAgentRating(value: unknown): AchieveAgentRating {
  if (typeof value !== 'string') return 'Other'
  switch (value.trim().toLowerCase()) {
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair'
    case 'poor':
      return 'Poor'
    default:
      return 'Other'
  }
}

/** Return one call-level rating, using the worst recognized matched submission. */
export function worstAchieveAgentRating(feedback: ReadonlyArray<unknown>): AchieveAgentRating | null {
  const parsed = feedback.flatMap(value => {
    const item = recordValue(value)
    return item === null ? [] : [item]
  })
  if (parsed.length === 0) return null

  const rank: Readonly<Record<AchieveAgentRating, number>> = { Poor: 0, Fair: 1, Good: 2, Other: 3 }
  let worst: AchieveAgentRating = 'Other'
  for (const item of parsed) {
    const rating = normalizeAchieveAgentRating(item.call_quality)
    if (rank[rating] < rank[worst]) worst = rating
  }
  return worst
}

/** Filter calls only by observations in feedback matched to those calls. */
export function filterAchieveRows<Row extends AchieveAnalyticsRow>(
  rows: ReadonlyArray<Row>,
  filters: AchieveAnalyticsFilters,
): Row[] {
  const hasActiveFilter = filters.accent || filters.backgroundNoise || filters.connectionIssue || filters.rating !== null
  if (!hasActiveFilter) return rows.slice()

  return rows.filter(row => {
    const feedback = feedbackFor(row)
    if (feedback.length === 0) return false
    if (filters.accent && !feedback.some(item => item.accent === true)) return false
    if (filters.backgroundNoise && !feedback.some(item => item.background_noise === true)) return false
    if (filters.connectionIssue && !feedback.some(item => item.connection_issues === true)) return false
    if (filters.rating !== null && worstAchieveAgentRating(feedback) !== filters.rating) return false
    return true
  })
}

/** Whether a portal row has a trustworthy AI QA pass/fail result. */
export function isScoredAchieveRow(row: AchieveAnalyticsRow): boolean {
  const result = resultFor(row)
  const segment = recordValue(result.transcript_segment)
  return row.has_violation !== undefined
    && typeof row.has_violation === 'boolean'
    && result.grading_skipped !== true
    && segment?.used_full_transcript_fallback !== true
}

const DAY_MS = 24 * 60 * 60 * 1_000
const DAILY_SPAN_LIMIT_MS = 42 * DAY_MS
const utcDateLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function datedRows<Row extends AchieveAnalyticsRow>(rows: ReadonlyArray<Row>): Array<{ row: Row; timestamp: number }> {
  return rows.flatMap(row => {
    if (typeof row.alert_created_at !== 'string') return []
    const timestamp = Date.parse(row.alert_created_at)
    return Number.isFinite(timestamp) ? [{ row, timestamp }] : []
  })
}

function bucketStart(timestamp: number, granularity: 'day' | 'week'): number {
  const date = new Date(timestamp)
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  if (granularity === 'day') return dayStart
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  return dayStart - daysSinceMonday * DAY_MS
}

function utcDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Build daily trends for shorter loaded spans and Monday-based weekly trends
 * for longer spans. UTC keeps bucket membership stable for external viewers.
 */
export function buildAchieveTrends(rows: ReadonlyArray<AchieveAnalyticsRow>): AchieveTrends {
  const dated = datedRows(rows)
  if (dated.length === 0) return { granularity: 'day', timeZone: 'UTC', buckets: [] }

  const timestamps = dated.map(item => item.timestamp)
  const minimum = Math.min(...timestamps)
  const maximum = Math.max(...timestamps)
  const granularity = maximum - minimum <= DAILY_SPAN_LIMIT_MS ? 'day' : 'week'
  const firstBucket = bucketStart(minimum, granularity)
  const lastBucket = bucketStart(maximum, granularity)
  const step = granularity === 'day' ? DAY_MS : 7 * DAY_MS
  const rowsByBucket = new Map<number, AchieveAnalyticsRow[]>()

  for (const item of dated) {
    const start = bucketStart(item.timestamp, granularity)
    const bucket = rowsByBucket.get(start)
    if (bucket) bucket.push(item.row)
    else rowsByBucket.set(start, [item.row])
  }

  const buckets: AchieveTrendBucket[] = []
  for (let start = firstBucket; start <= lastBucket; start += step) {
    const summary = summarizeAchieveAnalytics(rowsByBucket.get(start) ?? [])
    const dateLabel = utcDateLabel.format(new Date(start))
    buckets.push({
      key: utcDateKey(start),
      label: granularity === 'day' ? dateLabel : `Week of ${dateLabel}`,
      ai: {
        scoredCalls: summary.ai.scoredCalls,
        passedCalls: summary.ai.passedCalls,
        flaggedCalls: summary.ai.flaggedCalls,
      },
      agent: {
        matchedCalls: summary.agent.matchedCalls,
        ratings: summary.agent.ratings,
      },
    })
  }

  return { granularity, timeZone: 'UTC', buckets }
}

/** Summarize the available recent/loaded rows without performing I/O. */
export function summarizeAchieveAnalytics(rows: ReadonlyArray<AchieveAnalyticsRow>): AchieveAnalyticsSummary {
  let scoredCalls = 0
  let passedCalls = 0
  let flaggedCalls = 0
  let scriptIssueCalls = 0
  let poorTransferCalls = 0
  let matchedCalls = 0
  let submissions = 0
  const ratings: Record<AchieveAgentRating, number> = { Good: 0, Fair: 0, Poor: 0, Other: 0 }
  const flags = { accent: 0, backgroundNoise: 0, connectionIssue: 0 }
  const missedElements = new Map<string, { key: string; label: string; count: number }>()

  for (const row of rows) {
    const feedback = feedbackFor(row)
    if (feedback.length > 0) {
      matchedCalls += 1
      submissions += feedback.length
      const rating = worstAchieveAgentRating(feedback)
      if (rating !== null) ratings[rating] += 1
      if (feedback.some(item => item.accent === true)) flags.accent += 1
      if (feedback.some(item => item.background_noise === true)) flags.backgroundNoise += 1
      if (feedback.some(item => item.connection_issues === true)) flags.connectionIssue += 1
    }

    if (!isScoredAchieveRow(row)) continue
    scoredCalls += 1
    if (row.has_violation === true) flaggedCalls += 1
    else passedCalls += 1

    const result = resultFor(row)
    const adherence = recordValue(result.script_adherence)
    const scriptVersion = typeof result.script_version === 'string' ? result.script_version : undefined
    const checklist = deriveChecklist(adherence ?? undefined, scriptVersion)
    const missing = checklist.rows.filter(item => !item.isCovered)
    const isScriptIssue = row.has_violation === true
      && (adherence?.violation === true || missing.length > 0)
    if (isScriptIssue) {
      scriptIssueCalls += 1
      for (const item of missing) {
        const existing = missedElements.get(item.key)
        if (existing) existing.count += 1
        else missedElements.set(item.key, { key: item.key, label: item.label, count: 1 })
      }
    }

    if (parseTransferExperience(result.transfer_experience)?.poorTransfer === true) {
      poorTransferCalls += 1
    }
  }

  return {
    loadedCalls: rows.length,
    ai: {
      scoredCalls,
      notGradedCalls: rows.length - scoredCalls,
      passedCalls,
      flaggedCalls,
      passRate: scoredCalls === 0 ? null : (passedCalls / scoredCalls) * 100,
      scriptIssueCalls,
      poorTransferCalls,
      missedElements: Array.from(missedElements.values()).sort((left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
      ),
    },
    agent: { matchedCalls, submissions, ratings, flags },
  }
}
