import { test, expect, type Page } from '@playwright/test'
import type { CallListRow } from '../src/lib/calls-queries'
import { reviewFixture } from './review-fixture'

const period = 'start=2026-08-09&end=2026-09-07'
const url = `/dashboard?${period}`
const call = (id: number): CallListRow => ({
  id, call_id: `call-${id}`, started_at: '2026-09-04T16:00:00Z',
  agent_email: 'agent@example.test', agent_full_name: `Agent ${String(id).padStart(4, '0')}`,
  contact_phone: null, talk_time: id * 10, handle_time: null,
  disposition: 'Cal.com Meeting', campaign_name: null,
  qa: { call_id: `call-${id}`, overall_score: 'good', compliance_rating: 'pass', customer_satisfaction_likely: 'high', manager_escalation: false },
})

function gate() {
  let release = () => {}
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

/** Browser-facing HTTP seam, not a fake proof of SQL. The separate PostgreSQL check owns query correctness. */
async function fixture(page: Page, size = 65) {
  const shared = await reviewFixture(page, [])
  const state = {
    requests: [] as { name: string; args: Record<string, unknown> }[],
    rows: Array.from({ length: size }, (_, i) => call(size - i)),
    summaryGate: Promise.resolve(), pageGate: Promise.resolve(),
    failSummary: false, failPage: false, failPageOffsets: new Set<number>(), malformedPage: false, failAgents: false, failExportOffset: -1, repeatExportPage: false,
  }
  await page.route('**/rest/v1/rpc/eavesly_*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    const args: Record<string, unknown> = route.request().postDataJSON()
    state.requests.push({ name, args })
    const respond = (value: unknown, status = 200) => route.fulfill({ json: value, status })
    if (name === 'eavesly_active_call_agents') return state.failAgents
      ? respond({ message: 'Synthetic agent error' }, 500)
      : respond([
          { agent_email: 'agent@example.test', agent_full_name: 'Agent Team' },
          { agent_email: 'alpha@example.test', agent_full_name: 'Agent Alpha' },
          { agent_email: 'beta@example.test', agent_full_name: 'Agent Beta' },
        ])
    if (name === 'eavesly_team_pitch_risk') return respond([{ agent_email: 'agent@example.test', pitch_call_count: 4, rushed_pitch_count: 2 }])
    if (name === 'eavesly_calls_summary') {
      await state.summaryGate
      if (state.failSummary) return respond({ message: 'Synthetic summary error' }, 500)
      return respond({ total_calls: args.p_quick_filter === 'all' ? size : 1, window_calls: size, calls_requiring_attention: 0,
        avg_talk_time: 330, avg_handle_time: 0, compliance_pass_rate: 100, high_sat_rate: 100, dispositions: ['Cal.com Meeting'] })
    }
    if (name === 'eavesly_calls_page') {
      const offset = Number(args.p_offset)
      const limit = Number(args.p_limit)
      const rows = args.p_quick_filter === 'all' ? [...state.rows] : [call(9999)]
      if (args.p_sort === 'agent') rows.sort((a, b) => (a.agent_full_name ?? '').localeCompare(b.agent_full_name ?? '') * (args.p_desc ? -1 : 1))
      const resultOffset = limit === 1000 && state.repeatExportPage ? 0 : offset
      const response = { rows: rows.slice(resultOffset, resultOffset + limit), has_more: rows.length > resultOffset + limit }
      await state.pageGate
      if (state.failPage || state.failPageOffsets.has(offset) || (limit === 1000 && offset === state.failExportOffset)) return respond({ message: 'Synthetic page error' }, 500)
      if (state.malformedPage) return respond({ rows: [{ id: 'bad' }], has_more: false })
      return respond(response)
    }
    throw new Error(`Unexpected Calls RPC ${name}`)
  })
  return { ...shared, state }
}

const visibleRows = (page: Page) => page.locator('tbody tr[role="link"]')

test('first 25 rows need one RPC, not the summary or 70k calls; Next works before totals', async ({ page }, testInfo) => {
  const { state, requests } = await fixture(page, 70_000)
  const summary = gate()
  state.summaryGate = summary.promise
  try {
    await page.goto(url)
    await expect(visibleRows(page)).toHaveCount(25)
    await expect(page.getByRole('status').filter({ hasText: 'Loading summary' })).toBeVisible()
    await expect(page.getByText(/Showing 1–25 · total pending/)).toBeVisible()
    expect(state.requests.filter(r => r.name === 'eavesly_calls_page')).toHaveLength(1)
    expect(state.requests.map(r => r.name).sort()).toEqual(['eavesly_active_call_agents', 'eavesly_calls_page', 'eavesly_calls_summary'])
    expect(requests.filter(r => /\/eavesly_(calls|transcription_qa)$/.test(r.pathname))).toHaveLength(0)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.getByText(/Showing 26–50 · total pending/)).toBeVisible()
    expect(state.requests.filter(r => r.name === 'eavesly_calls_summary')).toHaveLength(1)
    await testInfo.attach('bounded-load-contract', { body: JSON.stringify({ representedCalls: 70_000, firstPageRows: 25, initialDataRequests: 3, blockedSummaryDidNotBlockRows: true }), contentType: 'application/json' })
  } finally {
    summary.release()
  }
})

test('direct page/sort URLs load that server page and invalid values fall back safely', async ({ page }) => {
  const { state } = await fixture(page)
  await page.goto(`${url}&page=2&sort=agent&dir=asc`)
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  expect(state.requests.find(r => r.name === 'eavesly_calls_page')?.args).toMatchObject({
    p_offset: 25,
    p_sort: 'agent',
    p_desc: false,
  })

  await page.goto(`${url}&page=85899347&sort=unknown&dir=sideways`)
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  const parsed = new URL(page.url()).searchParams
  expect(parsed.get('page')).toBeNull()
  expect(parsed.get('sort')).toBeNull()
  expect(parsed.get('dir')).toBeNull()
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args).toMatchObject({
    p_offset: 0,
    p_sort: 'time',
    p_desc: true,
  })
})

test('server sort/filter resets offset immediately; URL/ET bounds preserved; warm page is cached', async ({ page }) => {
  const { state } = await fixture(page)
  await page.goto(url)
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  const firstPage = state.requests.find(r => r.name === 'eavesly_calls_page')
  expect(firstPage?.args).toMatchObject({ p_start: '2026-08-09T04:00:00.000Z', p_end: '2026-09-08T03:59:59.999Z', p_offset: 0, p_limit: 25, p_sort: 'time', p_desc: true })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  // Returning to page one must use its cache. Whether the browser re-enters
  // the still-focused Next control can additionally prefetch page three.
  for (const offset of [0, 25]) {
    expect(state.requests.filter(r => r.name === 'eavesly_calls_page' && r.args.p_offset === offset)).toHaveLength(1)
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(visibleRows(page).first()).toContainText('Agent 0001')
  expect(new URL(page.url()).searchParams.get('page')).toBeNull()
  expect(new URL(page.url()).searchParams.get('sort')).toBe('agent')
  expect(new URL(page.url()).searchParams.get('dir')).toBe('asc')
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args).toMatchObject({ p_offset: 0, p_sort: 'agent', p_desc: false })
  const delayed = gate()
  state.pageGate = delayed.promise
  try {
    await page.getByRole('button', { name: 'Pitch calls under 30 min', exact: true }).click()
    await expect(visibleRows(page)).toHaveCount(0)
    await expect(page).toHaveURL(/qf=rushed/)
  } finally {
    delayed.release()
  }
  await expect(visibleRows(page)).toHaveCount(1)
  await expect(visibleRows(page).first()).toContainText('Agent 9999')
  expect(new URL(page.url()).searchParams.get('page')).toBeNull()
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args).toMatchObject({ p_offset: 0, p_quick_filter: 'rushed', p_sort: 'agent' })
})

test('Next, call detail, and Back restore exact page, sort, filters, and scroll after a cold page load', async ({ page }) => {
  const { state } = await fixture(page)
  await page.setViewportSize({ width: 1024, height: 500 })
  await page.goto(`${url}&agents=agent%40example.test&sort=agent&dir=asc`)
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  await expect(page).toHaveURL(/agents=agent%40example\.test.*page=2.*sort=agent.*dir=asc/)

  const row = visibleRows(page).last()
  await row.scrollIntoViewIfNeeded()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  expect(scrollBefore).toBeGreaterThan(0)
  await row.click()
  await expect(page).toHaveURL(/\/dashboard\/calls\/call-\d+\?.*agents=agent%40example\.test.*page=2.*sort=agent.*dir=asc/)
  await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
  await page.clock.fastForward(10 * 60_000 + 1)
  const coldPage = gate()
  state.pageGate = coldPage.promise
  await page.getByRole('button', { name: 'Back', exact: true }).click()

  await expect(page).toHaveURL(/\/dashboard\?.*agents=agent%40example\.test.*page=2.*sort=agent.*dir=asc/)
  await expect(visibleRows(page)).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  coldPage.release()
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(scrollBefore - 2)
})

test('filter and uncached-page loading keep honest, stable results geometry without old rows', async ({ page }) => {
  test.setTimeout(60_000)
  const { state } = await fixture(page)
  await page.goto(url)
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  const pageLoad = gate()
  const summaryLoad = gate()
  state.pageGate = pageLoad.promise
  state.summaryGate = summaryLoad.promise
  try {
    await page.getByRole('button', { name: 'Compliance failures', exact: true }).click()
    const calls = page.getByRole('region', { name: 'Calls results' })
    await expect(calls).toHaveAttribute('aria-busy', 'true')
    await expect(visibleRows(page)).toHaveCount(0)
    await expect(calls.getByRole('status')).toHaveText('Loading calls…')
    await expect(calls.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await expect(calls.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    await expect(page.getByText(/Showing 0/)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '65 calls in window' })).toHaveCount(0)
  } finally {
    pageLoad.release()
    summaryLoad.release()
  }
  await expect(visibleRows(page)).toHaveCount(1)

  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(url)
    const results = page.getByRole('region', { name: 'Calls results' })
    await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
    const next = results.getByRole('button', { name: 'Next', exact: true })
    const loadedResults = await results.boundingBox()
    const loadedNext = await next.boundingBox()
    expect(loadedResults).not.toBeNull()
    expect(loadedNext).not.toBeNull()

    const nextPage = gate()
    state.pageGate = nextPage.promise
    try {
      // DOM activation exercises the real button without hover/focus intent
      // warming the exact page that this pending-state regression needs.
      await next.evaluate((button: HTMLButtonElement) => button.click())
      await expect(results.getByRole('status')).toHaveText('Loading calls…')
      const pendingResults = await results.boundingBox()
      const pendingNext = await results.getByRole('button', { name: 'Next', exact: true }).boundingBox()
      expect(pendingResults?.height).toBeGreaterThanOrEqual((loadedResults?.height ?? 0) - 1)
      expect(pendingNext?.y).toBeGreaterThanOrEqual((loadedNext?.y ?? 0) - 1)
    } finally {
      nextPage.release()
    }
    await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  }
})

test('returning to a previous filter still resets to page one', async ({ page }) => {
  await fixture(page)
  await page.goto(url)
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  await page.getByRole('button', { name: 'Compliance failures', exact: true }).click()
  await expect(visibleRows(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'All calls', exact: true }).click()
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
})

test('Next intent prefetches exactly one same-query page and reuses it on navigation', async ({ page }) => {
  const { state, requests } = await fixture(page)
  await page.goto(url)
  await expect(visibleRows(page)).toHaveCount(25)
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await next.hover()
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').length).toBe(2)
  await next.focus()
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page').map(r => r.args.p_offset)).toEqual([0, 25])
  expect(requests.filter(r => /\/eavesly_(calls|transcription_qa)$/.test(r.pathname))).toHaveLength(0)

  await next.click()
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page').map(r => r.args.p_offset)).toEqual([0, 25])
})

test('failed Next prefetch is silent and does not poison later navigation', async ({ page }) => {
  const { state } = await fixture(page)
  state.failPageOffsets.add(25)
  await page.goto(url)
  await expect(visibleRows(page)).toHaveCount(25)
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await next.hover()
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').length).toBe(2)
  await expect(visibleRows(page)).toHaveCount(25)
  await expect(page.getByText('Something went wrong loading data. Try again in a moment.')).toHaveCount(0)

  state.failPageOffsets.delete(25)
  await next.click()
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page').map(r => r.args.p_offset)).toEqual([0, 25, 25])
})

test('saving threshold settings deliberately resets Calls to page one', async ({ page }) => {
  await fixture(page)
  await page.goto(`${url}&page=2`)
  await expect(page.getByText('Showing 26–50 of 65')).toBeVisible()
  await page.getByRole('button', { name: 'Thresholds', exact: true }).click()
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('page')).toBeNull()
})

test('summary and agent failures are recoverable without hiding loaded rows', async ({ page }) => {
  const { state } = await fixture(page)
  state.failSummary = true
  state.failAgents = true
  await page.goto(url)
  await expect(visibleRows(page)).toHaveCount(25)
  await expect(page.getByText("Couldn't load call summary")).toBeVisible()
  await expect(page.getByText("Couldn't load agent options")).toBeVisible()
  await expect(page.getByText(/Showing 1–25 · total pending/)).toBeVisible()
  state.failSummary = false
  state.failAgents = false
  await page.getByRole('button', { name: 'Try again' }).first().click()
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
})

test('malformed rows are an error, not an empty success', async ({ page }) => {
  const { state } = await fixture(page)
  state.malformedPage = true
  await page.goto(url)
  await expect(page.getByText("Couldn't load calls")).toBeVisible()
  await expect(page.getByText('No calls match your filters.')).toHaveCount(0)
  state.malformedPage = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(visibleRows(page)).toHaveCount(25)
})

test('whole filtered PDF fetch is on demand, paginates past 1000, and includes rows after 50', async ({ page }) => {
  const { state } = await fixture(page, 1002)
  await page.goto(url)
  await expect(visibleRows(page)).toHaveCount(25)
  expect(state.requests.filter(r => r.args.p_limit === 1000)).toHaveLength(0)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const download = await downloadPromise
  expect(await download.failure()).toBeNull()
  expect(state.requests.filter(r => r.args.p_limit === 1000).map(r => r.args.p_offset)).toEqual([0, 1000])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const pdf = Buffer.concat(chunks).toString('latin1')
  expect(pdf).toContain('Agent 0001')
  expect(pdf).toContain('Agent 1002')
})

test('failed export never downloads a partial PDF', async ({ page }) => {
  const { state } = await fixture(page, 1002)
  state.failExportOffset = 1000
  const downloads: string[] = []
  page.on('download', value => downloads.push(value.suggestedFilename()))
  await page.goto(url)
  await expect(visibleRows(page)).toHaveCount(25)
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByText("Couldn't export calls")).toBeVisible()
  expect(downloads).toEqual([])
})

test('an offset shift during export fails explicitly instead of duplicating rows in a PDF', async ({ page }) => {
  const { state } = await fixture(page, 1002)
  state.repeatExportPage = true
  const downloads: string[] = []
  page.on('download', value => downloads.push(value.suggestedFilename()))
  await page.goto(url)
  await expect(visibleRows(page)).toHaveCount(25)
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  await expect(page.getByText('Calls changed during export. Please try again.')).toBeVisible()
  expect(downloads).toEqual([])
})

test('Team pitch counts use one aggregate request, never pitch call pagination', async ({ page }) => {
  const { state, requests } = await fixture(page)
  await page.goto(`/dashboard/team?${period}`)
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_team_pitch_risk').length).toBe(1)
  expect(requests.filter(r => r.pathname.endsWith('/eavesly_calls') && r.searchParams.get('select')?.includes('campaign_name'))).toHaveLength(0)
})

test('agent/disposition URL filters and local quick thresholds reach both RPCs', async ({ page }) => {
  const { state } = await fixture(page)
  await page.addInitScript(() => localStorage.setItem('dashboardThresholds', JSON.stringify({ overallScore: 'good', compliance: 'fail', customerSat: 'medium' })))
  await page.goto(`${url}&agents=agent%40example.test&dispo=Cal.com%20Meeting&qf=threshold`)
  await expect(visibleRows(page)).toHaveCount(1)
  const expected = { p_agents: ['agent@example.test'], p_dispositions: ['Cal.com Meeting'], p_quick_filter: 'threshold',
    p_thresholds: { overallScore: 'good', compliance: 'fail', customerSat: 'medium' } }
  expect(state.requests.find(r => r.name === 'eavesly_calls_page')?.args).toMatchObject(expected)
  expect(state.requests.find(r => r.name === 'eavesly_calls_summary')?.args).toMatchObject(expected)
  await page.getByRole('button', { name: 'Remove Agent Team' }).click()
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args.p_agents).toEqual([])
  await page.getByRole('combobox').first().selectOption('')
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args.p_dispositions).toEqual([])
})

test('agent search supports keyboard multi-selection and keeps an unlisted selected agent removable', async ({ page }) => {
  const { state } = await fixture(page)
  await page.goto(`${url}&agents=legacy%40example.test%2Calpha%40example.test`)
  await expect.poll(() => state.requests.find(r => r.name === 'eavesly_calls_page')?.args.p_agents).toEqual([
    'legacy@example.test',
    'alpha@example.test',
  ])

  await page.getByRole('button', { name: /Agents/ }).click()
  const search = page.getByRole('searchbox', { name: 'Search agents' })
  await search.fill('Beta')
  const beta = page.getByRole('checkbox', { name: /Agent Beta/ })
  await beta.focus()
  await page.keyboard.press('Space')
  await expect(beta).toBeChecked()
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args.p_agents).toEqual([
    'legacy@example.test',
    'alpha@example.test',
    'beta@example.test',
  ])

  const agentTrigger = page.getByRole('button', { name: 'Agents 3 selected' })
  await agentTrigger.click()
  await expect(agentTrigger).toHaveAttribute('aria-expanded', 'false')
  const removeLegacy = page.getByRole('button', { name: 'Remove legacy@example.test' })
  await expect(removeLegacy).toBeVisible()
  await removeLegacy.press('Enter')
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args.p_agents).toEqual([
    'alpha@example.test',
    'beta@example.test',
  ])
})

test('empty data shows a genuine zero summary and disables Next', async ({ page }) => {
  await fixture(page, 0)
  await page.goto(url)
  await expect(page.getByText('No calls match your filters.')).toBeVisible()
  await expect(page.getByText('Showing 0–0 of 0')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await expect(page.getByText("Couldn't load calls")).toHaveCount(0)
})

test('Calls controls fit 320/375/414/768 widths with mobile filters and secondary actions reachable', async ({ page }) => {
  test.setTimeout(60_000)
  await fixture(page)
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(url)
    await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible()
    const dateRange = page.getByRole('button', { name: 'Date range', exact: false })
    await expect(dateRange).toBeVisible()
    expect(await dateRange.locator('span.font-medium').evaluate(element => {
      const text = document.createRange()
      text.selectNodeContents(element)
      return text.getClientRects().length
    }), `date label stays on one line at ${width}px`).toBe(1)
    const firstCard = await page.getByRole('region', { name: 'Calls results' }).locator('ul > li').first().boundingBox()
    expect(firstCard?.y, `first call is visible without scrolling at ${width}px`).toBeLessThan(650)
    const overflow = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 5)
        .map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })),
    }))
    expect(overflow.fits, `viewport ${width}px overflow: ${JSON.stringify(overflow)}`).toBe(true)

    await page.getByRole('button', { name: /^Filters/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Filters' })
    const agents = dialog.getByRole('button', { name: /Agents/ })
    await expect(agents).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Compliance failures' })).toBeVisible()
    if (width === 320) {
      await agents.click()
      await page.getByRole('searchbox', { name: 'Search agents' }).fill('Alpha')
      await page.getByRole('checkbox', { name: /Agent Alpha/ }).focus()
      await page.keyboard.press('Space')
      await page.keyboard.press('Escape')
      await dialog.getByRole('button', { name: 'Compliance failures' }).click()
      await expect(page).toHaveURL(/agents=alpha%40example\.test.*qf=compliance/)
    }
    await page.keyboard.press('Escape')
    if (width === 320) {
      await expect(page.getByRole('button', { name: 'Filters (2)' })).toBeVisible()
    }
    await page.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('button', { name: 'Thresholds', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeVisible()
  }
})

test('desktop/mobile Calls screenshots', async ({ page }, testInfo) => {
  await fixture(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(url)
  await expect(page.getByText('Showing 1–25 of 65')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('calls-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: /Agent 0065/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('calls-mobile.png'), animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
