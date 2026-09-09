import type { AlertWithFeedback } from '../types/database'
import { ymdInBusinessTZ } from './time-zone'

/** Thirty Eastern calendar days including today, encoded for the existing date picker. */
export function defaultAlertWindow(now: Date): { start: Date; end: Date } {
  const [y, m, d] = ymdInBusinessTZ(now).split('-').map(Number)
  return { start: new Date(y, m - 1, d - 29), end: new Date(y, m - 1, d, 23, 59, 59, 999) }
}

/** Views over the scoped alerts in the selected date window. */
export const ALERT_QUEUE_VIEWS = {
  new: 'New',
  overdue: 'Overdue',
  follow_up: 'Follow-up',
  reviewed: 'Reviewed',
  all: 'All',
} as const

/** First-pass review, director sign-off, and coaching are separate lifecycles. */
export type AlertQueueView = keyof typeof ALERT_QUEUE_VIEWS

type ReviewState = Pick<AlertWithFeedback,
  'is_reviewed' | 'feedback_by' | 'acker_emails' | 'accurate' | 'action_taken' | 'alert_created_at'>

/** Parse an untrusted URL view; unknown values retain the existing New default. */
export function parseAlertQueueView(value: string | null): AlertQueueView {
  return value === 'overdue' || value === 'follow_up' || value === 'reviewed' || value === 'all'
    ? value : 'new'
}

/** Whether the current reviewer has personally signed off a structured review. */
export function isClosedForReviewer(alert: ReviewState, email: string | null | undefined): boolean {
  if (!alert.is_reviewed) return false
  if (!email) return true
  const lower = email.toLowerCase()
  return alert.feedback_by?.toLowerCase() === lower ||
    (alert.acker_emails ?? []).some(acker => acker.toLowerCase() === lower)
}

/** Deferred coaching remains outstanding even after a director approves the verdict. */
export function needsCoachingFollowUp(alert: ReviewState): boolean {
  return alert.is_reviewed && alert.accurate === true && alert.action_taken === 'follow_up_later'
}

/** The documented 24-hour target applies to the first structured manager review. */
export function isReviewOverdue(alert: ReviewState, now: number): boolean {
  const created = Date.parse(alert.alert_created_at)
  return !alert.is_reviewed && Number.isFinite(created) && now - created > 24 * 60 * 60 * 1000
}

/** Filter without changing the input order; that same order drives navigation. */
export function matchesAlertQueueView(
  alert: ReviewState,
  view: AlertQueueView,
  isGodMode: boolean,
  email: string | null | undefined,
  now: number,
): boolean {
  switch (view) {
    case 'overdue': return isReviewOverdue(alert, now)
    case 'follow_up': return needsCoachingFollowUp(alert)
    case 'new': return isGodMode ? !isClosedForReviewer(alert, email) : !alert.is_reviewed
    case 'reviewed': return isGodMode ? isClosedForReviewer(alert, email) : alert.is_reviewed
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
