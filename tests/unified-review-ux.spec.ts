import { test, expect, type Page } from '@playwright/test'
import { alertRow, genericAlertRow, NOW, QUOTES, reviewFixture } from './review-fixture'

async function expectUnifiedWorkspace(page: Page, width: number, height: number) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  if (width < 640) {
    await expect.poll(() => dialog.boundingBox()).toEqual({ x: 0, y: 0, width, height })
  } else {
    await expect.poll(async () => {
      const box = await dialog.boundingBox()
      return box && {
        width: box.width >= 1040 && box.width <= 1080,
        centered: Math.abs(box.x - (width - box.width) / 2) <= 1,
        height: Math.abs(box.height - height * 0.9) <= 1,
      }
    }).toEqual({ width: true, centered: true, height: true })
  }
}

const litigationResult = {
  violation_reason: 'The customer mentioned active litigation and the required escalation was not recorded.',
  key_evidence_quote: 'I already have an attorney handling the lawsuit.',
}
const violationDetails = 'The active-litigation disclosure required escalation before continuing the call.'
const actionDetails = 'The manager reviewed the escalation path and coached the agent after the call.'

function dispositionAuditRow(id: string, contactName: string) {
  return {
    ...genericAlertRow(id, {
      module_name: 'disposition_review',
      violation_type: 'disposition_review',
      alert_created_at: NOW.toISOString(),
      contact_name: contactName,
      recording_link: 'https://example.test/audit.mp3',
      transcript_url: 'https://example.test/audit-transcript',
      result_json: { reasoning_summary: 'The transcript shows a live conversation before the disposition.', evidence: [{ speaker: 'handling agent', quote: QUOTES[0], rationale: 'The call evidence supports review.' }] },
    }),
    current_disposition: 'Not Interested',
    suggested_disposition: 'Follow Up',
    model_conversation_happened: 'yes',
    model_confidence: 0.94,
    audit_category: 'ended_live_lead' as const,
    talk_time: 420,
  }
}

test('standalone modules use the centered evidence-to-response workspace and preserve the internal save contract', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const row = genericAlertRow('unified-litigation', {
    module_name: 'litigation_check',
    violation_type: 'litigation_check',
    result_json: litigationResult,
    recording_link: 'https://example.test/litigation.mp3',
    transcript_url: 'https://example.test/litigation-transcript',
  })
  const state = await reviewFixture(page, [row])
  await page.goto('/dashboard/alerts/unified-litigation/litigation_check')

  await expectUnifiedWorkspace(page, 1440, 900)
  await expect(page.getByText('agent@example.test · Example unified-litigation', { exact: false }).filter({ visible: true })).toBeVisible()
  const evidence = page.getByRole('region', { name: 'Litigation check: Eavesly evidence' })
  const response = page.getByRole('region', { name: 'Litigation check: Your response' })
  const [evidenceBox, responseBox] = await Promise.all([evidence.boundingBox(), response.boundingBox()])
  expect(responseBox?.x).toBeGreaterThanOrEqual((evidenceBox?.x ?? 0) + (evidenceBox?.width ?? 0))
  await expect(evidence).toContainText(litigationResult.key_evidence_quote)
  await expect(page.getByRole('region', { name: 'Call recording' })).toBeVisible()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Continue review' })).toBeInViewport()
  await expect(page.getByRole('radio', { name: 'Warranted (Y)' })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Warranted (Y)' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('standalone-unified-desktop.png'), animations: 'disabled' })

  await page.setViewportSize({ width: 390, height: 844 })
  await expectUnifiedWorkspace(page, 390, 844)
  await expect(evidence).toBeVisible()
  await expect(response).toBeVisible()
  await response.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('standalone-unified-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.getByRole('radio', { name: 'Warranted (Y)' }).check()
  await page.getByRole('radio', { name: '1. Coached the agent' }).check()
  await page.getByRole('textbox', { name: 'What happened?' }).fill(violationDetails)
  await page.getByRole('textbox', { name: 'What action did you take?' }).fill(actionDetails)
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  expect(state.writes.find(write => write && typeof write === 'object' && 'p_verdict' in write)).toMatchObject({
    p_call_id: 'unified-litigation',
    p_module_name: 'litigation_check',
    p_verdict: true,
    p_action: 'coached',
    p_violation_details: violationDetails,
    p_action_details: actionDetails,
  })
})

test('partner QA keeps its writer and required-note policy inside the same workspace', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const row = alertRow('unified-partner', {
    module_name: 'achieve_welcome_call_qa',
    violation_type: 'achieve_welcome_call',
    result_json: { violation_reason: 'The welcome-call expectation needs review.', key_evidence_quote: 'We can skip the remaining setup.' },
    is_reviewed: true,
    feedback_id: 12,
    feedback_by: 'partner.reviewer@example.test',
    accurate: false,
    inaccuracy_reason: 'wrong_context',
    feedback_comment: 'The original reviewer found that the cited excerpt came from another part of the call.',
    reviewed_at: '2026-09-05T14:00:00Z',
  })
  const state = await reviewFixture(page, [row], { god: true })
  await page.goto('/dashboard/alerts?workload=partner_qa&status=all')
  await page.getByRole('button', { name: 'Review Achieve welcome call alert for Example unified-partner' }).click()

  await expectUnifiedWorkspace(page, 1440, 900)
  await expect(page.getByRole('region', { name: 'Achieve welcome call: Manager’s response' })).toContainText('Wrong context')
  await page.getByRole('button', { name: "Approve partner.reviewer's review" }).click()
  await expect(page.getByRole('button', { name: 'Reviewed' })).toBeVisible()
  await page.getByRole('button', { name: 'Override review' }).click()
  await expect(page.getByRole('region', { name: 'Achieve welcome call: Your response' })).toBeVisible()
  await page.getByRole('radio', { name: 'Warranted (Y)' }).check()
  await page.getByRole('radio', { name: '1. Coached the agent' }).check()
  const notes = page.getByRole('textbox', { name: /What happened and how you addressed it/ })
  await notes.fill('Too short')
  await expect(page.getByRole('button', { name: 'Save override' })).toBeDisabled()
  const feedbackWrites = () => state.writes.filter(write => write && typeof write === 'object' && 'accurate' in write)
  await notes.press('ControlOrMeta+Enter')
  expect(feedbackWrites()).toEqual([])
  await expect(page.getByText('Complete the review before saving.')).toBeHidden({ timeout: 8000 })
  const partnerNotes = 'The manager coached the partner representative on the complete welcome-call setup.'
  await notes.fill(partnerNotes)
  await page.screenshot({ path: testInfo.outputPath('partner-unified-desktop.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Save override' }).click()
  await expect.poll(() => feedbackWrites().length).toBe(1)
  await expect(page.getByText('Review saved')).toBeVisible()
  expect(feedbackWrites()).toEqual([expect.objectContaining({
    call_id: 'unified-partner', accurate: true, action_taken: 'coached', comment: partnerNotes,
  })])
})

test('disposition audit uses the unified workspace, native controls, guarded footer, and audit writer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const auditRow = dispositionAuditRow('unified-audit', 'Audit Contact')
  const nextAuditRow = { ...auditRow, call_id: 'audit-next', contact_name: 'Next Audit Contact', module_result_id: 2 }
  const state = await reviewFixture(page, [auditRow, nextAuditRow])
  await page.goto('/dashboard/disposition-audit')
  await page.locator('tr[role="button"]').filter({ has: page.getByText('Audit Contact', { exact: true }) }).click()

  await expectUnifiedWorkspace(page, 1440, 900)
  await expect(page.getByRole('region', { name: 'Disposition audit: Eavesly evidence' })).toContainText(QUOTES[0])
  await expect(page.getByRole('region', { name: 'Disposition audit: Your response' })).toBeVisible()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Continue review' })).toBeInViewport()
  await expect(page.getByRole('radio', { name: 'Real issue' })).not.toBeChecked()
  const realIssue = page.getByRole('radio', { name: 'Real issue' })
  await realIssue.check()
  await page.getByRole('radio', { name: '1. Coached the agent' }).check()
  page.once('dialog', dialog => dialog.dismiss())
  await page.keyboard.press('j')
  await expect(realIssue).toBeChecked()
  const notes = page.getByRole('textbox', { name: /What happened and how you addressed it/ })
  await notes.fill('The manager coached the agent on the correct live-lead disposition after reviewing the call.')
  await page.screenshot({ path: testInfo.outputPath('audit-unified-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expectUnifiedWorkspace(page, 390, 844)
  const auditResponse = page.getByRole('region', { name: 'Disposition audit: Your response' })
  await auditResponse.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('audit-unified-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 900 })

  let releaseSave = () => {}
  state.feedbackGate = new Promise<void>(resolve => { releaseSave = resolve })
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Enter')
  const writes = state.writes.filter(write => write && typeof write === 'object' && 'module_name' in write)
  expect(writes).toHaveLength(1)
  releaseSave()
  await expect(page.getByText('Review saved')).toBeVisible()
  expect(writes[0]).toMatchObject({ call_id: 'unified-audit', module_name: 'disposition_review', accurate: true, action_taken: 'coached' })
})

test('disposition audit transcript stays lazy, searchable, and honest on error or missing text', async ({ page }) => {
  const rows = [dispositionAuditRow('audit-transcript', 'Transcript Audit'), dispositionAuditRow('audit-transcript-error', 'Error Audit')]
  const state = await reviewFixture(page, rows)
  await page.goto('/dashboard/disposition-audit')
  await page.locator('tr[role="button"]').filter({ has: page.getByText('Transcript Audit', { exact: true }) }).click()
  expect(state.requests.some(url => url.pathname.endsWith('/eavesly_calls'))).toBe(false)
  await page.getByRole('button', { name: 'View transcript', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search transcript' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '1 evidence passages' })).toBeVisible()
  await expect(page.locator('mark')).toHaveText([QUOTES[0]])
  await page.getByRole('button', { name: 'Close (Esc)' }).click()

  state.failTranscript = true
  await page.locator('tr[role="button"]').filter({ has: page.getByText('Error Audit', { exact: true }) }).click()
  await page.getByRole('button', { name: 'View transcript', exact: true }).click()
  await expect(page.getByText("Couldn't load the transcript.", { exact: false })).toBeVisible()
  state.failTranscript = false
  state.transcript = null
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('No transcript text is available for this call.', { exact: false })).toBeVisible()
})
