import type { AlertWithFeedback } from '../types/database'
import { ymdInBusinessTZ } from './time-zone'

/** Thirty Eastern calendar days including today, encoded for the existing date picker. */
export function defaultAlertWindow(now: Date): { start: Date; end: Date } {
  const [y, m, d] = ymdInBusinessTZ(now).split('-').map(Number)
  return { start: new Date(y, m - 1, d - 29), end: new Date(y, m - 1, d, 23, 59, 59, 999) }
}

/** Explicit views over scoped alerts; outstanding can use the separate all-time lens. */
export const ALERT_QUEUE_VIEWS = {
  outstanding: 'All outstanding',
  awaiting_manager: 'Awaiting manager',
  awaiting_approval: 'Awaiting Kris’s approval',
  changes_requested: 'Changes requested by Kris',
  coaching_due: 'Coaching due',
  reviewed: 'Reviewed',
  all: 'All',
} as const

/** First-pass review, director sign-off, and coaching are separate dimensions. */
export type AlertQueueView = keyof typeof ALERT_QUEUE_VIEWS

type ReviewState = Pick<AlertWithFeedback,
  'is_reviewed' | 'feedback_by' | 'acker_emails' | 'accurate' | 'action_taken' |
  'alert_created_at' | 'current_decision'>

/** Review-work accounting at one sent `(call, module)` row per received alert. */
export type ReviewWorkloadCounts = {
  readonly received: number
  readonly reviewed: number
  readonly real: number
  readonly falseAlarm: number
  readonly awaitingManager: number
  /** Returned reviews overlap `reviewed`; they are not first-review backlog. */
  readonly changesRequested: number
  readonly systemClosed: number
}

/** Administrative launch cleanup is not human review or evidence of accuracy. */
export function isSystemClosed(alert: Pick<ReviewState, 'is_reviewed' | 'feedback_by'>): boolean {
  return alert.is_reviewed && alert.feedback_by?.trim().toLowerCase() === 'system@pennie'
}

/** A human review has a persisted real/false verdict and was not a system closure. */
export function isHumanReviewed(alert: Pick<ReviewState, 'is_reviewed' | 'feedback_by' | 'accurate'>): boolean {
  return alert.is_reviewed && !isSystemClosed(alert) && typeof alert.accurate === 'boolean'
}

/** Classify a complete fetched workload without mutating or dropping rows. */
export function summarizeReviewWorkload(alerts: readonly ReviewState[]): ReviewWorkloadCounts {
  let real = 0
  let falseAlarm = 0
  let awaitingManager = 0
  let changesRequested = 0
  let systemClosed = 0
  for (const alert of alerts) {
    if (isSystemClosed(alert)) systemClosed += 1
    else if (isHumanReviewed(alert)) {
      if (alert.current_decision === 'changes_requested') changesRequested += 1
      if (alert.accurate) real += 1
      else falseAlarm += 1
    } else awaitingManager += 1
  }
  return {
    received: alerts.length,
    reviewed: real + falseAlarm,
    real,
    falseAlarm,
    awaitingManager,
    changesRequested,
    systemClosed,
  }
}

/** Parse an untrusted URL view, retaining legacy links with clearer labels. */
export function parseAlertQueueView(value: string | null, isGodMode = false): AlertQueueView {
  switch (value) {
    case 'awaiting_approval':
      return isGodMode ? 'awaiting_approval' : 'awaiting_manager'
    case 'outstanding':
    case 'awaiting_manager':
    case 'changes_requested':
    case 'coaching_due':
    case 'reviewed':
    case 'all':
      return value
    case 'new':
      return isGodMode ? 'awaiting_approval' : 'awaiting_manager'
    case 'overdue':
      return 'awaiting_manager'
    case 'follow_up':
      return 'coaching_due'
    default:
      return isGodMode ? 'awaiting_approval' : 'awaiting_manager'
  }
}

/** Whether a review has authoritative approval; partner QA retains legacy personal acks. */
export function isClosedForReviewer(
  alert: ReviewState,
  email: string | null | undefined,
  workload: 'internal' | 'partner_qa' = 'internal',
): boolean {
  if (!isHumanReviewed(alert)) return false
  if (workload === 'internal') return alert.current_decision === 'approved'
  if (!email) return true
  const lower = email.toLowerCase()
  return alert.feedback_by?.toLowerCase() === lower ||
    (alert.acker_emails ?? []).some(acker => acker.toLowerCase() === lower)
}

/** Deferred coaching remains outstanding even after a director approves the verdict. */
export function needsCoachingFollowUp(alert: ReviewState): boolean {
  return isHumanReviewed(alert) && alert.accurate === true && alert.action_taken === 'follow_up_later'
}

/** Actionable work across first review, approval, correction, and deferred coaching. */
export function isOutstandingReviewWork(
  alert: ReviewState,
  isGodMode: boolean,
  email: string | null | undefined,
): boolean {
  if (isSystemClosed(alert)) return false
  if (!isHumanReviewed(alert)) return true
  if (alert.current_decision === 'changes_requested' || needsCoachingFollowUp(alert)) return true
  return isGodMode && !isClosedForReviewer(alert, email)
}

export const FIRST_REVIEW_AGES = {
  within_24h: 'Within 24h',
  hours_24_48: '24–48h',
  hours_48_72: '48–72h',
  over_72h: 'Over 72h',
  unknown: 'Age unknown',
} as const
export type FirstReviewAge = keyof typeof FIRST_REVIEW_AGES

export function parseFirstReviewAge(value: string | null): FirstReviewAge | null {
  switch (value) {
    case 'within_24h': case 'hours_24_48': case 'hours_48_72': case 'over_72h': case 'unknown': return value
    default: return null
  }
}

/** Non-overlapping elapsed-time buckets; exactly 24h still meets the existing target. */
export function firstReviewAgeBucket(alert: ReviewState, now: number): FirstReviewAge | null {
  if (isHumanReviewed(alert) || isSystemClosed(alert)) return null
  const age = now - Date.parse(alert.alert_created_at)
  if (!Number.isFinite(age) || age < 0) return 'unknown'
  if (age <= 24 * 3_600_000) return 'within_24h'
  if (age <= 48 * 3_600_000) return 'hours_24_48'
  if (age <= 72 * 3_600_000) return 'hours_48_72'
  return 'over_72h'
}

/** Only incomplete first reviews can miss the documented 24 elapsed-hour target. */
export function isReviewOverdue(alert: ReviewState, now: number): boolean {
  const bucket = firstReviewAgeBucket(alert, now)
  return bucket === 'hours_24_48' || bucket === 'hours_48_72' || bucket === 'over_72h'
}

/** Filter without changing input order; that same order drives navigation. */
export function matchesAlertQueueView(
  alert: ReviewState,
  view: AlertQueueView,
  isGodMode: boolean,
  email: string | null | undefined,
  _now: number,
  workload: 'internal' | 'partner_qa' = 'internal',
): boolean {
  switch (view) {
    case 'outstanding': return isOutstandingReviewWork(alert, isGodMode, email)
    case 'awaiting_manager': return !isHumanReviewed(alert) && !isSystemClosed(alert)
    case 'awaiting_approval': return isGodMode && isHumanReviewed(alert) &&
      alert.current_decision !== 'changes_requested' && !isClosedForReviewer(alert, email, workload)
    case 'changes_requested': return isHumanReviewed(alert) && alert.current_decision === 'changes_requested'
    case 'coaching_due': return needsCoachingFollowUp(alert)
    case 'reviewed': return isHumanReviewed(alert)
    case 'all': return true
  }
}

/** Elapsed age, not calendar-day subtraction (including across DST changes). */
export function reviewAgeLabel(createdAt: string, now: number): string {
  const hours = Math.floor((now - Date.parse(createdAt)) / 3_600_000)
  if (!Number.isFinite(hours) || hours < 0) return 'Age unavailable'
  if (hours < 1) return 'Less than 1h old'
  if (hours < 48) return `${hours}h old`
  return `${Math.floor(hours / 24)}d old`
}
