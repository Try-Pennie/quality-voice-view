import { test, expect, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { alertRow, genericAlertRow, reviewFixture, EMAIL, FULL_QA_CRITERIA, FULL_QA_RESULT, QUOTES } from './review-fixture'

test.use({ video: 'on' })

// Real, silent PCM audio served through HTTP: browser transport is not mocked.
const wav = Buffer.alloc(44 + 30 * 8000 * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)

async function recordingRoute(page: Page, audio = wav) {
  await page.route('**/synthetic-recording-*.wav', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    // Bound each real range response; metadata shouldn't serialize a 64MB long-call fixture over CDP.
    const end = range ? Math.min(audio.length - 1, range[2] ? Number(range[2]) : start + 262143) : audio.length - 1
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: audio.subarray(start, end + 1),
      headers: range ? { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : { 'Accept-Ranges': 'bytes' } })
  })
}

// Speech-like tones followed by genuine silence, for native analyser checks.
const audibleWav = Buffer.from(wav)
for (let sample = 0; sample < 15 * 8000; sample++) {
  const time = sample / 8000
  const envelope = 0.35 + 0.3 * Math.sin(time * Math.PI * 4)
  audibleWav.writeInt16LE(Math.round(20000 * envelope * (Math.sin(time * Math.PI * 400) + 0.35 * Math.sin(time * Math.PI * 1600))), 44 + sample * 2)
}
test('verified passages play in one click, highlight without scrolling and reset with the next call', async ({ page }, testInfo) => {
  const reference = '/synthetic-recording-timestamps.wav'
  const state = await reviewFixture(page, [alertRow('timestamp-a', { recording_link: reference }), alertRow('timestamp-b', { recording_link: '/synthetic-recording-next-timestamp.wav' })])
  await recordingRoute(page)
  state.transcript = `[handling agent]:Welcome to this synthetic call.\n[contact]:I have a question.\n[handling agent]:${QUOTES[0]}\n[contact]:Thank you for explaining.`
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
    recording_reference: reference, original_transcript: state.transcript, duration: 30,
    words: QUOTES[0].split(' ').map((text, index) => ({ text, start: 12 + index * 0.3, end: 12.2 + index * 0.3 })),
  } }))
  await page.goto('/dashboard/alerts/timestamp-a/full_qa')
  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate(element => element.duration)).toBe(30)
  const link = page.getByRole('button', { name: /^Listen at 0:12/ }).first()
  await expect(link).toBeVisible()
  // Verified evidence has one primary action, not separate Listen and Find controls.
  await expect(page.getByRole('region', { name: 'Flagged passages' }).getByRole('button', { name: 'Find in transcript', exact: true })).toHaveCount(0)
  await link.focus(); await page.keyboard.press('Enter')
  await expect.poll(() => audio.evaluate(element => !element.paused && element.currentTime >= 10 && element.currentTime < 12)).toBe(true)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('slider', { name: 'Seek', exact: true }).fill('2')
  await link.click()
  await expect.poll(() => audio.evaluate(element => !element.paused && element.currentTime >= 10 && element.currentTime < 12)).toBe(true)
  await expect(link).toHaveAttribute('aria-current', 'location')
  const transcript = page.getByRole('region', { name: 'Transcript context' })
  await expect(transcript.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  const transcriptJump = transcript.getByRole('button', { name: 'Play from here at 0:12 — handling agent', exact: true })
  await expect(transcriptJump).toBeVisible()
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('0.5')
  await transcriptJump.click()
  const active = transcript.locator('li[aria-current="true"]')
  await expect(active).toContainText(QUOTES[0])
  await expect(transcript.getByText(/Timestamps appear only for verified audio matches/)).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('timestamp-play-desktop.png') })
  const scroll = page.getByRole('dialog').locator('.overflow-y-auto').first()
  await scroll.evaluate(element => { element.scrollTop = 0 })
  // Progress leaving the verified range must not pull the reader back to that passage.
  await expect(active).toHaveCount(0)
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(0)
  await transcriptJump.click()
  await expect(active).toHaveCount(1)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(active).toHaveCount(0)
  await page.getByRole('slider', { name: 'Seek', exact: true }).fill('20')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(20)
  await expect(active).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 375, height: 812 })
  await transcriptJump.click()
  await expect(active).toHaveCount(1)
  expect((await transcriptJump.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  expect(await transcript.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('timestamp-play-mobile.png') })
  await page.getByRole('button', { name: 'Next alert (j)', exact: true }).click()
  await expect(page.locator('audio')).toHaveAttribute('src', '/synthetic-recording-next-timestamp.wav')
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBe(0)
  await expect(page.getByRole('button', { name: /^(Play from here|Listen at)/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Previous alert (k)', exact: true }).click()
  await expect(page.locator('audio')).toHaveAttribute('src', reference)
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBe(0)
  expect(state.writes).toEqual([])
})

test('unverified audio quotes offer literal transcript navigation, not invented timestamps or paraphrase links', async ({ page }) => {
  const reference = '/synthetic-recording-find.wav'
  const state = await reviewFixture(page, [alertRow('find-quote', { recording_link: reference })])
  await recordingRoute(page)
  state.transcript = `[handling agent]:Welcome to this synthetic call.\n[contact]:I have a question.\n[handling agent]:${QUOTES[0]}\n[contact]:Thank you for explaining.`
  let release: () => void = () => {}
  state.transcriptGate = new Promise(resolve => { release = resolve })
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
    recording_reference: reference, original_transcript: state.transcript, duration: 30,
    words: 'A wholly different passage.'.split(' ').map((text, index) => ({ text, start: index, end: index + 0.5 })),
  } }))
  await page.goto('/dashboard/alerts/find-quote/full_qa')
  const find = page.getByRole('article', { name: 'Credit pull consent', exact: true }).getByRole('button', { name: 'Find in transcript', exact: true })
  await expect(find).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^(Play from here|Listen at)/ })).toHaveCount(0)
  await find.focus(); await page.keyboard.press('Enter')
  const transcript = page.getByRole('region', { name: 'Transcript context' })
  await expect(transcript).toBeFocused()
  await expect(transcript.getByText('Loading transcript…')).toBeVisible()
  release()
  const search = transcript.getByRole('searchbox', { name: 'Search transcript' })
  await expect(search).toHaveValue(QUOTES[0])
  await expect(search).toBeFocused()
  await expect(transcript.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  await expect(transcript.locator('mark[aria-current="true"]')).toBeInViewport()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(true)
  await search.fill('nothing matches')
  await find.click()
  await expect(search).toHaveValue(QUOTES[0])
  await expect(search).toBeFocused()
  await search.fill('explaining')
  await page.getByRole('button', { name: 'View transcript', exact: true }).click()
  await expect(search).toHaveValue('explaining')
  await page.locator('summary', { hasText: 'Discussion' }).click()
  const message = page.getByRole('textbox', { name: 'Add a message', exact: true })
  await message.focus()
  const scroll = page.getByRole('dialog').locator('.overflow-y-auto').first()
  const beforeTyping = await scroll.evaluate(element => element.scrollTop)
  await message.pressSequentially('Keep this unsaved draft while I read.', { delay: 20 })
  await expect(message).toBeInViewport()
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(beforeTyping)
  expect(state.writes).toEqual([])
})

test('a passage click before metadata loads never queues unexpected playback', async ({ page }) => {
  const reference = '/synthetic-recording-delayed-timing.wav'
  const state = await reviewFixture(page, [alertRow('delayed-timing', { recording_link: reference })])
  state.transcript = QUOTES[0]
  await recordingRoute(page)
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/synthetic-recording-delayed-timing.wav', async route => { await gate; await route.fallback() })
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
    recording_reference: reference, original_transcript: QUOTES[0], duration: 30,
    words: QUOTES[0].split(' ').map((text, index) => ({ text, start: 12 + index * 0.3, end: 12.2 + index * 0.3 })),
  } }))
  await page.goto('/dashboard/alerts/delayed-timing/full_qa', { waitUntil: 'domcontentloaded' })
  const link = page.getByRole('button', { name: /^Listen at 0:12/ }).first()
  await link.click()
  await expect(page.getByText(/Recording is not ready/)).toBeVisible()
  release()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.duration)).toBe(30)
  expect(await page.locator('audio').evaluate(audio => ({ time: audio.currentTime, paused: audio.paused }))).toEqual({ time: 0, paused: true })
  await link.click()
  await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused && audio.currentTime >= 10 && audio.currentTime < 12)).toBe(true)
  await expect(page.getByText(/Recording is not ready/)).toHaveCount(0)
  expect(state.writes).toEqual([])
})

for (const kind of ['repeated', 'original-repeated', 'mismatched-recording', 'invalid', 'unavailable', 'duration-mismatch']) test(`timing ${kind} does not produce an unsafe seek`, async ({ page }) => {
  const reference = '/synthetic-recording-timestamp-rejection.wav'
  const state = await reviewFixture(page, [alertRow('timestamp-rejection', { recording_link: reference })])
  state.transcript = QUOTES.join(' ')
  await recordingRoute(page)
  const words = QUOTES[0].split(' ').map((text, index) => ({ text, start: 10 + index * 0.3, end: 10.2 + index * 0.3 }))
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ status: kind === 'unavailable' ? 503 : 200, json: {
    recording_reference: kind === 'mismatched-recording' ? '/wrong-audio.wav' : reference,
    original_transcript: kind === 'original-repeated' ? `${QUOTES[0]} ${QUOTES[0]}` : QUOTES.join(' '),
    duration: kind === 'duration-mismatch' ? 35 : 30,
    words: kind === 'repeated' ? [...words, ...words.map(word => ({ ...word, start: word.start + 10, end: word.end + 10 }))] : kind === 'invalid' ? [{ text: 'invalid', start: -1, end: 3 }] : words,
  } }))
  await page.goto('/dashboard/alerts/timestamp-rejection/full_qa')
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.duration)).toBe(30)
  if (kind === 'duration-mismatch') {
    await page.getByRole('button', { name: /^Listen at 0:10/ }).first().click()
    await expect(page.getByText('This timestamp does not match the recording. Use the player to find the passage.')).toBeVisible()
  } else await expect(page.getByRole('button', { name: /^(Play from here|Listen at)/ })).toHaveCount(0)
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBe(0)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0)
  expect(state.writes).toEqual([])
})

test('a not-yet-seekable HTTP recording refuses a passage instead of starting at the wrong time', async ({ page }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Access-Control-Allow-Origin': '*' })
    // Deliberately ignore Range, reproducing the non-seekable HTTP media boundary.
    response.end(wav)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected local TCP fixture')
    const reference = `http://127.0.0.1:${address.port}/unseekable.wav`
    const state = await reviewFixture(page, [alertRow('unseekable', { recording_link: reference })])
    state.transcript = QUOTES[0]
    await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
      recording_reference: reference, original_transcript: QUOTES[0], duration: 30,
      words: QUOTES[0].split(' ').map((text, index) => ({ text, start: 12 + index * 0.3, end: 12.2 + index * 0.3 })),
    } }))
    await page.goto('/dashboard/alerts/unseekable/full_qa', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.duration)).toBe(30)
    await page.getByRole('button', { name: /^Listen at 0:12/ }).first().click()
    await expect(page.getByText('This passage is not ready. Play the recording to load it, or use the player to find the passage.')).toBeVisible()
    expect(await page.locator('audio').evaluate(audio => ({ paused: audio.paused, time: audio.currentTime }))).toEqual({ paused: true, time: 0 })
    expect(state.writes).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('timing flag controls cache reads without changing playback', async ({ page }) => {
  await reviewFixture(page, [alertRow('timing-flag', { recording_link: '/synthetic-recording-flag.wav' })])
  await recordingRoute(page)
  let reads = 0
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => { reads++; return route.fulfill({ json: null }) })
  await page.goto('/dashboard/alerts/timing-flag/full_qa')
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.duration)).toBe(30)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0.3)
  expect(reads).toBe(process.env.VITE_RECORDING_TIMESTAMPS === 'false' ? 0 : 1)
})

test('literal audio matching keeps signs, amounts and negation and rejects short or unverified quotes', async ({ page }) => {
  await reviewFixture(page, [alertRow('matcher')])
  await page.goto('/dashboard/alerts/matcher/full_qa')
  const results = await page.evaluate(async path => {
    const { createAudioQuoteMatcher } = await import(path)
    const quote = 'Your balance is -$500 today.'
    const words = quote.split(' ').map((text, index) => ({ text, start: index, end: index + 0.5 }))
    const match = createAudioQuoteMatcher({ recording_reference: 'synthetic', original_transcript: quote, duration: 30, words })
    return [match(quote), match('Your balance is $500 today.'), match('Your balance is not -$500 today.'), match('Your balance is'),
      createAudioQuoteMatcher({ recording_reference: 'synthetic', original_transcript: 'A different sentence entirely.', duration: 30, words })(quote)]
  }, '/src/lib/recording-timestamps.ts')
  expect(results).toEqual([{ start: 0, end: 4.5 }, null, null, null, null])
})

test('whole-quote timing tolerates gonna spelling only, preserving ambiguity, amounts, negation and word timestamps', async ({ page }) => {
  await reviewFixture(page, [alertRow('spoken-spelling')])
  await page.goto('/dashboard/alerts/spoken-spelling/full_qa')
  const result = await page.evaluate(async path => {
    const { createAudioQuoteMatcher } = await import(path)
    const quote = "We are not gonna charge you $500 today."
    const expanded = quote.replace('gonna', 'going to')
    const timed = (text: string) => text.split(' ').map((word, index) => ({ text: word, start: index, end: index + 0.5 }))
    const timing = { recording_reference: 'synthetic', duration: 60, original_transcript: quote, words: timed(expanded) }
    const match = createAudioQuoteMatcher(timing, 'spoken-spelling')
    return [createAudioQuoteMatcher(timing)(quote), match(quote), match(quote.replace('not ', '')), match(quote.replace('$500', '$50')),
      createAudioQuoteMatcher({ ...timing, original_transcript: expanded, words: timed(quote) }, 'spoken-spelling')(expanded),
      createAudioQuoteMatcher({ ...timing, words: [...timed(quote), ...timed(expanded).map(w => ({ ...w, start: w.start + 20, end: w.end + 20 }))] }, 'spoken-spelling')(quote),
      createAudioQuoteMatcher({ ...timing, original_transcript: `${quote} ${expanded}` }, 'spoken-spelling')(quote),
      createAudioQuoteMatcher({ ...timing, original_transcript: 'We gonna leave', words: timed('We going to leave') }, 'spoken-spelling')('We gonna leave'),
      createAudioQuoteMatcher({ ...timing, original_transcript: expanded }, 'spoken-spelling')(quote),
      createAudioQuoteMatcher({ ...timing, original_transcript: '[agent]: We are not gonna\n[contact]:charge you $500 today.\n[agent]:Hello.\n[contact]:Goodbye.' }, 'spoken-spelling')(quote)]
  }, '/src/lib/recording-timestamps.ts')
  expect(result).toEqual([null, { start: 0, end: 8.5 }, null, null, { start: 0, end: 7.5 }, null, null, null, null, null])
})

test('call-level flags reveal and play the complete verified passage with context while retaining a mobile draft', async ({ page }, testInfo) => {
  const reference = '/synthetic-recording-flag-navigation.wav'
  const quote = 'You are gonna see the full program details before you decide.'
  const state = await reviewFixture(page, [alertRow('flag-navigation', { recording_link: reference })])
  await recordingRoute(page)
  state.fullQaSources.set('flag-navigation', { ...FULL_QA_RESULT, call_overview: {
    manager_review_reason: 'Review this saved call-level concern in context.',
    manager_focus_areas: [{ quote, speaker: 'handling agent', context: 'Check the statement against the full discussion.' }],
  } })
  state.transcript = `[handling agent]:Welcome to this synthetic call.\n[contact]:I have a question.\n[handling agent]:${quote}\n[contact]:Thank you for explaining.`
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
    recording_reference: reference, original_transcript: state.transcript, duration: 30,
    words: quote.replace('gonna', 'going to').split(' ').map((text, index) => ({ text, start: 12 + index * 0.3, end: 12.2 + index * 0.3 })),
  } }))
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/dashboard/alerts/flag-navigation/full_qa')
  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate(element => element.duration)).toBe(30)
  const views = page.getByRole('group', { name: 'Full QA workspace view' })
  await views.getByRole('button', { name: 'Review', exact: true }).click()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const explanation = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await explanation.fill('Keep this unsaved decision while I listen to the flagged passage.')
  const flags = page.getByRole('region', { name: 'Flagged passages', exact: true })
  const listen = flags.getByRole('button', { name: 'Listen at 0:12 — handling agent', exact: true })
  await listen.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('flag-listen-mobile.png') })
  await listen.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Transcript workspace', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Transcript context' }).locator('mark[aria-current="true"]')).toHaveText(quote)
  await expect.poll(() => audio.evaluate(element => !element.paused && element.currentTime >= 10 && element.currentTime < 12)).toBe(true)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('flag-listen-transcript-mobile.png') })
  await views.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(explanation).toHaveValue('Keep this unsaved decision while I listen to the flagged passage.')
  await expect(listen).toHaveAttribute('aria-current', 'location')
  await expect(flags.getByRole('button', { name: /^Find in transcript/ })).toHaveCount(0)
  await expect(audio).toHaveCount(1)
  await page.setViewportSize({ width: 1440, height: 900 })
  await flags.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('flag-listen-desktop.png') })
  expect(state.writes).toEqual([])
})

test('flag Listen waits for the displayed transcript and rejects a different revision', async ({ page }) => {
  const reference = '/synthetic-recording-stale-transcript.wav'
  const state = await reviewFixture(page, [alertRow('stale-transcript', { recording_link: reference })])
  await recordingRoute(page)
  let release: () => void = () => {}
  state.transcriptGate = new Promise(resolve => { release = resolve })
  state.transcript = 'A different current transcript without the saved passage.'
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
    recording_reference: reference, original_transcript: QUOTES[0], duration: 30,
    words: QUOTES[0].split(' ').map((text, index) => ({ text, start: 12 + index * 0.3, end: 12.2 + index * 0.3 })),
  } }))
  await page.goto('/dashboard/alerts/stale-transcript/full_qa')
  const flags = page.getByRole('region', { name: 'Flagged passages', exact: true })
  // The timing response has arrived and can support text-only navigation, not combined playback.
  await expect(flags.getByRole('button', { name: 'Find in transcript', exact: true })).toHaveCount(1)
  await expect(flags.getByRole('button', { name: /^Listen at/ })).toHaveCount(0)
  release()
  await expect(page.getByText(state.transcript, { exact: true })).toBeVisible()
  await expect(flags.getByRole('button', { name: /^Listen at/ })).toHaveCount(0)
  await expect(flags.getByRole('button', { name: 'Find in transcript', exact: true })).toHaveCount(0)
  expect(await page.locator('audio').evaluate(audio => ({ paused: audio.paused, time: audio.currentTime }))).toEqual({ paused: true, time: 0 })
  expect(state.writes).toEqual([])
})

const spectrumInk = (page: Page) => page.getByRole('img', { name: 'Live audio frequencies, not a recording timeline' }).evaluate((canvas: HTMLCanvasElement) => {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let ink = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++
  return ink
})

test('real streaming sound drives the spectrum, silence stays low, and contexts close with the call', async ({ page, context }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('visual-a', { recording_link: '/synthetic-recording-visual-a.wav' }), alertRow('visual-b', { recording_link: '/synthetic-recording-visual-b.wav' })])
  await recordingRoute(page, audibleWav)
  const cdp = await context.newCDPSession(page)
  const contexts = new Set<string>()
  cdp.on('WebAudio.contextCreated', event => contexts.add(event.context.contextId))
  cdp.on('WebAudio.contextWillBeDestroyed', event => contexts.delete(event.contextId))
  cdp.on('WebAudio.contextChanged', event => { if (event.context.contextState === 'closed') contexts.delete(event.context.contextId) })
  await cdp.send('WebAudio.enable')
  const requests: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('synthetic-recording-visual')) requests.push(request.resourceType()) })
  page.on('pageerror', error => errors.push(error.name))
  await page.goto('/dashboard/alerts/visual-a/full_qa')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await expect(recording.getByText('Ready to play', { exact: true })).toBeVisible()
  expect(contexts.size).toBe(0)
  const baseline = await spectrumInk(page)
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(recording.getByText('Live audio', { exact: true })).toBeVisible()
  await expect.poll(() => spectrumInk(page)).toBeGreaterThan(baseline * 2)
  await expect.poll(() => contexts.size).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('live-audio-desktop.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(recording.getByRole('button', { name: 'Pause', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('live-audio-mobile.png') })
  await page.setViewportSize({ width: 1280, height: 720 })
  await recording.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => spectrumInk(page)).toBe(baseline)
  await recording.getByRole('slider', { name: 'Seek' }).fill('20')
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => spectrumInk(page)).toBeLessThanOrEqual(baseline + 4)
  await page.getByRole('button', { name: 'Next alert (j)', exact: true }).click()
  await expect.poll(() => contexts.size).toBe(0)
  await expect(page.locator('audio')).toHaveAttribute('src', '/synthetic-recording-visual-b.wav')
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => contexts.size).toBe(1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => spectrumInk(page)).toBe(baseline)
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0.1)
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
  await expect.poll(() => contexts.size).toBe(0)
  expect(requests.every(type => type === 'media')).toBe(true)
  expect(errors).toEqual([])
  expect(state.writes).toEqual([])
})

test('speech frequencies use the full visualizer width instead of leaving a quiet upper-frequency tail', async ({ page }) => {
  const tone = Buffer.from(wav)
  for (let sample = 0; sample < 30 * 8000; sample++) {
    tone.writeInt16LE(Math.round(16000 * Math.sin(2 * Math.PI * 3000 * sample / 8000)), 44 + sample * 2)
  }
  const state = await reviewFixture(page, [alertRow('speech-band', { recording_link: '/synthetic-recording-speech.wav' })])
  await recordingRoute(page, tone)
  await page.goto('/dashboard/alerts/speech-band/full_qa')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  // Real 3kHz audio should appear near the right edge of the speech band, not three-quarters across.
  await expect.poll(() => page.getByRole('img', { name: 'Live audio frequencies, not a recording timeline' }).evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
    const columns: number[] = []
    for (let x = 0; x < width; x++) {
      if (pixels[(Math.floor(height / 4) * width + x) * 4 + 3] > 0) columns.push(x / width)
    }
    return columns.length ? columns.reduce((sum, x) => sum + x, 0) / columns.length : 0
  })).toBeGreaterThan(0.88)
  expect(state.writes).toEqual([])
})

for (const cors of [false, true]) test(`cross-origin recording ${cors ? 'with CORS has a real spectrum' : 'without CORS falls back to ordinary playback'}`, async ({ page }) => {
  // route.fulfill adds CORS headers automatically. Use real HTTP to exercise browser enforcement.
  const server = createServer((request, response) => {
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), audibleWav.length - 1) : audibleWav.length - 1
    const body = audibleWav.subarray(start, end + 1)
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': body.length, 'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audibleWav.length}` } : {}), ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) })
    response.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected local TCP fixture')
    const reference = `http://127.0.0.1:${address.port}/audio.wav`
    const state = await reviewFixture(page, [alertRow('cross-origin', { recording_link: reference })])
    state.transcript = QUOTES[0]
    await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
      recording_reference: reference, original_transcript: QUOTES[0], duration: 30,
      words: QUOTES[0].split(' ').map((text, index) => ({ text, start: 5 + index * 0.3, end: 5.2 + index * 0.3 })),
    } }))
    await page.goto('/dashboard/alerts/cross-origin/full_qa')
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.duration)).toBe(30)
    const recording = page.getByRole('region', { name: 'Call recording', exact: true })
    if (!cors) {
      await expect(recording.getByText('Audio only', { exact: true })).toBeVisible()
      await expect(recording.getByRole('img')).toHaveCount(0)
    }
    await page.getByRole('button', { name: /^Listen at 0:05/ }).first().click()
    await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused && audio.currentTime >= 3 && audio.currentTime < 5)).toBe(true)
    await expect(recording.getByRole('button', { name: 'Retry recording', exact: true })).toHaveCount(0)
    if (cors) await expect.poll(() => spectrumInk(page)).toBeGreaterThan(2000)
    else {
      await recording.getByRole('button', { name: 'Pause', exact: true }).click()
      await page.getByRole('dialog').focus()
      await page.keyboard.press('Space')
      await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(false)
      await expect(recording.getByRole('img')).toHaveCount(0)
    }
    expect(state.writes).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('a browser without Web Audio keeps native playback instead of failing or pretending to visualize', async ({ page }) => {
  // Missing platform capability, not a mocked media/AudioContext method.
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'AudioContext') })
  const state = await reviewFixture(page, [alertRow('native-only', { recording_link: '/synthetic-recording-native.wav' })])
  await recordingRoute(page, audibleWav)
  await page.goto('/dashboard/alerts/native-only/full_qa')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(recording.getByText('Audio only', { exact: true })).toBeVisible()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0.1)
  expect(state.writes).toEqual([])
})

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

  const transcript = page.getByRole('region', { name: 'Transcript workspace' })
  const transcriptSearch = transcript.getByRole('searchbox', { name: 'Search transcript' })
  await page.getByRole('button', { name: 'View transcript', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(transcriptSearch).toBeFocused()
  expect(await audio.evaluate(element => element.paused)).toBe(true)
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 667 : 900 })
    await transcriptSearch.scrollIntoViewIfNeeded()
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

test('mobile recording keeps a full-width seek target and leaves room for the review', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('mobile-long-call', {
    agent_email: 'production-sample-rep-18@example.test', contact_name: 'Production sample 021 · Latest call',
    recording_link: '/synthetic-recording-long.wav',
  })])
  // Real 66-minute silent PCM; retain the browser-supported 8kHz sample rate.
  const longAudio = Buffer.alloc(44 + 4000 * 8000 * 2)
  wav.copy(longAudio, 0, 0, 44)
  longAudio.writeUInt32LE(longAudio.length - 8, 4)
  longAudio.writeUInt32LE(longAudio.length - 44, 40)
  await recordingRoute(page, longAudio)
  await page.goto('/dashboard/alerts/mobile-long-call/full_qa')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await expect.poll(() => page.locator('audio').evaluate(element => element.duration)).toBe(4000)
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 667 : 900 })
    const slider = await recording.getByRole('slider').boundingBox()
    for (const name of ['Back 10 seconds', 'Play', 'Forward 10 seconds']) {
      const control = recording.getByRole('button', { name, exact: true })
      await expect(control).toBeInViewport()
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    if (width < 640) {
      expect(slider!.width).toBeGreaterThanOrEqual(width - 34)
      expect(slider!.height).toBeGreaterThanOrEqual(44)
      expect((await page.getByRole('region', { name: 'Transcript workspace' }).boundingBox())!.height).toBeGreaterThan(160)
    }
    expect(await recording.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`manager-recording-${width}.png`) })
  }
  expect(state.writes).toEqual([])
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
  const search = page.getByRole('searchbox', { name: 'Search transcript' })
  await search.scrollIntoViewIfNeeded()
  await expect(search).toBeInViewport()
  // Call Detail has its own fixed app header; only unbounded drawer transcripts get a sticky toolbar.
  await expect(search.locator('..').locator('..')).toHaveCSS('position', 'static')
  expect((await search.boundingBox())!.y).toBeGreaterThanOrEqual((await page.locator('header').first().boundingBox())!.height)
  expect(state.writes).toEqual([])
})

test('an alert list row shows loading until recording details arrive, not a false unavailable message', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('loading-recording', { recording_link: '/synthetic-recording-loading.wav' })])
  await recordingRoute(page)
  let release = () => {}
  state.alertGate = new Promise<void>(resolve => { release = resolve })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example loading-recording', exact: true }).click()
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await expect(recording.getByText('Loading recording…', { exact: true })).toBeVisible()
  await expect(recording.getByRole('button', { name: 'View transcript', exact: true })).toBeVisible()
  await expect(recording.getByText('Recording not available')).toHaveCount(0)
  const loadingHeight = (await recording.boundingBox())!.height
  release()
  await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeInViewport()
  expect((await recording.boundingBox())!.height).toBe(loadingHeight)
})

test('failed alert details can be retried without discarding the review draft', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('retry-details', { recording_link: '/synthetic-recording-retry.wav' })])
  await recordingRoute(page)
  let failing = true
  await page.route('**/rest/v1/eavesly_alerts_with_feedback*', route => {
    const params = new URL(route.request().url()).searchParams
    if (failing && params.get('select') === '*' && params.has('module_name') && params.has('call_id')) {
      return route.fulfill({ status: 503, json: { message: 'Synthetic detail failure' } })
    }
    return route.fallback()
  })
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await page.getByRole('button', { name: /Review .* Example retry-details/ }).click()
  await page.getByRole('button', { name: /^(Your decision|Continue review)$/ }).click()
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const draft = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await draft.fill('Keep this draft while the recording recovers.')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await expect(recording.getByRole('button', { name: 'Retry recording', exact: true })).toBeVisible()
  await expect(recording.getByText('Loading recording…', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('recording-error-retry.png') })
  failing = false
  await recording.getByRole('button', { name: 'Retry recording', exact: true }).click()
  await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(draft).toHaveValue('Keep this draft while the recording recovers.')
  await expect.poll(() => page.locator('audio').evaluate(element => element.duration)).toBe(30)
  expect(state.writes).toEqual([])
})

test('a media failure offers retry and real playback recovers without unhandled rejection', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('retry-audio', { recording_link: '/synthetic-recording-retry.wav' })])
  await recordingRoute(page)
  let failing = true
  await page.route('**/synthetic-recording-retry.wav', route => failing
    ? route.fulfill({ status: 503, body: 'Synthetic media failure' }) : route.fallback())
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  await page.goto('/dashboard/alerts/retry-audio/full_qa')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(recording.getByText('Recording could not be played. Try loading it again.', { exact: true })).toBeVisible()
  failing = false
  await recording.getByRole('button', { name: 'Retry recording', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(element => element.duration)).toBe(30)
  await recording.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(element => element.currentTime)).toBeGreaterThan(0)
  expect(errors).toEqual([])
  expect(state.writes).toEqual([])
})

for (const view of ['alerts', 'calls']) test(`${view} retries expired private media with a freshly signed URL`, async ({ page }) => {
  const reference = `storage://review-sample-recordings/${'b'.repeat(32)}.mp3`
  const state = await reviewFixture(page, [alertRow('expired-media', { recording_link: reference })])
  await page.route('**/rest/v1/eavesly_transcription_qa*', route => route.fulfill({ json: { call_id: 'expired-media', recording_link: reference } }))
  let signatures = 0, recovered = false
  await page.route('**/storage/v1/object/sign/review-sample-recordings/*', route => {
    if (route.request().method() === 'POST') {
      signatures++
      return route.fulfill({ json: { signedURL: `/object/sign/review-sample-recordings/audio.wav?token=${recovered ? 'fresh' : 'expired'}` } })
    }
    return new URL(route.request().url()).searchParams.get('token') === 'expired'
      ? route.fulfill({ status: 403, body: 'Synthetic expired link' })
      : route.fulfill({ status: 200, contentType: 'audio/wav', body: wav })
  })
  await page.goto(`/dashboard/${view}/expired-media${view === 'alerts' ? '/full_qa' : ''}`)
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  await expect(recording.getByRole('button', { name: 'Retry recording', exact: true })).toBeVisible()
  const before = signatures
  recovered = true
  await recording.getByRole('button', { name: 'Retry recording', exact: true }).click()
  await expect(page.locator('audio')).toHaveAttribute('src', /token=fresh$/)
  await expect.poll(() => page.locator('audio').evaluate(element => element.duration)).toBe(30)
  expect(signatures).toBeGreaterThan(before)
  expect(await page.locator('audio').evaluate(element => element.paused)).toBe(true)
  expect(state.writes).toEqual([])
})

for (const peerChange of ['review', 'decision']) test(`recording retry cannot rebind a dirty draft to a newer ${peerChange}`, async ({ page }) => {
  const originalReason = 'The original saved manager judgment remains explicit.'
  const peerReason = 'A newer review was saved in another browser session.'
  const draftReason = 'This is an older unsaved draft, not a review of the newer state.'
  const scores: Readonly<Record<string, unknown>> = { ...FULL_QA_RESULT.compliance_scorecard, ...FULL_QA_RESULT.customer_experience_scorecard, ...FULL_QA_RESULT.sales_process_scorecard, ...FULL_QA_RESULT.program_expectations_scorecard }
  const review = { feedback_revision: 1, corrections: FULL_QA_CRITERIA.map(item => ({ criterion_key: item.key, disposition: 'confirmed', corrected_value: scores[item.score_path.split('.')[1]], reason: null })), findings: [], escalation_justified: false, escalation_reason: originalReason, escalation_inaccuracy_reason: 'wrong_context', action_taken: null, action_details: null, saved_by: EMAIL, saved_at: '2026-09-07T15:00:00Z' }
  const row = alertRow('retry-concurrent', { is_reviewed: true, feedback_id: 1, feedback_by: EMAIL, review_revision: 1, accurate: false, recording_link: '/synthetic-recording-concurrent.wav' })
  const state = await reviewFixture(page, [row], { fullQaReviews: new Map([['retry-concurrent', review]]) })
  await recordingRoute(page)
  let failing = true
  await page.route('**/synthetic-recording-concurrent.wav', route => failing ? route.fulfill({ status: 503, body: 'Synthetic failure' }) : route.fallback())
  await page.goto('/dashboard/alerts/retry-concurrent/full_qa?status=all')
  const draft = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await draft.fill(draftReason)
  if (peerChange === 'review') {
    row.review_revision = 2
    state.fullQaReviews.set(row.call_id, { ...review, feedback_revision: 2, escalation_reason: peerReason })
  } else {
    row.current_decision_id = 42
    row.current_decision = 'approved'
    row.current_decision_by = 'director@example.test'
    row.current_decided_at = '2026-09-07T16:00:00Z'
    row.current_decision_source = 'typed'
  }
  failing = false
  await page.getByRole('button', { name: 'Retry recording', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(element => element.duration)).toBe(30)
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.writes[0]).toMatchObject({ p_expected_revision: 1, p_expected_decision_id: null })
  await expect(draft).toHaveValue(draftReason)
  await expect(page.getByText('Saved source or revision changed', { exact: true })).toBeVisible()
  expect(row.review_revision).toBe(peerChange === 'review' ? 2 : 1)
  expect(row.current_decision_id).toBe(peerChange === 'decision' ? 42 : null)
  await page.getByRole('button', { name: 'Reload review and discard draft', exact: true }).click()
  await expect(draft).toHaveValue(peerChange === 'review' ? peerReason : originalReason)
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
})

test('missing recordings show an honest compact message rather than dead controls', async ({ page }) => {
  await reviewFixture(page, [alertRow('no-recording')])
  for (const path of ['/dashboard/alerts/no-recording/full_qa', '/dashboard/calls/no-recording']) {
    await page.goto(path)
    const recording = page.getByRole('region', { name: 'Call recording', exact: true })
    await expect(recording.getByText('Recording not available', { exact: true })).toBeVisible()
    await expect(recording).toBeInViewport()
    await expect(page.locator('audio')).toHaveCount(0)
    expect((await recording.boundingBox())?.height).toBeLessThan(90)
  }
})
