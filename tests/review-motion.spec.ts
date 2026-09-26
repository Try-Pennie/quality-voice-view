import { test, expect, type Page } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

test.use({ video: 'on' })

const opener = (page: Page) => page.getByRole('button', { name: 'Review Manager escalation alert for Example motion-review', exact: true })
const overlay = (page: Page) => page.locator('[data-state="open"].fixed.inset-0').filter({ hasNot: page.getByRole('heading') }).first()

// Pause native CSS timelines before mounting. Pausing in animationstart races
// compositor progress/event delivery on a busy runner; durations/keyframes stay real.
async function pauseEntry(page: Page) {
  await page.addStyleTag({ content: '[role="dialog"][data-state="open"], .fixed.inset-0[data-state="open"] { animation-play-state: paused !important; }' })
  await page.evaluate(() => document.addEventListener('animationstart', event => {
    const element = event.target
    if (!(element instanceof HTMLElement) || !(element.matches('[role="dialog"]') || element.matches('.fixed.inset-0'))) return
    element.dataset.testAnimationStarts = String(Number(element.dataset.testAnimationStarts ?? 0) + 1)
  }))
}

for (const width of [375, 1440]) test(`pointer entry is short, centered and continuous at ${width}px without replay on detail arrival`, async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('motion-review')])
  let release = () => {}
  state.alertGate = new Promise<void>(resolve => { release = resolve })
  await page.setViewportSize({ width, height: width < 640 ? 812 : 900 })
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await pauseEntry(page)
  await opener(page).click()
  const dialog = page.getByRole('dialog'), backdrop = overlay(page)
  await expect(dialog).toHaveAttribute('data-test-animation-starts', '1')
  await expect(backdrop).toHaveAttribute('data-test-animation-starts', '1')
  for (const element of [dialog, backdrop]) {
    const timing = await element.evaluate(el => ({ duration: getComputedStyle(el).animationDuration, easing: getComputedStyle(el).animationTimingFunction, opacity: getComputedStyle(el).opacity }))
    expect(timing).toEqual({ duration: '0.22s', easing: 'cubic-bezier(0.16, 1, 0.3, 1)', opacity: '0' })
  }
  const start = await dialog.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).toJSON())
  expect(start.m41).toBe(0)
  expect(start.m42).toBe(8)
  expect(start.m11).toBeCloseTo(width < 640 ? 1 : 0.985, 3)
  // Sample actual eased frames, including 10% speed inspection through explicit timeline positions.
  for (const time of [22, 110, 219]) {
    for (const element of [dialog, backdrop]) await element.evaluate((el, ms) => { for (const animation of el.getAnimations()) animation.currentTime = ms }, time)
    const frame = await dialog.evaluate(el => ({ opacity: Number(getComputedStyle(el).opacity), y: new DOMMatrix(getComputedStyle(el).transform).m42 }))
    expect(frame.opacity).toBeGreaterThan(0)
    expect(frame.opacity).toBeLessThanOrEqual(1)
    expect(frame.y).toBeGreaterThanOrEqual(0)
    expect(frame.y).toBeLessThan(8)
    await page.screenshot({ path: testInfo.outputPath(`entry-${width}-${time}ms.png`) })
  }
  for (const element of [dialog, backdrop]) await element.evaluate(el => { for (const animation of el.getAnimations()) animation.finish() })
  release()
  await expect(page.getByText('Loading recording…', { exact: true })).toHaveCount(0)
  await expect(dialog).toHaveAttribute('data-test-animation-starts', '1')
  const box = await dialog.boundingBox()
  expect(box).toEqual(width < 640 ? { x: 0, y: 0, width, height: 812 } : { x: 8, y: 18, width: 1424, height: 864 })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener(page)).toBeFocused()
  expect(state.writes).toEqual([])
})

test('Review next animates pointer activation but keyboard, reduced motion and deep links stay instant', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('motion-review')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  const next = page.getByRole('button', { name: /Review next/i })
  await pauseEntry(page)
  await next.click()
  await expect(page.getByRole('dialog')).toHaveAttribute('data-test-animation-starts', '1')
  await page.keyboard.press('Escape')
  await next.focus()
  await page.keyboard.press('Enter')
  for (const element of [page.getByRole('dialog'), overlay(page)]) expect(await element.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await opener(page).click()
  for (const element of [page.getByRole('dialog'), overlay(page)]) expect(await element.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await page.goto('/dashboard/alerts/motion-review/full_qa')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  expect(state.writes).toEqual([])
})

test.describe('real-time pointer and touch motion', () => {
  test.use({ hasTouch: true })

  test('native entry settles, and browser Back/Forward never replays pointer motion', async ({ page }, testInfo) => {
    const state = await reviewFixture(page, [alertRow('motion-review')])
    await page.goto('/dashboard/alerts?status=awaiting_manager')
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width < 640 ? 812 : 900 })
      if (width < 640) await opener(page).tap()
      else await opener(page).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      expect(await dialog.evaluate(el => getComputedStyle(el).animationName)).toBe('enter')
      await dialog.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)) })
      expect(await dialog.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
      if (width < 640) await expect(page.getByRole('region', { name: 'Transcript workspace' }).getByRole('searchbox', { name: 'Search transcript' })).toBeVisible()
      else await expect(page.getByRole('heading', { name: 'Why Eavesly requested review', exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`settled-${width}.png`) })
      await page.goBack()
      await expect(dialog).toHaveCount(0)
      await expect(opener(page)).toBeFocused()
      await page.goForward()
      await expect(dialog).toBeVisible()
      expect(await dialog.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
    expect(state.writes).toEqual([])
  })
})

test('closing during entry and rapid reopening preserve focus, drafts and instant next-call navigation', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('motion-review'), alertRow('second-motion')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await pauseEntry(page)
  await opener(page).click()
  await expect(page.getByRole('dialog')).toHaveAttribute('data-test-animation-starts', '1')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener(page)).toBeFocused()
  await opener(page).click()
  await expect(page.getByRole('dialog')).toHaveAttribute('data-test-animation-starts', '1')
  await page.getByRole('dialog').evaluate(el => { for (const animation of el.getAnimations()) animation.finish() })
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const reason = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await reason.fill('Keep this review draft when closing is cancelled.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(reason).toHaveValue('Keep this review draft when closing is cancelled.')
  await expect(page.getByRole('dialog')).toHaveAttribute('data-test-animation-starts', '1')
  // J/K must not animate or silently discard drafts.
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).focus()
  page.once('dialog', dialog => dialog.accept())
  await page.keyboard.press('j')
  await expect(page).toHaveURL(/second-motion\/full_qa/)
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await expect(reason).toHaveCount(0)
  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  await expect(reason).toHaveValue('')
  expect(state.writes).toEqual([])
})
