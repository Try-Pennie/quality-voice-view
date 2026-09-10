import { test, expect } from '@playwright/test'
import { alertRow, openAlert, reviewFixture } from './review-fixture'

test('browser Back and Forward can be cancelled without losing notes or corrupting history', async ({ page }) => {
  await reviewFixture(page, [alertRow('history-a'), alertRow('history-b')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'history-a')
  const firstUrl = page.url()
  await page.getByRole('button', { name: 'Next alert (j)', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Example history-b')
  const secondUrl = page.url()
  await page.goBack()
  await expect(page).toHaveURL(firstUrl)
  await page.getByRole('button', { name: 'Real issue (Y)', exact: true }).click()
  const note = page.getByRole('textbox', { name: 'What happened?' })
  await note.fill('Unsaved coaching notes survive browser history gestures until explicitly discarded.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.goBack()
  await expect(page).toHaveURL(firstUrl)
  await expect(note).toHaveValue('Unsaved coaching notes survive browser history gestures until explicitly discarded.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.goForward()
  await expect(page).toHaveURL(firstUrl)
  await expect(note).toHaveValue('Unsaved coaching notes survive browser history gestures until explicitly discarded.')
  page.once('dialog', dialog => dialog.accept())
  await page.goForward()
  await expect(page).toHaveURL(secondUrl)
  await expect(page.getByRole('dialog')).toContainText('Example history-b')
  await page.goBack()
  await expect(page).toHaveURL(firstUrl)
  await expect(page.getByRole('textbox', { name: 'What happened?' })).toHaveCount(0)
})

test('a mobile follow-up can inspect evidence and reach its save button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await reviewFixture(page, [alertRow('mobile-coaching', {
    is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: 'manager@example.test',
    violation_details: 'The required disclosure was omitted from the call.',
    action_details: 'Coaching is scheduled for our next one-to-one session.',
  })])
  await page.goto('/dashboard/alerts?status=coaching_due')
  await openAlert(page, 'mobile-coaching')
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toBeInViewport()
  await page.getByRole('button', { name: '1. Coached the agent', exact: true }).click()
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.rows[0].action_taken).toBe('coached')
})
