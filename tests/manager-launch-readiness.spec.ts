import { expect, test } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

const agent = 'player-coach@example.test'
const manager = 'manager@example.test'

const terminalWeekMetric = {
  agent_email: agent,
  agent_full_name: 'Player Coach',
  bucket_day: '2026-09-21',
  call_count: 10,
  reviewable_call_count: 7,
  talk_time_sum: 2_000,
  talk_time_n: 10,
  qa_count: 5,
  compliance_pass_count: 4,
  compliance_total_count: 5,
  escalation_count: 2,
  csat_high_count: 3,
  csat_medium_count: 2,
  csat_low_count: 0,
  total_alerts_count: 0,
  open_alerts: 0,
  unreviewed_alerts: 0,
  false_positive_count: 0,
}

test('30-day rollup includes the terminal partial week and orders paginated RPC rows', async ({ page }) => {
  const state = await reviewFixture(page, [], { god: true, dailyMetrics: [terminalWeekMetric] })
  await page.goto('/login')

  const result = await page.evaluate(async ({ agentEmail }) => {
    const { fetchTeamRollup } = await import('/src/lib/team-queries.ts')
    const rows = await fetchTeamRollup(
      { email: 'director@example.test', isGodMode: true, managedAgents: [] },
      new Date(2026, 7, 23),
      new Date(2026, 8, 21, 23, 59, 59),
    )
    const row = rows.find(candidate => candidate.agent_email === agentEmail)
    return {
      calls: row?.call_count,
      trendCalls: row?.trend_points.reduce((sum, point) => sum + point.call_count, 0),
      buckets: row?.trend_points.map(point => point.bucket),
    }
  }, { agentEmail: agent })

  expect(result).toEqual({
    calls: 10,
    trendCalls: 10,
    buckets: ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'],
  })
  const request = state.requests.find(url => url.pathname.endsWith('/rpc/team_daily_metrics'))
  expect(request?.searchParams.get('order')).toBe('bucket_day.asc,agent_email.asc')
})

test('manager escalation rate uses AI-evaluated calls like the representative rate', async ({ page }) => {
  await reviewFixture(page, [], { god: true, dailyMetrics: [terminalWeekMetric] })
  await page.goto('/login')

  const result = await page.evaluate(async ({ agentEmail, managerEmail }) => {
    const { aggregateManagerRollups, fetchTeamRollup } = await import('/src/lib/team-queries.ts')
    const rows = await fetchTeamRollup(
      { email: 'director@example.test', isGodMode: true, managedAgents: [] },
      new Date(2026, 8, 21),
      new Date(2026, 8, 21, 23, 59, 59),
    )
    const managers = aggregateManagerRollups(rows, [
      { agent_email: agentEmail, manager_email: managerEmail },
    ])
    return {
      representative: rows[0]?.escalation_rate,
      manager: managers[0]?.escalation_rate,
    }
  }, { agentEmail: agent, managerEmail: manager })

  expect(result).toEqual({ representative: 40, manager: 40 })
})

test('director team totals preserve an alert-only player-coach absent from metrics', async ({ page }, testInfo) => {
  const unmappedAgent = 'unassigned-alert@example.test'
  await reviewFixture(page, [
    alertRow('alert-only', { agent_email: agent }),
    alertRow('unassigned-alert-only', { agent_email: unmappedAgent }),
  ], {
    god: true,
    managerMapping: [{ agent_email: agent, manager_email: manager }],
    managerNames: { [manager]: 'Manager Example' },
    dailyMetrics: [],
  })

  await page.goto('/dashboard/team?start=2026-08-23&end=2026-09-21')

  const teams = page.getByRole('region', { name: 'Team outcomes by manager', exact: true })
  const managerRow = teams.getByRole('row').filter({ hasText: 'Manager Example' })
  await expect(managerRow.getByRole('cell').first()).toHaveText('1')
  const unassignedRow = teams.getByRole('row').filter({ hasText: 'Unassigned agents' })
  await expect(unassignedRow.getByRole('cell').first()).toHaveText('1')

  const representatives = page.getByRole('region', { name: 'Alerts by representative', exact: true })
  await expect(representatives.getByRole('button', {
    name: `Filter ${agent} Received 1`,
    exact: true,
  })).toBeVisible()
  await expect(representatives.getByRole('button', {
    name: `Filter ${unmappedAgent} Received 1`,
    exact: true,
  })).toBeVisible()
  await page.getByRole('button', { name: 'Has open alerts', exact: true }).click()
  await expect(representatives.getByRole('button', {
    name: `Filter ${agent} Received 1`,
    exact: true,
  })).toBeVisible()
  await expect(representatives.getByRole('button', {
    name: `Filter ${unmappedAgent} Received 1`,
    exact: true,
  })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('manager-alert-only-director.png'),
    fullPage: true,
  })
})
