import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

test('bulk approval bounds database writes and keeps failed reviews in the queue', async ({ page }) => {
  const state = await reviewFixture(page, Array.from({ length: 12 }, (_, index) => alertRow(`approve-${index}`, {
    is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: 'other-manager@example.test',
  })), { god: true })
  let release = () => {}
  state.decisionGate = new Promise<void>(resolve => { release = resolve })
  state.failedDecisionIds.add('approve-11')
  await page.goto('/dashboard/alerts')
  await page.getByRole('checkbox', { name: 'Select all approvable alerts' }).check()
  await page.getByRole('button', { name: 'Approve 12 reviews', exact: true }).click()
  await expect.poll(() => state.maxDecisionInFlight).toBe(10)
  release()
  await expect(page.getByText('Approved 11, 1 failed', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(1)
  expect(state.maxDecisionInFlight).toBe(10)
  expect(state.rows.filter(row => row.current_decision === 'approved')).toHaveLength(11)
  state.failedDecisionIds.clear()
  await page.getByRole('checkbox', { name: 'Select all approvable alerts' }).check()
  await page.getByRole('button', { name: 'Approve 1 review', exact: true }).click()
  await expect(page.getByText('No manager decisions await approval in this window.')).toBeVisible()
})
