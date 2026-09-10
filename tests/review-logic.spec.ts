import { test, expect } from '@playwright/test'
import {
  ALERT_QUEUE_VIEWS, defaultAlertWindow, isClosedForReviewer, isReviewOverdue,
  matchesAlertQueueView, needsCoachingFollowUp, parseAlertQueueView,
  reviewAgeLabel, summarizeReviewWorkload,
} from '../src/lib/alert-review-queue'
import { extractEvidenceQuotes, findTranscriptRanges, parseTranscriptTurns } from '../src/lib/transcript-evidence'
import { formatDateParam } from '../src/lib/url-filters'
import { filterAlertWorkloadRows } from '../src/lib/suppressed-alerts'

const now = Date.parse('2026-09-07T16:00:00Z')
const open = {
  is_reviewed: false, feedback_by: null, acker_emails: [], accurate: null,
  action_taken: null, alert_created_at: '2026-09-06T15:59:59Z',
}

test('overdue uses elapsed 24h and only first-pass review, including DST', () => {
  expect(isReviewOverdue(open, now)).toBe(true)
  expect(isReviewOverdue({ ...open, alert_created_at: '2026-09-06T16:00:00Z' }, now)).toBe(false)
  expect(isReviewOverdue({ ...open, alert_created_at: '2026-09-08T16:00:00Z' }, now)).toBe(false)
  expect(isReviewOverdue({ ...open, alert_created_at: 'invalid' }, now)).toBe(false)
  expect(isReviewOverdue({ ...open, is_reviewed: true }, now)).toBe(false)
  expect(isReviewOverdue({ ...open, alert_created_at: '2026-03-07T17:00:00Z' }, Date.parse('2026-03-08T16:00:00Z'))).toBe(false)
  expect(isReviewOverdue({ ...open, alert_created_at: '2026-10-31T16:00:00Z' }, Date.parse('2026-11-01T17:00:00Z'))).toBe(true)
  expect(reviewAgeLabel('invalid', now)).toBe('Age unavailable')
  expect(reviewAgeLabel('2026-09-07T15:45:00Z', now)).toBe('Less than 1h old')
  expect(reviewAgeLabel('2026-09-04T16:00:00Z', now)).toBe('3d old')
})

test('manager review, director approval, coaching, and system closure stay distinct', () => {
  const deferred = { ...open, is_reviewed: true, accurate: true, action_taken: 'follow_up_later' as const, feedback_by: 'Manager@example.test' }
  expect(ALERT_QUEUE_VIEWS).toEqual({
    awaiting_manager: 'Awaiting manager',
    awaiting_approval: 'Awaiting your approval',
    coaching_due: 'Coaching due',
    reviewed: 'Reviewed',
    all: 'All',
  })
  expect(needsCoachingFollowUp(deferred)).toBe(true)
  expect(isClosedForReviewer(deferred, 'manager@EXAMPLE.test')).toBe(true)
  expect(matchesAlertQueueView(deferred, 'awaiting_approval', true, 'director@example.test', now)).toBe(true)
  expect(matchesAlertQueueView(deferred, 'awaiting_manager', true, 'director@example.test', now)).toBe(false)
  const approved = { ...deferred, acker_emails: ['DIRECTOR@example.test'] }
  expect(matchesAlertQueueView(approved, 'awaiting_approval', true, 'director@example.test', now)).toBe(false)
  expect(matchesAlertQueueView(approved, 'coaching_due', true, 'director@example.test', now)).toBe(true)
  expect(matchesAlertQueueView(deferred, 'reviewed', true, 'director@example.test', now)).toBe(true)
  expect(needsCoachingFollowUp({ ...deferred, accurate: false })).toBe(false)
  expect(needsCoachingFollowUp({ ...deferred, action_taken: 'coached' })).toBe(false)
  expect(needsCoachingFollowUp({ ...deferred, is_reviewed: false })).toBe(false)
  expect(matchesAlertQueueView(deferred, 'awaiting_approval', false, 'someone@example.test', now)).toBe(false)
  expect(matchesAlertQueueView(open, 'all', false, null, now)).toBe(true)
  expect(parseAlertQueueView('__proto__', false)).toBe('awaiting_manager')
  expect(parseAlertQueueView(null, true)).toBe('awaiting_approval')
  expect(parseAlertQueueView('follow_up', true)).toBe('coaching_due')
})

test('human outcomes reconcile while administrative closures remain separate', () => {
  const real = { ...open, is_reviewed: true, accurate: true, feedback_by: 'reviewer-a@example.test' }
  const falseAlarm = { ...open, is_reviewed: true, accurate: false, feedback_by: 'reviewer-b@example.test' }
  const systemClosed = { ...open, is_reviewed: true, accurate: true, feedback_by: 'system@pennie' }
  const counts = summarizeReviewWorkload([open, real, falseAlarm, systemClosed])
  expect(counts).toEqual({ received: 4, reviewed: 2, real: 1, falseAlarm: 1, awaitingManager: 1, systemClosed: 1 })
  expect(counts.received).toBe(counts.reviewed + counts.awaitingManager + counts.systemClosed)
  expect(counts.reviewed).toBe(counts.real + counts.falseAlarm)
  expect(matchesAlertQueueView(systemClosed, 'reviewed', true, 'director@example.test', now)).toBe(false)
})

test('internal and partner workloads remain separate even for god-mode viewers', () => {
  const rows = [
    { module_name: 'full_qa' },
    { module_name: 'gota_check' },
    { module_name: 'disposition_review' },
    { module_name: 'achieve_welcome_call_qa' },
  ]
  expect(filterAlertWorkloadRows(rows, { isGodMode: true }, 'internal').map(row => row.module_name)).toEqual(['full_qa', 'gota_check'])
  expect(filterAlertWorkloadRows(rows, { isGodMode: true }, 'partner_qa').map(row => row.module_name)).toEqual(['achieve_welcome_call_qa'])
  expect(filterAlertWorkloadRows(rows, { isGodMode: false }, 'partner_qa')).toEqual([])
})

test('default window is 30 inclusive Eastern calendar days, even when UTC date differs', () => {
  const window = defaultAlertWindow(new Date('2026-09-08T02:00:00Z'))
  expect(formatDateParam(window.start)).toBe('2026-08-09')
  expect(formatDateParam(window.end)).toBe('2026-09-07')
})

test('transcripts support both backend speaker formats without losing preambles', () => {
  const turns = ['[handling agent]: First sentence.', '[contact]: Reply.', '[handling agent]: More context.', '[contact]: Agreed.']
  expect(parseTranscriptTurns(turns.join('\n'))?.map(turn => turn.speaker)).toEqual(['handling agent', 'contact', 'handling agent', 'contact'])
  expect(parseTranscriptTurns('Agent: One\nCustomer: Two\nAgent: Three\nCustomer: Four')).toHaveLength(4)
  expect(parseTranscriptTurns('Important preamble\n' + turns.join('\n'))).toBeNull()
  expect(parseTranscriptTurns('Raw text: a single line')).toBeNull()
})

test('search is literal, whitespace tolerant and preserves source offsets', () => {
  const text = 'First quote\nwith  spacing. FIRST QUOTE with spacing. Fee is $5.00 (today)?'
  const ranges = findTranscriptRanges(text, ['first quote with spacing.'])
  expect(ranges.map(range => text.slice(range.start, range.end))).toEqual(['First quote\nwith  spacing.', 'FIRST QUOTE with spacing.'])
  const literal = findTranscriptRanges(text, ['$5.00 (today)?'])
  expect(literal.map(range => text.slice(range.start, range.end))).toEqual(['$5.00 (today)?'])
  expect(findTranscriptRanges(text, ['.*', '   ', '[bad regex'])).toEqual([])
  expect(findTranscriptRanges('abcdefghijk', ['abcde', 'cdefg'])).toEqual([{ start: 0, end: 7 }])
  expect(findTranscriptRanges('A A', ['A'])).toHaveLength(2)
})

test('evidence extraction separates full-QA quotes, accepts structured quotes, rejects malformed fields', () => {
  const quotes = ['Your credit may be affected.', 'You can cancel at any time.']
  expect(extractEvidenceQuotes('manager_escalation', { call_overview: { manager_focus_areas: quotes.map(quote => ({ quote })) } })).toEqual(quotes)
  expect(extractEvidenceQuotes('program_expectations', { key_evidence_quote: quotes[0], evidence: [{ quote: quotes[1] }, { quote: quotes[0] }, { quote: 42 }] })).toEqual(quotes)
  expect(extractEvidenceQuotes('budget_compliance', { key_evidence_quote: { malicious: true } })).toEqual([])
  expect(extractEvidenceQuotes('warm_transfer', { warm_transfer_compliance: { violation_reason: quotes[0] } })).toEqual([])
  expect(extractEvidenceQuotes('budget_compliance', { key_evidence_quote: 'short' })).toEqual([])
  expect(extractEvidenceQuotes('manager_escalation', null)).toEqual([])
})
