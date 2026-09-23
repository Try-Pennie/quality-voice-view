import { expect, test, type Page } from '@playwright/test'
import { alertRow, QUOTES, reviewFixture } from './review-fixture'

const wav = Buffer.alloc(44 + 2 * 8000 * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)

async function serveRecording(page: Page) {
  await page.route('**/transcript-first.wav', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range ? Math.min(wav.length - 1, range[2] ? Number(range[2]) : wav.length - 1) : wav.length - 1
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
      headers: range ? { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : { 'Accept-Ranges': 'bytes' } })
  })
}

const switchView = (page: Page, name: 'Transcript' | 'Review') =>
  page.getByRole('group', { name: 'Full QA workspace view' }).getByRole('button', { name, exact: true }).click()

test('desktop gives transcript sixty percent and keeps both panes independently scrollable', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('desktop-workspace')])
  state.transcript = Array.from({ length: 30 }, (_, index) => `[handling agent]: Transcript passage ${index} with enough detail to require scrolling.\n[contact]: Customer response ${index} with additional context.`).join('\n')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard/alerts/desktop-workspace/full_qa')

  const dialog = page.getByRole('dialog')
  const transcript = page.getByRole('region', { name: 'Transcript workspace' })
  const review = page.getByRole('region', { name: 'Review workspace' })
  await expect(transcript.getByRole('searchbox', { name: 'Search transcript' })).toBeVisible()
  await expect(review.getByRole('form', { name: 'Full QA rubric review' })).toBeVisible()
  const [dialogBox, transcriptBox, reviewBox] = await Promise.all([dialog.boundingBox(), transcript.boundingBox(), review.boundingBox()])
  expect(dialogBox?.width).toBeGreaterThanOrEqual(1400)
  expect(dialogBox?.height).toBeGreaterThanOrEqual(850)
  const transcriptShare = (transcriptBox?.width ?? 0) / ((transcriptBox?.width ?? 0) + (reviewBox?.width ?? 0))
  expect(transcriptShare).toBeGreaterThanOrEqual(0.58)
  expect(transcriptShare).toBeLessThanOrEqual(0.62)

  const consent = review.getByRole('article', { name: 'Credit pull consent', exact: true })
  const source = consent.getByRole('region', { name: 'Credit pull consent: What Eavesly flagged' })
  const response = consent.getByRole('region', { name: 'Credit pull consent: Your review' })
  const [sourceBox, responseBox] = await Promise.all([source.boundingBox(), response.boundingBox()])
  expect(Math.abs((sourceBox?.x ?? 0) - (responseBox?.x ?? 0))).toBeLessThanOrEqual(1)
  expect(responseBox?.y).toBeGreaterThanOrEqual((sourceBox?.y ?? 0) + (sourceBox?.height ?? 0))

  await page.screenshot({ path: testInfo.outputPath('transcript-first-desktop-entry.png'), animations: 'disabled' })
  await expect.poll(() => transcript.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect.poll(() => review.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await transcript.evaluate(element => { element.scrollTop = 200 })
  expect(await review.evaluate(element => element.scrollTop)).toBe(0)
  await review.evaluate(element => { element.scrollTop = 250 })
  expect(await transcript.evaluate(element => element.scrollTop)).toBe(200)
  await expect(page.getByRole('region', { name: 'Call recording', exact: true })).toBeInViewport()
  await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Save review', exact: true })).toBeInViewport()
})

test('mobile switch preserves one draft and audio instance through every supported width and keyboard save', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('mobile-workspace', { recording_link: '/transcript-first.wav' })])
  await serveRecording(page)
  await page.setViewportSize({ width: 320, height: 812 })
  await page.goto('/dashboard/alerts/mobile-workspace/full_qa')

  const transcriptButton = page.getByRole('group', { name: 'Full QA workspace view' }).getByRole('button', { name: 'Transcript', exact: true })
  const reviewButton = page.getByRole('group', { name: 'Full QA workspace view' }).getByRole('button', { name: 'Review', exact: true })
  await expect(transcriptButton).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Transcript workspace' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Review workspace' })).toBeHidden()

  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate(element => element.duration)).toBe(2)
  await audio.evaluate(element => { element.dataset.workspaceOwner = 'same-audio' })
  await page.getByRole('region', { name: 'Call recording', exact: true }).getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0)

  await reviewButton.click()
  await expect(page.getByRole('region', { name: 'Review workspace' })).toBeVisible()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const explanation = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await explanation.fill('The exact transcript confirms the customer gave permission before the credit pull.')

  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 812 })
    await switchView(page, 'Transcript')
    await expect(transcriptButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('region', { name: 'Transcript workspace' }).getByText('Hello, let us discuss your program.', { exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(audio).toHaveAttribute('data-workspace-owner', 'same-audio')
    if (width === 375) await page.screenshot({ path: testInfo.outputPath('transcript-first-mobile-transcript-375.png'), animations: 'disabled' })
    await switchView(page, 'Review')
    await expect(explanation).toHaveValue('The exact transcript confirms the customer gave permission before the credit pull.')
    if (width === 375) await page.screenshot({ path: testInfo.outputPath('transcript-first-mobile-review-375.png'), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }

  await explanation.focus()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes).toContainEqual(expect.objectContaining({ p_escalation_justified: false }))
})

test('exact evidence jumps to selected transcript text without timing and keeps the review draft', async ({ page }, testInfo) => {
  await reviewFixture(page, [alertRow('literal-jump')])
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/dashboard/alerts/literal-jump/full_qa')
  await switchView(page, 'Review')
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const explanation = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await explanation.fill('Keep this draft while checking the exact evidence in the transcript.')

  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  const find = consent.getByRole('button', { name: 'Find in transcript', exact: true })
  await expect(find).toBeVisible()
  await expect(consent.getByRole('button', { name: /^Play from here/ })).toHaveCount(0)
  await find.click()

  const transcript = page.getByRole('region', { name: 'Transcript workspace' })
  await expect(transcript).toBeVisible()
  await expect(transcript.getByRole('searchbox', { name: 'Search transcript' })).toHaveValue(QUOTES[0])
  await expect(transcript.getByRole('searchbox', { name: 'Search transcript' })).toBeFocused()
  await expect(transcript.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  await expect(transcript.locator('mark[aria-current="true"]')).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('transcript-first-literal-match-375.png'), animations: 'disabled' })
  await switchView(page, 'Review')
  await expect(explanation).toHaveValue('Keep this draft while checking the exact evidence in the transcript.')
})

test('refined workspace keeps evidence before the decision and search navigation compact', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('refined-workspace')])
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard/alerts/refined-workspace/full_qa')
  const flags = page.getByRole('region', { name: 'What Eavesly flagged', exact: true })
  const decision = page.getByText('Was this alert warranted?', { exact: true })
  const scores = flags.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(decision).toBeVisible()
  expect((await decision.boundingBox())!.y).toBeGreaterThan((await flags.boundingBox())!.y)
  expect((await scores.boundingBox())!.y).toBeLessThan((await decision.boundingBox())!.y)
  await page.screenshot({ path: testInfo.outputPath('refined-workspace-desktop.png') })
  const transcript = page.getByRole('region', { name: 'Transcript context', exact: true })
  const search = transcript.getByRole('searchbox', { name: 'Search transcript' })
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await search.fill('credit')
    const next = transcript.getByRole('button', { name: 'Next match', exact: true })
    const clear = transcript.getByRole('button', { name: 'Show evidence', exact: true })
    for (const control of [search, next, clear]) {
      const box = await control.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(Math.abs(box!.y - (await search.boundingBox())!.y)).toBeLessThan(2)
    }
    await expect(transcript.getByRole('status')).toContainText('1 of 2 search matches')
    await search.press('Enter')
    await expect(transcript.getByRole('status')).toContainText('2 of 2 search matches')
    await expect(transcript.locator('mark[aria-current="true"]')).toBeInViewport()
    await search.press('Shift+Enter')
    await expect(transcript.getByRole('status')).toContainText('1 of 2 search matches')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width === 375) await page.screenshot({ path: testInfo.outputPath('refined-workspace-mobile.png') })
    await clear.click()
    await expect(search).toHaveValue('')
  }
  expect(errors).toEqual([])
  expect(state.writes).toEqual([])
})

test('decision jump and saved-review footer finish the queue without bypassing failed or pending saves', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('a-polished-save'), alertRow('z-polished-next')])
  await page.goto('/dashboard/alerts/a-polished-save/full_qa?status=all')
  const footer = page.getByRole('contentinfo')
  const next = footer.getByRole('button', { name: 'Next alert', exact: true })
  await expect(next).toHaveCount(0)
  await footer.getByRole('button', { name: 'Your decision', exact: true }).click()
  await expect(page.getByText('Was this alert warranted?', { exact: true })).toBeFocused()
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  const save = footer.getByRole('button', { name: 'Save review', exact: true })
  state.failFeedback = true
  await save.click()
  await expect(page.getByText(/Couldn't save Full QA review/)).toBeVisible()
  await expect(next).toHaveCount(0)
  await expect(page).toHaveURL(/polished-save/)
  state.failFeedback = false
  let release: () => void = () => {}
  state.fullQaSubmitGate = new Promise(resolve => { release = resolve })
  await save.click()
  await expect(footer.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
  await expect(next).toHaveCount(0)
  release()
  await expect(next).toBeVisible()
  const feedback = page.getByRole('textbox', { name: 'Feedback on Eavesly (optional)', exact: true })
  await feedback.fill('A new unsaved detail after the successful review.')
  await expect(next).toHaveCount(0)
  await feedback.fill('')
  await expect(next).toBeVisible()
  await next.focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/polished-next/)
})

test('off-team direct links do not read or display raw call transcripts', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('off-team-transcript')], { managedAgents: ['someone-else@example.test'] })
  await page.goto('/dashboard/alerts/off-team-transcript/full_qa')
  await expect(page.getByRole('region', { name: 'Transcript workspace' })).toContainText('Transcript unavailable outside your assigned team.')
  await expect(page.getByRole('form', { name: 'Full QA rubric review' })).toBeVisible()
  await page.waitForTimeout(100)
  expect(state.requests.filter(url => url.pathname === '/rest/v1/eavesly_transcription_qa' ||
    (url.pathname === '/rest/v1/eavesly_calls' && url.searchParams.get('call_id') === 'eq.off-team-transcript'))).toEqual([])
})

test('transcript workspace selects the latest QA retry deterministically', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('qa-retries')], { transcriptionQaRows: [
    { call_id: 'qa-retries', id: 9, created_at: '2026-09-01T12:00:00Z', original_transcript: '[agent]: Old retry must not appear.\n[contact]: Old response.\n[agent]: Old follow-up.\n[contact]: Old close.', recording_link: null },
    { call_id: 'qa-retries', id: 10, created_at: '2026-09-02T12:00:00Z', original_transcript: '[agent]: Latest retry selected.\n[contact]: Latest response.\n[agent]: Latest follow-up.\n[contact]: Latest close.', recording_link: null },
  ] })
  await page.goto('/dashboard/alerts/qa-retries/full_qa')
  const transcript = page.getByRole('region', { name: 'Transcript workspace' })
  await expect(transcript).toContainText('Latest retry selected.')
  await expect(transcript).not.toContainText('Old retry must not appear.')
  const request = state.requests.find(url => url.pathname === '/rest/v1/eavesly_transcription_qa')
  expect(request?.searchParams.get('order')).toBe('created_at.desc.nullslast,id.desc')
  expect(request?.searchParams.get('limit')).toBe('1')
})

test('focused desktop pane remains selected and visible when resizing to tablet', async ({ page }) => {
  await reviewFixture(page, [alertRow('resize-focus')])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard/alerts/resize-focus/full_qa')
  const verdict = page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true })
  await verdict.focus()
  await expect(verdict).toBeFocused()
  await page.setViewportSize({ width: 768, height: 900 })
  const switcher = page.getByRole('group', { name: 'Full QA workspace view' })
  await expect(switcher.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(verdict).toBeFocused()
  await expect(verdict).toBeInViewport()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(verdict).toBeFocused()
  await expect(page.getByRole('region', { name: 'Transcript workspace' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Review workspace' })).toBeVisible()
})

for (const stateName of ['missing', 'error'] as const) {
  test(`${stateName} transcript stays usable in the transcript-first workspace`, async ({ page }) => {
    const state = await reviewFixture(page, [alertRow(`${stateName}-transcript`)])
    if (stateName === 'missing') state.transcript = null
    else state.failTranscript = true
    await page.setViewportSize({ width: 414, height: 812 })
    await page.goto(`/dashboard/alerts/${stateName}-transcript/full_qa`)
    const transcript = page.getByRole('region', { name: 'Transcript workspace' })
    if (stateName === 'missing') await expect(transcript.getByText('No transcript text is available for this call.', { exact: false })).toBeVisible()
    else {
      await expect(transcript.getByText("Couldn't load the transcript.", { exact: false })).toBeVisible()
      await expect(transcript.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    }
    await expect(page.getByRole('group', { name: 'Full QA workspace view' })).toBeVisible()
    await switchView(page, 'Review')
    await expect(page.getByRole('form', { name: 'Full QA rubric review' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
