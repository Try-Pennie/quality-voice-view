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
    failSummary: false, failPage: false, malformedPage: false, failAgents: false, failExportOffset: -1, repeatExportPage: false,
  }
  await page.route('**/rest/v1/rpc/eavesly_*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    const args: Record<string, unknown> = route.request().postDataJSON()
    state.requests.push({ name, args })
    const respond = (value: unknown, status = 200) => route.fulfill({ json: value, status })
    if (name === 'eavesly_active_call_agents') return state.failAgents
      ? respond({ message: 'Synthetic agent error' }, 500)
      : respond([{ agent_email: 'agent@example.test', agent_full_name: 'Agent Team' }])
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
      if (state.failPage || (limit === 1000 && offset === state.failExportOffset)) return respond({ message: 'Synthetic page error' }, 500)
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
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page')).toHaveLength(2)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(visibleRows(page).first()).toContainText('Agent 0001')
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
  expect(state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args).toMatchObject({ p_offset: 0, p_quick_filter: 'rushed', p_sort: 'agent' })
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
  await page.getByRole('combobox').first().selectOption('')
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args.p_agents).toEqual([])
  await page.getByRole('combobox').nth(1).selectOption('')
  await expect.poll(() => state.requests.filter(r => r.name === 'eavesly_calls_page').at(-1)?.args.p_dispositions).toEqual([])
})

test('empty data shows a genuine zero summary and disables Next', async ({ page }) => {
  await fixture(page, 0)
  await page.goto(url)
  await expect(page.getByText('No calls match your filters.')).toBeVisible()
  await expect(page.getByText('Showing 0–0 of 0')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await expect(page.getByText("Couldn't load calls")).toHaveCount(0)
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
