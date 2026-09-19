import { expect, test, type Locator } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

// Composite actual browser colors, including transparent ancestors, before checking contrast.
async function contrast(locator: Locator, property: 'color' | 'borderTopColor' | 'borderLeftColor', againstWhite = false) {
  return locator.evaluate((element, { property, againstWhite }) => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number)
    const over = (front: number[], back: number[]) => back.map((channel, i) => front[i] * (front[3] ?? 1) + channel * (1 - (front[3] ?? 1)))
    const ancestors: Element[] = []
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node)
    const background = ancestors.reduce((back, node) => over(rgb(getComputedStyle(node).backgroundColor), back), [255, 255, 255])
    const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0)
    const first = luminance(againstWhite ? background : over(rgb(getComputedStyle(element)[property]), background))
    const second = luminance(againstWhite ? [255, 255, 255] : background)
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  }, { property, againstWhite })
}

test('recording, evidence and review controls have distinct surfaces and stronger boundaries', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('contrast')])
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  await page.goto('/dashboard/alerts/contrast/full_qa')
  const recording = page.getByRole('region', { name: 'Call recording', exact: true })
  const source = page.getByRole('region', { name: 'Credit pull consent: What Eavesly flagged', exact: true })
  const response = page.getByRole('region', { name: 'Credit pull consent: Your review', exact: true })
  await expect(source).toBeVisible()
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 })
    await source.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`review-contrast-${width}.png`) })
    expect(await contrast(recording, 'color', true)).toBeGreaterThan(1.12)
    expect(await contrast(source, 'color', true)).toBeGreaterThan(1.06)
    expect(await contrast(response, width < 768 ? 'borderTopColor' : 'borderLeftColor')).toBeGreaterThan(2)
    expect(await contrast(source.getByRole('heading', { name: 'Credit pull consent' }), 'color')).toBeGreaterThanOrEqual(4.5)
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
