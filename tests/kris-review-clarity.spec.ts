import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

test('follow-up is discoverable before issues and Continue review targets its required inputs', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('clear-followup')])
  await page.goto('/dashboard/alerts/clear-followup/full_qa')
  const followup = page.getByRole('region', { name: 'Follow-up with the rep', exact: true })
  await expect(followup).toBeVisible()
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await expect(followup).toContainText('Add the confirmed issues above')
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  for (const [index, criterion] of ['Credit pull consent', 'Accurate representations'].entries()) {
    await page.getByRole('article', { name: criterion, exact: true }).getByRole('button', { name: 'Add as coaching issue' }).click()
    await page.getByRole('textbox', { name: `What was the issue? Finding ${index + 1} summary`, exact: true }).fill(`Confirmed separate compliance issue ${index + 1} from this synthetic call.`)
  }
  await page.getByRole('textbox', { name: 'Explain your decision', exact: true }).fill('Two separate confirmed compliance issues warrant this alert.')
  await page.getByRole('button', { name: 'Continue review', exact: true }).click()
  await expect(followup.getByRole('heading', { name: 'Follow-up with the rep', exact: true })).toBeFocused()
  await expect(followup).toBeInViewport()
  await followup.getByRole('combobox', { name: 'What did you do about the issue?', exact: true }).selectOption('coached')
  await followup.getByRole('textbox', { name: 'Coaching or next steps', exact: true }).fill('Reviewed both issues with the rep and practiced the approved language.')
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeEnabled()
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await followup.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`followup-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect.poll(() => state.fullQaReviews.has('clear-followup')).toBe(true)
  const saved = state.fullQaReviews.get('clear-followup')!
  expect(saved.action_details).toBe('Reviewed both issues with the rep and practiced the approved language.')
  expect(saved.escalation_reason).toBe('Two separate confirmed compliance issues warrant this alert.')
  const kris = await page.context().newPage()
  await reviewFixture(kris, state.rows, { god: true, email: 'kris@example.test', fullQaReviews: state.fullQaReviews })
  await kris.goto('/dashboard/alerts/clear-followup/full_qa')
  const outcome = kris.getByRole('region', { name: 'Manager’s review', exact: true })
  await expect(outcome).toContainText(saved.action_details as string)
  await expect(outcome).toContainText(saved.escalation_reason as string)
  await expect(kris.getByRole('button', { name: 'Approve review', exact: true })).toBeEnabled()
})

test('returned instructions survive a failed detail fetch and name the requesting reviewer', async ({ page }) => {
  const instructions = 'Please document the follow-up date and what the rep will practice.'
  const state = await reviewFixture(page, [alertRow('returned-instructions', {
    is_reviewed: true, accurate: true, review_revision: 1,
    feedback_by: 'manager@example.test', assigned_manager_email: 'manager@example.test',
    current_decision: 'changes_requested', current_decision_id: 12,
    current_decision_by: 'director.one@example.test', current_decision_instructions: instructions,
  })])
  await page.route('**/rest/v1/eavesly_alerts_with_feedback?*', route => {
    const url = new URL(route.request().url())
    return url.searchParams.get('select') === '*'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic detail failure' }) })
      : route.fallback()
  })
  await page.goto('/dashboard/alerts/returned-instructions/full_qa?status=changes_requested')
  await expect(page.getByRole('button', { name: 'Retry recording', exact: true })).toBeVisible()
  await expect(page.getByText('Changes requested by director.one', { exact: true })).toBeVisible()
  await expect(page.getByText(instructions, { exact: true })).toHaveCount(1)
  expect(state.requests.some(url => url.searchParams.get('select')?.includes('current_decision_instructions'))).toBe(true)
})

test('unnecessary alert with no retained issues requires no invented follow-up', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('no-followup')])
  await page.goto('/dashboard/alerts/no-followup/full_qa')
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await page.getByRole('textbox', { name: 'Explain your decision', exact: true }).fill('The recorded evidence does not support an escalation on this call.')
  await page.getByRole('combobox', { name: 'Why was the alert unnecessary?' }).selectOption('wrong_context')
  await expect(page.getByRole('region', { name: 'Follow-up with the rep' })).toContainText('No confirmed coaching issues. No follow-up required.')
  await expect(page.getByRole('textbox', { name: 'Coaching or next steps' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect.poll(() => state.fullQaReviews.has('no-followup')).toBe(true)
  expect(state.fullQaReviews.get('no-followup')?.action_details).toBeNull()
})
