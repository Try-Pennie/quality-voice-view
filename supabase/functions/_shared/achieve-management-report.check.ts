// Self-check for completed ET windows, Form-led ranking, intersection, and CSV.
// Run: npx tsx supabase/functions/_shared/achieve-management-report.check.ts
import assert from 'node:assert/strict'
import {
  achieveFirstPayOutcomesCsv,
  achieveManagementReportCsv,
  achieveReportWeekEnding,
  completedAchieveReportRanges,
  isAchieveReportDeliveryHour,
  loadAchieveManagementReport,
  type AchieveReportRange,
} from './achieve-management-report'

assert.deepStrictEqual(completedAchieveReportRanges(new Date('2026-08-19T12:00:00Z')), [
  { weeks: 2, startAt: '2026-08-03T04:00:00.000Z', endAt: '2026-08-17T04:00:00.000Z' },
  { weeks: 4, startAt: '2026-07-20T04:00:00.000Z', endAt: '2026-08-17T04:00:00.000Z' },
  { weeks: 6, startAt: '2026-07-06T04:00:00.000Z', endAt: '2026-08-17T04:00:00.000Z' },
])
assert.deepStrictEqual(completedAchieveReportRanges(new Date('2026-11-04T12:00:00Z'))[0], {
  weeks: 2,
  startAt: '2026-10-19T04:00:00.000Z',
  endAt: '2026-11-02T05:00:00.000Z',
})
assert.strictEqual(isAchieveReportDeliveryHour(new Date('2026-08-17T13:05:00Z')), true)
assert.strictEqual(isAchieveReportDeliveryHour(new Date('2026-12-07T14:05:00Z')), true)
assert.strictEqual(isAchieveReportDeliveryHour(new Date('2026-12-07T13:05:00Z')), false)

function dashboard(range: AchieveReportRange) {
  const lowIndex = range.weeks / 2 - 1
  const rows = Array.from({ length: 11 }, (_, index) => {
    const low = index === lowIndex
    const total = low ? 10 : index === 10 ? 1 : 2
    const poor = low ? 0 : index === 10 ? 1 : 1
    return {
      achieve_agent_name: index === 0 ? '=Representative 0' : `Representative ${index}`,
      achieve_agent_email: `rep-${index}@example.test`,
      total_submissions: total,
      good: total - poor,
      fair: 0,
      poor,
      other: 0,
      accent: 0,
      background_noise: 0,
      connection_issues: 0,
      latest_submitted_at: '2026-08-01T00:00:00Z',
      ai_total: 2,
      ai_pass: 1,
      ai_flagged: 1,
      latest_ai_graded_at: '2026-08-01T00:00:00Z',
      overlap_calls: 0,
      both_clear: 0,
      both_concern: 0,
      human_only: 0,
      ai_only: 0,
    }
  })
  rows.push({
    achieve_agent_name: 'AI only', achieve_agent_email: 'ai-only@example.test',
    total_submissions: 0, good: 0, fair: 0, poor: 0, other: 0,
    accent: 0, background_noise: 0, connection_issues: 0, latest_submitted_at: null,
    ai_total: 1, ai_pass: 1, ai_flagged: 0, latest_ai_graded_at: '2026-08-01T00:00:00Z',
    overlap_calls: 0, both_clear: 0, both_concern: 0, human_only: 0, ai_only: 0,
  })
  return {
    overview: { generated_at: '2026-08-19T12:00:00Z' },
    representatives: {
      rows,
      coverage: { total: rows.length, loaded: rows.length, limit: 500, offset: 0, cap_reached: false },
    },
  }
}

const rawOutcomes = {
  source_as_of: '2026-08-19',
  refreshed_at: '2026-08-19T11:00:00Z',
  maturity_cutoff: '2026-08-09',
  periods: ['all_time', 'mature_4_weeks', 'mature_6_weeks'].map(key => ({
    key,
    start_date: key === 'all_time' ? null : key === 'mature_4_weeks' ? '2026-07-13' : '2026-06-29',
    end_date: '2026-08-09',
    agents: [{
      agent_name: 'Outcome Agent', agent_email: 'outcome@example.test', n: 20,
      failures: 8, failure_rate: 40, expected_failures: 5, expected_successes: 15,
      expected_rate: 25, delta_pp: 15, z: 2.5, rescinded: 3, never_paid: 5,
      sample_qualified: true, rank: 1,
    }],
  })),
}

const loaded = await loadAchieveManagementReport(
  async range => ({ data: dashboard(range), error: null }),
  async () => ({ data: rawOutcomes, error: null }),
  async () => ({
    data: [{
      agent_name: 'Representative 3',
      agent_email: 'rep-3@example.test',
      terminated_at: '2026-08-18T04:00:00Z',
      activity: true,
      latest_activity_on: '2026-08-19',
    }],
    error: null,
  }),
  new Date('2026-08-19T12:00:00Z'),
)
assert.strictEqual(loaded.ok, true)
if (!loaded.ok) throw new Error('expected report')
assert.deepStrictEqual(loaded.report.persistentAgentEmails, [
  'rep-10@example.test',
  'rep-3@example.test',
  'rep-4@example.test',
  'rep-5@example.test',
  'rep-6@example.test',
  'rep-7@example.test',
  'rep-8@example.test',
  'rep-9@example.test',
])
const firstPeriod = loaded.report.periods[0]
assert.strictEqual(firstPeriod?.representatives.find(row => row.agentEmail === 'ai-only@example.test')?.riskRank, null)
assert.strictEqual(firstPeriod?.representatives.find(row => row.agentEmail === 'rep-3@example.test')?.terminatedAt, '2026-08-18T04:00:00Z')
assert.strictEqual(loaded.report.terminations[0]?.activity, true)
const oneOfOne = firstPeriod?.representatives.find(row => row.agentEmail === 'rep-10@example.test')
const oneOfTwo = firstPeriod?.representatives.find(row => row.agentEmail === 'rep-9@example.test')
assert.ok((oneOfOne?.adjustedFormRisk ?? 0) > (oneOfTwo?.adjustedFormRisk ?? 0))

assert.strictEqual(loaded.report.outcomes.periods[2]?.agents[0]?.z, 2.5)
assert.strictEqual(achieveReportWeekEnding(loaded.report), '2026-08-16')
const csv = achieveManagementReportCsv(loaded.report)
assert.ok(csv.startsWith('\uFEFF"Period","Period start (UTC)"'))
assert.ok(csv.includes('"Bottom 5 last 2 weeks"'))
assert.ok(csv.includes('"Activity after termination"'))
assert.ok(csv.includes('"2026-08-18T04:00:00Z"'))
assert.ok(csv.includes('"\'=Representative 0"'))
assert.strictEqual(csv.trim().split('\r\n').length, 1 + 12 * 3)
const outcomeCsv = achieveFirstPayOutcomesCsv(loaded.report.outcomes)
assert.ok(outcomeCsv.includes('"Outcome Agent"'))
assert.ok(outcomeCsv.includes('"2.5000"'))
assert.ok(outcomeCsv.includes('"all_time"'))
assert.ok(outcomeCsv.includes('"mature_4_weeks"'))
assert.ok(outcomeCsv.includes('"mature_6_weeks"'))
assert.strictEqual(outcomeCsv.trim().split('\r\n').length, 4)

assert.deepStrictEqual(
  await loadAchieveManagementReport(
    async () => ({ data: null, error: { code: 'db' } }),
    async () => ({ data: rawOutcomes, error: null }),
    async () => ({ data: [], error: null }),
    new Date(),
  ),
  { ok: false, reason: 'dashboard_query_failed' },
)

console.log('achieve-management-report: all checks passed')
