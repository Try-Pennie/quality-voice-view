// Behavior check for the Achieve management boundary parser and selectors.
// Run: npx tsx src/lib/achieve-management.check.ts
import assert from 'node:assert/strict'
import {
  achieveManagementPeriod,
  achieveOutcomeSignal,
  parseAchieveManagementReport,
  selectedAchieveRepresentatives,
} from './achieve-management'

function dashboard(weeks: number) {
  return {
    overview: {
      generated_at: '2026-08-17T13:00:00Z',
      scope: { first_submitted_at: '2026-08-01T00:00:00Z', last_submitted_at: '2026-08-15T00:00:00Z', total_submissions: 14 },
      ratings: { good: 11, fair: 3, poor: 0, other: 0 },
      flags: { accent: 1, background_noise: 0, connection_issues: 0, with_notes: 0 },
      coverage: { call_associated: 14, exact_agent_attributed: 14, agent_unavailable: 0, unresolved: 0 },
      unresolved_reasons: { call_ambiguous: 0, no_call_in_window: 0, invalid_phone: 0, submitter_not_found: 0, other: 0 },
      distinct_exact_agents: 2,
      distinct_any_agents: 2,
      qa: {
        coverage: { all_graded: 2, exact_agent_attributed: 2, agent_unavailable: 0 },
        outcomes: { pass: 1, flagged: 1 },
        alignment: { overlap_calls: 0, both_clear: 0, both_concern: 0, human_only: 0, ai_only: 0 },
        distinct_exact_agents: 2,
      },
    },
    representatives: {
      rows: [{
        achieve_agent_name: 'Representative A', achieve_agent_email: 'REP-A@example.test',
        total_submissions: 4, good: 1, fair: 3, poor: 0, other: 0,
        accent: 1, background_noise: 0, connection_issues: 0, latest_submitted_at: '2026-08-15T00:00:00Z',
        ai_total: 1, ai_pass: 0, ai_flagged: 1, latest_ai_graded_at: '2026-08-15T00:00:00Z',
        overlap_calls: 0, both_clear: 0, both_concern: 0, human_only: 0, ai_only: 0,
      }, {
        achieve_agent_name: 'Baseline', achieve_agent_email: 'baseline@example.test',
        total_submissions: 10, good: 10, fair: 0, poor: 0, other: 0,
        accent: 0, background_noise: 0, connection_issues: 0, latest_submitted_at: '2026-08-15T00:00:00Z',
        ai_total: 1, ai_pass: 1, ai_flagged: 0, latest_ai_graded_at: '2026-08-15T00:00:00Z',
        overlap_calls: 0, both_clear: 0, both_concern: 0, human_only: 0, ai_only: 0,
      }],
      coverage: { total: 2, loaded: 2, limit: 500, offset: 0, cap_reached: false },
    },
    marker: weeks,
  }
}

const cutoff = '2026-08-07'
const addDays = (days: number) => {
  const value = new Date(`${cutoff}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const raw = {
  generatedAt: '2026-08-17T13:00:00Z',
  completedThrough: '2026-08-17T04:00:00Z',
  periods: [2, 4, 6].map((weeks, index) => ({
    weeks,
    startAt: `2026-0${8 - index}-01T04:00:00Z`,
    endAt: '2026-08-17T04:00:00Z',
    dashboard: dashboard(weeks),
    representatives: [
      { agentEmail: 'rep-a@example.test', adjustedFormRisk: 75, riskRank: 1, terminatedAt: null },
      { agentEmail: 'baseline@example.test', adjustedFormRisk: 0, riskRank: 2, terminatedAt: null },
    ],
  })),
  reviewTrends: ([2, 4, 6] as const).map((weeks, index) => ({
    weeks,
    startAt: `2026-0${8 - index}-01T04:00:00Z`,
    endAt: '2026-08-17T04:00:00Z',
    reviews: 14,
    negativeReviews: 3,
    previousStartAt: '2026-07-01T04:00:00Z',
    previousEndAt: `2026-0${8 - index}-01T04:00:00Z`,
    previousReviews: 10,
    previousNegativeReviews: 2,
  })),
  allTimeReviews: 20,
  allTimeNegativeReviews: 4,
  highRiskAgentEmails: ['rep-a@example.test'],
  bottomTenNegativeReviewAgentEmails: ['rep-a@example.test', 'baseline@example.test'],
  bottomTenIntelligibilityAgentEmails: ['rep-a@example.test'],
  bottomTenFirstPayAgentEmails: ['rep-a@example.test'],
  outcomes: {
    sourceAsOf: '2026-08-17',
    refreshedAt: '2026-08-17T12:00:00Z',
    maturityCutoff: cutoff,
    periods: (['all_time', 'mature_2_weeks', 'mature_4_weeks', 'mature_6_weeks'] as const).map(key => {
      const startDays = key === 'mature_2_weeks' ? -13 : key === 'mature_4_weeks' ? -27 : -41
      const priorStartDays = key === 'mature_2_weeks' ? -27 : key === 'mature_4_weeks' ? -55 : -83
      const priorEndDays = key === 'mature_2_weeks' ? -14 : key === 'mature_4_weeks' ? -28 : -42
      return {
        key,
        startDate: key === 'all_time' ? null : addDays(startDays),
        endDate: cutoff,
        n: 20,
        paid: 12,
        previousStartDate: key === 'all_time' ? null : addDays(priorStartDays),
        previousEndDate: key === 'all_time' ? null : addDays(priorEndDays),
        previousN: key === 'all_time' ? null : 10,
        previousPaid: key === 'all_time' ? null : 7,
        agents: [{
          agentName: 'Representative A', agentEmail: 'rep-a@example.test', n: 20,
          failures: 8, failureRate: 40, expectedFailures: 5, expectedSuccesses: 15,
          expectedRate: 25, deltaPp: 15, z: 2.5, rescinded: 3, neverPaid: 5,
          sampleQualified: true, rank: 1,
        }],
      }
    }),
  },
  terminations: [{
    agentName: 'Terminated Representative',
    agentEmail: 'terminated@example.test',
    terminatedAt: '2026-08-16T04:00:00Z',
    lastActivityOn: '2026-08-15',
    activityPostTermination: 0,
  }],
}

const parsed = parseAchieveManagementReport(raw)
assert.strictEqual(achieveManagementPeriod(parsed, 4).weeks, 4)
assert.deepStrictEqual(selectedAchieveRepresentatives(parsed, parsed.highRiskAgentEmails).map(row => row.agentEmail), ['rep-a@example.test'])
assert.strictEqual(parsed.outcomes.periods[1]?.key, 'mature_2_weeks')
const outcomeAgent = parsed.outcomes.periods[3]?.agents[0]
assert.ok(outcomeAgent)
assert.strictEqual(achieveOutcomeSignal(outcomeAgent), 'Flag')
assert.strictEqual(achieveOutcomeSignal({ ...outcomeAgent, z: -1 }), 'Below roster')
assert.strictEqual(parsed.terminations[0]?.activityPostTermination, 0)
assert.strictEqual(parsed.terminations[0]?.lastActivityOn, '2026-08-15')
assert.throws(
  () => parseAchieveManagementReport({ ...raw, highRiskAgentEmails: ['missing@example.test'] }),
  /invalid_achieve_management_response/,
)
assert.throws(
  () => parseAchieveManagementReport({ ...raw, bottomTenNegativeReviewAgentEmails: ['baseline@example.test'] }),
  /invalid_achieve_management_response/,
)
assert.throws(
  () => parseAchieveManagementReport({ ...raw, reviewTrends: raw.reviewTrends.map((trend, index) => index === 0 ? { ...trend, previousEndAt: '2026-07-31T04:00:00Z' } : trend) }),
  /invalid_achieve_management_response/,
)
assert.throws(
  () => parseAchieveManagementReport({ ...raw, outcomes: { ...raw.outcomes, maturityCutoff: '2026-08-08' } }),
  /invalid_achieve_management_response/,
)

console.log('achieve-management: all checks passed')
