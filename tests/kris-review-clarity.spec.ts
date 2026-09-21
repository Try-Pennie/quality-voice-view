import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

test('warranted alerts preserve issue descriptions and the action taken through save', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('clear-followup')])
  await page.goto('/dashboard/alerts/clear-followup/full_qa')
  const followup = page.getByRole('region', { name: 'Follow-up with the rep', exact: true })
  await expect(followup).toHaveCount(0)
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await expect(followup).toBeVisible()
  await expect(followup.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveCount(0)
  const action = followup.getByRole('textbox', { name: 'What action did you take?', exact: true })
  await expect(action).toBeVisible()
  await expect(action).toHaveAttribute('aria-required', 'true')
  await expect(action).toHaveAttribute('placeholder', 'Describe the coaching, escalation, or planned follow-up.')
  await expect(page.getByRole('textbox', { name: 'Explain your decision', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  for (const [index, criterion] of ['Credit pull consent', 'Accurate representations'].entries()) {
    await page.getByRole('article', { name: criterion, exact: true }).getByRole('button', { name: 'Add as coaching issue' }).click()
    await page.getByRole('textbox', { name: `What was the issue? Finding ${index + 1} summary`, exact: true }).fill(`Confirmed separate compliance issue ${index + 1} from this synthetic call.`)
  }
  await page.getByRole('button', { name: 'Continue review', exact: true }).click()
  await expect(followup.getByRole('heading', { name: 'How did you address it with the agent?', exact: true })).toBeFocused()
  await expect(followup).toBeInViewport()
  const actions = followup.getByRole('radiogroup', { name: 'Action taken', exact: true })
  await expect(actions.getByRole('radio', { checked: true })).toHaveCount(0)
  await actions.getByRole('radio', { name: 'Coached the agent', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(actions.getByRole('radio', { name: 'Coached the agent', exact: true })).toBeChecked()
  await action.fill('a'.repeat(11))
  await expect(action).toHaveAccessibleDescription(/12.*4,000.*11/)
  await expect(action).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Describe the action you took using 12–4,000 characters.')
  await action.fill('Reviewed both issues with the rep and practiced the approved language.')
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeEnabled()
  // Verdict changes preserve the action without inventing a dismissal explanation.
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await expect(page.getByRole('textbox', { name: 'Explain your decision', exact: true })).toHaveValue('')
  await expect(followup.getByRole('textbox', { name: 'Coaching or next steps', exact: true })).toHaveValue('Reviewed both issues with the rep and practiced the approved language.')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await expect(action).toHaveValue('Reviewed both issues with the rep and practiced the approved language.')
  await expect(actions.getByRole('radio', { name: 'Coached the agent', exact: true })).toBeChecked()
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await followup.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(112)
    for (const chip of await actions.locator('label').all()) {
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: testInfo.outputPath(`followup-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect.poll(() => state.fullQaReviews.has('clear-followup')).toBe(true)
  const saved = state.fullQaReviews.get('clear-followup')!
  expect(saved.action_details).toBe('Reviewed both issues with the rep and practiced the approved language.')
  expect(saved.escalation_reason).toBe([1, 2].map(index => `Confirmed separate compliance issue ${index} from this synthetic call.`).join('\n\n'))
  const kris = await page.context().newPage()
  await reviewFixture(kris, state.rows, { god: true, email: 'kris@example.test', fullQaReviews: state.fullQaReviews })
  await kris.goto('/dashboard/alerts/clear-followup/full_qa')
  const outcome = kris.getByRole('region', { name: 'Manager’s review', exact: true })
  await expect(outcome).toContainText(saved.action_details as string)
  await expect(outcome).toContainText(saved.escalation_reason as string)
  await expect(outcome.getByText('Review summary', { exact: true })).toBeVisible()
  await expect(outcome.getByText('What action did you take?', { exact: true })).toBeVisible()
  await expect(kris.getByRole('button', { name: 'Approve review', exact: true })).toBeEnabled()
  await page.goto('/dashboard/alerts/clear-followup/full_qa?status=all')
  await expect(page.getByRole('textbox', { name: 'Finding 1 summary' })).toHaveValue('Confirmed separate compliance issue 1 from this synthetic call.')
  await expect(action).toHaveValue(saved.action_details as string)
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
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
  await page.getByRole('radiogroup', { name: 'Why was the alert unnecessary?' }).getByRole('radio', { name: 'Wrong context', exact: true }).check()
  await expect(page.getByRole('region', { name: 'Follow-up with the rep' })).toContainText('No confirmed coaching issues. No follow-up required.')
  await expect(page.getByRole('textbox', { name: 'Coaching or next steps' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect.poll(() => state.fullQaReviews.has('no-followup')).toBe(true)
  expect(state.fullQaReviews.get('no-followup')?.action_details).toBeNull()
})
