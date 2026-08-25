// Self-check for the Achieve management response parser and selectors.
// Run: npx tsx src/lib/achieve-management.check.ts
import assert from 'node:assert/strict'
import {
  achieveManagementPeriod,
  parseAchieveManagementReport,
  persistentAchieveRanks,
  persistentAchieveRepresentatives,
} from './achieve-management'

function dashboard(weeks: number) {
  return {
    overview: {
      generated_at: '2026-08-17T13:00:00Z',
      scope: { first_submitted_at: '2026-08-01T00:00:00Z', last_submitted_at: '2026-08-15T00:00:00Z', total_submissions: 1 },
      ratings: { good: 0, fair: 0, poor: 1, other: 0 },
      flags: { accent: 0, background_noise: 0, connection_issues: 0, with_notes: 0 },
      coverage: { call_associated: 1, exact_agent_attributed: 1, agent_unavailable: 0, unresolved: 0 },
      unresolved_reasons: { call_ambiguous: 0, no_call_in_window: 0, invalid_phone: 0, submitter_not_found: 0, other: 0 },
      distinct_exact_agents: 1,
      distinct_any_agents: 1,
      qa: {
        coverage: { all_graded: 1, exact_agent_attributed: 1, agent_unavailable: 0 },
        outcomes: { pass: 0, flagged: 1 },
        alignment: { overlap_calls: 1, both_clear: 0, both_concern: 1, human_only: 0, ai_only: 0 },
        distinct_exact_agents: 1,
      },
    },
    representatives: {
      rows: [{
        achieve_agent_name: 'Representative A', achieve_agent_email: 'REP-A@example.test',
        total_submissions: 1, good: 0, fair: 0, poor: 1, other: 0,
        accent: 0, background_noise: 0, connection_issues: 0, latest_submitted_at: '2026-08-15T00:00:00Z',
        ai_total: 1, ai_pass: 0, ai_flagged: 1, latest_ai_graded_at: '2026-08-15T00:00:00Z',
        overlap_calls: 1, both_clear: 0, both_concern: 1, human_only: 0, ai_only: 0,
      }],
      coverage: { total: 1, loaded: 1, limit: 500, offset: 0, cap_reached: false },
    },
    marker: weeks,
  }
}

const raw = {
  generatedAt: '2026-08-17T13:00:00Z',
  completedThrough: '2026-08-17T04:00:00Z',
  periods: [2, 4, 6].map((weeks, index) => ({
    weeks,
    startAt: `2026-0${8 - index}-01T04:00:00Z`,
    endAt: '2026-08-17T04:00:00Z',
    dashboard: dashboard(weeks),
    representatives: [{
      agentEmail: 'rep-a@example.test', adjustedFormRisk: 75 - index, riskRank: 1,
      terminatedAt: '2026-08-16T04:00:00Z',
    }],
  })),
  persistentAgentEmails: ['rep-a@example.test'],
  terminations: [{
    agentName: 'Representative A',
    agentEmail: 'rep-a@example.test',
    terminatedAt: '2026-08-16T04:00:00Z',
    postTerminationFormSubmissions: 1,
    latestPostTerminationFormAt: '2026-08-17T01:00:00Z',
    postTerminationAiCalls: 0,
    latestPostTerminationAiAt: null,
  }],
}

const parsed = parseAchieveManagementReport(raw)
assert.strictEqual(achieveManagementPeriod(parsed, 4).weeks, 4)
assert.deepStrictEqual(persistentAchieveRepresentatives(parsed, 6).map(row => row.agentEmail), ['rep-a@example.test'])
assert.deepStrictEqual(persistentAchieveRanks(parsed).get('rep-a@example.test'), { 2: 1, 4: 1, 6: 1 })
assert.strictEqual(achieveManagementPeriod(parsed, 2).dashboard.representatives[0]?.terminatedAt, '2026-08-16T04:00:00Z')
assert.strictEqual(parsed.terminations[0]?.postTerminationFormSubmissions, 1)
assert.throws(
  () => parseAchieveManagementReport({ ...raw, persistentAgentEmails: ['missing@example.test'] }),
  /invalid_achieve_management_response/,
)
assert.throws(
  () => parseAchieveManagementReport({ ...raw, periods: raw.periods.slice(1) }),
  /invalid_achieve_management_response/,
)

console.log('achieve-management: all checks passed')
