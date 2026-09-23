import { test, expect } from '@playwright/test'
import { alertRow, FULL_QA_CRITERIA, FULL_QA_RESULT, reviewFixture } from './review-fixture'

for (const god of [false, true]) test(`Help shortcut preserves ${god ? 'Kris instructions' : 'manager review'} and explicit close still asks`, async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('help-draft', god ? {
    is_reviewed: true, feedback_id: 1, feedback_by: 'another.manager@example.test', review_revision: 1, accurate: false,
  } : {})], { god })
  await page.goto('/dashboard/alerts/help-draft/full_qa')
  await page.getByRole('button', { name: god ? 'Request changes' : 'Your decision', exact: true }).click()
  if (!god) await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const draft = page.getByRole('textbox', { name: god ? /Request changes with instructions/ : 'Explain your decision' })
  await draft.fill('Keep this unsaved draft intact.')
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).focus()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(draft).toHaveValue('Keep this unsaved draft intact.')
  await expect(page).toHaveURL(/\/dashboard\/alerts\/help-draft\/full_qa/)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(draft).toHaveValue('Keep this unsaved draft intact.')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('?')
  await expect(page).toHaveURL(/\/dashboard\/help$/)
  expect(state.writes).toEqual([])
})

test('Full QA explains text limits at the field and preserves the existing validation boundary', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('text-guidance')])
  await page.goto('/dashboard/alerts/text-guidance/full_qa')
  await page.getByRole('button', { name: 'Your decision', exact: true }).click()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await page.getByRole('radiogroup', { name: 'Why was the alert unnecessary?' }).getByRole('radio', { name: 'Wrong context', exact: true }).check()
  const reason = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await reason.fill('a'.repeat(11))
  await expect(reason).toHaveAccessibleDescription(/12.*4,000.*11/)
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await expect(page.getByRole('contentinfo').getByRole('status')).toContainText('Explain your decision using 12–4,000 characters.')
  await page.screenshot({ path: testInfo.outputPath('manager-text-guidance.png') })
  await reason.fill('a'.repeat(12))
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeEnabled()
  await reason.fill('a'.repeat(4000))
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeEnabled()
  // Overlong input remains visible for correction rather than being silently truncated.
  await reason.fill('a'.repeat(4001))
  await expect(reason).toHaveAccessibleDescription(/4,001/)
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  expect(state.writes).toEqual([])
})

test('a legacy review without a structured snapshot still saves against its existing revision', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('legacy-lock', { is_reviewed: true, feedback_id: 1, feedback_by: 'manager@example.test', review_revision: 3, accurate: false })])
  await page.goto('/dashboard/alerts/legacy-lock/full_qa?status=all')
  await expect(page.getByText('Earlier manager review', { exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await page.getByRole('textbox', { name: 'Explain your decision', exact: true }).fill('The existing review is now being replaced with an explicit structured review.')
  await page.getByRole('radiogroup', { name: 'Why was the alert unnecessary?' }).getByRole('radio', { name: 'Wrong context', exact: true }).check()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes[0]).toMatchObject({ p_expected_revision: 3, p_expected_decision_id: null })
  expect(state.rows[0].review_revision).toBe(4)
})

test('Kris can see why Request changes is disabled', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('instruction-guidance', {
    is_reviewed: true, feedback_id: 1, feedback_by: 'another.manager@example.test', review_revision: 1, accurate: false,
  })], { god: true })
  await page.goto('/dashboard/alerts/instruction-guidance/full_qa')
  const request = page.getByRole('button', { name: 'Request changes', exact: true })
  await request.click()
  const instructions = page.getByRole('textbox', { name: /Request changes with instructions/ })
  await expect(instructions).toBeFocused()
  await expect(instructions).toHaveAccessibleDescription(/12.*4,000/)
  await expect(page.getByText('Add at least 12 characters of instructions to request changes.', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('kris-change-guidance.png') })
  await instructions.fill('a'.repeat(11))
  await expect(request).toBeDisabled()
  await instructions.fill('a'.repeat(12))
  await expect(request).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toBeDisabled()
  expect(state.writes).toEqual([])
})

test('Kris can read the full manager reason in a stacked mobile summary', async ({ page }, testInfo) => {
  const reason = 'The alert was unnecessary because the customer explicitly gave permission; the separate coaching issue remains recorded for follow-up. '.repeat(3).trim()
  const scores: Readonly<Record<string, unknown>> = { ...FULL_QA_RESULT.compliance_scorecard, ...FULL_QA_RESULT.customer_experience_scorecard, ...FULL_QA_RESULT.sales_process_scorecard, ...FULL_QA_RESULT.program_expectations_scorecard }
  const review = { feedback_revision: 1, corrections: FULL_QA_CRITERIA.map(item => ({ criterion_key: item.key, disposition: 'confirmed', corrected_value: scores[item.score_path.split('.')[1]], reason: null })), findings: [], escalation_justified: false, escalation_reason: reason, escalation_inaccuracy_reason: 'wrong_context', action_taken: null, action_details: null, saved_by: 'another.manager@example.test', saved_at: '2026-09-07T15:00:00Z' }
  const state = await reviewFixture(page, [alertRow('mobile-summary', { is_reviewed: true, feedback_id: 1, feedback_by: 'another.manager@example.test', review_revision: 1, accurate: false })], { god: true, fullQaReviews: new Map([['mobile-summary', review]]) })
  await page.goto('/dashboard/alerts/mobile-summary/full_qa')
  const summary = page.getByRole('region', { name: 'Manager’s review', exact: true })
  const explanation = summary.getByText(reason, { exact: true })
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 })
    if (width === 320) await page.getByRole('button', { name: 'Review', exact: true }).click()
    await expect(explanation).toHaveText(reason)
    const label = summary.locator('dt', { hasText: 'Manager’s reason' })
    const labelBox = await label.boundingBox(), reasonBox = await explanation.boundingBox(), listBox = await summary.locator('dl').boundingBox()
    if (width < 640) {
      expect(reasonBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height)
      expect(reasonBox!.width).toBeGreaterThanOrEqual(listBox!.width - 1)
    } else expect(reasonBox!.x).toBeGreaterThan(labelBox!.x)
    await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`kris-summary-${width}.png`) })
  }
  expect(state.writes).toEqual([])
})

for (const missing of [false, true]) test(`View transcript reaches ${missing ? 'empty' : 'loading and error'} context instead of leaving focus in the header`, async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('transcript-recovery')])
  let release = () => {}
  if (missing) state.transcript = null
  else {
    state.failTranscript = true
    state.transcriptGate = new Promise<void>(resolve => { release = resolve })
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/dashboard/alerts/transcript-recovery/full_qa')
  await page.getByRole('button', { name: 'View transcript', exact: true }).click()
  const context = page.getByRole('region', { name: 'Transcript context', exact: true })
  await expect(context).toBeFocused()
  await expect(context).toBeInViewport()
  if (missing) await expect(context).toContainText('No transcript text is available')
  else {
    await expect(context).toContainText('Loading transcript…')
    release()
    await expect(context.getByRole('button', { name: /Retry|Try again/ })).toBeVisible()
    await expect(context).toBeFocused()
    state.failTranscript = false
    await context.getByRole('button', { name: /Retry|Try again/ }).click()
    await expect(page.getByRole('searchbox', { name: 'Search transcript' })).toBeFocused()
  }
  expect(state.writes).toEqual([])
})

test('View transcript opens the existing search directly and keeps the draft on mobile and desktop', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('direct-transcript')])
  await page.goto('/dashboard/alerts/direct-transcript/full_qa')
  await page.getByRole('button', { name: 'Your decision', exact: true }).click()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const reason = page.getByRole('textbox', { name: 'Explain your decision', exact: true, includeHidden: true })
  await reason.fill('Keep my decision while checking the transcript.')
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 })
    await page.getByRole('button', { name: 'View transcript', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Search transcript' })
    await expect(search).toHaveCount(1)
    await expect(search).toBeFocused()
    await expect(search).toBeInViewport()
    await expect(reason).toHaveValue('Keep my decision while checking the transcript.')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`direct-transcript-${width}.png`) })
  }
  expect(state.writes).toEqual([])
})
