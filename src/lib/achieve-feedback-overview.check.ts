// Self-check for the WC Agent Summary boundary parser.
// Run: npx tsx src/lib/achieve-feedback-overview.check.ts
import assert from 'node:assert/strict'
import {
  achieveRepresentativeReviewStatus,
  achieveRepresentativesCsv,
  filterAchieveRepresentatives,
  parseAchieveFeedbackDashboard,
  parseAchieveRepresentativeFeedbackDetails,
} from './achieve-feedback-overview'

const validResponse = {
  overview: {
    generated_at: '2026-08-16T07:40:00Z',
    scope: { first_submitted_at: '2026-07-15T16:59:55Z', last_submitted_at: '2026-08-15T21:56:28Z', total_submissions: 6 },
    ratings: { good: 1, fair: 1, poor: 2, other: 2 },
    flags: { accent: 2, background_noise: 1, connection_issues: 1, with_notes: 1 },
    coverage: { call_associated: 5, exact_agent_attributed: 3, agent_unavailable: 2, unresolved: 1 },
    unresolved_reasons: { call_ambiguous: 1, no_call_in_window: 0, invalid_phone: 0, submitter_not_found: 0, other: 0 },
    distinct_exact_agents: 2,
    distinct_any_agents: 3,
    qa: {
      coverage: { all_graded: 5, exact_agent_attributed: 4, agent_unavailable: 1 },
      outcomes: { pass: 3, flagged: 1 },
      alignment: { overlap_calls: 3, both_clear: 1, both_concern: 1, human_only: 1, ai_only: 0 },
      distinct_exact_agents: 3,
    },
  },
  representatives: {
    rows: [
      {
        achieve_agent_name: 'Representative A', achieve_agent_email: 'REP-A@example.test',
        total_submissions: 2, good: 1, fair: 1, poor: 0, other: 0,
        accent: 0, background_noise: 1, connection_issues: 0, latest_submitted_at: '2026-08-11T10:00:00Z',
        ai_total: 2, ai_pass: 2, ai_flagged: 0, latest_ai_graded_at: '2026-08-11T09:00:00Z',
        overlap_calls: 2, both_clear: 1, both_concern: 0, human_only: 1, ai_only: 0,
      },
      {
        achieve_agent_name: 'Representative C', achieve_agent_email: 'rep-c@example.test',
        total_submissions: 1, good: 0, fair: 0, poor: 1, other: 0,
        accent: 0, background_noise: 0, connection_issues: 1, latest_submitted_at: '2026-08-14T10:00:00Z',
        ai_total: 1, ai_pass: 0, ai_flagged: 1, latest_ai_graded_at: '2026-08-14T09:00:00Z',
        overlap_calls: 1, both_clear: 0, both_concern: 1, human_only: 0, ai_only: 0,
      },
      {
        achieve_agent_name: 'Representative QA', achieve_agent_email: 'rep-qa@example.test',
        total_submissions: 0, good: 0, fair: 0, poor: 0, other: 0,
        accent: 0, background_noise: 0, connection_issues: 0, latest_submitted_at: null,
        ai_total: 1, ai_pass: 1, ai_flagged: 0, latest_ai_graded_at: '2026-08-15T09:00:00Z',
        overlap_calls: 0, both_clear: 0, both_concern: 0, human_only: 0, ai_only: 0,
      },
    ],
    coverage: { total: 3, loaded: 3, limit: 200, offset: 0, cap_reached: false },
  },
}

const parsed = parseAchieveFeedbackDashboard(validResponse)
assert.strictEqual(parsed.overview.qa.coverage.allGraded, 5)
assert.strictEqual(parsed.overview.qa.alignment.overlapCalls, 3)
assert.strictEqual(parsed.representatives[2]?.totalSubmissions, 0)
assert.strictEqual(parsed.representatives[2]?.ai.total, 1)
assert.strictEqual(parsed.representatives[0]?.fairPoorRate, 50)
assert.strictEqual(achieveRepresentativeReviewStatus(parsed.representatives[0]), 'low_sample')
assert.deepStrictEqual(filterAchieveRepresentatives(parsed.representatives, '', false).map(row => row.agentEmail), [
  'rep-a@example.test', 'rep-c@example.test', 'rep-qa@example.test',
])
assert.deepStrictEqual(filterAchieveRepresentatives(parsed.representatives, '', true), [])

const reviewCandidate = { ...parsed.representatives[0], totalSubmissions: 8, fairPoorRate: 25 }
assert.strictEqual(achieveRepresentativeReviewStatus(reviewCandidate), 'needs_review')

const csv = achieveRepresentativesCsv([{
  ...parsed.representatives[0],
  agentName: '\t=Representative, "A"',
}])
assert.ok(csv.startsWith('\uFEFF"Representative","Email","Latest activity (UTC)"'))
assert.ok(csv.includes('"\'\t=Representative, ""A"""'))
assert.ok(csv.includes('"2026-08-11T10:00:00Z","Low Form sample"'))
assert.strictEqual(csv.trim().split('\r\n').length, 2)

for (const invalid of [
  { ...validResponse, overview: { ...validResponse.overview, qa: { ...validResponse.overview.qa, coverage: { all_graded: 5, exact_agent_attributed: 4, agent_unavailable: 2 } } } },
  { ...validResponse, overview: { ...validResponse.overview, qa: { ...validResponse.overview.qa, outcomes: { pass: 2, flagged: 2 } } } },
  { ...validResponse, overview: { ...validResponse.overview, qa: { ...validResponse.overview.qa, alignment: { ...validResponse.overview.qa.alignment, overlap_calls: 4 } } } },
  { ...validResponse, representatives: { ...validResponse.representatives, rows: validResponse.representatives.rows.map((row, index) => index === 2 ? { ...row, latest_submitted_at: '2026-08-15T00:00:00Z' } : row) } },
  { ...validResponse, representatives: { ...validResponse.representatives, rows: validResponse.representatives.rows.map((row, index) => index === 0 ? { ...row, ai_pass: 1 } : row) } },
]) {
  assert.throws(() => parseAchieveFeedbackDashboard(invalid), /invalid_achieve_feedback_response/)
}

const detail = parseAchieveRepresentativeFeedbackDetails({
  rows: [{
    feedback_id: 12, submitted_at: '2026-08-11T10:00:00Z', rating: 'fair', accent: false,
    background_noise: true, connection_issues: false, notes: 'The background was distracting.', submitted_by: 'Pennie Agent',
  }],
  coverage: { total: 1, loaded: 1, limit: 200, offset: 0, cap_reached: false },
  qa_rows: [
    { module_result_id: 42, graded_at: '2026-08-12T09:00:00Z', outcome: 'flagged' },
    { module_result_id: 41, graded_at: '2026-08-11T09:00:00Z', outcome: 'pass' },
  ],
  qa_coverage: { total: 2, loaded: 2, limit: 200, offset: 0, cap_reached: false },
})
assert.strictEqual(detail.rows[0]?.notes, 'The background was distracting.')
assert.strictEqual(detail.qaRows[0]?.moduleResultId, 42)
assert.strictEqual(detail.qaRows[0]?.outcome, 'flagged')

for (const invalidDetail of [
  { rows: [], coverage: { total: 0, loaded: 0, limit: 200, offset: 0, cap_reached: false }, qa_rows: [{ module_result_id: 1, graded_at: 'bad', outcome: 'pass' }], qa_coverage: { total: 1, loaded: 1, limit: 200, offset: 0, cap_reached: false } },
  { rows: [], coverage: { total: 0, loaded: 0, limit: 200, offset: 0, cap_reached: false }, qa_rows: [{ module_result_id: 1, graded_at: '2026-08-11T09:00:00Z', outcome: 'unknown' }], qa_coverage: { total: 1, loaded: 1, limit: 200, offset: 0, cap_reached: false } },
]) {
  assert.throws(() => parseAchieveRepresentativeFeedbackDetails(invalidDetail), /invalid_achieve_feedback_response/)
}

console.log('achieve-feedback-overview: all checks passed')
