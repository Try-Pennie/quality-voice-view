// Self-check for the pure Achieve leadership analytics.
// Run: npx tsx src/lib/achieve-analytics.check.ts
import assert from 'node:assert'
import {
  EMPTY_ACHIEVE_FILTERS,
  buildAchieveTrends,
  filterAchieveRows,
  normalizeAchieveAgentRating,
  summarizeAchieveAnalytics,
} from './achieve-analytics'

const empty = summarizeAchieveAnalytics([])
assert.deepStrictEqual(empty, {
  loadedCalls: 0,
  ai: {
    scoredCalls: 0,
    notGradedCalls: 0,
    passedCalls: 0,
    flaggedCalls: 0,
    passRate: null,
    scriptIssueCalls: 0,
    poorTransferCalls: 0,
    missedElements: [],
  },
  agent: {
    matchedCalls: 0,
    submissions: 0,
    ratings: { Good: 0, Fair: 0, Poor: 0, Other: 0 },
    flags: { accent: 0, backgroundNoise: 0, connectionIssue: 0 },
  },
})

const malformed = summarizeAchieveAnalytics([
  { alert_created_at: 'not-a-date', has_violation: 'false', result_json: 'malformed', agent_feedback: 'malformed' },
])
assert.strictEqual(malformed.loadedCalls, 1)
assert.strictEqual(malformed.ai.scoredCalls, 0)
assert.strictEqual(malformed.agent.matchedCalls, 0)
assert.deepStrictEqual(buildAchieveTrends([{ alert_created_at: 'not-a-date' }]), {
  granularity: 'day',
  timeZone: 'UTC',
  buckets: [],
})

const gradingExclusions = summarizeAchieveAnalytics([
  { alert_created_at: '2026-01-01T10:00:00Z', has_violation: false, result_json: { grading_skipped: true } },
  {
    alert_created_at: '2026-01-02T10:00:00Z',
    has_violation: true,
    result_json: { transcript_segment: { used_full_transcript_fallback: true } },
  },
  { alert_created_at: '2026-01-03T10:00:00Z', has_violation: false, result_json: {} },
])
assert.strictEqual(gradingExclusions.loadedCalls, 3)
assert.strictEqual(gradingExclusions.ai.scoredCalls, 1)
assert.strictEqual(gradingExclusions.ai.notGradedCalls, 2)
assert.strictEqual(gradingExclusions.ai.passedCalls, 1)
assert.strictEqual(gradingExclusions.ai.passRate, 100)

const signalSummary = summarizeAchieveAnalytics([
  {
    alert_created_at: '2026-02-01T10:00:00Z',
    has_violation: true,
    result_json: {
      script_version: 'fdr_wholesale_db_pilot_v1',
      script_adherence: {
        greeting_and_identity_completed: true,
        recording_disclosure_provided: false,
        company_credibility_covered: true,
        call_agenda_provided: true,
        dedicated_account_deposits_explained: true,
        creditor_negotiation_explained: true,
        settlement_authorizations_explained: true,
        dashboard_account_setup_covered: true,
        tools_and_resources_covered: true,
        closing_and_support_provided: true,
        violation: true,
      },
      transfer_experience: { poor_transfer: true, reasons: [] },
    },
    agent_feedback: [
      { call_quality: ' GOOD ', accent: true, background_noise: false, connection_issues: false },
      { call_quality: 'poor', accent: false, background_noise: true, connection_issues: false },
    ],
  },
  {
    alert_created_at: '2026-02-02T09:00:00Z',
    has_violation: false,
    result_json: {
      script_version: 'fdr_wholesale_db_pilot_v1',
      script_adherence: { recording_disclosure_provided: false },
    },
  },
  {
    alert_created_at: '2026-02-02T10:00:00Z',
    has_violation: false,
    result_json: {},
    agent_feedback: [
      { call_quality: 'unexpected', accent: false, background_noise: false, connection_issues: true },
    ],
  },
  {
    alert_created_at: '2026-02-03T10:00:00Z',
    has_violation: false,
    result_json: {},
    agent_feedback: [{ call_quality: 'fAiR' }],
  },
])
// Concentrations describe failed checks; contradictory missing flags on a
// passed row must not inflate the leadership issue tally.
assert.strictEqual(signalSummary.ai.scriptIssueCalls, 1)
assert.strictEqual(signalSummary.ai.poorTransferCalls, 1)
assert.deepStrictEqual(signalSummary.ai.missedElements, [
  { key: 'recording_disclosure', label: 'Recording disclosure', count: 1 },
])
assert.strictEqual(signalSummary.agent.matchedCalls, 3)
assert.strictEqual(signalSummary.agent.submissions, 4)
assert.deepStrictEqual(signalSummary.agent.ratings, { Good: 0, Fair: 1, Poor: 1, Other: 1 })
assert.deepStrictEqual(signalSummary.agent.flags, { accent: 1, backgroundNoise: 1, connectionIssue: 1 })
assert.strictEqual(normalizeAchieveAgentRating(''), 'Other')
assert.strictEqual(normalizeAchieveAgentRating('not supplied'), 'Other')

const filterRows = [
  {
    call_id: 'accent-poor',
    agent_feedback: [
      { call_quality: 'Good', accent: true },
      { call_quality: 'Poor', background_noise: true },
    ],
  },
  { call_id: 'connection-other', agent_feedback: [{ call_quality: null, connection_issues: true }] },
  { call_id: 'fair', agent_feedback: [{ call_quality: 'fair' }] },
  { call_id: 'not-matched', accent: true },
]
assert.strictEqual(filterAchieveRows(filterRows, EMPTY_ACHIEVE_FILTERS).length, 4)
assert.deepStrictEqual(
  filterAchieveRows(filterRows, { ...EMPTY_ACHIEVE_FILTERS, accent: true }).map(row => row.call_id),
  ['accent-poor'],
)
assert.deepStrictEqual(
  filterAchieveRows(filterRows, { ...EMPTY_ACHIEVE_FILTERS, backgroundNoise: true, rating: 'Poor' }).map(row => row.call_id),
  ['accent-poor'],
)
assert.deepStrictEqual(
  filterAchieveRows(filterRows, { ...EMPTY_ACHIEVE_FILTERS, rating: 'Other' }).map(row => row.call_id),
  ['connection-other'],
)
assert.deepStrictEqual(
  filterAchieveRows(filterRows, { ...EMPTY_ACHIEVE_FILTERS, connectionIssue: true, rating: 'Fair' }),
  [],
)

assert.deepStrictEqual(buildAchieveTrends([]), { granularity: 'day', timeZone: 'UTC', buckets: [] })
const dailyTrend = buildAchieveTrends([
  {
    alert_created_at: '2026-01-01T23:30:00-05:00',
    has_violation: false,
    result_json: {},
    agent_feedback: [{ call_quality: 'Good' }],
  },
  {
    alert_created_at: '2026-01-03T01:00:00Z',
    has_violation: true,
    result_json: {},
    agent_feedback: [
      { call_quality: 'Fair' },
      { call_quality: 'Poor' },
    ],
  },
])
assert.strictEqual(dailyTrend.granularity, 'day')
assert.deepStrictEqual(dailyTrend.buckets.map(bucket => bucket.key), ['2026-01-02', '2026-01-03'])
assert.deepStrictEqual(dailyTrend.buckets.map(bucket => bucket.ai), [
  { scoredCalls: 1, passedCalls: 1, flaggedCalls: 0 },
  { scoredCalls: 1, passedCalls: 0, flaggedCalls: 1 },
])
assert.deepStrictEqual(dailyTrend.buckets.map(bucket => bucket.agent), [
  { matchedCalls: 1, ratings: { Good: 1, Fair: 0, Poor: 0, Other: 0 } },
  { matchedCalls: 1, ratings: { Good: 0, Fair: 0, Poor: 1, Other: 0 } },
])

const weeklyTrend = buildAchieveTrends([
  { alert_created_at: '2026-01-04T12:00:00Z', has_violation: false, result_json: {} },
  { alert_created_at: '2026-02-20T12:00:00Z', has_violation: true, result_json: {} },
])
assert.strictEqual(weeklyTrend.granularity, 'week')
assert.strictEqual(weeklyTrend.buckets[0]?.key, '2025-12-29')
assert.strictEqual(weeklyTrend.buckets.at(-1)?.key, '2026-02-16')
assert.strictEqual(weeklyTrend.buckets.reduce((total, bucket) => total + bucket.ai.scoredCalls, 0), 2)

console.log('achieve-analytics: all checks passed')
