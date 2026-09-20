import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

const MANAGER_A = 'manager-a@example.test'
const MANAGER_B = 'manager-b@example.test'
const AGENT_A = 'agent-a@example.test'

const dailyMetrics = [{
  agent_email: AGENT_A,
  agent_full_name: 'Agent Alpha',
  bucket_day: '2026-09-04',
  call_count: 7,
  talk_time_sum: 8_400,
  talk_time_n: 7,
  qa_count: 6,
  compliance_pass_count: 5,
  compliance_total_count: 6,
  escalation_count: 1,
  csat_high_count: 4,
  csat_medium_count: 1,
  csat_low_count: 1,
  total_alerts_count: 99,
  open_alerts: 99,
  unreviewed_alerts: 99,
  false_positive_count: 99,
}]

function reviewRows() {
  return [
    alertRow('a-pending-1', { assigned_manager_email: MANAGER_A, agent_email: 'agent-a@example.test' }),
    alertRow('a-pending-2', { assigned_manager_email: MANAGER_A, agent_email: 'agent-a@example.test' }),
    alertRow('a-real', { assigned_manager_email: MANAGER_A, agent_email: 'agent-a@example.test', is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: MANAGER_A }),
    alertRow('a-false', { assigned_manager_email: MANAGER_A, agent_email: 'agent-a@example.test', is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: 'reviewer-a@example.test' }),
    alertRow('a-system', { assigned_manager_email: MANAGER_A, agent_email: 'agent-a@example.test', is_reviewed: true, accurate: true, action_taken: 'no_action_needed', feedback_by: 'system@pennie' }),
    alertRow('b-real', { assigned_manager_email: MANAGER_B, agent_email: 'agent-b@example.test', is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: 'reviewer-b@example.test' }),
    alertRow('b-delivered-nonviolating', { assigned_manager_email: MANAGER_B, agent_email: 'agent-b@example.test', has_violation: false }),
    alertRow('partner-1', { assigned_manager_email: MANAGER_A, agent_email: 'partner-agent@example.test', module_name: 'achieve_welcome_call_qa', violation_type: 'achieve_welcome_call' }),
    alertRow('partner-2', { assigned_manager_email: MANAGER_A, agent_email: 'partner-agent@example.test', module_name: 'achieve_welcome_call_qa', violation_type: 'achieve_welcome_call' }),
    alertRow('disposition', { assigned_manager_email: MANAGER_A, agent_email: 'agent-a@example.test', module_name: 'disposition_review' }),
    alertRow('unsent', { assigned_manager_email: MANAGER_A, agent_email: 'agent-a@example.test', alert_sent: false }),
  ]
}

test('god-mode internal manager counts reconcile and filter the same inbox', async ({ page }) => {
  const state = await reviewFixture(page, reviewRows(), {
    god: true,
    managerNames: { [MANAGER_A]: 'Manager Alpha', [MANAGER_B]: 'Manager Beta' },
  })
  await page.goto('/dashboard/alerts')
  await expect(page.getByText('3 awaiting Kris’s approval', { exact: true })).toBeVisible()
  await page.getByText('Team workload', { exact: true }).click()
  await expect(page.getByText('7 received in period', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Received 5' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Manager reviewed 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Warranted 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Unnecessary 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Awaiting manager 2' })).toBeVisible()

  await page.getByRole('button', { name: 'Filter Manager Alpha Received 5' }).click()
  await expect(page.locator('[aria-live="polite"]', { hasText: '5 received in period' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(5)
  await page.getByText('Team workload', { exact: true }).click()
  await page.getByRole('button', { name: 'Filter Manager Alpha Manager reviewed 2' }).click()
  await expect(page.getByText('2 manager reviewed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(2)
  await expect(page.getByText('Decision by manager-a@example.test')).toBeVisible()
  await expect(page.getByText('Decision by reviewer-a@example.test')).toBeVisible()
  await page.getByText('Team workload', { exact: true }).click()
  await page.getByRole('button', { name: 'Filter Manager Alpha Unnecessary 1' }).click()
  await expect(page.getByText('1 manager reviewed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(1)

  const listRequests = state.requests.filter(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(listRequests.some(url => url.searchParams.getAll('module_name').includes('neq.disposition_review'))).toBe(true)
  expect(listRequests.some(url => url.searchParams.getAll('module_name').includes('neq.achieve_welcome_call_qa'))).toBe(true)
  expect(listRequests.some(url => url.searchParams.get('alert_sent') === 'eq.true')).toBe(true)
})

test('partner QA is a separate god-mode destination and never appears for a manager', async ({ page }) => {
  const state = await reviewFixture(page, reviewRows(), { god: true })
  await page.goto('/dashboard/alerts')
  await page.getByText('More filters', { exact: true }).click()
  await page.getByRole('button', { name: 'Partner QA', exact: true }).click()
  await expect(page.getByText('Partner QA · Admin only')).toBeVisible()
  await expect(page.getByText('2 awaiting manager review', { exact: true })).toBeVisible()
  const partnerRow = page.getByRole('button', { name: 'Review Achieve welcome call alert for Example partner-1' })
  await expect(partnerRow).toBeVisible()
  await partnerRow.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => state.requests.some(url => url.pathname.endsWith('/eavesly_alert_messages'))).toBe(true)
  await page.getByRole('radio', { name: 'Unnecessary (N)' }).click()
  await page.getByRole('radio', { name: '3. Wrong context' }).click()
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  expect(state.writes.some(write => write && typeof write === 'object' && 'call_id' in write && write.call_id === 'partner-1')).toBe(true)

  const managerPage = await page.context().newPage()
  const managerState = await reviewFixture(managerPage, reviewRows(), { managedAgents: [AGENT_A] })
  await managerPage.goto('/dashboard/alerts?workload=partner_qa&status=all')
  await expect(managerPage.getByRole('button', { name: 'Partner QA', exact: true })).toHaveCount(0)
  await expect(managerPage.getByText('Example partner-1')).toHaveCount(0)
  await expect(managerPage.locator('[aria-live="polite"]', { hasText: '5 received in period' })).toBeVisible()
  await expect(managerPage.getByText('Example b-real')).toHaveCount(0)
  expect(new URL(managerPage.url()).searchParams.has('workload')).toBe(false)
  const managerListRequest = managerState.requests.find(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(managerListRequest?.searchParams.get('agent_email')).toContain(AGENT_A)
})

test('fresh Google sign-in requests a return directly to Review', async ({ page }) => {
  await page.routeWebSocket(/.*/, socket => socket.close())
  await page.route(url => url.protocol === 'https:', route => {
    if (new URL(route.request().url()).pathname === '/auth/v1/authorize') {
      return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic authorization endpoint</p>' })
    }
    return route.abort()
  })
  await page.goto('/login')
  const origin = new URL(page.url()).origin
  const authorizeRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/auth/v1/authorize')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  const authorizeUrl = new URL((await authorizeRequest).url())
  expect(authorizeUrl.searchParams.get('provider')).toBe('google')
  expect(authorizeUrl.searchParams.get('redirect_to')).toBe(`${origin}/dashboard/alerts`)
})

test('god-mode reviewer summary credits latest decisions to feedback authors and filters matching cohort rows', async ({ page }, testInfo) => {
  const reviewerOne = 'reviewer-one@example.test'
  const reviewerTwo = 'reviewer-two@example.test'
  await reviewFixture(page, [
    alertRow('reviewer-one-real', { assigned_manager_email: MANAGER_A, is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: reviewerOne }),
    alertRow('reviewer-one-false', { assigned_manager_email: MANAGER_B, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: reviewerOne }),
    alertRow('reviewer-two-false-a', { assigned_manager_email: MANAGER_A, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: reviewerTwo }),
    alertRow('reviewer-two-false-b', { assigned_manager_email: MANAGER_A, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: reviewerTwo }),
    alertRow('reviewer-system', { assigned_manager_email: MANAGER_A, is_reviewed: true, accurate: true, action_taken: 'no_action_needed', feedback_by: 'system@pennie' }),
    alertRow('reviewer-pending', { assigned_manager_email: MANAGER_A }),
  ], { god: true, managerNames: { [MANAGER_A]: 'Manager Alpha', [MANAGER_B]: 'Manager Beta' } })
  await page.goto('/dashboard/alerts?start=2026-08-09&end=2026-09-07&status=all')
  await page.getByText('Team workload', { exact: true }).click()

  await expect(page.getByText('By actual reviewer', { exact: true })).toBeVisible()
  await expect(page.getByText(/Latest recorded decisions for alerts received 2026-08-09 – 2026-09-07 \(ET\)\./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter reviewer-one Reviewed 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter reviewer-one Warranted 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter reviewer-one Unnecessary 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter reviewer-one Unnecessary share 50%' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter reviewer-two Reviewed 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter reviewer-two Unnecessary share 100%' })).toBeVisible()
  await expect(page.getByText('system@pennie', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('actual-reviewer-summary.png'), fullPage: true, animations: 'disabled' })

  await page.getByRole('button', { name: 'Filter reviewer-one Reviewed 2' }).click()
  await expect(page.locator('[aria-live="polite"]', { hasText: '2 manager reviewed' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Example reviewer-one-/ })).toHaveCount(2)
  await expect(page.getByRole('button', { name: /Example reviewer-two-/ })).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('reviewer')).toBe(reviewerOne)
  await page.getByText('Team workload', { exact: true }).click()
  await page.getByRole('button', { name: 'Filter reviewer-one Unnecessary share 50%' }).click()
  await expect(page.locator('[aria-live="polite"]', { hasText: '1 manager reviewed' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Example reviewer-one-false/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Example reviewer-one-real/ })).toHaveCount(0)

  const managerPage = await page.context().newPage()
  await reviewFixture(managerPage, [alertRow('manager-review', { is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: reviewerOne })])
  await managerPage.goto('/dashboard/alerts?status=all')
  await managerPage.getByText('Team workload', { exact: true }).click()
  await expect(managerPage.getByText('By actual reviewer', { exact: true })).toHaveCount(0)
})

test('manager drilldown normalizes the same owner as its summary count', async ({ page }) => {
  await reviewFixture(page, [alertRow('padded-owner', { assigned_manager_email: `  ${MANAGER_A.toUpperCase()}  ` })], {
    god: true,
    managerNames: { [MANAGER_A]: 'Manager Alpha' },
  })
  await page.goto('/dashboard/alerts')
  await page.getByText('Team workload', { exact: true }).click()
  await page.getByRole('button', { name: 'Filter Manager Alpha Received 1' }).click()
  await expect(page.locator('[aria-live="polite"]', { hasText: '1 received in period' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review Manager escalation alert for Example padded-owner' })).toBeVisible()
})

test('manager opening an admin approval link lands on their pending review queue', async ({ page }) => {
  await reviewFixture(page, [alertRow('pending')])
  await page.goto('/dashboard/alerts?status=awaiting_approval')
  await expect(page.getByText('1 ready for first review', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review Manager escalation alert for Example pending' })).toBeVisible()
})

test('login, logo, primary navigation, drawer, and history retain explicit ET dates', async ({ page }) => {
  const unexpectedDialogs: string[] = []
  page.on('dialog', dialog => { unexpectedDialogs.push(dialog.message()); return dialog.dismiss() })
  await reviewFixture(page, [alertRow('dated')])
  await page.goto('/login')
  await expect(page).toHaveURL(/\/dashboard\/alerts\?start=2026-08-09&end=2026-09-07/)
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example dated' }).click()
  expect(new URL(page.url()).searchParams.get('start')).toBe('2026-08-09')
  expect(new URL(page.url()).searchParams.get('end')).toBe('2026-09-07')
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(unexpectedDialogs).toEqual([])
  await page.getByRole('link', { name: 'Calls', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard\?start=2026-08-09&end=2026-09-07/)
  await page.getByRole('link', { name: 'Eavesly', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard\/alerts\?start=2026-08-09&end=2026-09-07/)
  await page.goBack()
  await expect(page).toHaveURL(/\/dashboard\?start=2026-08-09&end=2026-09-07/)
})

test('received heatmap cell opens every matching review state in its date, module, and agent scope', async ({ page }) => {
  const rows = [
    alertRow('heat-pending', { agent_email: AGENT_A }),
    alertRow('heat-real', { agent_email: AGENT_A, is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: MANAGER_A }),
    alertRow('heat-false', { agent_email: AGENT_A, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: MANAGER_A }),
    alertRow('heat-system', { agent_email: AGENT_A, is_reviewed: true, accurate: true, action_taken: 'no_action_needed', feedback_by: 'system@pennie' }),
    alertRow('heat-correction', { agent_email: AGENT_A, is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: MANAGER_A, current_decision: 'changes_requested' }),
    alertRow('outside-date', { agent_email: AGENT_A, alert_created_at: '2026-08-01T16:00:00Z' }),
    alertRow('outside-module', { agent_email: AGENT_A, module_name: 'budget_inputs', violation_type: 'budget_compliance' }),
    alertRow('outside-agent', { agent_email: 'agent-b@example.test' }),
    alertRow('similar-agent', { agent_email: 'aagent-a@example.test' }),
  ]
  const state = await reviewFixture(page, rows, { managedAgents: [AGENT_A, 'aagent-a@example.test'], dailyMetrics })
  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07')

  await page.getByText('Alert types and AI coaching themes', { exact: true }).click()
  const heatmap = page.locator('section').filter({ has: page.getByText('Alert breakdown', { exact: true }) })
  await heatmap.getByRole('button', { name: '5' }).click()

  const url = new URL(page.url())
  expect(url.pathname).toBe('/dashboard/alerts')
  expect(url.searchParams.get('start')).toBe('2026-08-09')
  expect(url.searchParams.get('end')).toBe('2026-09-07')
  expect(url.searchParams.get('module')).toBe('full_qa')
  expect(url.searchParams.get('agent')).toBe(AGENT_A)
  expect(url.searchParams.has('search')).toBe(false)
  expect(url.searchParams.get('status')).toBe('all')
  await expect(page.locator('[aria-live="polite"]', { hasText: '5 received in period' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example heat-/ })).toHaveCount(5)
  await expect(page.getByText('Example outside-date')).toHaveCount(0)
  await expect(page.getByText('Example outside-module')).toHaveCount(0)
  await expect(page.getByText('Example outside-agent')).toHaveCount(0)
  await expect(page.getByText('Example similar-agent')).toHaveCount(0)
  const exactAgentRequest = state.requests.find(url => url.searchParams.get('select')?.includes('feedback_comment') && url.searchParams.getAll('agent_email').includes(`eq.${AGENT_A}`))
  expect(exactAgentRequest?.searchParams.getAll('agent_email')).toContain(`eq.${AGENT_A}`)

  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07')
  await page.getByText('Alert types and AI coaching themes', { exact: true }).click()
  const moduleHeatmap = page.locator('section').filter({ has: page.getByText('Alert breakdown', { exact: true }) })
  await moduleHeatmap.getByRole('button', { name: 'Full QA', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('status')).toBe('all')
  expect(new URL(page.url()).searchParams.get('module')).toBe('full_qa')
  await expect(page.locator('[aria-live="polite"]', { hasText: '6 received in period' })).toBeVisible()

  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07')
  await page.getByText('Alert types and AI coaching themes', { exact: true }).click()
  const agentHeatmap = page.locator('section').filter({ has: page.getByText('Alert breakdown', { exact: true }) })
  await agentHeatmap.getByTitle('Agent Alpha').click()
  expect(new URL(page.url()).searchParams.get('status')).toBe('all')
  expect(new URL(page.url()).searchParams.get('agent')).toBe(AGENT_A)
  expect(new URL(page.url()).searchParams.has('search')).toBe(false)
  expect(new URL(page.url()).searchParams.has('module')).toBe(false)
  await expect(page.locator('[aria-live="polite"]', { hasText: '6 received in period' })).toBeVisible()
})

test('Review heatmap summarizes received rows rather than only the active pending queue', async ({ page }) => {
  await reviewFixture(page, [
    alertRow('review-heat-pending', { agent_email: AGENT_A }),
    alertRow('review-heat-real', { agent_email: AGENT_A, is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: MANAGER_A }),
    alertRow('review-heat-false', { agent_email: AGENT_A, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: MANAGER_A }),
    alertRow('review-heat-system', { agent_email: AGENT_A, is_reviewed: true, accurate: true, action_taken: 'no_action_needed', feedback_by: 'system@pennie' }),
  ], { managedAgents: [AGENT_A] })
  await page.goto('/dashboard/alerts?start=2026-08-09&end=2026-09-07')
  await expect(page.getByText('1 ready for first review', { exact: true })).toBeVisible()
  await page.getByText('Team workload', { exact: true }).click()

  const heatmap = page.locator('section').filter({ has: page.getByText('By alert type × agent', { exact: true }) })
  await heatmap.getByRole('button', { name: '4' }).click()
  await expect(page.locator('[aria-live="polite"]', { hasText: '4 received in period' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example review-heat-/ })).toHaveCount(4)
})

test('Team and agent drilldown use the same internal sent-row counts', async ({ page }) => {
  const state = await reviewFixture(page, reviewRows(), { managedAgents: [AGENT_A], dailyMetrics })
  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07')
  await page.getByRole('button', { name: 'More metrics', exact: true }).click()
  await expect(page.getByText('AI-evaluated calls', { exact: true })).toBeVisible()
  await expect(page.getByText('Received alerts', { exact: true })).toBeVisible()
  await expect(page.getByText('Warranted alerts', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pitch calls under 30 min' })).toBeVisible()
  const agentCell = page.getByRole('cell', { name: /Agent Alpha.*agent-a@example\.test/ })
  await expect(agentCell).toBeVisible()
  await expect(agentCell.locator('..').getByText('2 waiting', { exact: true })).toBeVisible()
  const breakdownRequest = state.requests.find(url => url.searchParams.get('select')?.includes('feedback_by') && url.searchParams.get('select')?.includes('has_violation'))
  expect(breakdownRequest?.searchParams.get('alert_sent')).toBe('eq.true')
  expect(breakdownRequest?.searchParams.getAll('module_name')).toContain('neq.achieve_welcome_call_qa')
  await agentCell.click()
  await expect(page.getByRole('heading', { name: 'Agent Alpha' })).toBeVisible()
  await expect(page.getByText('2 awaiting manager · 5 received')).toBeVisible()
  await expect(page.getByText('Received alerts', { exact: true }).locator('..')).toContainText('5')
  await expect(page.getByText('Warranted alerts', { exact: true }).locator('..')).toContainText('1')
})

test('Team does not render fabricated zero workload after an alert read failure', async ({ page }) => {
  const state = await reviewFixture(page, reviewRows(), { managedAgents: [AGENT_A], dailyMetrics })
  state.failBreakdown = true
  await page.goto('/dashboard/team')
  await expect(page.getByText("Couldn't load team metrics")).toBeVisible()
  await expect(page.getByText('no partial zero counts', { exact: false })).toBeVisible()
  await expect(page.getByText('99', { exact: true })).toHaveCount(0)
})

test('Review workspace desktop and mobile screenshots use synthetic workload', async ({ page }, testInfo) => {
  await reviewFixture(page, reviewRows(), {
    god: true,
    managerNames: { [MANAGER_A]: 'Manager Alpha', [MANAGER_B]: 'Manager Beta' },
  })
  await page.goto('/dashboard/alerts?status=all')
  await expect(page.locator('[aria-live="polite"]', { hasText: '7 received in period' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('review-workspace-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[aria-live="polite"]', { hasText: '7 received in period' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('review-workspace-mobile.png'), fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('direct outstanding links select the all-time lens while selected-period and partner queues do not mislabel it', async ({ page }) => {
  await reviewFixture(page, [alertRow('direct-old', { alert_created_at: '2026-01-04T16:00:00Z' })], { god: true })
  await page.goto('/dashboard/alerts?start=2026-08-09&end=2026-09-07')
  await expect(page.getByRole('combobox', { name: 'Queue' }).getByRole('option', { name: 'All outstanding' })).toHaveCount(0)

  await page.goto('/dashboard/alerts?status=outstanding')
  await expect(page.locator('[aria-live="polite"]', { hasText: '1 outstanding across all time' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('range')).toBe('outstanding')
  await expect(page.getByRole('button', { name: /Example direct-old/ })).toBeVisible()

  await page.goto('/dashboard/alerts?workload=partner_qa&status=outstanding')
  await expect(page.getByText('Partner QA · Admin only')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Queue' })).toHaveValue('awaiting_manager')
  expect(new URL(page.url()).searchParams.has('range')).toBe(false)
})

test('all-time outstanding loads every actionable state without date clipping or Team rollup reads', async ({ page }, testInfo) => {
  const old = '2026-01-04T16:00:00Z'
  const state = await reviewFixture(page, [
    alertRow('old-first-review', { alert_created_at: old }),
    alertRow('old-approval', { alert_created_at: old, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: MANAGER_A }),
    alertRow('old-correction', { alert_created_at: old, is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: MANAGER_A, current_decision: 'changes_requested' }),
    alertRow('old-coaching', { alert_created_at: old, is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: MANAGER_A, current_decision: 'approved' }),
    alertRow('old-complete', { alert_created_at: old, is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: MANAGER_A, current_decision: 'approved' }),
    alertRow('old-system', { alert_created_at: old, is_reviewed: true, accurate: true, action_taken: 'no_action_needed', feedback_by: 'system@pennie' }),
  ], { god: true })
  await page.goto('/dashboard/alerts?start=2026-08-09&end=2026-09-07')
  await expect(page.getByText('0 awaiting Kris’s approval', { exact: true })).toBeVisible()
  await expect.poll(() => state.requests.some(url => url.pathname.endsWith('/team_daily_metrics'))).toBe(true)
  state.requests.length = 0

  await page.getByText('More filters', { exact: true }).click()
  await page.getByRole('button', { name: 'Outstanding' }).click()

  await expect(page.locator('[aria-live="polite"]', { hasText: '4 outstanding across all time' })).toBeVisible()
  await page.getByText('Outstanding by next action', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filter all-time First reviews 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter all-time Awaiting Kris’s approval 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter all-time Changes requested by Kris 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter all-time Coaching due 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example old-/ })).toHaveCount(4)
  await expect(page.getByRole('button', { name: /Example old-first-review/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Example old-approval/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Example old-correction/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Example old-coaching/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Example old-complete/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Example old-system/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('all-time-outstanding.png'), fullPage: true, animations: 'disabled' })
  const listRequest = state.requests.find(url => url.searchParams.get('select')?.includes('feedback_comment') && url.searchParams.has('or'))
  expect(listRequest?.searchParams.has('alert_created_at')).toBe(false)
  expect(state.requests.some(url => url.pathname.endsWith('/team_daily_metrics'))).toBe(false)

  const managerPage = await page.context().newPage()
  const managerState = await reviewFixture(managerPage, state.rows)
  await managerPage.goto('/dashboard/alerts?range=outstanding&status=outstanding')
  await expect(managerPage.locator('[aria-live="polite"]', { hasText: '3 outstanding across all time' })).toBeVisible()
  await expect(managerPage.getByRole('button', { name: /Example old-approval/ })).toHaveCount(0)
  await expect(managerPage.getByRole('button', { name: /Example old-first-review/ })).toBeVisible()
  await expect(managerPage.getByRole('button', { name: /Example old-correction/ })).toBeVisible()
  await expect(managerPage.getByRole('button', { name: /Example old-coaching/ })).toBeVisible()
  const managerListRequest = managerState.requests.find(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(managerListRequest?.searchParams.get('or')).not.toContain('current_decision.is.null')
})

test('all-time outstanding paginates beyond the server row cap without sampling', async ({ page }) => {
  const rows = Array.from({ length: 1005 }, (_, index) => alertRow(`old-backlog-${String(index).padStart(4, '0')}`, {
    alert_created_at: '2026-01-04T16:00:00Z',
  }))
  const state = await reviewFixture(page, rows)
  await page.goto('/dashboard/alerts?range=outstanding&status=outstanding')

  await expect(page.locator('[aria-live="polite"]', { hasText: '1,005 outstanding across all time' })).toBeVisible()
  await expect(page.getByText('Showing 1–50 of 1,005 alerts', { exact: true })).toBeVisible()
  const listRequests = state.requests.filter(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(listRequests.map(url => url.searchParams.get('offset'))).toEqual(['0', '1000'])
  expect(listRequests.every(url => url.searchParams.has('or') && !url.searchParams.has('alert_created_at'))).toBe(true)
})

test('system closures are separate from human review and false-alarm arithmetic', async ({ page }) => {
  await reviewFixture(page, reviewRows(), {
    god: true,
    managerNames: { [MANAGER_A]: 'Manager Alpha', [MANAGER_B]: 'Manager Beta' },
  })
  await page.goto('/dashboard/alerts?status=all')
  await expect(page.locator('[aria-live="polite"]', { hasText: '7 received in period' })).toBeVisible()
  const deliveredRow = page.getByRole('button', { name: 'Review Manager escalation alert for Example b-delivered-nonviolating' })
  await expect(deliveredRow).toBeVisible()
  await page.getByText('Team workload', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Manager reviewed 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Warranted 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Unnecessary 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Beta Manager reviewed 1' })).toBeVisible()
  const managerAlphaRow = page.getByRole('row', { name: /Manager Alpha/ })
  await expect(managerAlphaRow.locator('td').last()).toHaveText('1')
  const systemRow = page.getByRole('button', { name: 'Review Manager escalation alert for Example a-system' })
  await expect(systemRow).toContainText('System closed')
  await systemRow.click()
  await expect(page.getByRole('button', { name: /Approve .* review/ })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'Warranted (Y)' })).toHaveCount(0)
})
