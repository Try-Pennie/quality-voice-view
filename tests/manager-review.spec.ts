import { test, expect } from '@playwright/test'
import { genericAlertRow, EMAIL, NOW, openAlert, QUOTES, reviewFixture } from './review-fixture'

const followUp = (id: string) => genericAlertRow(id, {
  is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: EMAIL,
  violation_details: 'The required disclosure was omitted from the call.',
  action_details: 'Follow up in the next coaching session with the specific evidence.',
  feedback_id: 1, reviewed_at: '2026-09-05T16:00:00Z',
})

test('overdue queue retrieves beyond 1000, keeps scope and survives drawer/reload/back', async ({ page }) => {
  const rows = Array.from({ length: 1002 }, (_, index) => genericAlertRow(`call-${String(index).padStart(4, '0')}`))
  rows.push(genericAlertRow('other-team', { agent_email: 'outside@example.test' }))
  rows.push(genericAlertRow('hidden', { module_name: 'disposition_review' }))
  const state = await reviewFixture(page, rows)
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await expect(page.getByText('1,002 ready for first review', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('2026-08-09 – 2026-09-07')
  await expect(page.getByRole('status')).toContainText('Counts only cover this window.')
  const requests = state.requests.filter(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(requests.some(url => url.searchParams.get('offset') === '1000')).toBe(true)
  for (const url of requests) {
    expect(url.searchParams.get('agent_email')).toContain('agent@example.test')
    expect(url.searchParams.get('order')).toContain('call_id.asc,module_name.asc')
    expect(url.searchParams.getAll('module_name')).toContain('neq.disposition_review')
    expect(url.searchParams.getAll('module_name')).toContain('neq.achieve_welcome_call_qa')
    expect(url.searchParams.get('alert_sent')).toBe('eq.true')
  }
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('call-1001')
  await expect(page.getByText('1 ready for first review', { exact: true })).toBeVisible()
  await openAlert(page, 'call-1001')
  expect(new URL(page.url()).searchParams.get('status')).toBe('awaiting_manager')
  expect(new URL(page.url()).searchParams.get('search')).toBe('call-1001')
  await page.reload()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveValue('call-1001')
  await openAlert(page, 'call-1001')
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('awaiting-manager includes fresh work and identifies overdue rows, with oldest first', async ({ page }) => {
  await reviewFixture(page, [
    genericAlertRow('fresh', { alert_created_at: NOW.toISOString() }),
    genericAlertRow('exact', { alert_created_at: '2026-09-06T16:00:00Z' }),
    followUp('reviewed'), genericAlertRow('older'),
    genericAlertRow('oldest', { alert_created_at: '2026-09-01T16:00:00Z' }),
  ])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await expect(page.getByText('4 ready for first review', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toContainText('Example oldest')
  await expect(page.getByRole('button', { name: /Review .* alert for Example oldest/ })).toContainText('Overdue · 6d old')
  await page.getByRole('button', { name: 'Time (ET)' }).click()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toContainText('Example fresh')
  await page.reload()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toContainText('Example fresh')
})

test('failed later page is an error, not a partial or empty inbox; retry recovers', async ({ page }) => {
  const state = await reviewFixture(page, Array.from({ length: 1001 }, (_, index) => genericAlertRow(`call-${index}`)))
  state.failQueueOffset = 1000
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await expect(page.getByText("Couldn't load alerts")).toBeVisible()
  await expect(page.getByText('No received alerts in this window.')).toHaveCount(0)
  await expect(page.getByText('No alerts awaiting a manager in this window.')).toHaveCount(0)
  state.failQueueOffset = -1
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText('1,001 ready for first review', { exact: true })).toBeVisible()
})

test('manager with no agents never fetches an alert list', async ({ page }) => {
  const state = await reviewFixture(page, [genericAlertRow('not-visible')], { noAgents: true })
  await page.goto('/dashboard/alerts?status=coaching_due')
  await expect(page.getByRole('heading', { name: 'No agents assigned to you' })).toBeVisible()
  expect(state.requests.filter(url => url.searchParams.get('select')?.includes('feedback_comment'))).toHaveLength(0)
})

test('defer from New, then complete coaching; failed save preserves draft and queue', async ({ page }) => {
  const state = await reviewFixture(page, [genericAlertRow('defer'), followUp('remaining')])
  await page.goto('/dashboard/alerts')
  await openAlert(page, 'defer')
  await page.getByRole('button', { name: 'Real issue (Y)', exact: true }).click()
  await page.getByRole('button', { name: '3. Will follow up later', exact: true }).click()
  await page.getByRole('textbox', { name: 'What happened?' }).fill('The required disclosure was omitted from the call.')
  const firstAction = page.getByRole('textbox', { name: 'What action did you take?' })
  await firstAction.fill('I will follow up in the next coaching session with the specific evidence.')
  // Hotkey must read the latest action/details, not the prior render's closure.
  await firstAction.press('Control+Enter')
  await expect(page.getByText('Review saved')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Queue' }).selectOption('coaching_due')
  await expect(page.getByText('2 coaching due', { exact: true })).toBeVisible()
  await openAlert(page, 'defer')
  await page.getByRole('button', { name: '1. Coached the agent', exact: true }).click()
  const note = page.getByRole('textbox', { name: 'What action did you take?' })
  await note.fill('Coached the agent with this recording and agreed on the correct disclosure for future calls.')
  state.failFeedback = true
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect(page.getByText(/Couldn't save review:/)).toBeVisible()
  await expect(note).toHaveValue('Coached the agent with this recording and agreed on the correct disclosure for future calls.')
  expect(state.rows[0].action_taken).toBe('follow_up_later')
  state.failFeedback = false
  await note.press('Control+Enter')
  await expect(page.getByRole('dialog')).toContainText('Example remaining')
  expect(state.rows[0].action_taken).toBe('coached')
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByText('1 coaching due', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('1 coaching due', { exact: true })).toBeVisible()
})

test('discussion is not a review; composer hotkey never submits the structured form', async ({ page }) => {
  const state = await reviewFixture(page, [genericAlertRow('discussion')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'discussion')
  await page.getByText('Discussion', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Add a message' }).fill('Can we discuss this call in the next coaching session?')
  await page.getByRole('textbox', { name: 'Add a message' }).press('Control+Enter')
  await expect(page.getByRole('textbox', { name: 'Add a message' })).toHaveValue('')
  await expect(page.getByRole('dialog')).toContainText('Example discussion')
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0]).toHaveProperty('body')
  expect(state.rows[0].is_reviewed).toBe(false)
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByText('1 ready for first review', { exact: true })).toBeVisible()
})

test('director approval does not complete coaching or allow silent keyboard override', async ({ page }) => {
  const row = followUp('director')
  row.feedback_by = 'other-manager@example.test'
  const state = await reviewFixture(page, [row], { god: true })
  await page.goto('/dashboard/alerts?status=coaching_due')
  await openAlert(page, 'director')
  await page.keyboard.press('y')
  await page.keyboard.press('Control+Enter')
  expect(state.writes).toHaveLength(0)
  await page.getByRole('button', { name: 'Approve review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approved', exact: true })).toBeDisabled()
  await expect(page.getByRole('dialog')).toContainText('Coaching follow-up is still open.')
  expect(state.rows[0].action_taken).toBe('follow_up_later')
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByText('1 coaching due', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Queue' }).selectOption('awaiting_approval')
  await expect(page.getByText('No manager decisions await approval in this window.')).toBeVisible()
})

test('inline evidence is lazy, independently highlighted, searchable and keyboard navigable', async ({ page }) => {
  const state = await reviewFixture(page, [genericAlertRow('evidence')])
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'evidence')
  expect(state.requests.some(url => url.pathname.endsWith('/eavesly_calls') && url.searchParams.get('call_id') === 'eq.evidence')).toBe(false)
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await expect(page.getByText('2 evidence passages', { exact: true })).toBeVisible()
  await expect(page.locator('mark')).toHaveText(QUOTES)
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toHaveText(QUOTES[1])
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  const search = page.getByRole('searchbox', { name: 'Search transcript' })
  await search.fill('credit')
  await expect(page.locator('mark')).toHaveCount(2)
  await search.press('Enter')
  await expect(page.getByText('2 of 2 search matches', { exact: false })).toBeVisible()
  await search.press('Shift+Enter')
  await expect(page.getByText('1 of 2 search matches', { exact: false })).toBeVisible()
  await search.fill('.*')
  await expect(page.getByText('No search matches.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Show evidence', exact: true }).click()
  await expect(page.locator('mark')).toHaveText(QUOTES)
  expect(errors).toEqual([])
})

test('inline transcript loading, failure/retry, empty and raw/no-evidence states', async ({ page }) => {
  const state = await reviewFixture(page, [genericAlertRow('no-transcript')])
  state.failTranscript = true
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'no-transcript')
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await expect(page.getByText("Couldn't load the transcript.", { exact: false })).toBeVisible()
  state.failTranscript = false
  state.transcript = null
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('No transcript text is available for this call.', { exact: false })).toBeVisible()
  state.transcript = 'Plain transcript without speaker markers. A repeated phrase. A repeated phrase.'
  await page.reload()
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await expect(page.getByText('No literal evidence match in this transcript.', { exact: false })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search transcript' }).fill('repeated phrase')
  await expect(page.locator('mark')).toHaveCount(2)
})

test('drawer close/navigation protects unsaved notes', async ({ page }) => {
  await reviewFixture(page, [genericAlertRow('draft'), genericAlertRow('next')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'draft')
  await page.getByRole('button', { name: 'Real issue (Y)', exact: true }).click()
  const note = page.getByRole('textbox', { name: 'What happened?' })
  await note.fill('Draft coaching notes must not disappear when navigating by keyboard.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Next alert (j)', exact: true }).click()
  await expect(note).toHaveValue('Draft coaching notes must not disappear when navigating by keyboard.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('mobile queue and evidence controls fit and remain usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await reviewFixture(page, [genericAlertRow('mobile'), followUp('coaching')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await expect(page.getByText('1 ready for first review', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('overdue-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > window.innerWidth).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width })).slice(0, 8))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow)).toBe(true)
  await openAlert(page, 'mobile')
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  await page.screenshot({ path: testInfo.outputPath('evidence-mobile.png') })
  await page.getByRole('button', { name: 'Back to alerts' }).click()
  await page.getByRole('combobox', { name: 'Queue' }).selectOption('coaching_due')
  await expect(page.getByText('1 coaching due', { exact: true })).toBeVisible()
})

test('call-detail uses the same searchable evidence view', async ({ page }, testInfo) => {
  await reviewFixture(page, [genericAlertRow('detail')])
  await page.goto('/dashboard/calls/detail')
  await expect(page.getByRole('searchbox', { name: 'Search transcript' })).toBeVisible()
  await expect(page.locator('mark')).toHaveText(QUOTES)
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  await page.screenshot({ path: testInfo.outputPath('call-detail-evidence-desktop.png'), fullPage: true })
})
