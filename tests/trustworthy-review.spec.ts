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
  await expect(page.getByRole('heading', { name: '3 awaiting your approval' })).toBeVisible()
  await expect(page.getByText('Received').locator('..').getByText('7', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Received 5' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Reviewed 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Real 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha False alarm 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Awaiting manager 2' })).toBeVisible()

  await page.getByRole('button', { name: 'Filter Manager Alpha Received 5' }).click()
  await expect(page.getByRole('heading', { name: '5 received in window' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(5)
  await page.getByRole('button', { name: 'Filter Manager Alpha Reviewed 2' }).click()
  await expect(page.getByRole('heading', { name: '2 reviewed' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(2)
  await expect(page.getByText('Decision by manager-a@example.test')).toBeVisible()
  await expect(page.getByText('Decision by reviewer-a@example.test')).toBeVisible()
  await page.getByRole('button', { name: 'Filter Manager Alpha False alarm 1' }).click()
  await expect(page.getByRole('heading', { name: '1 reviewed' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(1)

  const listRequests = state.requests.filter(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(listRequests.some(url => url.searchParams.getAll('module_name').includes('neq.disposition_review'))).toBe(true)
  expect(listRequests.some(url => url.searchParams.getAll('module_name').includes('neq.achieve_welcome_call_qa'))).toBe(true)
  expect(listRequests.some(url => url.searchParams.get('alert_sent') === 'eq.true')).toBe(true)
})

test('partner QA is a separate god-mode destination and never appears for a manager', async ({ page }) => {
  const state = await reviewFixture(page, reviewRows(), { god: true })
  await page.goto('/dashboard/alerts')
  await page.getByRole('button', { name: 'Partner QA', exact: true }).click()
  await expect(page.getByText('Partner QA · Admin only')).toBeVisible()
  await expect(page.getByRole('heading', { name: '2 awaiting manager' })).toBeVisible()
  await expect(page.getByText('Example partner-1')).toBeVisible()
  await page.getByRole('button', { name: 'Review Achieve welcome call alert for Example partner-1' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => state.requests.some(url => url.pathname.endsWith('/eavesly_alert_messages'))).toBe(true)
  await page.getByRole('button', { name: 'False alarm (N)' }).click()
  await page.getByRole('button', { name: '3. Wrong context' }).click()
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  expect(state.writes.some(write => write && typeof write === 'object' && 'call_id' in write && write.call_id === 'partner-1')).toBe(true)

  const managerPage = await page.context().newPage()
  const managerState = await reviewFixture(managerPage, reviewRows(), { managedAgents: [AGENT_A] })
  await managerPage.goto('/dashboard/alerts?workload=partner_qa&status=all')
  await expect(managerPage.getByRole('button', { name: 'Partner QA', exact: true })).toHaveCount(0)
  await expect(managerPage.getByText('Example partner-1')).toHaveCount(0)
  await expect(managerPage.getByRole('heading', { name: '5 received in window' })).toBeVisible()
  await expect(managerPage.getByText('Example b-real')).toHaveCount(0)
  expect(new URL(managerPage.url()).searchParams.has('workload')).toBe(false)
  const managerListRequest = managerState.requests.find(url => url.searchParams.get('select')?.includes('feedback_comment'))
  expect(managerListRequest?.searchParams.get('agent_email')).toContain(AGENT_A)
})

test('login, logo, primary navigation, drawer, and history retain explicit ET dates', async ({ page }) => {
  await reviewFixture(page, [alertRow('dated')])
  await page.goto('/login')
  await expect(page).toHaveURL(/\/dashboard\/alerts\?start=2026-08-09&end=2026-09-07/)
  await page.getByRole('button', { name: 'Review Manager escalation alert for Example dated' }).click()
  expect(new URL(page.url()).searchParams.get('start')).toBe('2026-08-09')
  expect(new URL(page.url()).searchParams.get('end')).toBe('2026-09-07')
  await page.goBack()
  await page.getByRole('link', { name: 'Calls', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard\?start=2026-08-09&end=2026-09-07/)
  await page.getByRole('link', { name: 'Eavesly', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard\/alerts\?start=2026-08-09&end=2026-09-07/)
  await page.goBack()
  await expect(page).toHaveURL(/\/dashboard\?start=2026-08-09&end=2026-09-07/)
})

test('Team and agent drilldown use the same internal sent-row counts', async ({ page }) => {
  const state = await reviewFixture(page, reviewRows(), { managedAgents: [AGENT_A], dailyMetrics })
  await page.goto('/dashboard/team?start=2026-08-09&end=2026-09-07')
  await expect(page.getByText('AI-evaluated calls', { exact: true })).toBeVisible()
  await expect(page.getByText('Received alerts', { exact: true })).toBeVisible()
  await expect(page.getByText('Manager-confirmed issues', { exact: true })).toBeVisible()
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
  await expect(page.getByText('Manager-confirmed issues', { exact: true }).locator('..')).toContainText('1')
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
  await expect(page.getByRole('heading', { name: '7 received in window' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('review-workspace-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '7 received in window' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('review-workspace-mobile.png'), fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('system closures are separate from human review and false-alarm arithmetic', async ({ page }) => {
  await reviewFixture(page, reviewRows(), { god: true })
  await page.goto('/dashboard/alerts?status=all')
  await expect(page.getByRole('heading', { name: '7 received in window' })).toBeVisible()
  await expect(page.getByText('Example b-delivered-nonviolating')).toBeVisible()
  await expect(page.getByText('3 system closed separately')).toHaveCount(0)
  await expect(page.getByText('1 system closed separately')).toBeVisible()
  await expect(page.getByText('3 real · 1 false alarm')).toHaveCount(0)
  await expect(page.getByText('2 real · 1 false alarm')).toBeVisible()
  const systemRow = page.getByRole('button', { name: 'Review Manager escalation alert for Example a-system' })
  await expect(systemRow).toContainText('System closed')
  await systemRow.click()
  await expect(page.getByRole('button', { name: /Approve .* review/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Real issue (Y)' })).toHaveCount(0)
})
