import { test, expect } from '@playwright/test'
import {
  defaultAlertWindow, isClosedForReviewer, isReviewOverdue, matchesAlertQueueView,
  needsCoachingFollowUp, parseAlertQueueView, reviewAgeLabel,
} from '../src/lib/alert-review-queue'
import { extractEvidenceQuotes, findTranscriptRanges, parseTranscriptTurns } from '../src/lib/transcript-evidence'
import { formatDateParam } from '../src/lib/url-filters'

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

test('director approval, first review, and coaching follow-up have distinct states', () => {
  const deferred = { ...open, is_reviewed: true, accurate: true, action_taken: 'follow_up_later' as const, feedback_by: 'Manager@example.test' }
  expect(needsCoachingFollowUp(deferred)).toBe(true)
  expect(isClosedForReviewer(deferred, 'manager@EXAMPLE.test')).toBe(true)
  expect(matchesAlertQueueView(deferred, 'new', true, 'director@example.test', now)).toBe(true)
  expect(matchesAlertQueueView(deferred, 'overdue', true, 'director@example.test', now)).toBe(false)
  const approved = { ...deferred, acker_emails: ['DIRECTOR@example.test'] }
  expect(matchesAlertQueueView(approved, 'new', true, 'director@example.test', now)).toBe(false)
  expect(matchesAlertQueueView(approved, 'follow_up', true, 'director@example.test', now)).toBe(true)
  expect(needsCoachingFollowUp({ ...deferred, accurate: false })).toBe(false)
  expect(needsCoachingFollowUp({ ...deferred, action_taken: 'coached' })).toBe(false)
  expect(needsCoachingFollowUp({ ...deferred, is_reviewed: false })).toBe(false)
  expect(matchesAlertQueueView(deferred, 'new', false, 'someone@example.test', now)).toBe(false)
  expect(matchesAlertQueueView(open, 'all', false, null, now)).toBe(true)
  expect(parseAlertQueueView('__proto__')).toBe('new')
  expect(parseAlertQueueView('follow_up')).toBe('follow_up')
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
