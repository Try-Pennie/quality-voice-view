import { test, expect } from '@playwright/test'
import { alertRow, FULL_QA_RESULT, reviewFixture } from './review-fixture'

test('agree alone saves without fabricated score confirmations or coaching, and reopens cleanly', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('decision-only')])
  await page.goto('/dashboard/alerts/decision-only/full_qa')
  const save = page.getByRole('button', { name: 'Save review', exact: true })
  await expect(save).toBeDisabled()
  const reviewSections = page.locator('h2, legend').filter({ hasText: /^(Scores to review|Was this alert warranted\?|Coaching issues \(optional\))$/ })
  const expectedOrder = ['Scores to review', 'Was this alert warranted?', 'Coaching issues (optional)']
  await expect(reviewSections).toHaveText(expectedOrder.slice(0, 2))
  await expect(page.getByRole('region', { name: 'Coaching issues', exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await expect(reviewSections).toHaveText(expectedOrder)
  await expect(page.getByRole('group', { name: 'Was this alert warranted?', exact: true }).getByRole('region', { name: 'Coaching issues', exact: true })).toBeVisible()
  await expect(save).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('agree-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(reviewSections).toHaveText(expectedOrder)
  await page.getByRole('group', { name: 'Was this alert warranted?', exact: true }).scrollIntoViewIfNeeded()
  await expect(save).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('agree-mobile.png'), animations: 'disabled' })
  await save.click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes).toContainEqual(expect.objectContaining({
    p_escalation_justified: true, p_escalation_reason: '', p_corrections: [], p_findings: [], p_action: null, p_action_details: null,
  }))
  expect(state.rows[0]).toMatchObject({ is_reviewed: true, action_taken: null })
  await page.goto('/dashboard/alerts/decision-only/full_qa')
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
  await expect(page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true })).toBeChecked()
  await expect(page.locator('[aria-label$=" disposition"] input:checked')).toHaveCount(0)
})

test('disagree needs only an explanation even when an AI score is missing', async ({ page }) => {
  const row = alertRow('missing-score-decision')
  row.result_json = { ...FULL_QA_RESULT, compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard, credit_pull_consent: null } }
  const state = await reviewFixture(page, [row])
  await page.goto('/dashboard/alerts/missing-score-decision/full_qa')
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const save = page.getByRole('button', { name: 'Save review', exact: true })
  await expect(save).toBeDisabled()
  await page.getByRole('textbox', { name: 'Explain your decision', exact: true }).fill('The customer gave verbal permission immediately before the credit pull.')
  await expect(save).toBeEnabled()
  await page.getByRole('radio', { name: 'Wrong context', exact: true }).check()
  await page.getByRole('button', { name: 'Clear reason category', exact: true }).click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes).toContainEqual(expect.objectContaining({ p_escalation_justified: false, p_inaccuracy_reason: null, p_corrections: [], p_action: null }))
})

test('agreement can retain mixed feedback without changing every score or writing a coaching issue', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('mixed-feedback')])
  await page.goto('/dashboard/alerts/mixed-feedback/full_qa')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  const note = 'The credit guarantee is a concern, but the interest claim was qualified. See 04:20.'
  await page.getByRole('textbox', { name: 'Feedback on Eavesly (optional)', exact: true }).fill(note)
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await consent.getByRole('radio', { name: 'Correct', exact: true }).check()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes).toContainEqual(expect.objectContaining({
    p_escalation_reason: note, p_corrections: [{ criterion_key: 'credit_pull_consent', disposition: 'confirmed', corrected_value: 'fail', reason: null }],
    p_findings: [], p_action: null,
  }))
})

test('optional responses can be cleared and call-level coaching survives a failed save without requiring findings', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('optional-followup')])
  await page.goto('/dashboard/alerts/optional-followup/full_qa')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  const save = page.getByRole('button', { name: 'Save review', exact: true })
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await consent.getByRole('radio', { name: 'Incorrect', exact: true }).check()
  await expect(save).toBeDisabled()
  await consent.getByRole('button', { name: 'Clear score response', exact: true }).click()
  await expect(save).toBeEnabled()
  const actions = page.getByRole('radiogroup', { name: 'Action taken', exact: true })
  await actions.getByRole('radio', { name: 'Coached the agent', exact: true }).check()
  await expect(save).toBeDisabled()
  await page.getByRole('button', { name: 'Clear optional follow-up', exact: true }).click()
  await expect(save).toBeEnabled()
  await actions.getByRole('radio', { name: 'Coached the agent', exact: true }).check()
  const note = 'Discussed this call in our scheduled one-to-one.'
  await page.getByRole('textbox', { name: 'What action did you take?', exact: true }).fill(note)
  state.failFeedback = true
  await save.click()
  await expect(page.getByText(/Couldn't save Full QA review/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'What action did you take?', exact: true })).toHaveValue(note)
  state.failFeedback = false
  await save.click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.fullQaReviews.get('optional-followup')).toMatchObject({ corrections: [], findings: [], action_taken: 'coached', action_details: note })
  await page.goto('/dashboard/alerts/optional-followup/full_qa')
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'What action did you take?', exact: true })).toHaveValue(note)
})

test('recurrence distinguishes missing category links from no coaching having happened', async ({ page }) => {
  await reviewFixture(page, [], { fullQaOccurrences: [{
    occurrence_kind: 'finding', call_id: 'category-only', feedback_revision: 1,
    call_started_at: '2026-09-06T12:00:00Z', window_basis: 'call_started_at', status: 'approved', confirmed: true,
    finding_id: 'finding-1', category: 'compliance', related_criteria: ['credit_pull_consent'],
    summary: 'An explicitly reviewed compliance issue.', evidence: 'The customer refused permission.',
    action_taken: null, action_details: null, review_saved_at: '2026-09-07T12:00:00Z',
    coaching_review_proxy_saved_at: null, coaching_timing: 'no_prior_recorded_coaching',
  }] })
  await page.goto('/dashboard/team/agent%40example.test?start=2026-08-09&end=2026-09-07')
  const panel = page.getByRole('region', { name: 'Approved Full QA recurrence', exact: true })
  await expect(panel).toContainText('No prior approved coaching linked to this category')
  await expect(panel).toContainText('Call-level coaching without linked issues stays on the call review')
  await expect(panel).not.toContainText('No prior approved coached review recorded')
})
