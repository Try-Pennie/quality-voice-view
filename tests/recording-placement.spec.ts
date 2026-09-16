import { test, expect, type Page } from '@playwright/test'
import { alertRow, genericAlertRow, reviewFixture } from './review-fixture'

// Real, silent PCM audio served through HTTP: browser transport is not mocked.
const wav = Buffer.alloc(44 + 30 * 8000 * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)

async function recordingRoute(page: Page) {
  await page.route('**/synthetic-recording-*.wav', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Number(range[2]) : wav.length - 1
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
      headers: range ? { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : { 'Accept-Ranges': 'bytes' } })
  })
}

for (const god of [false, true]) test(`${god ? 'Kris' : 'manager'} can listen at the top of alerts without opening details, including while scrolling`, async ({ page }, testInfo) => {
  const priorReview = god ? { is_reviewed: true, feedback_id: 1, feedback_by: 'another.manager@example.test', review_revision: 1, accurate: true } : {}
  const state = await reviewFixture(page, [
    alertRow('recording-a', { ...priorReview, recording_link: '/synthetic-recording-a.wav' }),
    alertRow('recording-b', { ...priorReview, recording_link: '/synthetic-recording-b.wav' }),
    genericAlertRow('recording-generic', { ...priorReview, recording_link: '/synthetic-recording-generic.wav' }),
  ], { god })
  await recordingRoute(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  await page.goto('/dashboard/alerts/recording-a/full_qa')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  const audio = page.locator('audio')
  await expect(audio).toHaveCount(1)
  await expect.poll(() => audio.evaluate(element => element.duration)).toBe(30)
  await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeInViewport()
  expect(await audio.evaluate(element => element.paused)).toBe(true)
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(recording.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0)
  await recording.getByRole('button', { name: 'Pause', exact: true }).click()
  await recording.getByRole('button', { name: 'Forward 10 seconds', exact: true }).click()
  expect(await audio.evaluate(element => element.currentTime)).toBeGreaterThanOrEqual(10)
  await recording.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.5')
  expect(await audio.evaluate(element => element.playbackRate)).toBe(1.5)
  await recording.getByRole('slider', { name: 'Seek' }).focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBe(1)

  const transcriptToggle = page.locator('summary', { hasText: 'Transcript and call summary' })
  await transcriptToggle.focus()
  await page.keyboard.press('Space')
  expect(await transcriptToggle.evaluate(element => element.parentElement?.hasAttribute('open'))).toBe(true)
  expect(await audio.evaluate(element => element.paused)).toBe(true)
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 667 : 900 })
    await transcriptToggle.scrollIntoViewIfNeeded()
    await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeInViewport()
    expect(await recording.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect((await recording.getByRole('slider').boundingBox())?.width).toBeGreaterThan(20)
    if (width < 768) expect((await recording.getByRole('link', { name: 'Open recording' }).boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByRole('button', { name: god ? 'Approve review' : 'Save review', exact: true })).toBeInViewport()
    if (width === 375 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${god ? 'kris' : 'manager'}-recording-scrolled-${width}.png`) })
  }
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  const previousAudio = await audio.elementHandle()
  await page.getByRole('button', { name: 'Next alert (j)', exact: true }).click()
  await expect(audio).toHaveAttribute('src', '/synthetic-recording-b.wav')
  await expect.poll(() => audio.evaluate(element => element.duration)).toBe(30)
  await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  expect(await audio.evaluate(element => element.currentTime)).toBe(0)
  expect(await audio.evaluate(element => element.playbackRate)).toBe(1.5)
  expect(await previousAudio?.evaluate(element => element.paused)).toBe(true)
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect(audio).toHaveCount(0)

  await page.goto('/dashboard/alerts/recording-generic/budget_inputs')
  await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeInViewport()
  await expect(audio).toHaveCount(1)
  expect(state.writes).toEqual([])
  expect(errors).toEqual([])
})

test('call detail puts its single recording above metadata and alerts on desktop and mobile', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('recording-call')])
  await recordingRoute(page)
  await page.route('**/rest/v1/eavesly_transcription_qa*', route => route.fulfill({ json: {
    call_id: 'recording-call', recording_link: '/synthetic-recording-call.wav', original_transcript: 'Synthetic call transcript.',
  } }))
  await page.goto('/dashboard/calls/recording-call')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await expect(page.locator('audio')).toHaveCount(1)
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeInViewport()
    const box = await recording.boundingBox()
    const header = await page.getByRole('heading', { level: 1 }).boundingBox()
    expect(box && header && box.y + box.height <= header.y).toBe(true)
    if (width === 375) await page.screenshot({ path: testInfo.outputPath('call-recording-mobile.png') })
    expect(await recording.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect((await recording.getByRole('slider').boundingBox())?.width).toBeGreaterThan(20)
  }
  await page.screenshot({ path: testInfo.outputPath('call-recording-desktop.png') })
  expect(state.writes).toEqual([])
})

test('an alert list row shows loading until recording details arrive, not a false unavailable message', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('loading-recording', { recording_link: '/synthetic-recording-loading.wav' })])
  await recordingRoute(page)
  let release = () => {}
  state.alertGate = new Promise<void>(resolve => { release = resolve })
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example loading-recording', exact: true }).click()
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await expect(recording).toHaveText('Loading recording…')
  await expect(recording.getByText('Recording not available')).toHaveCount(0)
  release()
  await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeInViewport()
})

test('missing recordings show an honest compact message rather than dead controls', async ({ page }) => {
  await reviewFixture(page, [alertRow('no-recording')])
  for (const path of ['/dashboard/alerts/no-recording/full_qa', '/dashboard/calls/no-recording']) {
    await page.goto(path)
    const recording = page.getByRole('region', { name: 'Call recording', exact: true })
    await expect(recording).toHaveText('Recording not available')
    await expect(recording).toBeInViewport()
    await expect(page.locator('audio')).toHaveCount(0)
    expect((await recording.boundingBox())?.height).toBeLessThan(90)
  }
})
