import { test, expect, type Page } from '@playwright/test'
import { genericAlertRow, reviewFixture, EMAIL } from './review-fixture'

// Synthetic before/after comparison scenario. Never uses a live session or customer data.

const period = 'start=2026-08-09&end=2026-09-07'
const managerNames = {
  [EMAIL]: 'Manager Alpha',
  'manager-beta@example.test': 'Manager Beta',
  'manager-gamma@example.test': 'Manager Gamma',
  'manager-delta@example.test': 'Manager Delta',
}

function rows() {
  const managers = Object.keys(managerNames)
  const pending = managers.flatMap((manager, index) => Array.from({ length: index + 2 }, (_, i) => genericAlertRow(`pending-${index}-${i}`, {
    agent_email: index === 0 ? 'agent@example.test' : `agent-${index}@example.test`,
    assigned_manager_email: manager,
    call_summary: 'The required disclosure may be incomplete. Review the quoted passage before deciding.',
  })))
  return [
    ...pending,
    ...managers.map((manager, index) => genericAlertRow(`real-${index}`, {
      assigned_manager_email: manager,
      agent_email: index === 0 ? 'agent@example.test' : `agent-${index}@example.test`,
      is_reviewed: true, accurate: true, feedback_by: manager,
      action_taken: 'coached', review_revision: 1, feedback_id: 100 + index,
      reviewed_at: '2026-09-05T14:00:00Z',
      violation_details: 'The representative did not explain the cancellation right before enrollment.',
      action_details: 'We practiced the disclosure together and scheduled a follow-up call review.',
      call_summary: 'Manager reviewed the missing disclosure and recorded a coaching action.',
    })),
    ...managers.map((manager, index) => genericAlertRow(`false-${index}`, {
      assigned_manager_email: manager,
      agent_email: index === 0 ? 'agent@example.test' : `agent-${index}@example.test`,
      is_reviewed: true, accurate: false, feedback_by: manager,
      inaccuracy_reason: 'wrong_context', review_revision: 1, feedback_id: 200 + index,
      reviewed_at: '2026-09-05T15:00:00Z',
      feedback_comment: 'The disclosure was already covered in the preceding call, which I listened to.',
      call_summary: 'Manager marked this flag as incorrect after checking the prior call.',
    })),
    genericAlertRow('correction', {
      is_reviewed: true, accurate: false, feedback_by: EMAIL,
      inaccuracy_reason: 'wrong_context', review_revision: 1, feedback_id: 300,
      feedback_comment: 'The prior call appears to contain the requested disclosure.',
      current_decision: 'changes_requested', current_decision_id: 30,
      current_decision_by: 'director@example.test', current_decision_source: 'typed',
      current_decision_instructions: 'Please identify the prior call and the exact statement that covers this disclosure.',
    }),
    genericAlertRow('missing-owner', { agent_email: 'agent-unassigned@example.test', assigned_manager_email: null }),
    genericAlertRow('placeholder-owner', { agent_email: 'agent-placeholder@example.test', assigned_manager_email: 'Unassigned' }),
  ]
}

async function settled(page: Page) {
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

test('director queue and approval drawer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await reviewFixture(page, rows(), { god: true, managerNames, email: 'director@example.test' })
  await page.goto(`/dashboard/alerts?${period}`)
  await settled(page)
  await page.screenshot({ path: testInfo.outputPath('director-queue-desktop.png'), animations: 'disabled' })
  await page.screenshot({ path: testInfo.outputPath('director-queue-full.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example real-0', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Manager review', exact: true })).toContainText('The representative did not explain the cancellation right before enrollment.')
  await page.screenshot({ path: testInfo.outputPath('director-approval-desktop.png'), animations: 'disabled' })
})

test('manager mobile queue and real-issue form', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 844 })
  await reviewFixture(page, rows(), { managerNames })
  await page.goto(`/dashboard/alerts?${period}`)
  await settled(page)
  await page.screenshot({ path: testInfo.outputPath('manager-queue-mobile.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example pending-0-0', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('radio', { name: 'Warranted (Y)' }).click()
  await page.getByRole('radio', { name: '1. Coached the agent' }).click()
  const what = page.getByRole('textbox', { name: /What happened/ })
  const action = page.getByRole('textbox', { name: /What action did you take/ })
  await what.fill('The representative did not explain the cancellation right before enrollment.')
  await action.fill('We practiced the disclosure together and scheduled a follow-up call review.')
  await expect(page.getByRole('button', { name: 'Save review' })).toBeEnabled()
  await what.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('manager-review-mobile.png'), animations: 'disabled' })
})
