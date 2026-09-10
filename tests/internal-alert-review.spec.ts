import { test, expect } from '@playwright/test'
import {
  parseDecisionRpcResult,
  mergeAlertDetailsWithoutReviewRegression,
  parseInitialManagerReview,
  parseInternalReviewDraft,
  parseSubmitReviewRpcResult,
} from '../src/lib/internal-alert-review'
import { alertRow } from './review-fixture'

test('structured review parser enforces the same 12–4000 character prose contract on both verdicts', () => {
  expect(parseInternalReviewDraft({
    verdict: true,
    action: 'coached',
    reason: null,
    violationDetails: 'Too short',
    actionDetails: 'The manager coached the representative.',
    falseAlarmDetails: null,
  }).ok).toBe(false)
  expect(parseInternalReviewDraft({
    verdict: true,
    action: 'coached',
    reason: null,
    violationDetails: 'The disclosure was omitted.',
    actionDetails: 'The disclosure was omitted.',
    falseAlarmDetails: null,
  }).ok).toBe(false)
  expect(parseInternalReviewDraft({
    verdict: true,
    action: 'coached',
    reason: 'wrong_context', // A hidden draft from toggling verdicts is ignored.
    violationDetails: 'The disclosure was omitted.',
    actionDetails: 'The manager coached the full disclosure.',
    falseAlarmDetails: 'The hidden false-alarm explanation remains in the form draft.',
  })).toMatchObject({
    ok: true,
    value: { verdict: true, reason: null, falseAlarmDetails: null },
  })

  for (const reason of ['soft_inquiry_misclassified', 'wrong_context', 'evidence_misquoted', 'policy_does_not_apply', 'addressed_off_call', 'covered_not_verbatim', 'call_dropped_incomplete', 'other'] as const) {
    expect(parseInternalReviewDraft({
      verdict: false,
      action: null,
      reason,
      violationDetails: null,
      actionDetails: null,
      falseAlarmDetails: 'Too short',
    }).ok).toBe(false)
    expect(parseInternalReviewDraft({
      verdict: false,
      action: 'coached',
      reason,
      violationDetails: 'A hidden real-issue draft.',
      actionDetails: 'A hidden coaching-action draft.',
      falseAlarmDetails: 'The evidence came from a different context.',
    })).toMatchObject({
      ok: true,
      value: { verdict: false, reason, action: null, violationDetails: null, actionDetails: null },
    })
  }

  expect(parseInternalReviewDraft({
    verdict: false,
    action: null,
    reason: 'other',
    violationDetails: null,
    actionDetails: null,
    falseAlarmDetails: 'x'.repeat(4001),
  }).ok).toBe(false)
})

test('late detail responses cannot replace a typed decision with a legacy ack', () => {
  const current = alertRow('same-review', {
    is_reviewed: true,
    accurate: false,
    feedback_by: 'manager@example.test',
    review_revision: 1,
    current_decision_id: 44,
    current_decision: 'changes_requested',
    current_decision_by: 'director@example.test',
    current_decision_source: 'typed',
  })
  const stale = alertRow('same-review', {
    is_reviewed: true,
    accurate: false,
    feedback_by: 'manager@example.test',
    review_revision: 1,
    current_decision_id: -7,
    current_decision: 'approved',
    current_decision_by: 'legacy-admin@example.test',
    current_decision_source: 'legacy_superadmin_ack',
  })
  expect(mergeAlertDetailsWithoutReviewRegression(current, stale)).toMatchObject({
    current_decision_id: 44,
    current_decision: 'changes_requested',
    current_decision_source: 'typed',
  })
})

test('RPC and persisted snapshot parsers reject malformed serialized values', () => {
  expect(parseSubmitReviewRpcResult({
    feedback_id: 42,
    review_revision: 2,
    reviewed_at: '2026-09-07T16:00:00Z',
    idempotent: false,
  })).toEqual({
    ok: true,
    value: {
      _tag: 'ReviewSubmitted',
      feedbackId: 42,
      reviewRevision: 2,
      reviewedAt: '2026-09-07T16:00:00Z',
      idempotent: false,
    },
  })
  expect(parseSubmitReviewRpcResult({ feedback_id: '42' }).ok).toBe(false)
  expect(parseDecisionRpcResult({
    decision_id: 9,
    feedback_revision: 2,
    decision: 'changes_requested',
    decided_at: '2026-09-07T16:01:00Z',
    idempotent: true,
  })).toMatchObject({ ok: true, value: { _tag: 'ReviewDecided', decision: 'changes_requested' } })
  expect(parseDecisionRpcResult({ decision: 'maybe' }).ok).toBe(false)

  expect(parseInitialManagerReview({
    manager_email: 'first.manager@trypennie.com',
    accurate: true,
    action_taken: 'coached',
    inaccuracy_reason: null,
    comment: 'Historic combined note.',
    violation_details: null,
    action_details: null,
    reviewed_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T11:59:00Z', // Server-only retry metadata is forward-compatible.
  })).toMatchObject({ ok: true, value: { managerEmail: 'first.manager@trypennie.com' } })
  expect(parseInitialManagerReview({ manager_email: 123 }).ok).toBe(false)
})
