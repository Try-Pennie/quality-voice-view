import { test, expect } from '@playwright/test'
import { alertRow, NOW, reviewFixture } from './review-fixture'
import { firstReviewAgeBucket } from '../src/lib/alert-review-queue'

const manager = 'owner@example.test'
const agent = 'agent@example.test'
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

test('first-review age uses elapsed boundaries, excludes human/system decisions, and preserves unknowns', () => {
  for (const [hours, bucket] of [[0, 'within_24h'], [24, 'within_24h'], [24.01, 'hours_24_48'], [48, 'hours_24_48'], [48.01, 'hours_48_72'], [72, 'hours_48_72'], [72.01, 'over_72h']] as const) {
    expect(firstReviewAgeBucket(alertRow('boundary', { alert_created_at: hoursAgo(hours) }), NOW.getTime())).toBe(bucket)
  }
  for (const date of ['invalid', hoursAgo(-1)]) expect(firstReviewAgeBucket(alertRow('unknown', { alert_created_at: date }), NOW.getTime())).toBe('unknown')
  expect(firstReviewAgeBucket(alertRow('saved', { is_reviewed: true, accurate: false, feedback_by: manager }), NOW.getTime())).toBeNull()
  expect(firstReviewAgeBucket(alertRow('system', { is_reviewed: true, accurate: true, feedback_by: 'system@pennie' }), NOW.getTime())).toBeNull()
  expect(firstReviewAgeBucket(alertRow('incomplete', { is_reviewed: true, accurate: null, feedback_by: manager, alert_created_at: hoursAgo(30) }), NOW.getTime())).toBe('hours_24_48')
  expect(firstReviewAgeBucket(alertRow('dst', { alert_created_at: '2026-03-07T17:00:00Z' }), Date.parse('2026-03-08T16:00:00Z'))).toBe('within_24h')
})

test('queue makes period and filtered versus broader counts explicit', async ({ page }) => {
  await reviewFixture(page, [alertRow('sample'), alertRow('another')])
  await page.goto('/dashboard/alerts?range=outstanding&status=awaiting_manager&search=sample')
  await expect(page.getByRole('button', { name: 'Date range', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Review', exact: true })).toBeVisible()
  await expect(page.getByText('Showing 1 of 2 in this queue.', { exact: true })).toBeVisible()
  await page.getByText('Outstanding by next action', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filter all-time First reviews 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Filter all-time First reviews 2' }).click()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(2)
  await expect(page.getByText(/Showing \d+ of \d+ in this queue\./)).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Queue' }).getByRole('option', { name: 'Changes requested by Kris' })).toHaveCount(1)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Open menu', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Review', exact: true })).toBeVisible()
})

test('manager aging drilldowns reconcile all-time first reviews and survive reload', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [
    alertRow('fresh', { assigned_manager_email: manager, alert_created_at: hoursAgo(5) }),
    alertRow('late', { assigned_manager_email: manager, alert_created_at: hoursAgo(30) }),
    alertRow('later', { assigned_manager_email: manager, alert_created_at: hoursAgo(60) }),
    alertRow('oldest', { assigned_manager_email: manager, alert_created_at: '2026-01-01T16:00:00Z' }),
    alertRow('future', { assigned_manager_email: manager, alert_created_at: hoursAgo(-1) }),
    alertRow('returned', { assigned_manager_email: manager, is_reviewed: true, accurate: false, feedback_by: manager, current_decision: 'changes_requested' }),
    alertRow('system', { assigned_manager_email: manager, is_reviewed: true, accurate: true, feedback_by: 'system@pennie' }),
  ], { god: true, managerNames: { [manager]: 'Manager Alpha' } })
  await page.goto('/dashboard/alerts?range=outstanding&status=awaiting_manager')
  await page.getByText('Manager response times', { exact: true }).click()
  expect(state.requests.some(url => url.searchParams.get('or')?.includes('accurate.is.null'))).toBe(true)
  const aging = page.getByRole('region', { name: 'Manager response times' })
  for (const label of ['Within 24h', '24–48h', '48–72h', 'Over 72h', 'Age unknown']) {
    await expect(aging.getByRole('button', { name: `Filter Manager Alpha ${label} 1`, exact: true })).toBeVisible()
  }
  await expect(aging.getByRole('button', { name: 'Filter Manager Alpha Awaiting review 5' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('manager-aging-desktop.png'), fullPage: true })
  await aging.getByRole('button', { name: 'Filter Manager Alpha Over 72h 1' }).click()
  await expect(page.getByRole('button', { name: /Review .* Example oldest/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(1)
  expect(new URL(page.url()).searchParams.get('age')).toBe('over_72h')
  await page.reload()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(1)
  await page.getByRole('button', { name: 'Age: Over 72h ×', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(5)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByText('Manager response times', { exact: true }).click()
  await expect(aging).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('manager-aging-mobile.png'), fullPage: true })
})

test('god-mode team outcomes sort visibly and retain historical team filtering and AI details', async ({ page }, testInfo) => {
  const other = 'other-agent@example.test'
  await reviewFixture(page, [
    alertRow('alpha', { agent_email: agent, is_reviewed: true, accurate: true, feedback_by: manager }),
    alertRow('beta-one', { agent_email: other, is_reviewed: true, accurate: true, feedback_by: manager }),
    alertRow('beta-two', { agent_email: other, is_reviewed: true, accurate: true, feedback_by: manager }),
  ], { god: true, managerNames: { [manager]: 'Manager Alpha', 'second@example.test': 'Manager Beta' },
    managerMapping: [{ agent_email: agent, manager_email: manager }, { agent_email: other, manager_email: 'second@example.test' }],
    dailyMetrics: [{ agent_email: agent, agent_full_name: 'Agent Alpha', bucket_day: '2026-09-04', call_count: 100, reviewable_call_count: 12, qa_count: 10 }, { agent_email: other, agent_full_name: 'Agent Beta', bucket_day: '2026-09-04', call_count: 5, reviewable_call_count: 5, qa_count: 5 }],
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07')
  const trends = page.locator('details').filter({ has: page.getByText('AI trends and call metrics', { exact: true }) })
  await trends.locator('summary').click()
  await expect(trends.locator('.recharts-surface').first()).toBeVisible()
  for (const chart of await trends.locator('.recharts-surface').all()) {
    const box = await chart.boundingBox()
    expect(box?.width).toBeGreaterThan(100)
    expect(box?.height).toBeGreaterThan(100)
  }
  expect(errors).toEqual([])
  await trends.locator('summary').click()
  const teams = page.getByRole('region', { name: 'Team outcomes by manager', exact: true })
  await expect(teams.getByRole('row').nth(1)).toContainText('Manager Beta')
  await expect(teams.getByRole('columnheader', { name: /Warranted/ })).toHaveAttribute('aria-sort', 'descending')
  await teams.getByRole('button', { name: 'Manager Alpha', exact: true }).click()
  const reps = page.getByRole('region', { name: 'Alerts by representative', exact: true })
  await expect(reps.getByRole('button', { name: 'Filter Agent Alpha Warranted 1' })).toBeVisible()
  await expect(reps.getByRole('button', { name: /Filter Agent Beta/ })).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe('/dashboard/team')
  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07&sort=compliance_pass_rate')
  await expect(teams.getByRole('columnheader', { name: /AI compliance/ })).toHaveAttribute('aria-sort', 'descending')
  await expect(teams.getByRole('button', { name: 'Team alert outcomes', exact: true })).toBeVisible()
  await teams.getByRole('button', { name: 'Team alert outcomes', exact: true }).click()
  await expect(teams.getByRole('columnheader', { name: /Warranted/ })).toHaveAttribute('aria-sort', 'descending')
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('team-outcomes-mobile.png'), fullPage: true })
})

test('representative outcomes show review coverage and exact warranted-alert drilldown', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [
    alertRow('confirmed', { agent_email: agent, is_reviewed: true, accurate: true, feedback_by: manager }),
    alertRow('unnecessary', { agent_email: agent, is_reviewed: true, accurate: false, feedback_by: manager }),
    alertRow('pending', { agent_email: agent }),
  ], { dailyMetrics: [{ agent_email: agent, agent_full_name: 'Agent Alpha', bucket_day: '2026-09-04', call_count: 10, reviewable_call_count: 9, qa_count: 8 }] })
  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07')
  const outcomes = page.getByRole('region', { name: 'Alerts by representative' })
  await expect(outcomes.getByText('2 / 3 reviewed', { exact: true }).first()).toBeVisible()
  await expect(outcomes.getByRole('button', { name: 'Filter Agent Alpha Warranted 1', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('rep-outcomes-desktop.png'), fullPage: true })
  await outcomes.getByRole('button', { name: 'Filter Agent Alpha Warranted 1', exact: true }).click()
  const url = new URL(page.url())
  expect(url.searchParams.get('agent')).toBe(agent)
  expect(url.searchParams.get('outcome')).toBe('real')
  expect(url.searchParams.get('status')).toBe('reviewed')
  expect(url.searchParams.get('start')).toBe('2026-08-09')
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(1)
  expect(state.writes).toEqual([])
})
