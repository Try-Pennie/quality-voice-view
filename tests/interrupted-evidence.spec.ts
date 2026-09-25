import { test, expect } from '@playwright/test'
import { findEvidenceOccurrences, parseTranscriptTurns } from '../src/lib/transcript-evidence'
import { alertRow, FULL_QA_RESULT, reviewFixture } from './review-fixture'

const fragments = ['This plan does not guarantee results', 'within 18 months and', 'your balance remains -$500 today.']
const quote = fragments.join(' ')
const transcript = `[contact]: Hello.\n[handling agent]: Some context. ${fragments[0]}\n[contact]: Yeah.\n[handling agent]: ${fragments[1]}\n[contact]: Yep.\n[handling agent]: ${fragments[2]} More context.\n[contact]: Thank you.`

test('speaker-attributed quotes map exact fragments without discarding interruptions or same-speaker words', () => {
  const turns = parseTranscriptTurns(transcript)!
  const matches = findEvidenceOccurrences(turns, quote, 'Handling Agent')
  expect(matches).toHaveLength(1)
  expect(matches[0].map(span => span.turnIndex)).toEqual([1, 3, 5])
  expect(matches[0].map(span => turns[span.turnIndex].text.slice(span.start, span.end))).toEqual(fragments)
  expect(findEvidenceOccurrences(turns, quote)).toEqual([])
  expect(findEvidenceOccurrences(turns, quote, 'contact')).toEqual([])
  expect(findEvidenceOccurrences(turns, quote.replace('not ', ''), 'handling agent')).toEqual([])
  expect(findEvidenceOccurrences(turns, quote.replace('-$500', '$500'), 'handling agent')).toEqual([])
  expect(findEvidenceOccurrences(turns, quote.replace('18', '12'), 'handling agent')).toEqual([])
  expect(findEvidenceOccurrences(parseTranscriptTurns(transcript.replace(fragments[1], `I must clarify this. ${fragments[1]}`))!, quote, 'handling agent')).toEqual([])
  expect(findEvidenceOccurrences([...turns, ...turns], quote, 'handling agent')).toHaveLength(2)
  for (const speaker of ['unknown', 'Unknown speaker', 'unidentified', 'Speaker 1']) {
    expect(findEvidenceOccurrences(parseTranscriptTurns(transcript.replace('[contact]: Yeah.', `[${speaker}]: Yeah.`))!, quote, 'handling agent')).toEqual([])
    expect(findEvidenceOccurrences([{ speaker, text: quote }], quote, speaker)).toEqual([])
  }
})

test('interrupted source still requires unique contiguous verified audio and monotonic timing', async ({ page }) => {
  await reviewFixture(page, [alertRow('interrupted-safety')])
  await page.goto('/dashboard/alerts/interrupted-safety/full_qa')
  const result = await page.evaluate(async ({ quote, transcript }) => {
    const path = '/src/lib/recording-timestamps.ts'
    const { createAudioQuoteMatcher } = await import(path)
    const words = quote.split(' ').map((text, index) => ({ text, start: 5 + index * .3, end: 5.2 + index * .3 }))
    const timing = { recording_reference: 'synthetic', original_transcript: transcript, duration: 60, words }
    const match = createAudioQuoteMatcher(timing, 'spoken-spelling')
    return [match(quote, 'handling agent'), match(quote, 'contact'), match(quote), match(quote.replace('not ', ''), 'handling agent'),
      match(quote.replace('-$500', '$500'), 'handling agent'), match(quote.replace('18', '12'), 'handling agent'),
      createAudioQuoteMatcher({ ...timing, original_transcript: transcript + '\n' + transcript }, 'spoken-spelling')(quote, 'handling agent'),
      createAudioQuoteMatcher({ ...timing, words: [...words, ...words.map(word => ({ ...word, start: word.start + 20, end: word.end + 20 }))] }, 'spoken-spelling')(quote, 'handling agent'),
      createAudioQuoteMatcher({ ...timing, words: words.map((word, i) => i === 2 ? { ...word, start: 0, end: .1 } : word) }, 'spoken-spelling')(quote, 'handling agent'),
      createAudioQuoteMatcher({ ...timing, words: [...words.slice(0, 6), { text: 'yeah', start: 6.9, end: 7 }, ...words.slice(6)] }, 'spoken-spelling')(quote, 'handling agent'),
      createAudioQuoteMatcher({ ...timing, original_transcript: quote }, 'spoken-spelling')(quote, 'handling agent'),
      createAudioQuoteMatcher({ ...timing, original_transcript: transcript.replace('[contact]: Yeah.', '[unknown]: Yeah.') }, 'spoken-spelling')(quote, 'handling agent')]
  }, { quote, transcript })
  expect(result[0]).toEqual({ start: 5, end: 5.2 + (quote.split(' ').length - 1) * .3 })
  expect(result.slice(1)).toEqual(Array(11).fill(null))
})

test('interrupted evidence can be found without timing but never invents a Listen action', async ({ page }) => {
  const result = { ...FULL_QA_RESULT, call_overview: { manager_review_reason: 'Synthetic interrupted passage.', manager_focus_areas: [{ quote, speaker: 'handling agent' }] } }
  const state = await reviewFixture(page, [alertRow('interrupted-find', { result_json: result, recording_link: null })])
  state.transcript = transcript
  await page.goto('/dashboard/alerts/interrupted-find/full_qa')
  const card = page.getByRole('group', { name: 'General review focus (no specific claim saved) evidence 1', exact: true })
  await card.getByRole('button', { name: 'Find in transcript — handling agent', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Transcript workspace', exact: true }).locator('mark[aria-current="true"]')).toHaveText(fragments)
  await expect(card.getByRole('button', { name: /^Listen at/ })).toHaveCount(0)
  await expect(card).toContainText('No verified audio timestamp')
  expect(state.writes).toEqual([])
})

test('interrupted evidence listens, highlights one occurrence across chat bubbles, and returns on mobile', async ({ page }, testInfo) => {
  const reference = '/interrupted-evidence.wav'
  const result = { ...FULL_QA_RESULT, compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard,
    critical_red_flag_hits: [{ red_flag: 'Synthetic interrupted claim', evidence: [{ quote, speaker: 'handling agent' }] }],
  } }
  const state = await reviewFixture(page, [alertRow('interrupted', { result_json: result, recording_link: reference })])
  state.transcript = transcript
  const wav = Buffer.alloc(44 + 30 * 8000 * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  await page.route('**/interrupted-evidence.wav', route => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(wav.length - 1, Number(range[2])) : wav.length - 1
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
      headers: range ? { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : { 'Accept-Ranges': 'bytes' } })
  })
  await page.route('**/rest/v1/rpc/get_recording_word_timestamps', route => route.fulfill({ json: {
    recording_reference: reference, original_transcript: transcript, duration: 30,
    words: quote.split(' ').map((text, index) => ({ text, start: 12 + index * .3, end: 12.2 + index * .3 })),
  } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard/alerts/interrupted/full_qa')
  const audio = page.locator('audio')
  await expect.poll(() => audio.evaluate(element => element.duration)).toBe(30)
  const card = page.getByRole('group', { name: 'Synthetic interrupted claim evidence 1', exact: true })
  await card.getByRole('button', { name: 'Listen at 0:12 — handling agent', exact: true }).click()
  await expect.poll(() => audio.evaluate(element => !element.paused && element.currentTime >= 10 && element.currentTime < 12)).toBe(true)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const pane = page.getByRole('region', { name: 'Transcript workspace', exact: true })
  await expect(pane.locator('mark[aria-current="true"]')).toHaveText(fragments)
  await expect(pane.getByRole('status').filter({ hasText: 'matching passages for the selected evidence' })).toHaveText('1 of 1 matching passages for the selected evidence')
  await expect(pane.getByText('Yeah.', { exact: true })).toBeVisible()
  await expect(pane.getByText('Yep.', { exact: true })).toBeVisible()
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const agentBubble = pane.locator('li').filter({ hasText: 'Some context.' })
    const contactBubble = pane.locator('li').filter({ hasText: 'Hello.' })
    const [a, c, list] = await Promise.all([agentBubble.boundingBox(), contactBubble.boundingBox(), pane.getByRole('list').boundingBox()])
    expect(a!.x + a!.width).toBeCloseTo(list!.x + list!.width, 0)
    expect(c!.x).toBeCloseTo(list!.x, 0)
    expect(await pane.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`chat-evidence-${width}.png`) })
  }
  await pane.getByRole('button', { name: 'Back to evidence', exact: true }).click()
  await expect(card).toBeFocused()
  await card.getByRole('radio', { name: 'Evidence: Partly correct', exact: true }).check()
  await card.getByRole('button', { name: 'Add comment', exact: true }).click()
  await card.getByRole('textbox').fill('Synthetic draft preserved while listening.')
  await card.getByRole('button', { name: 'Listen at 0:12 — handling agent', exact: true }).click()
  await pane.getByRole('button', { name: 'Back to evidence', exact: true }).click()
  await expect(card.getByRole('textbox')).toHaveValue('Synthetic draft preserved while listening.')
  expect(state.writes).toEqual([])
})
