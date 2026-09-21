// Behavior check for canonical Achieve report selection, comparisons, and CSV.
// Run: npx tsx supabase/functions/_shared/achieve-management-report.check.ts
import assert from 'node:assert/strict'
import { runAchieveWeeklyReport, type AchieveWeeklyReportOperations } from '../achieve-weekly-report/orchestration'
import {
  achieveFirstPayOutcomesCsv,
  achieveManagementReportCsv,
  achieveReportWeekEnding,
  completedAchieveReportRanges,
  expectedAchieveSourceDate,
  isAcceptableAchieveSourceDate,
  isAchieveReportDeliveryHour,
  loadAchieveManagementReport,
  type AchieveDashboardRange,
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
assert.strictEqual(expectedAchieveSourceDate(new Date('2026-08-19T12:14:59Z')), '2026-08-18')
assert.strictEqual(expectedAchieveSourceDate(new Date('2026-08-19T12:15:00Z')), '2026-08-19')
assert.strictEqual(isAcceptableAchieveSourceDate('2026-08-19', new Date('2026-08-19T11:00:00Z')), true)
assert.strictEqual(isAcceptableAchieveSourceDate('2026-08-18', new Date('2026-08-19T11:00:00Z')), true)
assert.strictEqual(isAcceptableAchieveSourceDate('2026-08-18', new Date('2026-08-19T12:15:00Z')), false)
assert.strictEqual(isAcceptableAchieveSourceDate('2026-08-20', new Date('2026-08-19T11:00:00Z')), false)

type RowOverrides = Partial<{
  total: number
  negative: number
  accent: number
  noise: number
  connection: number
}>

function row(email: string, overrides: RowOverrides = {}) {
  const total = overrides.total ?? 4
  const negative = overrides.negative ?? 0
  return {
    achieve_agent_name: email === 'formula@example.test' ? '=Formula Agent' : email.split('@')[0],
    achieve_agent_email: email,
    total_submissions: total,
    good: total - negative,
    fair: negative,
    poor: 0,
    other: 0,
    accent: overrides.accent ?? 0,
    background_noise: overrides.noise ?? 0,
    connection_issues: overrides.connection ?? 0,
    latest_submitted_at: total === 0 ? null : '2026-08-15T12:00:00Z',
    ai_total: total === 0 ? 1 : total,
    ai_pass: total === 0 ? 1 : total - 1,
    ai_flagged: total === 0 ? 0 : 1,
    latest_ai_graded_at: '2026-08-15T12:00:00Z',
    overlap_calls: 0,
    both_clear: 0,
    both_concern: 0,
    human_only: 0,
    ai_only: 0,
  }
}

const currentByWeeks = {
  2: [
    row('persistent@example.test', { total: 4, negative: 3 }),
    row('latest-only@example.test', { total: 3, negative: 2 }),
    row('low-sample@example.test', { total: 2, negative: 2 }),
    row('one-negative@example.test', { total: 4, negative: 1 }),
    row('terminated@example.test', { total: 4, negative: 4 }),
    row('baseline@example.test', { total: 20, negative: 1 }),
  ],
  4: [
    row('persistent@example.test', { total: 6, negative: 4, accent: 2, noise: 1 }),
    row('bottom@example.test', { total: 3, negative: 3, connection: 1 }),
    row('activity-count@example.test', { total: 8, negative: 1, accent: 2, noise: 2, connection: 1 }),
    row('activity-rate@example.test', { total: 4, negative: 0, accent: 1, noise: 1 }),
    row('latest-only@example.test', { total: 4, negative: 1 }),
    row('terminated@example.test', { total: 5, negative: 5 }),
    row('formula@example.test', { total: 3, negative: 2 }),
    row('baseline@example.test', { total: 20, negative: 1 }),
  ],
  6: [
    row('persistent@example.test', { total: 8, negative: 4 }),
    row('latest-only@example.test', { total: 8, negative: 1 }),
    row('baseline@example.test', { total: 20, negative: 1 }),
  ],
} as const

function dashboard(range: AchieveDashboardRange) {
  let rows: ReadonlyArray<ReturnType<typeof row>>
  if (range.startAt === null) {
    rows = [row('all-time@example.test', { total: 10, negative: 3 })]
  } else if (range.endAt === '2026-08-17T04:00:00.000Z') {
    const days = Math.round((Date.parse(range.endAt) - Date.parse(range.startAt)) / 86_400_000)
    rows = currentByWeeks[(days / 7) as 2 | 4 | 6]
  } else {
    rows = [row(`prior-${range.startAt}@example.test`, { total: 10, negative: 2 })]
  }
  return {
    overview: { generated_at: '2026-08-19T12:00:00Z' },
    representatives: {
      rows,
      coverage: { total: rows.length, loaded: rows.length, limit: 500, offset: 0, cap_reached: false },
    },
  }
}

const cutoff = '2026-08-09'
const addCutoffMonths = (months: number) => {
  const date = new Date(`${cutoff}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}
const rawOutcomes = {
  source_as_of: '2026-08-19',
  refreshed_at: '2026-08-19T11:00:00Z',
  maturity_cutoff: cutoff,
  periods: (['all_time', 'mature_2_weeks', 'mature_4_weeks', 'mature_6_weeks', 'mature_6_months'] as const).map(key => {
    const days = key === 'mature_2_weeks' ? 13 : key === 'mature_4_weeks' ? 27 : 41
    const previousDays = key === 'mature_2_weeks' ? 27 : key === 'mature_4_weeks' ? 55 : 83
    const previousEndDays = key === 'mature_2_weeks' ? 14 : key === 'mature_4_weeks' ? 28 : 42
    const addDays = (amount: number) => {
      const date = new Date(`${cutoff}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + amount)
      return date.toISOString().slice(0, 10)
    }
    return {
      key,
      start_date: key === 'all_time' ? null : key === 'mature_6_months' ? '2026-02-10' : addDays(-days),
      end_date: cutoff,
      n: 20,
      paid: 12,
      previous_start_date: key === 'all_time' ? null : key === 'mature_6_months' ? '2025-08-10' : addDays(-previousDays),
      previous_end_date: key === 'all_time' ? null : key === 'mature_6_months' ? addCutoffMonths(-6) : addDays(-previousEndDays),
      previous_n: key === 'all_time' ? null : 10,
      previous_paid: key === 'all_time' ? null : 7,
      agents: [{
        agent_name: 'Outcome Agent', agent_email: 'outcome@example.test', n: 20,
        failures: 8, failure_rate: 40, expected_failures: 5, expected_successes: 15,
        expected_rate: 25, delta_pp: 15, z: 2.5, rescinded: 3, never_paid: 5,
        sample_qualified: true, rank: 1,
      }],
    }
  }),
}

const rawTerminationRows = [{
  agent_name: 'terminated',
  agent_email: 'terminated@example.test',
  terminated_at: '2026-08-10T04:00:00Z',
  activity_source_as_of: '2026-08-19',
  latest_post_term_enrollment_on: null,
  enrollments_post_termination: 0,
}]
const rawTerminations = { source_as_of: '2026-08-19', rows: rawTerminationRows }
const shiftIsoDate = (value: string | null, days: number) => {
  if (value === null) return null
  const shifted = new Date(`${value}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}
const previousOutcomes = {
  ...rawOutcomes,
  source_as_of: '2026-08-18',
  maturity_cutoff: '2026-08-08',
  periods: rawOutcomes.periods.map(period => ({
    ...period,
    start_date: shiftIsoDate(period.start_date, -1),
    end_date: shiftIsoDate(period.end_date, -1),
    previous_start_date: shiftIsoDate(period.previous_start_date, -1),
    previous_end_date: shiftIsoDate(period.previous_end_date, -1),
  })),
}
const previousTerminations = {
  source_as_of: '2026-08-18',
  rows: rawTerminationRows.map(item => ({ ...item, activity_source_as_of: '2026-08-18' })),
}

let activeDashboardLoads = 0
let maxDashboardLoads = 0
const loaded = await loadAchieveManagementReport(
  async range => {
    activeDashboardLoads++
    maxDashboardLoads = Math.max(maxDashboardLoads, activeDashboardLoads)
    await new Promise(resolve => setTimeout(resolve, 1))
    activeDashboardLoads--
    return { data: dashboard(range), error: null }
  },
  async () => ({ data: rawOutcomes, error: null }),
  async () => ({ data: rawTerminations, error: null }),
  new Date('2026-08-19T12:30:00Z'),
)
assert.strictEqual(loaded.ok, true)
assert.strictEqual(maxDashboardLoads, 1)
if (!loaded.ok) throw new Error('expected report')
assert.deepStrictEqual(loaded.report.highRiskAgentEmails, [
  'activity-count@example.test', 'activity-rate@example.test', 'persistent@example.test',
])
assert.deepStrictEqual(loaded.report.bottomTenNegativeReviewAgentEmails, [
  'bottom@example.test', 'persistent@example.test', 'formula@example.test', 'latest-only@example.test',
  'activity-count@example.test', 'baseline@example.test', 'activity-rate@example.test',
])
assert.deepStrictEqual(loaded.report.bottomTenIntelligibilityAgentEmails, [
  'persistent@example.test', 'activity-count@example.test', 'activity-rate@example.test',
])
assert.deepStrictEqual(loaded.report.bottomTenFirstPayAgentEmails, ['outcome@example.test'])
assert.ok(!loaded.report.bottomTenNegativeReviewAgentEmails.includes('terminated@example.test'))
assert.deepStrictEqual(loaded.report.reviewTrends.map(trend => ({
  weeks: trend.weeks,
  previousReviews: trend.previousReviews,
  previousNegativeReviews: trend.previousNegativeReviews,
})), [
  { weeks: 2, previousReviews: 10, previousNegativeReviews: 2 },
  { weeks: 4, previousReviews: 10, previousNegativeReviews: 2 },
  { weeks: 6, previousReviews: 10, previousNegativeReviews: 2 },
])
assert.strictEqual(loaded.report.allTimeNegativeReviews, 3)
assert.strictEqual(loaded.report.terminations[0]?.enrollmentsPostTermination, 0)
assert.strictEqual(loaded.report.terminations[0]?.latestPostTermEnrollmentOn, null)
assert.strictEqual(loaded.report.terminations[0]?.activitySourceAsOf, '2026-08-19')
assert.strictEqual(loaded.report.outcomes.periods[1]?.key, 'mature_2_weeks')
assert.strictEqual(achieveReportWeekEnding(loaded.report), '2026-08-16')
assert.deepStrictEqual(
  await loadAchieveManagementReport(
    async range => ({ data: dashboard(range), error: null }),
    async () => ({ data: rawOutcomes, error: null }),
    async () => ({
      data: {
        source_as_of: '2026-08-19',
        rows: [{ ...rawTerminationRows[0], enrollments_post_termination: 1 }],
      },
      error: null,
    }),
    new Date('2026-08-19T12:30:00Z'),
  ),
  { ok: false, reason: 'invalid_termination_response' },
)

const csv = achieveManagementReportCsv(loaded.report)
assert.ok(csv.includes('"High Risk Triangulation"'))
assert.ok(csv.includes('"Bottom 10 negative reviews"'))
assert.ok(csv.includes('"Bottom 10 intelligibility"'))
assert.ok(csv.includes('"Bottom 10 mature 6-week first pay"'))
assert.ok(csv.includes('"Bottom 10 mature 6-month first pay"'))
assert.ok(csv.includes('"All-time mature enrollments"'))
assert.ok(csv.includes('"Enrollments After Termination"'))
assert.ok(csv.includes('"Latest Post-Term Enrollment"'))
assert.ok(csv.includes('"\'=Formula Agent"'))
const outcomeCsv = achieveFirstPayOutcomesCsv(loaded.report.outcomes)
assert.ok(outcomeCsv.includes('"Organization enrollments"'))
assert.ok(outcomeCsv.includes('"Previous enrollments"'))
assert.ok(outcomeCsv.includes('"mature_2_weeks"'))
assert.ok(outcomeCsv.includes('"mature_6_months"'))
assert.strictEqual(outcomeCsv.trim().split('\r\n').length, 6)

assert.deepStrictEqual(
  await loadAchieveManagementReport(
    async () => ({ data: null, error: { code: 'db' } }),
    async () => ({ data: rawOutcomes, error: null }),
    async () => ({ data: rawTerminations, error: null }),
    new Date(),
  ),
  { ok: false, reason: 'dashboard_query_failed' },
)

for (const [label, outcomes, terminations] of [
  ['early current', rawOutcomes, rawTerminations],
  ['early yesterday', previousOutcomes, previousTerminations],
] as const) {
  const result = await loadAchieveManagementReport(
    async range => ({ data: dashboard(range), error: null }),
    async () => ({ data: outcomes, error: null }),
    async () => ({ data: terminations, error: null }),
    new Date('2026-08-19T11:00:00Z'),
  )
  assert.strictEqual(result.ok, true, `${label} snapshots must remain valid before the daily deadline`)
}

for (const [label, outcomes, terminations] of [
  ['stale', previousOutcomes, previousTerminations],
  ['future', { ...rawOutcomes, source_as_of: '2026-08-20', maturity_cutoff: '2026-08-10' }, { ...rawTerminations, source_as_of: '2026-08-20', rows: rawTerminationRows.map(item => ({ ...item, activity_source_as_of: '2026-08-20' })) }],
  ['mixed', rawOutcomes, { ...rawTerminations, source_as_of: '2026-08-18', rows: rawTerminationRows.map(item => ({ ...item, activity_source_as_of: '2026-08-18' })) }],
] as const) {
  const result = await loadAchieveManagementReport(
    async range => ({ data: dashboard(range), error: null }),
    async () => ({ data: outcomes, error: null }),
    async () => ({ data: terminations, error: null }),
    new Date('2026-08-19T12:30:00Z'),
  )
  assert.deepStrictEqual(result, { ok: false, reason: 'snapshot_freshness_failed' }, `${label} snapshots must fail closed`)
}

const emptyTerminations = await loadAchieveManagementReport(
  async range => ({ data: dashboard(range), error: null }),
  async () => ({ data: rawOutcomes, error: null }),
  async () => ({ data: { source_as_of: '2026-08-19', rows: [] }, error: null }),
  new Date('2026-08-19T12:30:00Z'),
)
assert.ok(emptyTerminations.ok && emptyTerminations.report.terminations.length === 0,
  'A fresh empty termination window remains a valid report')

assert.deepStrictEqual(
  await loadAchieveManagementReport(
    async range => ({ data: dashboard(range), error: null }),
    async () => ({ data: rawOutcomes, error: null }),
    async () => ({ data: { rows: rawTerminationRows }, error: null }),
    new Date('2026-08-19T12:30:00Z'),
  ),
  { ok: false, reason: 'invalid_termination_response' },
  'Missing termination snapshot metadata must fail closed',
)

const orchestrationCalls: Array<string> = []
const controller = new AbortController()
const operations: AchieveWeeklyReportOperations = {
  loadReport: async (_now, options) => {
    assert.strictEqual(options.signal, controller.signal)
    orchestrationCalls.push('load')
    return loaded
  },
  prepareEmail: async (_report, internalOnly, options) => {
    assert.strictEqual(options.signal, controller.signal)
    orchestrationCalls.push(internalOnly ? 'prepare_internal' : 'prepare')
    return { raw: 'mime' }
  },
  accessToken: async options => {
    assert.strictEqual(options.signal, controller.signal)
    orchestrationCalls.push('token')
    return 'token'
  },
  claimDelivery: async (_week, options) => {
    assert.strictEqual(options.signal, controller.signal)
    orchestrationCalls.push('claim')
    return 'claimed'
  },
  sendEmail: async (_raw, _token, options) => {
    assert.strictEqual(options.signal, controller.signal)
    orchestrationCalls.push('send')
    throw new Error('ambiguous provider response')
  },
  markSent: async () => {
    orchestrationCalls.push('mark')
  },
}
const ambiguousSend = await runAchieveWeeklyReport(
  { action: 'send', week_ending: '2026-08-16' },
  new Date('2026-08-19T12:30:00Z'),
  controller.signal,
  operations,
)
assert.deepStrictEqual(ambiguousSend, {
  ok: false,
  status: 500,
  error: 'weekly_report_failed',
  stage: 'gmail_send',
  claimRetained: true,
})
assert.deepStrictEqual(orchestrationCalls, ['load', 'prepare', 'token', 'claim', 'send'])

orchestrationCalls.length = 0
const rejectedBeforeDelivery = await runAchieveWeeklyReport(
  { action: 'scheduled' },
  new Date('2026-08-17T13:05:00Z'),
  controller.signal,
  { ...operations, loadReport: async () => ({ ok: false, reason: 'snapshot_freshness_failed' }) },
)
assert.deepStrictEqual(rejectedBeforeDelivery, {
  ok: false,
  status: 500,
  error: 'snapshot_freshness_failed',
  stage: 'report_load',
  claimRetained: false,
})
assert.deepStrictEqual(orchestrationCalls, [], 'Freshness failure must precede preparation, claim, and Gmail')

console.log('achieve-management-report: all checks passed')
