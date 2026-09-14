import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { reviewFixture } from './review-fixture'

const callsUrl = '/dashboard?start=2026-08-09&end=2026-09-07'
const rows = Array.from({ length: 65 }, (_, index) => ({
  id: 65 - index, call_id: `benchmark-${65 - index}`, started_at: '2026-09-04T16:00:00Z',
  agent_email: 'agent@example.test', agent_full_name: `Agent ${65 - index}`,
  contact_phone: null, talk_time: 300, handle_time: 360,
  disposition: 'Cal.com Meeting', campaign_name: null,
  qa: { call_id: `benchmark-${65 - index}`, overall_score: 'good', compliance_rating: 'pass', customer_satisfaction_likely: 'high', manager_escalation: false },
}))

async function fixture(page: Page) {
  await reviewFixture(page, [])
  await page.route('**/rest/v1/rpc/eavesly_*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    const input: unknown = route.request().postDataJSON()
    if (!input || typeof input !== 'object') throw new Error('Invalid benchmark RPC input')
    // Deliberately controlled API latency, not a simulation of production SQL.
    await new Promise(resolve => setTimeout(resolve, 180))
    if (name === 'eavesly_calls_page') {
      const offset = 'p_offset' in input && typeof input.p_offset === 'number' ? input.p_offset : 0
      const filtered = 'p_quick_filter' in input && input.p_quick_filter !== 'all'
      const matching = filtered ? rows.slice(0, 3) : rows
      return route.fulfill({ json: { rows: matching.slice(offset, offset + 25), has_more: offset + 25 < matching.length } })
    }
    if (name === 'eavesly_calls_summary') {
      const filtered = 'p_quick_filter' in input && input.p_quick_filter !== 'all'
      return route.fulfill({ json: { total_calls: filtered ? 3 : rows.length, window_calls: rows.length,
        calls_requiring_attention: 0, avg_talk_time: 300, avg_handle_time: 360,
        compliance_pass_rate: 100, high_sat_rate: 100, dispositions: ['Cal.com Meeting'] } })
    }
    if (name === 'eavesly_active_call_agents') return route.fulfill({ json: [{ agent_email: 'agent@example.test', agent_full_name: 'Agent team' }] })
    if (name === 'eavesly_team_pitch_risk') return route.fulfill({ json: [] })
    throw new Error(`Unexpected benchmark RPC: ${name}`)
  })
}

async function startMeasurement(page: Page) {
  return page.evaluate(() => performance.now())
}

async function elapsed(page: Page, start: number) {
  // Wait one paint opportunity so the metric is not just a React DOM mutation.
  return page.evaluate(started => new Promise<number>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)))
  }), start)
}

test('production-build user journeys (synthetic data, controlled latency)', async ({ browser }, testInfo) => {
  const samples = []
  for (let sample = 0; sample < 5; sample++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    const resourceReads: Promise<void>[] = []
    try {
      await fixture(page)
      const resources: Array<{ path: string; decodedBytes: number; transferredBytes: number; contentEncoding: string }> = []
      const resourceFailures: string[] = []
      page.on('response', response => {
        const url = new URL(response.url())
        if (url.origin !== 'http://127.0.0.1:4190' || !/\.(js|css|woff2)$/.test(url.pathname)) return
        // Read real responses rather than the fixture clock's Performance
        // resource buffer. Every asynchronous read is collected and awaited.
        resourceReads.push(response.body().then(async body => {
          const sizes = await response.request().sizes()
          resources.push({ path: url.pathname, decodedBytes: body.byteLength,
            transferredBytes: sizes.responseBodySize + sizes.responseHeadersSize,
            contentEncoding: response.headers()['content-encoding'] ?? 'identity' })
        }).catch(() => { resourceFailures.push(url.pathname) }))
      })
      const cdp = await context.newCDPSession(page)
      await cdp.send('Performance.enable')
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 40, downloadThroughput: 1_250_000, uploadThroughput: 625_000,
      })
      await page.goto(callsUrl)
      const visibleRows = page.locator('tbody tr[role="link"]')
      await expect(visibleRows).toHaveCount(25)
      const firstRowsMs = await elapsed(page, 0)
      await page.waitForFunction(() => {
        const main = document.querySelector('main > div')
        return main && Number(getComputedStyle(main).opacity) >= 0.99
      })
      const settledRowsMs = await elapsed(page, 0)
      await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      await Promise.all(resourceReads)
      expect(resourceFailures).toEqual([])
      const initialResources = [...resources]
      expect(initialResources.some(resource => resource.path.endsWith('.js'))).toBe(true)
      const browserMetrics = await cdp.send('Performance.getMetrics')
      const scriptDurationMs = (browserMetrics.metrics.find(metric => metric.name === 'ScriptDuration')?.value ?? 0) * 1000

      let start = await startMeasurement(page)
      await page.getByRole('button', { name: 'Compliance failures', exact: true }).click()
      await expect(visibleRows).toHaveCount(3)
      const filterMs = await elapsed(page, start)
      await page.getByRole('button', { name: 'All calls', exact: true }).click()
      await expect(visibleRows).toHaveCount(25)

      // Intent-first path: bounded prefetch can use this think time, never an
      // unbounded automatic scan. The same 300 ms hover occurs on both versions.
      const next = page.getByRole('button', { name: 'Next', exact: true })
      await next.hover()
      await new Promise(resolve => setTimeout(resolve, 300))
      start = await startMeasurement(page)
      await next.click()
      await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
      const nextMs = await elapsed(page, start)
      const priorFirstRow = await visibleRows.first().innerText()
      await visibleRows.first().click()
      await expect(page.getByText('Call detail', { exact: true })).toBeVisible()
      start = await startMeasurement(page)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(visibleRows).toHaveCount(25)
      const backMs = await elapsed(page, start)
      const restoredPage = (await visibleRows.first().innerText()) === priorFirstRow
      samples.push({ firstRowsMs, settledRowsMs, filterMs, nextMs, backMs, restoredPage, scriptDurationMs, initialResources })
      if (sample === 0) {
        await page.goto(callsUrl)
        await expect(visibleRows).toHaveCount(25)
        await page.screenshot({ path: testInfo.outputPath('calls-desktop.png'), fullPage: false })
        await page.setViewportSize({ width: 375, height: 844 })
        await page.screenshot({ path: testInfo.outputPath('calls-mobile.png'), fullPage: false })
      }
    } finally {
      await context.close()
      await Promise.all(resourceReads)
    }
  }
  const report = {
    commit: process.env.EXPERIENCE_SOURCE_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    harnessCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyTree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    scenario: 'Production Vite preview; 5 fresh Chromium contexts; 4x CPU; 10 Mbit/s download, 40ms transport latency; synthetic API responses delayed 180ms; no live data.',
    limitations: 'HTTP routing disables browser HTTP cache. Back uses the app query cache. Timings include browser automation wait/action overhead, and first-rows is observed DOM plus two animation frames, not field RUM. Wire bytes include response headers and preview-server compression, not Cloudflare CDN delivery. No production backend timing or authenticated production session is implied.',
    samples,
  }
  const json = JSON.stringify(report, null, 2)
  await testInfo.attach('experience-benchmark', { body: json, contentType: 'application/json' })
  await writeFile(process.env.EXPERIENCE_REPORT ?? '/tmp/eavesly-experience-benchmark.json', json)
})
