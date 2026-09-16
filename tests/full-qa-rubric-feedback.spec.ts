import { test, expect, type Page } from '@playwright/test'
import { alertRow, EMAIL, FULL_QA_CRITERIA, FULL_QA_RESULT, openAlert, reviewFixture } from './review-fixture'

const response = (page: Page, criterion: string) => page.getByRole('radiogroup', { name: `${criterion} disposition` })
// Criterion assessments only; the alert-verdict radiogroup is counted separately.
const dispositions = (page: Page) => page.getByRole('radiogroup', { name: / disposition$/ })
const saveButton = (page: Page) => page.getByRole('button', { name: /^(Save|Update) review$/ })

async function expectCenteredDesktopDialog(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  const box = await page.getByRole('dialog').boundingBox()
  expect(box).not.toBeNull()
  expect(box?.width).toBeGreaterThanOrEqual(1040)
  expect(box?.width).toBeLessThanOrEqual(1080)
  expect(Math.abs((box?.x ?? 0) - (1440 - (box?.width ?? 0)) / 2)).toBeLessThanOrEqual(1)
  expect(box?.height).toBe(810)
  expect(box?.y).toBe(45)
}

async function expectFullscreenMobileDialog(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 })
  const box = await page.getByRole('dialog').boundingBox()
  expect(box).toEqual({ x: 0, y: 0, width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

const correctionReason = 'The available call context confirms the corrected judgment.'
const contextReason = 'The audio is unavailable, so this criterion remains uncertain.'
const findingSummary = 'A distinct inaccurate representation requires coaching.'
const findingEvidence = 'The manager heard the guarantee repeated at 14:20 after the disclosure.'
const escalationReason = 'The alert escalation is unnecessary because only one distinct compliance issue is confirmed.'
const actionDetails = 'The manager retained the finding and scheduled specific coaching despite dismissing escalation.'

test('Full QA saves string-scale corrections, uncertainty, and a retained finding independently from dismissed escalation', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('rubric-flow')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'rubric-flow')

  await expectCenteredDesktopDialog(page)
  const evidenceColumn = page.getByRole('region', { name: 'Credit pull consent: What Eavesly flagged' })
  const responseColumn = page.getByRole('region', { name: 'Credit pull consent: Your review' })
  const [evidenceBox, responseBox] = await Promise.all([evidenceColumn.boundingBox(), responseColumn.boundingBox()])
  expect(evidenceBox).not.toBeNull()
  expect(responseBox).not.toBeNull()
  expect(Math.abs((evidenceBox?.y ?? 0) - (responseBox?.y ?? 0))).toBeLessThanOrEqual(1)
  expect(responseBox?.x).toBeGreaterThanOrEqual((evidenceBox?.x ?? 0) + (evidenceBox?.width ?? 0))
  await page.screenshot({ path: testInfo.outputPath('full-qa-floating-initial-desktop.png'), animations: 'disabled' })
  await expect(saveButton(page)).toBeInViewport()
  await expect(page.getByText('Recording not available')).toBeHidden()
  await expectFullscreenMobileDialog(page)
  await page.screenshot({ path: testInfo.outputPath('full-qa-floating-initial-mobile.png'), animations: 'disabled' })
  await expect(evidenceColumn).toBeVisible()
  await expect(responseColumn).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })

  await expect(page.getByRole('form', { name: 'Full QA rubric review' })).toBeVisible()
  await expect(page.getByText(/^\d+ items to check$/)).toBeVisible()
  await expect(response(page, 'Call recording disclosure')).toBeHidden()
  await page.getByText('Scoring policy & source', { exact: true }).click()
  await expect(page.getByText(/Exact production rubric/)).toContainText('1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37')
  await expect(page.locator('[role="radiogroup"][aria-label$=" disposition"]')).toHaveCount(23)
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('Eavesly flagged this', { exact: true })).toBeVisible()
  await expect(consent.getByText('Evidence Eavesly used', { exact: true })).toBeVisible()
  await expect(consent.locator('blockquote')).toHaveText('Your credit may be affected.')
  await expect(consent.locator('pre')).toBeHidden()
  await expect(consent.getByText('Exact synthetic rule for Credit pull consent.')).toBeHidden()
  await consent.getByText('Rule and saved evidence', { exact: true }).click()
  await expect(consent.getByText('Exact synthetic rule for Credit pull consent.')).toBeVisible()
  await expect(consent.locator('pre')).toContainText('Your credit may be affected.')
  await page.getByText('Scoring policy & source', { exact: true }).click()
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  await expect(dispositions(page)).toHaveCount(23)

  await response(page, 'Call recording disclosure').getByRole('radio', { name: 'Need more context', exact: true }).check()
  await page.getByRole('textbox', { name: 'Call recording disclosure correction reason' }).fill(contextReason)
  await response(page, 'Credit pull consent').getByRole('radio', { name: 'Incorrect', exact: true }).check()
  await expect(page.getByRole('combobox', { name: 'Credit pull consent corrected value' })).toHaveValue('pass')
  await page.getByRole('textbox', { name: 'Credit pull consent correction reason' }).fill(correctionReason)
  await response(page, 'professional tone').getByRole('radio', { name: 'Incorrect', exact: true }).check()
  await page.getByRole('combobox', { name: 'professional tone corrected value' }).selectOption('poor')
  await page.getByRole('textbox', { name: 'professional tone correction reason' }).fill('The manager identified a tone concern the AI initially missed.')
  await page.getByRole('button', { name: 'Show only items to check' }).click()
  await expect(response(page, 'Call recording disclosure').getByRole('radio', { name: 'Need more context', exact: true })).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'professional tone corrected value' })).toHaveValue('poor')
  await expect(response(page, 'Social security verification')).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await response(page, 'Credit pull consent').scrollIntoViewIfNeeded()
  await expect(page.getByRole('combobox', { name: 'Credit pull consent corrected value' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('full-qa-rubric-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 720 })

  // Score answers never created an issue; the manager adds one explicitly from a criterion.
  await expect(page.getByText('No coaching issues added.', { exact: true })).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Choose whether this alert was warranted.')
  await page.getByRole('article', { name: 'Accurate representations', exact: true }).getByRole('button', { name: 'Add as coaching issue' }).click()
  await expect(page.getByRole('combobox', { name: 'Finding 1 category' })).toHaveValue('compliance')
  await expect(page.getByText('Related criteria (1 selected: Accurate representations)', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Finding 1 evidence' })).toHaveValue('Synthetic inaccurate statement')
  await expect(page.getByRole('textbox', { name: 'Finding 1 summary' })).toHaveValue('')
  await expect(page.getByRole('article', { name: 'Accurate representations', exact: true }).getByRole('button', { name: 'Edit coaching issue 1' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Finding 1 summary' }).fill(findingSummary)
  await page.getByRole('textbox', { name: 'Finding 1 evidence' }).fill(findingEvidence)
  await expect(page.getByRole('radiogroup', { name: 'Alert verdict' }).getByRole('radio', { checked: true })).toHaveCount(0)
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await page.getByRole('textbox', { name: 'Explain your decision' }).fill(escalationReason)
  await page.getByRole('combobox', { name: 'Why was the alert unnecessary?' }).selectOption('wrong_context')
  await page.getByRole('combobox', { name: 'What did you do about the issue?' }).selectOption('follow_up_later')
  await page.getByRole('textbox', { name: 'Coaching or next steps' }).fill(actionDetails)

  await page.screenshot({ path: testInfo.outputPath('full-qa-dismissed-retained-finding-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved')).toBeVisible()

  const write = state.writes.find(value => value && typeof value === 'object' && 'p_corrections' in value)
  expect(write).toMatchObject({
    p_escalation_justified: false,
    p_inaccuracy_reason: 'wrong_context',
    p_action: 'follow_up_later',
    p_action_details: actionDetails,
  })
  expect(write).toHaveProperty('p_corrections')
  expect((write as { p_corrections: unknown[] }).p_corrections).toHaveLength(23)
  expect((write as { p_corrections: unknown[] }).p_corrections).toEqual(expect.arrayContaining([
    { criterion_key: 'social_security_verification', disposition: 'confirmed', corrected_value: 'pass', reason: null },
    { criterion_key: 'step4_paydown_projections', disposition: 'confirmed', corrected_value: 'not_applicable', reason: null },
    { criterion_key: 'professional_tone', disposition: 'corrected', corrected_value: 'poor', reason: 'The manager identified a tone concern the AI initially missed.' },
  ]))
  expect((write as { p_findings: unknown[] }).p_findings).toEqual([expect.objectContaining({
    category: 'compliance', related_criteria: ['accurate_representations'], summary: findingSummary, evidence: findingEvidence,
  })])
  expect(state.writes.some(value => value && typeof value === 'object' && 'p_verdict' in value)).toBe(false)
  expect(state.rows[0].accurate).toBe(false)
  expect(state.rows[0].action_taken).toBe('follow_up_later')
  await page.getByRole('combobox', { name: 'Queue' }).selectOption('coaching_due')
  await expect(page.getByRole('button', { name: /Review .* Example rubric-flow/ })).toBeVisible()
  await openAlert(page, 'rubric-flow')
  await expect(page.getByText('Coaching follow-up is still open.')).toBeVisible()
  await expect(page.getByText('Needs more context', { exact: true })).toBeVisible()
  await expect(page.getByText('Changed to: Meets the rule', { exact: true })).toBeVisible()
  await page.getByText('Suggest a rule change', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Current criterion for proposal' }).selectOption('credit_pull_consent')
  await page.getByRole('textbox', { name: 'Proposed rule content' }).fill('Require an explicit needs-context result when consent audio is unavailable.')
  await page.getByRole('textbox', { name: 'Why change this rule?' }).fill('Unavailable audio must not become a confirmed pass or failure.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Close (Esc)' }).click()
  await expect(page.getByRole('textbox', { name: 'Proposed rule content' })).toHaveValue('Require an explicit needs-context result when consent audio is unavailable.')
  await page.getByRole('button', { name: 'Propose for evaluation' }).click()
  await expect(page.getByText(/Rule proposed for evaluation review/)).toBeVisible()
  await page.getByRole('button', { name: 'Close (Esc)' }).click()

  const adminPage = await page.context().newPage()
  await reviewFixture(adminPage, state.rows, { god: true, email: 'director@example.test', fullQaReviews: state.fullQaReviews, fullQaProposals: state.fullQaProposals })
  await adminPage.goto('/dashboard/alerts?status=awaiting_approval')
  await openAlert(adminPage, 'rubric-flow')
  await expect(adminPage.getByText('This manager review is awaiting Kris’s approval.', { exact: true })).toHaveCount(0)
  // Kris sees the manager's outcome first, then decides; no form or disabled inputs.
  const outcome = adminPage.getByRole('region', { name: 'Manager’s review', exact: true })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    await adminPage.setViewportSize(viewport)
    await expect(outcome).toBeInViewport()
    await expect(adminPage.getByRole('button', { name: 'Approve review' })).toBeInViewport()
  }
  await adminPage.setViewportSize({ width: 1280, height: 720 })
  await expect(outcome).toContainText('Alert warranted')
  await expect(outcome).toContainText('No · Wrong context')
  await expect(outcome).toContainText(escalationReason)
  await expect(outcome).toContainText(`Will follow up later · ${actionDetails}`)
  await expect(outcome).toContainText(findingSummary)
  await expect(outcome.getByText(findingEvidence, { exact: true })).toBeHidden()
  await outcome.getByText('Manager’s evidence', { exact: true }).click()
  await expect(outcome.getByText(findingEvidence, { exact: true })).toBeVisible()
  await expect(outcome).not.toContainText('Synthetic inaccurate statement')
  await expect(outcome).toContainText('Changed or unresolved scores (3)')
  await expect(outcome).toContainText('Credit pull consent: Eavesly said Does not meet the rule → manager changed to Meets the rule — ' + correctionReason)
  await expect(outcome).toContainText('Call recording disclosure: Eavesly said Meets the rule → manager needs more context — ' + contextReason)
  await expect(outcome).toContainText('professional tone: Eavesly said Good → manager changed to Poor')
  await expect(adminPage.getByRole('radiogroup')).toHaveCount(0)
  const form = adminPage.getByRole('form', { name: 'Full QA rubric review' })
  await expect(form.locator('fieldset:disabled, input:disabled, textarea:disabled, select:disabled')).toHaveCount(0)
  await expect(adminPage.getByRole('textbox', { name: /Request changes with instructions/ })).toHaveCount(0)
  await expect(adminPage.getByText('Changed to: Poor', { exact: true })).toBeHidden()
  await adminPage.getByText(/Eavesly’s evidence and scores · \d+ items/).click()
  await expect(adminPage.getByText('Needs more context', { exact: true })).toBeVisible()
  await expect(adminPage.getByText('Changed to: Poor', { exact: true })).toBeVisible()
  const humanOnly = adminPage.getByRole('article', { name: 'professional tone', exact: true })
  await expect(humanOnly.getByText('Manager review item', { exact: true })).toBeVisible()
  await expect(humanOnly.getByText('Eavesly flagged this', { exact: true })).toHaveCount(0)
  await expect(adminPage.getByRole('heading', { name: 'Social security verification', exact: true })).toBeHidden()
  await adminPage.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Social security verification', exact: true })).toBeVisible()
  await expect(adminPage.getByRole('radiogroup')).toHaveCount(0)
  await adminPage.getByRole('button', { name: 'Show only items to check' }).click()
  const savedTreatment = adminPage.getByText('Changed to: Meets the rule', { exact: true })
  await expect(savedTreatment).toBeVisible()
  await savedTreatment.scrollIntoViewIfNeeded()
  await adminPage.screenshot({ path: testInfo.outputPath('full-qa-approval-desktop.png'), fullPage: true, animations: 'disabled' })
  await adminPage.getByText('Rule change proposals', { exact: true }).click()
  await adminPage.getByRole('textbox', { name: /Proposal .* decision reason/ }).fill('Approved for bounded candidate evaluation only.')
  await adminPage.getByRole('button', { name: 'Approve for evaluation' }).click()
  await expect(form.getByText('Approved for evaluation — not published')).toBeVisible()
  const requestChanges = adminPage.getByRole('button', { name: 'Request changes', exact: true })
  await expect(requestChanges).toBeEnabled()
  await requestChanges.click()
  const instructions = adminPage.getByRole('textbox', { name: /Request changes with instructions/ })
  await expect(instructions).toBeFocused()
  await expect(instructions).toBeInViewport()
  await expect(adminPage.getByRole('button', { name: 'Request changes', exact: true })).toBeDisabled()
  await instructions.fill('Draft instructions that must not be lost by an accidental approval.')
  await expect(adminPage.getByRole('button', { name: 'Request changes', exact: true })).toBeEnabled()
  await expect(adminPage.getByRole('button', { name: 'Approve review' })).toBeDisabled()
  await expect(adminPage.getByText('Send or clear the change instructions before approving.')).toBeVisible()
  await instructions.fill('')
  await expect(adminPage.getByRole('button', { name: 'Approve review' })).toBeEnabled()
  await adminPage.getByRole('button', { name: 'Approve review' }).click()
  await expect(adminPage.getByText('Review approved')).toBeVisible()
  await adminPage.close()
})

test('legacy Full QA feedback stays visible without inventing structured rubric responses', async ({ browser }) => {
  const legacyResult = structuredClone(FULL_QA_RESULT) as Record<string, unknown>
  delete legacyResult._evaluation_provenance
  const row = alertRow('legacy-feedback', {
    result_json: legacyResult,
    is_reviewed: true,
    feedback_id: 42,
    feedback_by: EMAIL,
    reviewed_at: '2026-09-05T14:00:00Z',
    accurate: true,
    action_taken: 'coached',
    violation_details: 'The manager confirmed the disclosure gap from the saved call context.',
    action_details: 'The manager coached the agent on the required disclosure after the call.',
    feedback_comment: 'Original manager note retained with the earlier review.',
  })

  const managerPage = await browser.newPage()
  const managerState = await reviewFixture(managerPage, [structuredClone(row)])
  let releaseContext = () => {}
  managerState.fullQaContextGate = new Promise<void>(resolve => { releaseContext = resolve })
  await managerPage.goto('/dashboard/alerts/legacy-feedback/full_qa')
  await expect(managerPage.getByText('Loading exact Full QA rubric…', { exact: true })).toBeVisible()
  await expect(managerPage.getByText('Earlier manager review', { exact: true })).toHaveCount(0)
  releaseContext()
  await expect(managerPage.getByText('Earlier manager review', { exact: true })).toBeVisible()
  await expect(managerPage.getByText(/Action: Coached the agent/)).toBeVisible()
  await expect(managerPage.getByText(/What happened: The manager confirmed the disclosure gap/)).toBeVisible()
  await expect(managerPage.getByText(/Action details: The manager coached the agent/)).toBeVisible()
  await expect(managerPage.getByText('Original manager note retained with the earlier review.', { exact: true })).toBeVisible()
  await expect(managerPage.getByText('This review was saved before individual scores could be reviewed. Original feedback is shown below.', { exact: true })).toBeVisible()
  await expect(managerPage.getByText('Original rubric unknown; current reference only.', { exact: true })).toBeVisible()
  await expect(managerPage.getByRole('region', { name: 'Manager’s review' })).toHaveCount(0)
  await managerPage.close()

  const adminPage = await browser.newPage()
  await reviewFixture(adminPage, [structuredClone(row)], { god: true, email: 'director@example.test' })
  await adminPage.goto('/dashboard/alerts/legacy-feedback/full_qa')
  await expect(adminPage.getByText('Earlier manager review', { exact: true })).toBeVisible()
  await expect(adminPage.getByText(/Action: Coached the agent/)).toBeVisible()
  await expect(adminPage.getByText(/Action details: The manager coached the agent/)).toBeVisible()
  await expect(adminPage.getByText('Original manager note retained with the earlier review.', { exact: true })).toBeVisible()
  await expect(adminPage.getByRole('button', { name: 'Approve review' })).toBeEnabled()
  await expect(adminPage.getByRole('region', { name: 'Manager’s review' })).toHaveCount(0)
  await adminPage.close()

  const errorPage = await browser.newPage()
  const errorState = await reviewFixture(errorPage, [structuredClone(row)], { god: true, email: 'director@example.test' })
  errorState.failFullQaContext = true
  await errorPage.goto('/dashboard/alerts/legacy-feedback/full_qa')
  await expect(errorPage.getByText('Full QA rubric context unavailable', { exact: true })).toBeVisible()
  await expect(errorPage.getByText('Earlier manager review', { exact: true })).toHaveCount(0)
  await errorPage.close()
})

test('score answers and an explicit verdict save without manufacturing any coaching issue', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('no-silent-findings')])
  await page.goto('/dashboard/alerts/no-silent-findings/full_qa')
  await response(page, 'Credit pull consent').getByRole('radio', { name: 'Incorrect', exact: true }).check()
  await page.getByRole('textbox', { name: 'Credit pull consent correction reason' }).fill(correctionReason)
  await response(page, 'Accurate representations').getByRole('radio', { name: 'Correct', exact: true }).check()
  await expect(page.getByText('No coaching issues added.', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'What did you do about the issue?' })).toHaveCount(0)
  await expect(saveButton(page)).toBeDisabled()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await page.getByRole('textbox', { name: 'Explain your decision' }).fill(escalationReason)
  await expect(page.getByRole('status')).toContainText('Choose why escalation was not justified.')
  await page.getByRole('combobox', { name: 'Why was the alert unnecessary?' }).selectOption('evidence_misquoted')
  await expect(page.getByRole('status')).toHaveCount(0)
  // The footer button and the keyboard shortcut submit the same form once.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByText('Full QA review saved')).toBeVisible()
  const writes = state.writes.filter(value => value && typeof value === 'object' && 'p_corrections' in value)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ p_escalation_justified: false, p_inaccuracy_reason: 'evidence_misquoted', p_findings: [], p_action: null, p_action_details: null })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/dashboard/alerts?status=reviewed')
  await openAlert(page, 'no-silent-findings')
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
  await expect(page.getByText('Changed to: Meets the rule', { exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true })).toBeChecked()
})

test('a warranted alert with two distinct issues records shared and repeated criterion links while one pending save holds every submit path', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('two-issues')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'two-issues')
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  const representations = page.getByRole('article', { name: 'Accurate representations', exact: true })
  await consent.getByRole('button', { name: 'Add as coaching issue' }).click()
  await page.getByRole('textbox', { name: 'Finding 1 summary' }).fill('Credit was pulled after the customer refused permission.')
  await page.getByRole('textbox', { name: 'Finding 1 evidence' }).fill('The refusal and the announced pull are both on the recording.')
  // One issue can reference several criteria through the checkbox list, not a native multi-select.
  await page.getByText('Related criteria (1 selected: Credit pull consent)', { exact: true }).click()
  await page.getByRole('group', { name: 'Finding 1 related criteria' }).getByRole('checkbox', { name: 'No misleading claims' }).check()
  await expect(page.getByText('Related criteria (2 selected: Credit pull consent, No misleading claims)', { exact: true })).toBeVisible()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await representations.getByRole('button', { name: 'Add as coaching issue' }).click()
  await page.getByRole('textbox', { name: 'Finding 2 summary' }).fill('The agent guaranteed a debt-free date to the customer.')
  // A second distinct issue under the same criterion is recorded through a manual add.
  await page.getByRole('button', { name: 'Add another issue' }).click()
  await expect(page.getByText('Related criteria (0 selected)', { exact: true })).toBeVisible()
  await page.getByText('Related criteria (0 selected)', { exact: true }).click()
  await page.getByRole('group', { name: 'Finding 3 related criteria' }).getByRole('checkbox', { name: 'Accurate representations' }).check()
  await page.getByRole('textbox', { name: 'Finding 3 summary' }).fill('The agent also misstated the monthly payment amount.')
  await page.getByRole('textbox', { name: 'Finding 3 evidence' }).fill('The payment figure quoted on the call differs from the offer sheet.')
  await expect(representations.getByRole('button', { name: 'Edit coaching issue 2' })).toBeVisible()
  await page.getByRole('combobox', { name: 'What did you do about the issue?' }).selectOption('coached')
  await page.getByRole('textbox', { name: 'Coaching or next steps' }).fill('Coached the agent on consent and on outcome language the same day.')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await page.getByRole('textbox', { name: 'Explain your decision' }).fill('Two distinct compliance issues were confirmed on this call.')
  await expect(page.getByRole('status')).toHaveCount(0)

  let release = () => {}
  state.fullQaSubmitGate = new Promise<void>(resolve => { release = resolve })
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  const saving = page.getByRole('button', { name: 'Saving…', exact: true })
  await expect(saving).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByRole('button', { name: 'Add another issue' })).toBeDisabled()
  await expect(consent.getByRole('radio', { name: 'Incorrect', exact: true })).toBeDisabled()
  expect(state.writes.filter(value => value && typeof value === 'object' && 'p_corrections' in value)).toHaveLength(1)
  release()
  await expect(page.getByText('Full QA review saved')).toBeVisible()
  const writes = state.writes.filter(value => value && typeof value === 'object' && 'p_corrections' in value)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ p_escalation_justified: true, p_inaccuracy_reason: null, p_action: 'coached' })
  expect((writes[0] as { p_findings: { related_criteria: string[] }[] }).p_findings.map(item => item.related_criteria)).toEqual([
    ['credit_pull_consent', 'no_misleading_claims'], ['accurate_representations'], ['accurate_representations'],
  ])
  expect(state.rows[0].accurate).toBe(true)
})

test('a realistic supported seed keeps the reason, first evidence, and first decision on the first screen', async ({ page }) => {
  const reason = 'Two separate compliance issues prompted this review: the agent announced a credit pull after the customer explicitly refused permission, then guaranteed the customer would be debt-free in exactly 48 months. The unsupported guarantee is one issue, even though it was repeated across the closing segment of the call.'
  const result = { ...FULL_QA_RESULT,
    _synthetic_staging: true,
    call_overview: { manager_review_required: true, manager_review_reason: reason },
    compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard,
      compliance_violations: ['Credit pulled after the customer explicitly refused permission.', 'A guaranteed debt-free date of 48 months.'],
      credit_pull_consent_evidence: [
        { speaker: 'contact', quote: 'No, do not pull my credit. I want to understand the options first.', context: 'The customer explicitly refused permission before the agent announced a credit pull.', process_step: 'Step 2 Credit Review' },
        { speaker: 'handling agent', quote: 'I have pulled your credit report anyway so we can continue.', context: 'The agent announced the pull after the customer refused permission.', process_step: 'Step 2 Credit Review' },
      ],
      accurate_representations_violations: ['You will be debt-free in 48 months, guaranteed.'],
    },
  }
  await reviewFixture(page, [alertRow('DEMO-SUPPORTED-001', { result_json: result, contact_name: 'Synthetic example · Two supported compliance issues with a long customer name', recording_link: 'https://example.test/recording.mp3', transcript_url: 'https://example.test/transcript' })])
  await page.goto('/dashboard/alerts/DEMO-SUPPORTED-001/full_qa')
  const summary = page.getByRole('region', { name: 'Why Eavesly requested review', exact: true })
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expectCenteredDesktopDialog(page)
  await expect(summary.getByText(reason, { exact: true })).toBeVisible()
  await expect(summary.getByRole('button', { name: 'Full reason' })).toHaveCount(0)
  await expect(consent.locator('blockquote').first()).toBeVisible()
  await expectFullscreenMobileDialog(page)
  await expect(summary.getByText(reason, { exact: true })).toBeVisible()
  await expect(saveButton(page)).toBeInViewport()
  await expect(consent.locator('blockquote')).toHaveText(['No, do not pull my credit. I want to understand the options first.', 'I have pulled your credit report anyway so we can continue.'])
  await expect(consent.locator('figcaption')).toHaveText(['contact · Step 2 Credit Review', 'handling agent · Step 2 Credit Review'])
  await expect(page.getByRole('article', { name: 'Accurate representations', exact: true }).getByText('You will be debt-free in 48 months, guaranteed.', { exact: true })).toBeVisible()
  // The base fixture retains four program gaps, one CX concern and one process gap alongside two compliance concerns.
  await expect(page.getByText('8 items to check', { exact: true })).toBeVisible()
  await expect(page.getByText('Recording, transcript and call summary', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open recording/ })).toBeHidden()
})

test('the floating review traps focus, guards outside and Escape closes while dirty, and returns focus', async ({ page }) => {
  await reviewFixture(page, [alertRow('modal-guard')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  const opener = page.getByRole('button', { name: 'Review Manager escalation alert for Example modal-guard', exact: true })
  await opener.focus()
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  await response(page, 'Credit pull consent').getByRole('radio', { name: 'Incorrect', exact: true }).check()
  page.once('dialog', confirm => confirm.dismiss())
  await page.mouse.click(10, 10)
  await expect(dialog).toBeVisible()
  await expect(response(page, 'Credit pull consent').getByRole('radio', { name: 'Incorrect', exact: true })).toBeChecked()

  page.once('dialog', confirm => confirm.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  page.once('dialog', confirm => confirm.accept())
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('focused scorecard respects categorical concerns and enrollment gating, while toggling preserves edits', async ({ page }, testInfo) => {
  const result = {
    ...structuredClone(FULL_QA_RESULT),
    customer_experience_scorecard: { ...FULL_QA_RESULT.customer_experience_scorecard, professional_tone: 'poor' },
    sales_process_scorecard: { ...FULL_QA_RESULT.sales_process_scorecard, step2_credit_review: 'missing' },
    program_expectations_scorecard: { ...FULL_QA_RESULT.program_expectations_scorecard, enrollment_completed: false, section_status: 'not_applicable' },
  }
  await reviewFixture(page, [alertRow('focused', { result_json: result })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'focused')
  await expect(dispositions(page)).toHaveCount(6)
  for (const label of ['Credit pull consent', 'Accurate representations', 'professional tone', 'patience empathy', 'step2 credit review', 'step6 debt resolution']) {
    await expect(response(page, label)).toBeVisible()
  }
  for (const label of ['Call recording disclosure', 'active listening', 'step1 agenda setting', 'step4 paydown projections', 'phase recovery covered']) {
    await expect(response(page, label)).toBeHidden()
  }
  const coaching = page.getByRole('article', { name: 'professional tone', exact: true })
  await expect(coaching.getByText('Eavesly score concern', { exact: true })).toBeVisible()
  await expect(coaching.getByText('Eavesly flagged this', { exact: true })).toHaveCount(0)
  const agree = response(page, 'Credit pull consent').getByRole('radio', { name: 'Correct', exact: true })
  await agree.focus()
  await page.keyboard.press('ArrowRight')
  await expect(response(page, 'Credit pull consent').getByRole('radio', { name: 'Incorrect', exact: true })).toBeChecked()
  await page.getByRole('textbox', { name: 'Credit pull consent correction reason' }).fill(correctionReason)
  const expand = page.getByRole('button', { name: 'View full scorecard · 23 criteria' })
  await expand.focus()
  await page.keyboard.press('Enter')
  await expect(dispositions(page)).toHaveCount(23)
  await response(page, 'phase recovery covered').getByRole('radio', { name: 'Need more context', exact: true }).check()
  await page.getByRole('textbox', { name: 'phase recovery covered correction reason' }).fill(contextReason)
  await page.getByRole('button', { name: 'Show only items to check' }).click()
  await expect(dispositions(page)).toHaveCount(7)
  await expect(page.getByRole('textbox', { name: 'phase recovery covered correction reason' })).toHaveValue(contextReason)
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await expand.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(expand).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('focused-scorecard.png'), animations: 'disabled' })
})

test('evidence shows readable quotes with context, keeps notes distinct, and preserves unfamiliar data under details', async ({ page }) => {
  const result = { ...FULL_QA_RESULT, compliance_scorecard: {
    ...FULL_QA_RESULT.compliance_scorecard,
    credit_pull_consent_evidence: [
      { speaker: 'Customer', quote: 'Yes, I authorize that credit review.', context: 'The agent asked permission immediately before this response.', process_step: 'Step 1 Agenda Setting' },
      { unfamiliar_field: 'Unfamiliar evidence must remain available.' },
    ],
    accurate_representations_violations: ['The model describes an unqualified outcome promise.'],
  } }
  await reviewFixture(page, [alertRow('readable-evidence', { result_json: result })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'readable-evidence')
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('Eavesly flagged this', { exact: true })).toBeVisible()
  await expect(consent.locator('blockquote')).toHaveText('Yes, I authorize that credit review.')
  await expect(consent.locator('figcaption')).toHaveText('Customer · Step 1 Agenda Setting')
  await expect(consent.getByText('Saved context: The agent asked permission immediately before this response.', { exact: true })).toBeVisible()
  await expect(consent).toContainText('No reason saved for this score.')
  await expect(consent.getByText('Some evidence is only available in the saved details below.', { exact: true })).toBeVisible()
  await expect(consent.locator('pre')).toBeHidden()
  await consent.getByText('Rule and saved evidence', { exact: true }).click()
  await expect(consent.locator('pre')).toContainText('Unfamiliar evidence must remain available.')
  const note = page.getByRole('article', { name: 'Accurate representations', exact: true })
  await expect(note.getByText('Why Eavesly flagged this', { exact: true })).toBeVisible()
  await expect(note.getByText('The model describes an unqualified outcome promise.', { exact: true })).toBeVisible()
  await expect(note.locator('blockquote')).toHaveCount(0)
  // Seeding an issue from a criterion copies only saved, attributed evidence; the summary is the manager's.
  await consent.getByRole('button', { name: 'Add as coaching issue' }).click()
  await expect(page.getByRole('textbox', { name: 'Finding 1 evidence' })).toHaveValue('Customer · Step 1 Agenda Setting: “Yes, I authorize that credit review.”\nSaved context: The agent asked permission immediately before this response.')
  await expect(page.getByRole('textbox', { name: 'Finding 1 summary' })).toHaveValue('')
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  const empty = page.getByRole('article', { name: 'Social security verification', exact: true })
  await expect(empty.getByText('Other Eavesly score', { exact: true })).toBeVisible()
  await expect(empty.getByText('No readable excerpt was saved. Check the transcript before deciding.', { exact: true })).toBeVisible()
})

test('valid unfamiliar rubric values stay readable rather than appearing unavailable', async ({ page }) => {
  const result = { ...FULL_QA_RESULT, compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard, credit_pull_consent: 'requires_follow_up' } }
  const criteria = FULL_QA_CRITERIA.map(item => item.key === 'credit_pull_consent'
    ? { ...item, domain: ['requires_follow_up', 'policy_exception'] } : item)
  await reviewFixture(page, [alertRow('new-domain', { result_json: result })], { fullQaCriteria: criteria })
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'new-domain')
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('requires follow up', { exact: true })).toBeVisible()
  await consent.getByRole('radio', { name: 'Incorrect', exact: true }).check()
  const corrected = consent.getByRole('combobox', { name: 'Credit pull consent corrected value' })
  await expect(corrected).toHaveValue('policy_exception')
  await expect(corrected.locator('option')).toHaveText(['requires follow up', 'policy exception'])
  await expect(consent.getByText('Unavailable', { exact: true })).toHaveCount(0)
})

test('empty focus is not a cleared alert and an unavailable score stays visible for context', async ({ page }) => {
  const scorecards: Record<string, Record<string, unknown>> = {}
  for (const criterion of FULL_QA_CRITERIA) {
    const [section, field] = criterion.score_path.split('.')
    scorecards[section] ??= {}
    scorecards[section][field] = criterion.domain[0]
  }
  const clean = { ...FULL_QA_RESULT, ...scorecards }
  const missing = { ...clean, compliance_scorecard: { ...scorecards.compliance_scorecard, social_security_verification: null } }
  await reviewFixture(page, [alertRow('no-concerns', { result_json: clean }), alertRow('missing-score', { result_json: missing })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'no-concerns')
  await expect(page.getByText(/No flagged criteria or review changes to show/)).toContainText('this does not clear the alert')
  await expect(dispositions(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  await expect(dispositions(page)).toHaveCount(23)
  await page.getByRole('button', { name: 'Close (Esc)' }).click()
  await openAlert(page, 'missing-score')
  await expect(dispositions(page)).toHaveCount(1)
  await expect(response(page, 'Social security verification').getByRole('radio', { name: 'Need more context', exact: true })).toBeChecked()
  await expect(response(page, 'Social security verification').getByRole('radio', { name: 'Correct', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Social security verification correction reason' })).toBeVisible()
})

test('a stale Full QA source keeps the draft but cannot silently pair it with a refreshed token', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('stale-source')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'stale-source')
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const reason = page.getByRole('textbox', { name: 'Explain your decision' })
  await reason.fill('No escalation is justified after reviewing this synthetic call.')
  await page.getByRole('combobox', { name: 'Why was the alert unnecessary?' }).selectOption('other')
  state.fullQaSourceFingerprints.set('stale-source', 'd'.repeat(64))
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText(/This review changed while you were working/)).toBeVisible()
  await expect(reason).toHaveValue('No escalation is justified after reviewing this synthetic call.')
  await expect(page.getByText('Saved source or revision changed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Reload review and discard draft' }).click()
  await expect(reason).toHaveValue('')
  await expect(page.getByRole('radiogroup', { name: 'Alert verdict' }).getByRole('radio', { checked: true })).toHaveCount(0)
})

test('Full QA provenance never presents an unknown stamped hash as current, while unstamped legacy is reference-only', async ({ page }) => {
  const unknown = structuredClone(FULL_QA_RESULT)
  unknown._evaluation_provenance.prompt_sha256 = 'f'.repeat(64)
  const legacy = structuredClone(FULL_QA_RESULT) as Record<string, unknown>
  delete legacy._evaluation_provenance
  await reviewFixture(page, [alertRow('unknown-hash', { result_json: unknown }), alertRow('legacy-source', { result_json: legacy })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')

  await openAlert(page, 'unknown-hash')
  await expect(page.getByText('Original rubric unavailable for this stamped hash; current field map only.')).toBeVisible()
  await page.getByText('Scoring policy & source', { exact: true }).click()
  await expect(page.getByText(/Original rubric unavailable for stamped hash/)).toContainText('f'.repeat(64))
  const firstCard = page.locator('article:visible').first()
  await expect(firstCard.getByText('Original rule unavailable for this stamped hash.')).toBeHidden()
  await firstCard.getByText('Rule and saved evidence', { exact: true }).click()
  await expect(firstCard.getByText('Original rule unavailable for this stamped hash.')).toBeVisible()
  await expect(page.getByText('Exact synthetic rule for Call recording disclosure.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close (Esc)' }).click()

  await openAlert(page, 'legacy-source')
  await expect(page.getByText('Original rubric unknown; current reference only.', { exact: true })).toBeVisible()
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('Exact synthetic rule for Credit pull consent.')).toBeHidden()
  await consent.getByText('Rule and saved evidence', { exact: true }).click()
  await expect(consent.getByText('Exact synthetic rule for Credit pull consent.')).toBeVisible()
})

test('an unmapped approved finding fails closed rather than disappearing from recurrence totals', async ({ page }) => {
  await reviewFixture(page, [], { fullQaOccurrences: [{
    occurrence_kind: 'finding', call_id: 'unmapped', feedback_revision: 1,
    call_started_at: '2026-09-06T12:00:00Z', window_basis: 'call_started_at',
    status: 'approved', confirmed: true, category: 'unrecognized_category',
    review_saved_at: '2026-09-07T12:00:00Z',
  }] })
  await page.goto('/dashboard/team/agent%40example.test?start=2026-08-09&end=2026-09-07')
  await expect(page.getByText("Couldn't load Full QA recurrence")).toBeVisible()
  await expect(page.getByText('Confirmed occurrence rows (0)')).toHaveCount(0)
})

test('Agent profile reconciles approved findings and keeps pending, needs-context, and legacy rows uncounted', async ({ page }, testInfo) => {
  const occurrences = [
    { occurrence_kind: 'finding', call_id: 'dismissed-real', feedback_revision: 2, call_started_at: '2026-09-06T12:00:00Z', window_basis: 'call_started_at', status: 'approved', confirmed: true, finding_id: 'finding-1', category: 'compliance', related_criteria: ['credit_pull_consent'], summary: findingSummary, evidence: 'The synthetic evidence confirms this underlying assertion once.', action_taken: 'coached', action_details: actionDetails, review_saved_at: '2026-09-05T12:00:00Z', coaching_review_proxy_saved_at: '2026-09-05T12:00:00Z', coaching_timing: 'after_recorded_coached_review' },
    { occurrence_kind: 'finding', call_id: 'pending', feedback_revision: 1, call_started_at: '2026-09-07T12:00:00Z', window_basis: 'call_started_at', status: 'pending', confirmed: false, finding_id: 'finding-2', category: 'compliance', related_criteria: ['accurate_representations'], summary: 'Pending manager finding.', evidence: 'Pending synthetic evidence.', action_taken: 'follow_up_later', action_details: actionDetails, review_saved_at: '2026-09-07T13:00:00Z', coaching_review_proxy_saved_at: null, coaching_timing: 'no_prior_recorded_coaching' },
    { occurrence_kind: 'needs_context', call_id: 'uncertain', feedback_revision: 1, call_started_at: null, window_basis: 'alert_created_at_fallback', status: 'approved', confirmed: false, criterion_key: 'credit_pull_consent', reason: contextReason, review_saved_at: '2026-09-07T13:00:00Z', coaching_timing: 'unknown' },
    { occurrence_kind: 'legacy_unmapped', call_id: 'legacy', feedback_revision: 1, call_started_at: '2026-09-04T12:00:00Z', window_basis: 'call_started_at', status: 'legacy_unmapped', confirmed: false, review_saved_at: '2026-09-04T13:00:00Z', coaching_timing: 'unknown' },
  ]
  await reviewFixture(page, [], { fullQaOccurrences: occurrences })
  await page.goto('/dashboard/team/agent%40example.test?start=2026-08-09&end=2026-09-07')
  const panel = page.getByRole('region', { name: 'Approved Full QA recurrence' })
  await expect(panel).toContainText('Compliance: 1')
  await expect(panel).toContainText('Confirmed occurrence rows (1)')
  await expect(panel).toContainText('Not counted (3)')
  await expect(panel).toContainText('After recorded coached review (review-date proxy)')
  await expect(panel).toContainText('Needs context: credit_pull_consent')
  await expect(panel).toContainText('Legacy review — no criterion mapping')
  await expect(panel).toContainText('Call time missing; timing unknown')
  await page.screenshot({ path: testInfo.outputPath('agent-full-qa-recurrence-desktop.png'), fullPage: true, animations: 'disabled' })
})

test('saved alert reasons and criterion context explain concerns without turning coaching scores into triggers', async ({ page }) => {
  const reason = 'Review requested because credit was pulled after a refusal and the agent guaranteed a debt-free date.'
  const note = 'The agent announced the credit pull immediately after the customer refused permission.'
  const result = { ...FULL_QA_RESULT,
    call_overview: { manager_review_required: true, manager_review_reason: reason },
    compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard,
      compliance_violations: ['Credit pulled despite refusal.', 'A guaranteed debt-free date.'],
      credit_pull_consent_evidence: [
        { speaker: 'Customer', quote: 'No, do not pull my credit.', context: note, process_step: 'Step 2 Credit Review' },
        { speaker: 'Agent', quote: 'I have pulled it anyway.', context: '', process_step: 'Step 2 Credit Review' },
      ],
    },
  }
  await reviewFixture(page, [alertRow('saved-reasons', { result_json: result })])
  await page.goto('/dashboard/alerts/saved-reasons/full_qa')
  const summary = page.getByRole('region', { name: 'Why Eavesly requested review', exact: true })
  await expect(summary.getByText(reason, { exact: true })).toBeVisible()
  await expect(summary.getByRole('listitem')).toHaveCount(0)
  await summary.getByText('Recorded compliance issues (2)', { exact: true }).click()
  await expect(summary.getByRole('listitem')).toHaveText(['Credit pulled despite refusal.', 'A guaranteed debt-free date.'])
  await expect(page.getByText(/^\d+ items to check$/)).toBeVisible()
  await expect(page.getByText('Why it fired', { exact: true })).toHaveCount(0)
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('Eavesly flagged this', { exact: true })).toBeVisible()
  await expect(consent.getByText(`Saved context (Customer · Step 2 Credit Review): ${note}`, { exact: true })).toHaveCount(1)
  await expect(consent.getByText('Evidence Eavesly used', { exact: true })).toBeVisible()
  await expect(consent).toContainText('No reason saved for this score.')
  await expect(consent.locator('blockquote')).toHaveText(['No, do not pull my credit.', 'I have pulled it anyway.'])
  await expect(consent.locator('figcaption')).toHaveText(['Customer · Step 2 Credit Review', 'Agent · Step 2 Credit Review'])
  await expect(consent.getByText('Is Eavesly’s assessment correct?', { exact: true })).toBeVisible()
  await expect(response(page, 'Credit pull consent').getByRole('radio')).toHaveCount(3)
  const coaching = page.getByRole('article', { name: 'patience empathy', exact: true })
  await expect(coaching.getByText('Eavesly score concern', { exact: true })).toBeVisible()
  await expect(coaching.getByText('Eavesly flagged this', { exact: true })).toHaveCount(0)
  await expect(coaching).toContainText('No reason saved for this score.')
})

test('a maximum observed saved reason is visible verbatim without an expand step', async ({ page }) => {
  const reason = `Review requested. ${'The agent restated the guaranteed outcome during the closing segment. '.repeat(12)}`.slice(0, 828)
  await reviewFixture(page, [alertRow('long-reason', { result_json: { ...FULL_QA_RESULT, call_overview: { manager_review_reason: reason } } })])
  await page.goto('/dashboard/alerts/long-reason/full_qa')
  const summary = page.getByRole('region', { name: 'Why Eavesly requested review', exact: true })
  await expect(summary.getByText(reason, { exact: true })).toBeVisible()
  await expect(summary.getByRole('button', { name: 'Full reason' })).toHaveCount(0)
})

test('missing or malformed explanations never become invented reasons or confirmed findings', async ({ page }) => {
  const result = { ...FULL_QA_RESULT,
    _synthetic_staging: true,
    call_overview: { manager_review_reason: { invented: 'Never render me as a saved reason.' }, manager_review_required: false },
    compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard,
      compliance_violations: [null, {}, false, '  '],
      credit_pull_consent_evidence: [{ quote: 'Yes, I authorize that credit review.', context: { invalid: true } }],
    },
  }
  await reviewFixture(page, [alertRow('DEMO-REVIEW-001', { result_json: result })])
  await page.goto('/dashboard/alerts/DEMO-REVIEW-001/full_qa')
  const summary = page.getByRole('region', { name: 'Why Eavesly requested review', exact: true })
  await expect(summary).toContainText('No alert reason saved.')
  await expect(summary).toContainText('saved assessment says manager review was not required')
  await expect(summary.getByRole('listitem')).toHaveCount(0)
  await expect(summary.getByText(/Recorded compliance issues/)).toHaveCount(0)
  await expect(page.getByText('Never render me as a saved reason.', { exact: true })).toHaveCount(0)
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent).toContainText('No reason saved for this score.')
  await expect(consent.locator('blockquote')).toHaveText('Yes, I authorize that credit review.')
  await expect(consent.locator('figcaption')).toHaveText('Speaker not saved')
  await expect(consent.getByRole('radio', { name: 'Correct', exact: true })).toBeChecked()
  await expect(page.getByText('No coaching issues added.', { exact: true })).toBeVisible()
  // A production-mode render never adds staging guidance, even for a matching synthetic ID.
  await expect(page.getByRole('complementary', { name: 'Staging practice guidance' })).toHaveCount(0)
})

test('severe-treatment reason survives without compliance counts and step notes stay scoped', async ({ page }) => {
  const reason = 'Manager review requested for the explicit refusal to end the call after repeated requests.'
  const result = { ...FULL_QA_RESULT,
    call_overview: { manager_review_reason: reason },
    sales_process_scorecard: { ...FULL_QA_RESULT.sales_process_scorecard,
      section_gap_reasons: [{ section: 6, reason: 'The debt-resolution discussion ended before options were explained.' }, { section: 2, reason: 'Unrelated credit-review gap.' }],
    },
  }
  await reviewFixture(page, [alertRow('severe-reason', { result_json: result })])
  await page.goto('/dashboard/alerts/severe-reason/full_qa')
  const summary = page.getByRole('region', { name: 'Why Eavesly requested review', exact: true })
  await expect(summary.getByText(reason, { exact: true })).toBeVisible()
  await expect(summary.getByRole('listitem')).toHaveCount(0)
  const step = page.getByRole('article', { name: 'step6 debt resolution', exact: true })
  await expect(step).toContainText('The debt-resolution discussion ended before options were explained.')
  await expect(step).not.toContainText('Unrelated credit-review gap.')
})

test('program gaps remain section-level notes rather than invented per-criterion reasons', async ({ page }) => {
  const summary = 'The enrollment discussion omitted recovery and rebuild.'
  const result = { ...FULL_QA_RESULT, program_expectations_scorecard: { ...FULL_QA_RESULT.program_expectations_scorecard,
    enrollment_completed: true, section_status: 'fail', section_summary: summary, missing_elements: ['Recovery phase', 'Rebuild phase'],
  } }
  await reviewFixture(page, [alertRow('section-notes', { result_json: result })])
  await page.goto('/dashboard/alerts/section-notes/full_qa')
  const section = page.getByRole('complementary', { name: 'Program expectations section notes' })
  await expect(section.getByText(summary, { exact: true })).toBeVisible()
  await expect(section).toContainText('gaps alone do not trigger this alert')
  const criterion = page.getByRole('article', { name: 'phase recovery covered', exact: true })
  await expect(criterion).toContainText('see the saved section notes above')
  await expect(criterion.getByText(summary, { exact: true })).toHaveCount(0)
})

test('Full QA summary, raw source and transcript highlights all use the pinned review source', async ({ page }) => {
  const live = { ...FULL_QA_RESULT, call_overview: { manager_review_reason: 'LIVE SOURCE MUST NOT APPEAR', manager_focus_areas: [{ quote: 'LIVE QUOTE MUST NOT APPEAR' }] } }
  const state = await reviewFixture(page, [alertRow('pinned-source', { result_json: live })])
  state.fullQaSources.set('pinned-source', structuredClone(FULL_QA_RESULT))
  await page.goto('/dashboard/alerts/pinned-source/full_qa')
  await expect(page.getByRole('region', { name: 'Why Eavesly requested review', exact: true })).toContainText('Review both quoted passages in context.')
  await expect(page.getByRole('dialog').getByText('Synthetic call for manager review checks.', { exact: true })).toBeHidden()
  await page.getByText('Recording, transcript and call summary', { exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Synthetic call for manager review checks.', { exact: true })).toBeVisible()
  await page.getByText('Technical details', { exact: true }).click()
  await page.getByRole('button', { name: 'Show raw evaluation JSON', exact: true }).click()
  await expect(page.locator('pre:visible')).toContainText('Review both quoted passages in context.')
  await expect(page.locator('pre:visible')).not.toContainText('LIVE SOURCE MUST NOT APPEAR')
  await page.getByRole('button', { name: 'Inspect transcript context', exact: true }).click()
  await expect(page.locator('mark').first()).toBeVisible()
  await expect(page.getByRole('dialog')).not.toContainText('LIVE QUOTE MUST NOT APPEAR')
})
