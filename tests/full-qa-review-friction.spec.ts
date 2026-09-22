import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

const summaries = ['Credit was pulled after the customer refused permission.', 'The agent guaranteed a debt-free date to the customer.']
const actionDetails = 'Coached the agent on consent and practiced accurate outcome language.'

test('warranted reviews save issue descriptions once, retain evidence, and reopen cleanly', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('less-typing')])
  await page.goto('/dashboard/alerts/less-typing/full_qa')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  for (const [index, criterion] of ['Credit pull consent', 'Accurate representations'].entries()) {
    await page.getByRole('article', { name: criterion, exact: true }).getByRole('button', { name: 'Add as coaching issue' }).click()
    await page.getByRole('textbox', { name: `Finding ${index + 1} summary` }).fill(summaries[index])
    // Saved evidence is reused, not retyped by the manager.
    await expect(page.getByRole('textbox', { name: `Finding ${index + 1} evidence` })).not.toHaveValue('')
  }
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await expect(page.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveCount(0)
  await page.getByRole('radiogroup', { name: 'Action taken', exact: true }).getByRole('radio', { name: 'Coached the agent', exact: true }).check()
  const action = page.getByRole('textbox', { name: 'What action did you take?', exact: true })
  await action.fill(actionDetails)
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeEnabled()

  // The optional review note survives verdict toggles and is never generated from issue text.
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const reason = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await expect(reason).toHaveValue('')
  await reason.fill('The two score flags concern the same underlying incident.')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await expect(reason).toHaveValue('The two score flags concern the same underlying incident.')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await expect(action).toHaveValue(actionDetails)

  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    if (width === 375) await page.getByRole('button', { name: 'Review', exact: true }).click()
    await action.scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`streamlined-followup-${width}.png`) })
  }
  state.failFeedback = true
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText(/Couldn't save Full QA review/)).toBeVisible()
  await expect(action).toHaveValue(actionDetails)
  state.failFeedback = false
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.fullQaReviews.get('less-typing')).toMatchObject({
    escalation_reason: 'The two score flags concern the same underlying incident.', action_details: actionDetails,
    findings: summaries.map(summary => expect.objectContaining({ summary })),
  })
  await page.goto('/dashboard/alerts/less-typing/full_qa?status=all')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Finding 1 summary' })).toHaveValue(summaries[0])
  await expect(action).toHaveValue(actionDetails)
  const changedSummary = 'The agent pulled credit without obtaining customer permission.'
  await page.getByRole('textbox', { name: 'Finding 1 summary' }).fill(changedSummary)
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect.poll(() => state.fullQaReviews.get('less-typing')?.feedback_revision).toBe(2)
  expect(state.fullQaReviews.get('less-typing')?.escalation_reason).toBe('The two score flags concern the same underlying incident.')

  // Reviews saved before this change have a separately typed overview. Merely
  // opening one must not dirty it or write a replacement revision.
  const saved = state.fullQaReviews.get('less-typing')
  if (!saved) throw new Error('Expected a saved review')
  state.fullQaReviews.set('less-typing', { ...saved, escalation_reason: 'An older separately written manager explanation.' })
  state.rows[0].violation_details = 'An older separately written manager explanation.'
  const writesBeforeReopen = state.writes.length
  await page.goto('/dashboard/alerts/less-typing/full_qa?status=all')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
  await expect(page.getByRole('contentinfo').getByRole('status')).toContainText('No unsaved review changes.')
  expect(state.writes).toHaveLength(writesBeforeReopen)
})

test('three logged issues guide directly to the missing summary and evidence, including on mobile', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('missing-fields')])
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/dashboard/alerts/missing-fields/full_qa')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  for (const criterion of ['Credit pull consent', 'Accurate representations', 'patience empathy']) {
    await page.getByRole('article', { name: criterion, exact: true }).getByRole('button', { name: 'Add as coaching issue' }).click()
  }
  await page.getByRole('textbox', { name: 'Finding 2 summary' }).fill(summaries[1])
  await page.getByRole('textbox', { name: 'Finding 3 summary' }).fill('The agent interrupted the customer during a question.')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await page.getByRole('radiogroup', { name: 'Action taken', exact: true }).getByRole('radio', { name: 'Coached the agent', exact: true }).check()
  await page.getByRole('textbox', { name: 'What action did you take?', exact: true }).fill(actionDetails)
  const status = page.getByRole('contentinfo').getByRole('status')
  const next = page.getByRole('button', { name: 'Continue review', exact: true })
  const firstSummary = page.getByRole('textbox', { name: 'Finding 1 summary' })
  await expect(status).toContainText('Issue 1: complete “What was the issue?” using 12–4,000 characters.')
  await next.click()
  await expect(firstSummary).toBeFocused()
  await expect(firstSummary).toBeInViewport()
  await expect(firstSummary).toHaveAttribute('aria-invalid', 'true')
  const hintId = await firstSummary.getAttribute('aria-describedby')
  expect(await page.locator(`[id="${hintId}"]`).evaluate(element => getComputedStyle(element).position)).not.toBe('absolute')
  await page.screenshot({ path: testInfo.outputPath('missing-issue-summary-mobile.png') })
  await firstSummary.fill('a'.repeat(11))
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await firstSummary.fill('a'.repeat(4001))
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await firstSummary.fill(summaries[0])
  await expect(status).toContainText('Issue 3: complete “Evidence” using 12–4,000 characters.')
  await next.click()
  const evidence = page.getByRole('textbox', { name: 'Finding 3 evidence' })
  await expect(evidence).toBeFocused()
  await expect(evidence).toBeInViewport()
  await evidence.fill('The manager heard repeated interruptions at 14:20.')
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect.poll(() => state.fullQaReviews.has('missing-fields')).toBe(true)
})

test('long optional issue descriptions remain complete without requiring a duplicate overview', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('long-issues')])
  await page.goto('/dashboard/alerts/long-issues/full_qa')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  const longSummaries = [summaries[0] + ' Detail.'.repeat(400), summaries[1] + ' Context.'.repeat(400)]
  for (const [index, criterion] of ['Credit pull consent', 'Accurate representations'].entries()) {
    await page.getByRole('article', { name: criterion, exact: true }).getByRole('button', { name: 'Add as coaching issue' }).click()
    await page.getByRole('textbox', { name: `Finding ${index + 1} summary` }).fill(longSummaries[index])
  }
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await page.getByRole('radiogroup', { name: 'Action taken', exact: true }).getByRole('radio', { name: 'Coached the agent', exact: true }).check()
  await page.getByRole('textbox', { name: 'What action did you take?', exact: true }).fill(actionDetails)
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect.poll(() => state.fullQaReviews.has('long-issues')).toBe(true)
  const saved = state.fullQaReviews.get('long-issues')
  expect(saved).toMatchObject({ findings: longSummaries.map(summary => expect.objectContaining({ summary })) })
  expect(saved?.escalation_reason).toBe('')
})
