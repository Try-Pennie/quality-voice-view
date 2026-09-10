import type { AlertWithFeedback } from '../types/database'
import { ymdInBusinessTZ } from './time-zone'

/** Thirty Eastern calendar days including today, encoded for the existing date picker. */
export function defaultAlertWindow(now: Date): { start: Date; end: Date } {
  const [y, m, d] = ymdInBusinessTZ(now).split('-').map(Number)
  return { start: new Date(y, m - 1, d - 29), end: new Date(y, m - 1, d, 23, 59, 59, 999) }
}

/** Explicit views over the scoped alerts in the selected date window. */
export const ALERT_QUEUE_VIEWS = {
  awaiting_manager: 'Awaiting manager',
  awaiting_approval: 'Awaiting your approval',
  coaching_due: 'Coaching due',
  reviewed: 'Reviewed',
  all: 'All',
} as const

/** First-pass review, director sign-off, and coaching are separate dimensions. */
export type AlertQueueView = keyof typeof ALERT_QUEUE_VIEWS

type ReviewState = Pick<AlertWithFeedback,
  'is_reviewed' | 'feedback_by' | 'acker_emails' | 'accurate' | 'action_taken' | 'alert_created_at'>

/** Review-work accounting at one sent `(call, module)` row per received alert. */
export type ReviewWorkloadCounts = {
  readonly received: number
  readonly reviewed: number
  readonly real: number
  readonly falseAlarm: number
  readonly awaitingManager: number
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
  let systemClosed = 0
  for (const alert of alerts) {
    if (isSystemClosed(alert)) systemClosed += 1
    else if (isHumanReviewed(alert)) {
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
    systemClosed,
  }
}

/** Parse an untrusted URL view, retaining legacy links with clearer labels. */
export function parseAlertQueueView(value: string | null, isGodMode = false): AlertQueueView {
  switch (value) {
    case 'awaiting_manager':
    case 'awaiting_approval':
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

/** Whether the current reviewer has personally signed off a structured review. */
export function isClosedForReviewer(alert: ReviewState, email: string | null | undefined): boolean {
  if (!isHumanReviewed(alert)) return false
  if (!email) return true
  const lower = email.toLowerCase()
  return alert.feedback_by?.toLowerCase() === lower ||
    (alert.acker_emails ?? []).some(acker => acker.toLowerCase() === lower)
}

/** Deferred coaching remains outstanding even after a director approves the verdict. */
export function needsCoachingFollowUp(alert: ReviewState): boolean {
  return isHumanReviewed(alert) && alert.accurate === true && alert.action_taken === 'follow_up_later'
}

/** The documented 24-hour target applies to the first structured manager review. */
export function isReviewOverdue(alert: ReviewState, now: number): boolean {
  const created = Date.parse(alert.alert_created_at)
  return !alert.is_reviewed && Number.isFinite(created) && now - created > 24 * 60 * 60 * 1000
}

/** Filter without changing input order; that same order drives navigation. */
export function matchesAlertQueueView(
  alert: ReviewState,
  view: AlertQueueView,
  isGodMode: boolean,
  email: string | null | undefined,
  _now: number,
): boolean {
  switch (view) {
    case 'awaiting_manager': return !isHumanReviewed(alert) && !isSystemClosed(alert)
    case 'awaiting_approval': return isGodMode && isHumanReviewed(alert) && !isClosedForReviewer(alert, email)
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
