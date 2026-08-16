// Self-check for the complete-Form Achieve leadership response parser.
// Run: npx tsx src/lib/achieve-feedback-overview.check.ts
import assert from 'node:assert/strict'
import {
  achieveRepresentativeReviewStatus,
  filterAchieveRepresentatives,
  parseAchieveFeedbackDashboard,
  parseAchieveRepresentativeFeedbackDetails,
} from './achieve-feedback-overview'

const validResponse = {
  overview: {
    generated_at: '2026-08-16T07:40:00Z',
    scope: {
      first_submitted_at: '2026-07-15T16:59:55Z',
      last_submitted_at: '2026-08-15T21:56:28Z',
      total_submissions: 6,
    },
    ratings: { good: 2, fair: 1, poor: 2, other: 1 },
    flags: { accent: 2, background_noise: 1, connection_issues: 1, with_notes: 1 },
    coverage: {
      call_associated: 5,
      exact_agent_attributed: 3,
      agent_unavailable: 2,
      unresolved: 1,
    },
    unresolved_reasons: {
      call_ambiguous: 1,
      no_call_in_window: 0,
      invalid_phone: 0,
      submitter_not_found: 0,
      other: 0,
    },
    distinct_exact_agents: 2,
  },
  representatives: {
    rows: [
      {
        achieve_agent_name: 'Representative A',
        achieve_agent_email: 'REP-A@example.test',
        total_submissions: 2,
        good: 1,
        fair: 1,
        poor: 0,
        other: 0,
        accent: 0,
        background_noise: 1,
        connection_issues: 0,
        latest_submitted_at: '2026-08-11T10:00:00Z',
      },
      {
        achieve_agent_name: 'Representative C',
        achieve_agent_email: 'rep-c@example.test',
        total_submissions: 1,
        good: 1,
        fair: 0,
        poor: 0,
        other: 0,
        accent: 0,
        background_noise: 0,
        connection_issues: 1,
        latest_submitted_at: '2026-08-14T10:00:00Z',
      },
    ],
    coverage: { total: 2, loaded: 2, limit: 200, offset: 0, cap_reached: false },
  },
}

const parsed = parseAchieveFeedbackDashboard(validResponse)
assert.strictEqual(parsed.overview.scope.totalSubmissions, 6)
assert.strictEqual(parsed.overview.coverage.exactAgentAttributed, 3)
assert.strictEqual(parsed.representatives[0]?.agentEmail, 'rep-a@example.test')
assert.strictEqual(parsed.representatives[0]?.fairPoorCount, 1)
assert.strictEqual(parsed.representatives[0]?.fairPoorRate, 50)
assert.strictEqual(achieveRepresentativeReviewStatus(parsed.representatives[0]), 'low_sample')
assert.deepStrictEqual(
  filterAchieveRepresentatives(parsed.representatives, 'representative c', false)
    .map(representative => representative.agentEmail),
  ['rep-c@example.test'],
)
assert.deepStrictEqual(filterAchieveRepresentatives(parsed.representatives, '', true), [])

const reviewCandidate = {
  ...parsed.representatives[0],
  totalSubmissions: 8,
  fairPoorRate: 25,
}
assert.strictEqual(achieveRepresentativeReviewStatus(reviewCandidate), 'needs_review')
assert.strictEqual(achieveRepresentativeReviewStatus({ ...reviewCandidate, fairPoorRate: 24.9 }), 'below_threshold')

for (const invalid of [
  {
    ...validResponse,
    overview: {
      ...validResponse.overview,
      ratings: { good: 2, fair: 1, poor: 1, other: 1 },
    },
  },
  {
    ...validResponse,
    overview: {
      ...validResponse.overview,
      coverage: { ...validResponse.overview.coverage, unresolved: 2 },
    },
  },
  {
    ...validResponse,
    representatives: {
      ...validResponse.representatives,
      rows: [...validResponse.representatives.rows, validResponse.representatives.rows[0]],
      coverage: { total: 3, loaded: 3, limit: 200, offset: 0, cap_reached: false },
    },
  },
]) {
  assert.throws(() => parseAchieveFeedbackDashboard(invalid), /invalid_achieve_feedback_response/)
}

const empty = parseAchieveFeedbackDashboard({
  overview: {
    generated_at: '2026-08-16T07:40:00Z',
    scope: { first_submitted_at: null, last_submitted_at: null, total_submissions: 0 },
    ratings: { good: 0, fair: 0, poor: 0, other: 0 },
    flags: { accent: 0, background_noise: 0, connection_issues: 0, with_notes: 0 },
    coverage: { call_associated: 0, exact_agent_attributed: 0, agent_unavailable: 0, unresolved: 0 },
    unresolved_reasons: {
      call_ambiguous: 0,
      no_call_in_window: 0,
      invalid_phone: 0,
      submitter_not_found: 0,
      other: 0,
    },
    distinct_exact_agents: 0,
  },
  representatives: {
    rows: [],
    coverage: { total: 0, loaded: 0, limit: 200, offset: 0, cap_reached: false },
  },
})
assert.strictEqual(empty.overview.scope.totalSubmissions, 0)

const detail = parseAchieveRepresentativeFeedbackDetails({
  rows: [
    {
      feedback_id: 12,
      submitted_at: '2026-08-11T10:00:00Z',
      rating: 'fair',
      accent: false,
      background_noise: true,
      connection_issues: false,
      notes: 'The background was distracting.',
      submitted_by: 'Pennie Agent',
    },
    {
      feedback_id: 11,
      submitted_at: '2026-08-10T10:00:00Z',
      rating: 'good',
      accent: false,
      background_noise: false,
      connection_issues: false,
      notes: null,
      submitted_by: null,
    },
  ],
  coverage: { total: 2, loaded: 2, limit: 200, offset: 0, cap_reached: false },
})
assert.strictEqual(detail.rows[0]?.id, 12)
assert.strictEqual(detail.rows[0]?.flags.backgroundNoise, true)
assert.strictEqual(detail.rows[0]?.submittedBy, 'Pennie Agent')
assert.strictEqual(detail.rows[1]?.notes, null)

for (const invalidDetail of [
  {
    rows: [{ ...detail.rows[0], feedback_id: 12 }],
    coverage: { total: 1, loaded: 2, limit: 200, offset: 0, cap_reached: false },
  },
  {
    rows: [
      {
        feedback_id: 12,
        submitted_at: '2026-08-11T10:00:00Z',
        rating: 'excellent',
        accent: false,
        background_noise: false,
        connection_issues: false,
        notes: null,
        submitted_by: null,
      },
    ],
    coverage: { total: 1, loaded: 1, limit: 200, offset: 0, cap_reached: false },
  },
]) {
  assert.throws(() => parseAchieveRepresentativeFeedbackDetails(invalidDetail), /invalid_achieve_feedback_response/)
}

console.log('achieve-feedback-overview: all checks passed')
