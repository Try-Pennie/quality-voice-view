import { expect, test } from '@playwright/test'
import { reviewFixture } from './review-fixture'

const day = '2026-09-21'
const metric = {
  agent_email: 'alpha@example.test', agent_full_name: 'Agent Alpha', bucket_day: day,
  call_count: 100, reviewable_call_count: 8, qa_count: 6,
  talk_time_sum: 480, talk_time_n: 8,
  compliance_pass_count: 5, compliance_total_count: 6,
  escalation_count: 2, csat_high_count: 4, csat_medium_count: 1, csat_low_count: 1,
  total_alerts_count: 0, open_alerts: 0, unreviewed_alerts: 0, false_positive_count: 0,
}
const beta = { ...metric, agent_email: 'beta@example.test', agent_full_name: 'Agent Beta', call_count: 20, reviewable_call_count: 12 }
const unscored = {
  ...metric, agent_email: 'unscored@example.test', agent_full_name: 'Agent Unscored',
  call_count: 50, reviewable_call_count: 3, qa_count: 0,
  compliance_pass_count: 0, compliance_total_count: 0, escalation_count: 0,
  csat_high_count: 0, csat_medium_count: 0, csat_low_count: 0,
}
const options = {
  god: true,
  dailyMetrics: [metric, beta, unscored],
  managerMapping: [
    { agent_email: metric.agent_email, manager_email: 'manager-a@example.test' },
    { agent_email: beta.agent_email, manager_email: 'manager-b@example.test' },
    { agent_email: unscored.agent_email, manager_email: 'manager-a@example.test' },
  ],
  managerNames: { 'manager-a@example.test': 'Manager Alpha', 'manager-b@example.test': 'Manager Beta' },
}
const url = `/dashboard/team?start=${day}&end=${day}&sort=call_count`

test('reviewable counts aggregate independently of QA and drive manager sorting and drilldown', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await reviewFixture(page, [], options)
  await page.goto(url)
  const teams = page.getByRole('region', { name: 'Team outcomes by manager', exact: true })
  await expect(teams.getByRole('columnheader', { name: 'Reviewable calls' })).toHaveAttribute('aria-sort', 'descending')
  const rows = teams.locator('tbody tr')
  await expect(rows.first()).toContainText('Manager Beta') // 12 reviewable / 20 total beats 11 / 150
  const alpha = rows.filter({ hasText: 'Manager Alpha' })
  await expect(alpha.getByRole('cell').nth(1)).toHaveText('11150 total calls')
  await expect(alpha.getByRole('cell').nth(2)).toHaveText('65 not yet evaluated')
  await expect(alpha.getByRole('cell').last()).toHaveText('33%') // 2/6, never 2/150 or 2/11
  await expect(teams).toContainText('pending or failed QA')
  await teams.screenshot({ path: testInfo.outputPath('reviewable-managers.png') })

  const representatives = page.getByRole('region', { name: 'Alerts by representative', exact: true })
  await representatives.getByRole('button', { name: 'More metrics', exact: true }).click()
  await expect(representatives.locator('tbody tr').first()).toContainText('Agent Beta')
  await alpha.getByRole('button', { name: 'Manager Alpha', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(representatives.locator('tbody tr')).toHaveCount(2)
  const alphaAgent = representatives.locator('tbody tr').filter({ hasText: 'Agent Alpha' })
  await expect(alphaAgent).toContainText('100 total calls')
  await expect(alphaAgent).toContainText('2 not yet evaluated')
  await alphaAgent.click()
  await expect(page).toHaveURL(/\/dashboard\/team\/alpha%40example.test/)
  await expect(page.getByText('8 reviewable calls · 100 total calls.', { exact: false })).toBeVisible()
  expect(errors).toEqual([])
})

test('selected manager derives its roster again when team dates change', async ({ page }) => {
  await reviewFixture(page, [], options)
  const mappingDates: string[] = []
  await page.route('**/rest/v1/rpc/agent_manager_mapping_at', route => {
    const { p_as_of } = route.request().postDataJSON() as { p_as_of: string }
    mappingDates.push(p_as_of)
    const current = p_as_of === '2026-09-07'
    return route.fulfill({ json: current ? options.managerMapping : [
      { agent_email: metric.agent_email, manager_email: 'manager-b@example.test' },
      { agent_email: beta.agent_email, manager_email: 'manager-a@example.test' },
      { agent_email: unscored.agent_email, manager_email: 'manager-b@example.test' },
    ] })
  })
  await page.goto('/dashboard/team?start=2026-09-07&end=2026-09-07')
  const teams = page.getByRole('region', { name: 'Team outcomes by manager', exact: true })
  await teams.getByRole('button', { name: 'Manager Alpha', exact: true }).click()
  const representatives = page.getByRole('region', { name: 'Alerts by representative', exact: true })
  await expect(representatives.locator('tbody tr')).toHaveCount(2)
  await expect(representatives).toContainText('Agent Alpha')
  await expect(representatives).toContainText('Agent Unscored')

  await page.getByRole('button', { name: /Date range:/ }).click()
  await page.getByRole('button', { name: 'Last month', exact: true }).click()
  await expect(page).toHaveURL(/start=2026-08-01&end=2026-08-31/)
  await expect.poll(() => mappingDates.at(-1)).toBe('2026-08-31')
  await expect(representatives.locator('tbody tr')).toHaveCount(1)
  await expect(representatives).toContainText('Agent Beta')
  await expect(representatives).not.toContainText('Agent Alpha')
  expect(new URL(page.url()).searchParams.get('mgr')).toBe('manager-a@example.test')
})

test('directors can clear a selected manager with no roster in the chosen range', async ({ page }) => {
  await reviewFixture(page, [], options)
  await page.goto(`${url}&mgr=missing-manager%40example.test`)
  await expect(page.getByText('The selected manager has no team in this date range.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear manager filter', exact: true }).click()
  await expect(page).not.toHaveURL(/[?&]mgr=/)
  await expect(page.getByRole('region', { name: 'Alerts by representative', exact: true }).locator('tbody tr')).toHaveCount(3)
})

test('ordinary managers can open director-shared manager links without losing their own team', async ({ page }) => {
  await reviewFixture(page, [], { ...options, god: false, managedAgents: [metric.agent_email], dailyMetrics: [metric] })
  await page.goto(`${url}&mgr=manager-b%40example.test`)
  const representatives = page.getByRole('region', { name: 'Alerts by representative', exact: true })
  await expect(representatives.locator('tbody tr')).toHaveCount(1)
  await expect(representatives).toContainText('Agent Alpha')
  await expect(page).not.toHaveURL(/[?&]mgr=/)
})

test('mobile shows pending coverage and does not treat unscored calls as AI failures', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await reviewFixture(page, [], options)
  await page.goto(url)
  const representatives = page.getByRole('region', { name: 'Alerts by representative', exact: true })
  await representatives.getByRole('button', { name: 'More metrics', exact: true }).click()
  const cards = representatives.locator('li')
  await expect(cards.first()).toContainText('Agent Beta')
  const pendingCard = cards.filter({ hasText: 'Agent Unscored' })
  await expect(pendingCard).toContainText('3 not yet evaluated')
  await expect(pendingCard).toContainText('50 total calls')
  await expect(pendingCard).toContainText('—')
  // Keep the sticky app header outside the component capture (same phone width).
  await page.setViewportSize({ width: 390, height: 1800 })
  await representatives.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 96))
  await representatives.screenshot({ path: testInfo.outputPath('reviewable-mobile.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'AI concerns or pending review', exact: true }).click()
  await expect(cards.filter({ hasText: 'Agent Unscored' })).toHaveCount(0)
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(width.document).toBeLessThanOrEqual(width.viewport)
})

test('coverage survives daily and team trend aggregation; missing RPC field is not silently zero', async ({ page }) => {
  await reviewFixture(page, [], options)
  await page.goto('/login')
  const result = await page.evaluate(async () => {
    const { aggregateTeamTrend, fetchTeamRollup, aggregateManagerRollups } = await import('/src/lib/team-queries.ts')
    const rollup = await fetchTeamRollup({ email: 'director@example.test', isGodMode: true, managedAgents: [] }, new Date(2026, 8, 21), new Date(2026, 8, 21, 23, 59))
    const trend = aggregateTeamTrend(rollup)
    const manager = aggregateManagerRollups(rollup, rollup.map(r => ({ agent_email: r.agent_email, manager_email: 'manager@example.test' })))[0]
    return { total: trend[0]?.call_count, reviewable: trend[0]?.reviewable_call_count, managerReviewable: manager?.reviewable_call_count, scored: manager?.qa_count }
  })
  expect(result).toEqual({ total: 170, reviewable: 23, managerReviewable: 23, scored: 12 })

  await page.route('**/rest/v1/rpc/team_daily_metrics**', route => route.fulfill({
    json: [{ ...metric, reviewable_call_count: undefined }],
  }))
  await page.goto(url)
  await expect(page.getByText("Couldn't load team metrics", { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Team outcomes by manager', exact: true })).toHaveCount(0)
})
