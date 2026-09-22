import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

const explanation = 'The guarantee was misleading, but the interest explanation was qualified.'

test('partly correct saves explicit mixed feedback, survives failure, and reopens for manager and approver', async ({ page, browser }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('partly-correct')])
  await page.goto('/dashboard/alerts/partly-correct/full_qa')
  const item = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(item.getByRole('radio', { checked: true })).toHaveCount(0)
  await item.getByRole('radio', { name: 'Partly correct', exact: true }).check()
  await expect(item.getByRole('combobox')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  const save = page.getByRole('button', { name: 'Save review', exact: true })
  await expect(save).toBeDisabled()
  const note = item.getByRole('textbox', { name: 'Credit pull consent partly correct explanation', exact: true })
  await note.fill('short')
  await expect(save).toBeDisabled()
  await note.fill(explanation)
  await expect(save).toBeEnabled()
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 })
    if (width === 375) await page.getByRole('button', { name: 'Review', exact: true }).click()
    await note.scrollIntoViewIfNeeded()
    await expect(item.getByRole('radio', { name: 'Partly correct', exact: true })).toBeInViewport()
    await expect(save).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`partly-correct-${width}.png`), animations: 'disabled' })
  }
  state.failFeedback = true
  await save.click()
  await expect(page.getByText(/Couldn't save Full QA review/)).toBeVisible()
  await expect(note).toHaveValue(explanation)
  state.failFeedback = false
  await save.click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  const correction = { criterion_key: 'credit_pull_consent', disposition: 'partially_correct', corrected_value: null, reason: explanation }
  expect(state.writes).toContainEqual(expect.objectContaining({ p_corrections: [correction], p_findings: [], p_action: null, p_escalation_justified: true }))
  await page.goto('/dashboard/alerts/partly-correct/full_qa')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
  await expect(item.getByRole('radio', { name: 'Partly correct', exact: true })).toBeChecked()
  await expect(note).toHaveValue(explanation)
  await expect(item.getByText('Partly correct', { exact: true }).first()).toBeVisible()
  await expect(item.getByText('Needs more context', { exact: true })).toHaveCount(0)

  const approver = await browser.newPage()
  await reviewFixture(approver, state.rows, { god: true, email: 'director@example.test', fullQaReviews: state.fullQaReviews })
  await approver.goto('/dashboard/alerts/partly-correct/full_qa')
  const outcome = approver.getByRole('region', { name: 'Manager’s review', exact: true })
  await expect(outcome).toContainText(`manager marked partly correct — ${explanation}`)
  await expect(outcome).toContainText('Coaching issues (0)')
  await approver.getByText(/Eavesly’s evidence and scores · \d+ items/).click()
  await expect(approver.getByRole('article', { name: 'Credit pull consent', exact: true }).getByText('Partly correct', { exact: true })).toBeVisible()
  await approver.getByRole('button', { name: 'Approve review', exact: true }).click()
  await expect(approver.getByText('Review approved', { exact: true })).toBeVisible()
  await approver.close()
})

test('switching mixed feedback retains the explanation, clears incompatible scores, and allows opting out', async ({ page }) => {
  await reviewFixture(page, [alertRow('switch-partly')])
  await page.goto('/dashboard/alerts/switch-partly/full_qa')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  const item = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  const save = page.getByRole('button', { name: 'Save review', exact: true })
  await item.getByRole('radio', { name: 'Incorrect', exact: true }).check()
  await item.getByRole('textbox', { name: 'Credit pull consent correction reason', exact: true }).fill(explanation)
  await item.getByRole('radio', { name: 'Partly correct', exact: true }).check()
  await expect(item.getByRole('combobox')).toHaveCount(0)
  await expect(item.getByRole('textbox')).toHaveValue(explanation)
  await expect(save).toBeEnabled()
  await item.getByRole('radio', { name: 'Incorrect', exact: true }).check()
  await expect(item.getByRole('textbox')).toHaveValue(explanation)
  await item.getByRole('radio', { name: 'Correct', exact: true }).check()
  await expect(item.getByRole('textbox')).toHaveCount(0)
  await item.getByRole('radio', { name: 'Partly correct', exact: true }).check()
  await expect(item.getByRole('textbox')).toHaveValue('')
  await expect(save).toBeDisabled()
  await item.getByRole('button', { name: 'Clear score response', exact: true }).click()
  await expect(item.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(save).toBeEnabled()
})

test('mixed explanations use the same Unicode character bounds as PostgreSQL and reopen intact', async ({ page }) => {
  await reviewFixture(page, [alertRow('unicode-partly')])
  await page.goto('/dashboard/alerts/unicode-partly/full_qa')
  const item = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await item.getByRole('radio', { name: 'Partly correct', exact: true }).check()
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  const note = item.getByRole('textbox', { name: 'Credit pull consent partly correct explanation', exact: true })
  const save = page.getByRole('button', { name: 'Save review', exact: true })
  for (const [length, valid] of [[6, false], [12, true], [4001, false], [4000, true]] as const) {
    await note.fill('😀'.repeat(length))
    await expect(note).toHaveAttribute('aria-invalid', String(!valid))
    if (valid) await expect(save).toBeEnabled()
    else await expect(save).toBeDisabled()
  }
  await save.click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  await page.goto('/dashboard/alerts/unicode-partly/full_qa')
  await expect(note).toHaveValue('😀'.repeat(4000))
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
})

for (const invalid of [{ corrected_value: 'pass', reason: explanation }, { corrected_value: null, reason: '' }]) {
  test(`malformed saved mixed feedback fails closed: ${JSON.stringify(invalid)}`, async ({ page }) => {
    const row = alertRow('bad-partly', { is_reviewed: true, feedback_id: 1, feedback_by: 'manager@example.test', review_revision: 1, accurate: true })
    await reviewFixture(page, [row], { fullQaReviews: new Map([['bad-partly', {
      feedback_revision: 1, corrections: [{ criterion_key: 'credit_pull_consent', disposition: 'partially_correct', ...invalid }], findings: [],
      escalation_justified: true, escalation_reason: '', escalation_inaccuracy_reason: null,
      action_taken: null, action_details: null, saved_by: 'manager@example.test', saved_at: '2026-09-05T14:00:00Z',
    }]]) })
    await page.goto('/dashboard/alerts/bad-partly/full_qa')
    await expect(page.getByText('Full QA rubric context unavailable', { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  })
}
