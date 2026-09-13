import { test, expect } from '@playwright/test'
import { alertRow, EMAIL, openAlert, reviewFixture } from './review-fixture'

test('table paging and J/K share the full ordered queue', async ({ page }) => {
  await reviewFixture(page, Array.from({ length: 52 }, (_, i) => alertRow(`page-${String(i).padStart(2, '0')}`)))
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await expect(page.getByText('Showing 1–50 of 52 alerts')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(50)
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.getByText('Showing 51–52 of 52 alerts')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(2)
  await page.getByRole('button', { name: 'Review next' }).click()
  await expect(page.getByRole('dialog')).toContainText('Example page-50')
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  // Starting J on page two starts at that page, not at the beginning of the queue.
  await page.keyboard.press('j')
  // Enter from a page button retains native behavior, so focus a table row first.
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example page-50', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('51 of 52')
  await page.getByRole('button', { name: 'Next alert (j)', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Example page-51')
  await expect(page.getByRole('button', { name: 'Next alert (j)', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Previous alert (k)', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Example page-50')
})

test('saving a still-deferred review does not advance or clear follow-up', async ({ page }) => {
  const state = await reviewFixture(page, ['first', 'second'].map(id => alertRow(id, {
    is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: EMAIL,
    violation_details: 'The required disclosure was omitted from the call.',
    action_details: 'Waiting until the next coaching session to discuss this.',
  })))
  await page.goto('/dashboard/alerts?status=coaching_due')
  await openAlert(page, 'first')
  await page.getByRole('textbox', { name: 'What action did you take?' }).fill('Still waiting for the next coaching session, which is now scheduled for Thursday.')
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Example first')
  expect(state.rows.filter(row => row.action_taken === 'follow_up_later')).toHaveLength(2)
})

test('transcript loading is visible and a call switch cannot show the prior transcript', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('first'), alertRow('second')])
  let release = () => {}
  state.transcriptGate = new Promise<void>(resolve => { release = resolve })
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'first')
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await expect(page.getByText('Loading transcript…', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next alert (j)', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Example second')
  release()
  await expect(page.getByRole('searchbox', { name: 'Search transcript' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await expect(page.getByRole('searchbox', { name: 'Search transcript' })).toBeVisible()
  expect(state.requests.some(url => url.searchParams.get('call_id') === 'eq.second' && url.pathname.endsWith('/eavesly_transcription_qa'))).toBe(true)
})

test('desktop feature screenshots with synthetic review data', async ({ page }, testInfo) => {
  await reviewFixture(page, [alertRow('older'), alertRow('recent', { alert_created_at: '2026-09-06T14:00:00Z' }), alertRow('follow-up', {
    is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: EMAIL,
    violation_details: 'The required disclosure was omitted from the call.',
    action_details: 'Scheduled coaching to review the disclosure and call evidence.',
  })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await expect(page.getByText('2 ready for first review', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('overdue-desktop.png'), fullPage: true })
  await page.getByRole('combobox', { name: 'Queue' }).selectOption('coaching_due')
  await expect(page.getByText('1 coaching due', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('follow-up-desktop.png'), fullPage: true })
  await openAlert(page, 'follow-up')
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.getByText('1 of 2 evidence passages', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('evidence-desktop.png') })
})
