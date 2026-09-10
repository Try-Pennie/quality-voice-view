import { test, expect } from '@playwright/test'
import { alertRow, EMAIL, NOW, openAlert, QUOTES, reviewFixture } from './review-fixture'

const followUp = (id: string) => alertRow(id, {
  is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: EMAIL,
  feedback_comment: 'Follow up in the next coaching session and discuss the specific call evidence.',
  feedback_id: 1, reviewed_at: '2026-09-05T16:00:00Z',
})

test('overdue queue retrieves beyond 1000, keeps scope and survives drawer/reload/back', async ({ page }) => {
  const rows = Array.from({ length: 1002 }, (_, index) => alertRow(`call-${String(index).padStart(4, '0')}`))
  rows.push(alertRow('other-team', { agent_email: 'outside@example.test' }))
  rows.push(alertRow('hidden', { module_name: 'disposition_review' }))
  const state = await reviewFixture(page, rows)
  await page.goto('/dashboard/alerts?status=overdue')
  await expect(page.getByRole('heading', { name: '1,002 overdue reviews' })).toBeVisible()
  await expect(page.getByText('Counts only cover this window;', { exact: false })).toContainText('2026-08-09 – 2026-09-07')
  const requests = state.requests.filter(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(requests.some(url => url.searchParams.get('offset') === '1000')).toBe(true)
  for (const url of requests) {
    expect(url.searchParams.get('agent_email')).toContain('agent@example.test')
    expect(url.searchParams.get('order')).toContain('call_id.asc,module_name.asc')
    expect(url.searchParams.getAll('module_name')).toContain('neq.disposition_review')
  }
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('call-1001')
  await expect(page.getByRole('heading', { name: '1 overdue reviews' })).toBeVisible()
  await openAlert(page, 'call-1001')
  expect(new URL(page.url()).searchParams.get('status')).toBe('overdue')
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

test('overdue excludes fresh, reviewed and exactly-24h alerts, with oldest first', async ({ page }) => {
  await reviewFixture(page, [
    alertRow('fresh', { alert_created_at: NOW.toISOString() }),
    alertRow('exact', { alert_created_at: '2026-09-06T16:00:00Z' }),
    followUp('reviewed'), alertRow('older'),
    alertRow('oldest', { alert_created_at: '2026-09-01T16:00:00Z' }),
  ])
  await page.goto('/dashboard/alerts?status=overdue')
  await expect(page.getByRole('heading', { name: '2 overdue reviews' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toContainText('Example oldest')
  await expect(page.getByText('Overdue · 6d old')).toBeVisible()
  await page.getByRole('button', { name: 'Time (ET)' }).click()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toContainText('Example older')
  await page.reload()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toContainText('Example older')
})

test('failed later page is an error, not a partial or empty inbox; retry recovers', async ({ page }) => {
  const state = await reviewFixture(page, Array.from({ length: 1001 }, (_, index) => alertRow(`call-${index}`)))
  state.failQueueOffset = 1000
  await page.goto('/dashboard/alerts?status=overdue')
  await expect(page.getByText("Couldn't load alerts")).toBeVisible()
  await expect(page.getByText('No overdue reviews in this window.')).toHaveCount(0)
  state.failQueueOffset = -1
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1,001 overdue reviews' })).toBeVisible()
})

test('manager with no agents never fetches an alert list', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('not-visible')], { noAgents: true })
  await page.goto('/dashboard/alerts?status=follow_up')
  await expect(page.getByRole('heading', { name: 'No agents assigned to you' })).toBeVisible()
  expect(state.requests.filter(url => url.searchParams.get('select')?.includes('feedback_comment'))).toHaveLength(0)
})

test('defer from New, then complete coaching; failed save preserves draft and queue', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('defer'), followUp('remaining')])
  await page.goto('/dashboard/alerts')
  await openAlert(page, 'defer')
  await page.getByRole('button', { name: 'Real issue (Y)', exact: true }).click()
  await page.getByRole('button', { name: '3. Will follow up later', exact: true }).click()
  await page.getByRole('textbox', { name: /What happened and how you addressed it/ }).fill('I will follow up in the next coaching session to discuss this specific evidence.')
  // Hotkey must read the latest action/comment, not the prior render's closure.
  await page.getByRole('textbox', { name: /What happened and how you addressed it/ }).press('Control+Enter')
  await expect(page.getByText('Review saved')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Follow-up', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2 coaching follow-ups' })).toBeVisible()
  await openAlert(page, 'defer')
  await page.getByRole('button', { name: '1. Coached the agent', exact: true }).click()
  const note = page.getByRole('textbox', { name: /What happened and how you addressed it/ })
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
  await expect(page.getByRole('heading', { name: '1 coaching follow-ups' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '1 coaching follow-ups' })).toBeVisible()
})

test('discussion is not a review; composer hotkey never submits the structured form', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('discussion')])
  await page.goto('/dashboard/alerts?status=overdue')
  await openAlert(page, 'discussion')
  await page.getByRole('textbox', { name: 'Add a message' }).fill('Can we discuss this call in the next coaching session?')
  await page.getByRole('textbox', { name: 'Add a message' }).press('Control+Enter')
  await expect(page.getByRole('textbox', { name: 'Add a message' })).toHaveValue('')
  await expect(page.getByRole('dialog')).toContainText('Example discussion')
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0]).toHaveProperty('body')
  expect(state.rows[0].is_reviewed).toBe(false)
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1 overdue reviews' })).toBeVisible()
})

test('director approval does not complete coaching or allow silent keyboard override', async ({ page }) => {
  const row = followUp('director')
  row.feedback_by = 'other-manager@example.test'
  const state = await reviewFixture(page, [row], { god: true })
  await page.goto('/dashboard/alerts?status=follow_up')
  await openAlert(page, 'director')
  await page.keyboard.press('y')
  await page.keyboard.press('Control+Enter')
  expect(state.writes).toHaveLength(0)
  await page.getByRole('button', { name: /Approve .* review/ }).click()
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Coaching follow-up is still open.')
  expect(state.rows[0].action_taken).toBe('follow_up_later')
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1 coaching follow-ups' })).toBeVisible()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByText('Inbox zero — nothing to review.')).toBeVisible()
})

test('inline evidence is lazy, independently highlighted, searchable and keyboard navigable', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('evidence')])
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/dashboard/alerts?status=overdue')
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
  const state = await reviewFixture(page, [alertRow('no-transcript')])
  state.failTranscript = true
  await page.goto('/dashboard/alerts?status=overdue')
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
  await reviewFixture(page, [alertRow('draft'), alertRow('next')])
  await page.goto('/dashboard/alerts?status=overdue')
  await openAlert(page, 'draft')
  await page.getByRole('button', { name: 'Real issue (Y)', exact: true }).click()
  const note = page.getByRole('textbox', { name: /What happened and how you addressed it/ })
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
  await reviewFixture(page, [alertRow('mobile'), followUp('coaching')])
  await page.goto('/dashboard/alerts?status=overdue')
  await expect(page.getByRole('heading', { name: '1 overdue reviews' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('overdue-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > window.innerWidth).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width })).slice(0, 8))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow)).toBe(true)
  await openAlert(page, 'mobile')
  await page.getByRole('button', { name: 'Inspect transcript context' }).click()
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  await page.screenshot({ path: testInfo.outputPath('evidence-mobile.png') })
  await page.getByRole('button', { name: 'Back to alerts' }).click()
  await page.getByRole('button', { name: 'Follow-up', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1 coaching follow-ups' })).toBeVisible()
})

test('call-detail uses the same searchable evidence view', async ({ page }, testInfo) => {
  await reviewFixture(page, [alertRow('detail')])
  await page.goto('/dashboard/calls/detail')
  await expect(page.getByRole('searchbox', { name: 'Search transcript' })).toBeVisible()
  await expect(page.locator('mark')).toHaveText(QUOTES)
  await page.getByRole('button', { name: 'Next evidence', exact: true }).click()
  await expect(page.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  await page.screenshot({ path: testInfo.outputPath('call-detail-evidence-desktop.png'), fullPage: true })
})
