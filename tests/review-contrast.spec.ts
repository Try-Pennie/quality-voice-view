import { expect, test, type Locator } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

// Composite actual browser colors, including transparent ancestors, before checking contrast.
async function contrast(locator: Locator, property: 'color' | 'borderTopColor' | 'borderLeftColor', against?: 'white' | 'parent') {
  return locator.evaluate((element, { property, against }) => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number)
    const over = (front: number[], back: number[]) => back.map((channel, i) => front[i] * (front[3] ?? 1) + channel * (1 - (front[3] ?? 1)))
    const ancestors: Element[] = []
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node)
    const background = ancestors.reduce((back, node) => over(rgb(getComputedStyle(node).backgroundColor), back), [255, 255, 255])
    const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0)
    const surrounding = ancestors.slice(0, -1).reduce((back, node) => over(rgb(getComputedStyle(node).backgroundColor), back), [255, 255, 255])
    const first = luminance(against === 'white' ? background : over(rgb(getComputedStyle(element)[property]), background))
    const second = luminance(against === 'white' ? [255, 255, 255] : against === 'parent' ? surrounding : background)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  }, { property, against })
}

test('colored review surfaces retain strong text, selection and input contrast', async ({ page }, testInfo) => {
  // One second of real PCM silence is enough to load the native recording controls.
  const audio = Buffer.alloc(44 + 8000 * 2)
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
  audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
  const state = await reviewFixture(page, [alertRow('contrast', { recording_link: '/contrast.wav' })])
  await page.route('**/contrast.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  await page.goto('/dashboard/alerts/contrast/full_qa')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  const source = page.getByRole('region', { name: 'Credit pull consent: What Eavesly flagged', exact: true })
  await expect(source).toBeVisible()
  await expect(recording.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  expect(await contrast(recording.getByRole('combobox', { name: 'Playback speed' }), 'borderTopColor', 'parent')).toBeGreaterThanOrEqual(3)
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 })
    if (width === 375) await page.getByRole('button', { name: 'Review', exact: true }).click()
    await source.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`review-contrast-${width}.png`) })
    await expect(recording).toHaveCSS('background-color', 'rgb(236, 248, 255)')
    await expect(page.getByRole('region', { name: 'Transcript workspace', exact: true, includeHidden: true })).toHaveCSS('background-color', 'rgb(249, 246, 240)')
    await expect(page.getByRole('region', { name: 'Review workspace', exact: true })).toHaveCSS('background-color', 'rgb(236, 248, 255)')
    const correct = source.getByText('Correct', { exact: true })
    expect(await contrast(correct, 'borderTopColor', 'parent')).toBeGreaterThanOrEqual(3)
    expect(await contrast(source.locator('figcaption').first(), 'color')).toBeGreaterThanOrEqual(7)
    await source.getByRole('radio', { name: 'Evidence: Correct', exact: true }).check()
    await expect(correct).toHaveCSS('background-color', 'rgb(29, 33, 47)')
    expect(await contrast(correct, 'color')).toBeGreaterThanOrEqual(7)
    await source.getByRole('button', { name: 'Clear passage response', exact: true }).click()
    await source.getByRole('button', { name: /^Find in transcript/ }).click()
    const transcript = page.getByRole('region', { name: 'Transcript workspace', exact: true })
    expect(await contrast(transcript.locator('mark[aria-current="true"]').first(), 'color')).toBeGreaterThanOrEqual(7)
    await transcript.getByRole('button', { name: 'Back to evidence', exact: true }).click()
    expect(await contrast(source.getByRole('button', { name: /^Find in transcript/ }), 'color')).toBeGreaterThanOrEqual(4.5)
    await source.getByRole('radio', { name: 'Evidence: Correct', exact: true }).check()
    expect(await contrast(source.getByRole('button', { name: 'Add comment', exact: true }), 'color')).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({ path: testInfo.outputPath(`review-selected-contrast-${width}.png`) })
    await source.getByRole('button', { name: 'Clear passage response', exact: true }).click()
    if (width === 375) {
      const selectedTab = page.getByRole('group', { name: 'Full QA workspace view' }).getByRole('button', { name: 'Review', exact: true })
      expect(await contrast(selectedTab, 'color')).toBeGreaterThanOrEqual(7)
    }
    expect(await contrast(source.getByRole('heading'), 'color')).toBeGreaterThanOrEqual(4.5)
    expect(await contrast(source.getByText('Correct', { exact: true }), 'color')).toBeGreaterThanOrEqual(4.5)
    expect(await contrast(recording.getByRole('button', { name: 'Play', exact: true }), 'color')).toBeGreaterThanOrEqual(4.5)
    expect(await recording.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const reason = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await expect(reason).toBeVisible()
  expect(await contrast(reason, 'borderTopColor')).toBeGreaterThanOrEqual(3)
  await reason.focus()
  await expect(reason).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('review-contrast-input.png') })
  expect(errors).toEqual([])
  expect(state.writes).toEqual([])
})
