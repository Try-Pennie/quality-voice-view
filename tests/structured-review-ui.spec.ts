import { test, expect } from '@playwright/test'
import { genericAlertRow, EMAIL, openAlert, reviewFixture } from './review-fixture'

const violation = 'The required disclosure was omitted from the call.'
const action = 'The manager coached the complete disclosure with the representative.'
const falseExplanation = 'The cited statement came from a different call context.'

function reviewedFalse(id: string) {
  return genericAlertRow(id, {
    is_reviewed: true,
    accurate: false,
    inaccuracy_reason: 'wrong_context',
    feedback_by: 'first.manager@example.test',
    feedback_comment: falseExplanation,
    review_revision: 1,
    feedback_id: 7,
  })
}

test('internal form requires distinct bounded real details and an explanation for every false alarm', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [genericAlertRow('real'), genericAlertRow('false')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'real')
  await page.getByRole('button', { name: 'Real issue (Y)' }).click()
  await page.getByRole('button', { name: '1. Coached the agent' }).click()
  const whatHappened = page.getByRole('textbox', { name: /What happened/ })
  const actionTaken = page.getByRole('textbox', { name: /What action did you take/ })
  await whatHappened.fill('Too short')
  await actionTaken.fill(action)
  await expect(page.getByRole('button', { name: 'Save review' })).toBeDisabled()
  await whatHappened.fill(violation)
  await expect(page.getByRole('button', { name: 'Save review' })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('structured-real-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await actionTaken.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('structured-real-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 720 })
  await actionTaken.press('Control+Enter')
  await expect(page.getByText('Review saved')).toBeVisible()

  await expect(page.getByRole('dialog')).toContainText('Example false')
  await page.getByRole('button', { name: 'False alarm (N)' }).click()
  await page.getByRole('button', { name: '3. Wrong context' }).click()
  await expect(page.getByRole('button', { name: 'Save review' })).toBeDisabled()
  const explanation = page.getByRole('textbox', { name: /Why is this a false alarm/ })
  await explanation.fill(falseExplanation)
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved').last()).toBeVisible()

  const rpcWrites = state.writes.filter(write => write && typeof write === 'object' && 'p_verdict' in write)
  expect(rpcWrites).toHaveLength(2)
  expect(rpcWrites[0]).toMatchObject({
    p_expected_revision: 0,
    p_expected_decision_id: null,
    p_verdict: true,
    p_violation_details: violation,
    p_action_details: action,
    p_false_alarm_details: null,
  })
  expect(rpcWrites[1]).toMatchObject({
    p_verdict: false,
    p_reason: 'wrong_context',
    p_false_alarm_details: falseExplanation,
    p_violation_details: null,
    p_action_details: null,
  })
})

test('click and keyboard verdict toggles preserve drafts but submit only active fields', async ({ page }) => {
  const state = await reviewFixture(page, [genericAlertRow('toggle-real'), genericAlertRow('toggle-false')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'toggle-real')

  await page.getByRole('button', { name: 'False alarm (N)' }).click()
  await page.getByRole('button', { name: '3. Wrong context' }).click()
  await page.getByRole('textbox', { name: /Why is this a false alarm/ }).fill(falseExplanation)
  const realToggle = page.getByRole('button', { name: 'Real issue (Y)' })
  await realToggle.click()
  await page.getByRole('button', { name: '1. Coached the agent' }).click()
  await page.getByRole('textbox', { name: /What happened/ }).fill(violation)
  await page.getByRole('textbox', { name: /What action did you take/ }).fill(action)
  await realToggle.click()
  await page.keyboard.press('n')
  await expect(page.getByRole('textbox', { name: /Why is this a false alarm/ })).toHaveValue(falseExplanation)
  await page.keyboard.press('y')
  await expect(page.getByRole('textbox', { name: /What happened/ })).toHaveValue(violation)
  await page.getByRole('button', { name: 'Save review' }).click()

  await expect(page.getByRole('dialog')).toContainText('Example toggle-false')
  await page.getByRole('button', { name: 'Real issue (Y)' }).click()
  await page.getByRole('button', { name: '1. Coached the agent' }).click()
  await page.getByRole('textbox', { name: /What happened/ }).fill(violation)
  await page.getByRole('textbox', { name: /What action did you take/ }).fill(action)
  await page.getByRole('button', { name: 'False alarm (N)' }).click()
  await page.getByRole('button', { name: '3. Wrong context' }).click()
  await page.getByRole('textbox', { name: /Why is this a false alarm/ }).fill(falseExplanation)
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const writes = state.writes.filter(write => write && typeof write === 'object' && 'p_verdict' in write)
  expect(writes).toHaveLength(2)
  expect(writes[0]).toMatchObject({
    p_verdict: true,
    p_reason: null,
    p_false_alarm_details: null,
  })
  expect(writes[1]).toMatchObject({
    p_verdict: false,
    p_action: null,
    p_violation_details: null,
    p_action_details: null,
  })
})

test('legacy combined notes do not block an approved real-review update', async ({ page }) => {
  const row = genericAlertRow('legacy-note', {
    is_reviewed: true,
    accurate: true,
    action_taken: 'coached',
    feedback_by: EMAIL,
    feedback_comment: 'Historic combined manager note remains available for compatibility.',
    review_revision: 1,
    current_decision_id: 33,
    current_decision: 'approved',
    current_decision_by: 'director@example.test',
    current_decision_source: 'typed',
  })
  const state = await reviewFixture(page, [row])
  await page.goto('/dashboard/alerts?status=reviewed')
  await openAlert(page, 'legacy-note')
  await expect(page.getByText('Updating creates a new revision that requires approval.')).toBeVisible()
  await page.getByRole('textbox', { name: /What happened/ }).fill(violation)
  await page.getByRole('textbox', { name: /What action did you take/ }).fill(action)
  await page.getByRole('button', { name: 'Update review' }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  expect(state.writes.find(write => write && typeof write === 'object' && 'p_verdict' in write)).toMatchObject({
    p_verdict: true,
    p_false_alarm_details: null,
  })
  expect(state.rows[0].current_decision).toBeNull()
})

test('request goes to the current manager, preserves the original, then another admin globally reapproves', async ({ browser }, testInfo) => {
  const row = reviewedFalse('returned')
  row.assigned_manager_email = EMAIL
  row.review_revision = 2
  row.initial_manager_review = {
    manager_email: 'first.manager@example.test',
    accurate: false,
    action_taken: null,
    inaccuracy_reason: 'wrong_context',
    comment: 'The original manager supplied this explanation.',
    violation_details: null,
    action_details: null,
    reviewed_at: '2026-09-05T14:00:00Z',
    updated_at: '2026-09-05T14:00:00Z',
  }

  const requestPage = await browser.newPage()
  const requestState = await reviewFixture(requestPage, [row], {
    god: true,
    email: 'director.one@trypennie.com',
  })
  await requestPage.goto('/dashboard/alerts?status=awaiting_approval')
  await openAlert(requestPage, 'returned')
  await expect(requestPage.getByRole('textbox', { name: /Request changes with instructions/ })).toHaveCount(0)
  await requestPage.getByRole('button', { name: 'Request changes', exact: true }).click()
  await requestPage.getByRole('textbox', { name: /Request changes with instructions/ }).fill('Identify the prior call and explain why this context differs.')
  await requestPage.screenshot({ path: testInfo.outputPath('admin-request-changes-desktop.png'), animations: 'disabled' })
  await requestPage.getByRole('button', { name: 'Request changes', exact: true }).click()
  await expect(requestPage.getByText('Changes requested').first()).toBeVisible()
  expect(requestState.rows[0].current_decision_by).toBe('director.one@trypennie.com')
  await requestPage.close()

  const managerPage = await browser.newPage()
  const managerState = await reviewFixture(managerPage, requestState.rows)
  await managerPage.goto('/dashboard/alerts?status=changes_requested')
  await expect(managerPage.getByText('1 changes requested by Kris', { exact: true })).toBeVisible()
  await expect(managerPage.getByRole('button', { name: /Review .* Example returned/ })).toContainText('Changes requested')
  await openAlert(managerPage, 'returned')
  await managerPage.getByText('Original review history', { exact: true }).click()
  await expect(managerPage.getByText('Original manager review')).toBeVisible()
  await expect(managerPage.getByText('first.manager', { exact: true }).first()).toBeVisible()
  await expect(managerPage.getByText('Identify the prior call and explain why this context differs.').first()).toBeVisible()
  await managerPage.getByRole('button', { name: 'Resubmit review' }).click()
  await expect(managerPage.getByText('Review resubmitted')).toBeVisible()
  expect(managerState.rows[0].review_revision).toBe(3)
  expect(managerState.rows[0].current_decision).toBeNull()
  expect(managerState.rows[0].feedback_by).toBe(EMAIL)
  expect(managerState.rows[0].initial_manager_review).toMatchObject({ manager_email: 'first.manager@example.test' })
  await managerPage.close()

  const adminPage = await browser.newPage()
  const adminState = await reviewFixture(adminPage, managerState.rows, {
    god: true,
    email: 'director.two@trypennie.com',
  })
  await adminPage.goto('/dashboard/alerts?status=awaiting_approval')
  await expect(adminPage.getByText('1 awaiting Kris’s approval', { exact: true })).toBeVisible()
  await openAlert(adminPage, 'returned')
  await adminPage.getByRole('button', { name: 'Approve review' }).click()
  await expect(adminPage.getByText('Review approved')).toBeVisible()
  expect(adminState.rows[0].current_decision).toBe('approved')
  expect(adminState.rows[0].current_decision_by).toBe('director.two@trypennie.com')
  expect(adminState.rows[0].accurate).toBe(false)
  await adminPage.close()
})

test('stale review failure keeps the draft and refreshes authoritative approval state', async ({ page }) => {
  const row = genericAlertRow('stale', {
    is_reviewed: true,
    accurate: true,
    action_taken: 'coached',
    feedback_by: EMAIL,
    violation_details: violation,
    action_details: action,
    review_revision: 1,
  })
  const state = await reviewFixture(page, [row])
  await page.goto('/dashboard/alerts?status=reviewed')
  await openAlert(page, 'stale')
  const actionTaken = page.getByRole('textbox', { name: /What action did you take/ })
  const draft = 'The manager scheduled another coaching session with specific examples.'
  await actionTaken.fill(draft)
  state.rows[0].review_revision = 2
  state.rows[0].current_decision_id = 55
  state.rows[0].current_decision = 'approved'
  state.rows[0].current_decision_by = 'director@example.test'
  state.rows[0].current_decision_source = 'typed'
  await page.getByRole('button', { name: 'Update review' }).click()
  await expect(page.getByText(/This review changed while you were working/)).toBeVisible()
  await expect(actionTaken).toHaveValue(draft)
  await expect(page.getByText('Approved by director')).toBeVisible()
})

test('stale request-changes keeps instructions and refreshes the current revision', async ({ page }) => {
  const row = reviewedFalse('stale-decision')
  const state = await reviewFixture(page, [row], { god: true, email: 'director@example.test' })
  await page.goto('/dashboard/alerts?status=awaiting_approval')
  await openAlert(page, 'stale-decision')
  await page.getByRole('button', { name: 'Request changes', exact: true }).click()
  const instructions = page.getByRole('textbox', { name: /Request changes with instructions/ })
  const draft = 'Please identify the exact prior-call evidence before resubmitting.'
  await instructions.fill(draft)
  state.rows[0].review_revision = 2
  await page.getByRole('button', { name: 'Request changes', exact: true }).click()
  await expect(page.getByText(/This review changed while you were working/)).toBeVisible()
  await expect(instructions).toHaveValue(draft)
  await expect(page.getByRole('button', { name: 'Approve review' })).toBeDisabled()
  await instructions.fill('')
  await page.getByRole('button', { name: 'Approve review' }).click()
  await expect(page.getByText('Review approved')).toBeVisible()
  expect(state.rows[0].current_decision).toBe('approved')
})

test('a late pre-submit detail response cannot overwrite the saved revision', async ({ page }) => {
  const state = await reviewFixture(page, [genericAlertRow('late-detail')])
  let release = () => {}
  state.alertGate = new Promise<void>(resolve => { release = resolve })
  await page.goto('/dashboard/alerts?status=all')
  const requested = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname.endsWith('/eavesly_alerts_with_feedback') && url.searchParams.get('select') === '*' && url.searchParams.get('call_id') === 'eq.late-detail'
  })
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example late-detail', exact: true }).click()
  await requested
  await expect(page.getByRole('region', { name: 'Call recording', exact: true })).toHaveText('Loading recording…')
  await page.getByRole('button', { name: 'Real issue (Y)' }).click()
  await page.getByRole('button', { name: '1. Coached the agent' }).click()
  await page.getByRole('textbox', { name: /What happened/ }).fill(violation)
  await page.getByRole('textbox', { name: /What action did you take/ }).fill(action)
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  release()
  await expect(page.getByText('Review both quoted passages in context.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update review' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /What happened/ })).toHaveValue(violation)
  expect(state.rows[0].review_revision).toBe(1)
})
