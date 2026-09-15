import { test, expect } from '@playwright/test'
import { alertRow, openAlert, reviewFixture } from './review-fixture'

test('initial queue loading is named without implying an error', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('loading')])
  let releaseQueue = () => {}
  state.queueGate = new Promise<void>(resolve => { releaseQueue = resolve })

  await page.goto('/dashboard/alerts')
  await expect(page.getByText('Loading queue…', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Queue unavailable', { exact: true })).toHaveCount(0)
  await page.getByText('Team workload', { exact: true }).click()
  await expect(page.getByRole('button', { name: /^Filter my team/ })).toHaveCount(0)
  releaseQueue()
  await expect(page.getByRole('button', { name: /Review .* Example loading/ })).toBeVisible()
})

test('default Review opens with the role queue and first actionable row, not a dashboard wall', async ({ page }) => {
  await reviewFixture(page, [
    alertRow('approved', {
      is_reviewed: true,
      accurate: true,
      action_taken: 'coached',
      feedback_by: 'manager@example.test',
      current_decision: 'approved',
    }),
    alertRow('next-review'),
  ])

  await page.goto('/dashboard/alerts')

  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Date range: Aug 9 – Sep 7, 2026/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Queue' })).toHaveValue('awaiting_manager')
  await expect(page.getByRole('button', { name: 'Review next' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review Manager escalation alert for Example next-review' })).toBeVisible()
  await expect(page.getByText('Current team workload')).toHaveCount(0)

  await page.getByRole('button', { name: 'Review next' }).click()
  await expect(page.getByRole('dialog')).toContainText('Example next-review')
})

test('manager workload and alert breakdown remain available on demand', async ({ page }) => {
  await reviewFixture(page, [
    alertRow('manager-pending'),
    alertRow('manager-reviewed', {
      is_reviewed: true,
      accurate: true,
      action_taken: 'coached',
      feedback_by: 'manager@example.test',
    }),
  ])
  await page.goto('/dashboard/alerts')

  await expect(page.getByText('Team workload', { exact: true })).toBeVisible()
  await expect(page.getByText('By alert type × agent', { exact: true })).not.toBeVisible()
  await page.getByText('Team workload', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filter my team Received 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter my team Manager reviewed 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter my team Awaiting manager 1' })).toBeVisible()
  await expect(page.getByText('By current manager', { exact: true })).toHaveCount(0)
  await expect(page.getByText('By alert type × agent', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Filter my team Manager reviewed 1' }).click()
  await expect(page.getByRole('combobox', { name: 'Queue' })).toHaveValue('reviewed')
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(1)
})

test('my-team counts clear unrelated queue filters and account for system closures', async ({ page }) => {
  await reviewFixture(page, [
    alertRow('pending'),
    alertRow('real', { is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: 'manager@example.test' }),
    alertRow('system', { is_reviewed: true, accurate: true, action_taken: 'no_action_needed', feedback_by: 'system@pennie' }),
  ])
  await page.goto('/dashboard/alerts?start=2026-08-09&end=2026-09-07&module=full_qa&search=missing&manager=old-owner%40example.test')
  await page.getByText('Team workload', { exact: true }).click()
  await page.getByRole('button', { name: 'Filter my team Received 3' }).click()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(3)
  const params = new URL(page.url()).searchParams
  expect(params.has('search')).toBe(false)
  expect(params.has('manager')).toBe(false)
  expect(params.get('module')).toBe('full_qa')
  expect(params.get('start')).toBe('2026-08-09')
  expect(params.get('end')).toBe('2026-09-07')
  await page.getByText('Team workload', { exact: true }).click()
  await expect(page.getByRole('region', { name: 'My team workload counts' })).toContainText('1 system closed')
})

test('an unchanged legacy self-review can be approved without inventing new review details', async ({ page }) => {
  const email = 'director@example.test'
  const state = await reviewFixture(page, [alertRow('legacy-own', { module_name: 'budget_inputs',
    is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: email,
    feedback_comment: 'Legacy combined note describing the finding and coaching action.',
  })], { god: true, email })
  await page.goto('/dashboard/alerts')
  await openAlert(page, 'legacy-own')
  await expect(page.getByRole('button', { name: 'Update review' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Approve review' })).toBeEnabled()
  await page.getByRole('button', { name: 'Approve review' }).click()
  await expect(page.getByText('Review approved')).toBeVisible()
  expect(state.rows[0].current_decision).toBe('approved')
  expect(state.rows[0].review_revision).toBe(1)
  expect(state.writes).toHaveLength(1)
})

test('director workload stays on demand and its named counts filter the queue', async ({ page }, testInfo) => {
  const manager = 'manager-a@example.test'
  await reviewFixture(page, [
    alertRow('pending', { assigned_manager_email: manager }),
    alertRow('real', { assigned_manager_email: manager, is_reviewed: true, accurate: true, action_taken: 'coached', feedback_by: manager }),
    alertRow('false', { assigned_manager_email: manager, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: manager }),
    alertRow('coaching', { assigned_manager_email: manager, is_reviewed: true, accurate: true, action_taken: 'follow_up_later', feedback_by: manager }),
    alertRow('correction', { assigned_manager_email: manager, is_reviewed: true, accurate: false, inaccuracy_reason: 'wrong_context', feedback_by: manager, current_decision: 'changes_requested' }),
    alertRow('system', { assigned_manager_email: manager, is_reviewed: true, accurate: true, action_taken: 'no_action_needed', feedback_by: 'system@pennie' }),
  ], { god: true, managerNames: { [manager]: 'Manager Alpha' } })

  await page.goto('/dashboard/alerts')

  await expect(page.getByRole('combobox', { name: 'Queue' })).toHaveValue('awaiting_approval')
  await expect(page.getByRole('button', { name: 'Review Manager escalation alert for Example coaching' })).toContainText('Awaiting Kris’s approval')
  await expect(page.getByText('Current team workload')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Partner QA', exact: true })).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('queue-first-director-desktop.png'), animations: 'disabled' })
  await page.getByText('Team workload', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Manager reviewed 4' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Awaiting Kris’s approval 3' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Coaching due 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha Changes requested 1' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('team-workload-expanded-desktop.png'), fullPage: true, animations: 'disabled' })

  await page.getByRole('button', { name: 'Filter Manager Alpha False alarm 2' }).click()
  await expect(page.getByRole('combobox', { name: 'Queue' })).toHaveValue('reviewed')
  await expect(page.getByText('Manager: Manager Alpha ×')).toBeVisible()
  await expect(page.getByText('Outcome: False alarm ×')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Filter Manager Alpha False alarm 2' })).toHaveCount(0)

  await page.getByText('More filters', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Partner QA', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Full QA', exact: true }).click()
  await page.getByText('More filters', { exact: true }).click()
  const moduleFilter = page.getByRole('button', { name: 'Full QA ×' })
  await expect(moduleFilter).toBeVisible()
  await moduleFilter.click()
  await expect(moduleFilter).toHaveCount(0)
})

test('compact queue fits the first row and keyboard path at supported narrow widths', async ({ page }) => {
  await reviewFixture(page, [
    alertRow('first-row'),
    alertRow('second-row', { alert_created_at: '2026-09-05T16:00:00Z' }),
  ])

  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/dashboard/alerts')
    const firstRow = page.getByRole('button', { name: 'Review Manager escalation alert for Example first-row' })
    await expect(firstRow).toBeVisible()
    const mobileSummary = firstRow.locator('td:visible').last()
    await expect(mobileSummary).toContainText('Manager escalation')
    await expect(mobileSummary).toContainText('Awaiting manager')
    await expect(mobileSummary).toContainText('Example first-row')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const bounds = await mobileSummary.boundingBox()
    expect(bounds).not.toBeNull()
    expect((bounds?.x ?? -1) + (bounds?.width ?? width + 1)).toBeLessThanOrEqual(width)
    for (const label of ['Manager escalation', 'Awaiting manager']) {
      const labelBounds = await mobileSummary.getByText(label, { exact: true }).boundingBox()
      expect(labelBounds).not.toBeNull()
      expect((labelBounds?.y ?? 845) + (labelBounds?.height ?? 845)).toBeLessThanOrEqual(844)
    }
  }

  await page.getByText('More filters', { exact: true }).click()
  const mobileSort = page.getByRole('combobox', { name: 'Sort queue' })
  await expect(mobileSort).toBeVisible()
  await mobileSort.selectOption('time:desc')
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ }).first()).toContainText('Example second-row')
  await mobileSort.selectOption('time:asc')
  await page.getByText('More filters', { exact: true }).click()

  await page.keyboard.press('j')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('Example first-row')
})

test('director sees the manager explanation and evidence before approval actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await reviewFixture(page, [alertRow('approval', {
    module_name: 'budget_inputs',
    is_reviewed: true,
    accurate: true,
    action_taken: 'coached',
    feedback_by: 'manager-a@example.test',
    violation_details: 'The manager identified the exact missing disclosure.',
    action_details: 'The manager coached the representative with the approved language.',
  })], { god: true, email: 'director@example.test' })
  await page.goto('/dashboard/alerts')
  await openAlert(page, 'approval')

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('The manager identified the exact missing disclosure.')).toBeVisible()
  await expect(dialog.getByText('Review both quoted passages in context.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Approve review' })).toBeInViewport()
  const contentOrder = await dialog.locator('section').evaluateAll(sections => ({
    review: sections.findIndex(section => section.getAttribute('aria-label') === 'Manager review'),
    approval: sections.findIndex(section => section.textContent?.includes('awaiting Kris’s approval')),
  }))
  expect(contentOrder.review).toBeGreaterThanOrEqual(0)
  expect(contentOrder.approval).toBeGreaterThan(contentOrder.review)
  await expect(dialog.getByText('Discussion', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Add a message' })).not.toBeVisible()
})

test('discussion count excludes deleted messages while keeping the thread on demand', async ({ page }) => {
  const message = {
    call_id: 'discussion-count',
    module_name: 'full_qa',
    author_email: 'manager@example.test',
    body: 'Synthetic discussion message.',
    parent_message_id: null,
    posted_at: '2026-09-05T14:00:00Z',
    edited_at: null,
    requires_acknowledgment: false,
  }
  await reviewFixture(page, [alertRow('discussion-count', { message_count: 2 })], {
    messages: [
      { ...message, id: 1, deleted_at: null },
      { ...message, id: 2, deleted_at: '2026-09-06T14:00:00Z' },
    ],
  })
  await page.goto('/dashboard/alerts')
  await openAlert(page, 'discussion-count')

  const discussionSummary = page.locator('summary').filter({ hasText: 'Discussion' })
  await expect(discussionSummary).toContainText('1')
  await expect(discussionSummary).not.toContainText('2')
})

test('a director editing their own manager review must save before approving it', async ({ page }) => {
  const email = 'director@example.test'
  const state = await reviewFixture(page, [alertRow('own-review', { module_name: 'budget_inputs',
    is_reviewed: true,
    accurate: true,
    action_taken: 'coached',
    feedback_by: email,
    violation_details: 'The required disclosure was omitted from this synthetic call.',
    action_details: 'The manager coached the representative using the approved language.',
  })], { god: true, email })
  await page.goto('/dashboard/alerts')
  await openAlert(page, 'own-review')

  const approve = page.getByRole('button', { name: 'Approve review' })
  const update = page.getByRole('button', { name: 'Update review' })
  await expect(update).toBeVisible()
  await expect(approve).toBeEnabled()
  await page.getByRole('textbox', { name: /What happened/ }).fill('')
  await expect(update).toBeDisabled()
  await expect(approve).toBeDisabled()
  await page.getByRole('textbox', { name: /What happened/ }).fill('The required disclosure was omitted from this synthetic call.')
  await page.getByRole('textbox', { name: /What action did you take/ }).fill('The director updated the coaching details before approving this revision.')
  await expect(approve).toBeDisabled()
  await page.getByRole('button', { name: 'Update review' }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  await expect(approve).toBeEnabled()
  await approve.click()
  await expect(page.getByText('Review approved')).toBeVisible()
  expect(state.rows[0].current_decision).toBe('approved')
})

test('drawer uses one scrolling review flow for evidence, required fields, and save', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('single-flow', { module_name: 'budget_inputs' })])
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/dashboard/alerts')
  await openAlert(page, 'single-flow')

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Why it fired')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save review' })).toBeInViewport()
  await dialog.getByRole('button', { name: 'Real issue (Y)' }).click()
  await dialog.getByRole('button', { name: '1. Coached the agent' }).click()
  await dialog.getByRole('textbox', { name: /What happened/ }).fill('The required disclosure was omitted from this synthetic call.')
  await dialog.getByRole('textbox', { name: /What action did you take/ }).fill('The manager coached the complete disclosure with the representative.')
  await expect(dialog.getByRole('button', { name: 'Save review' })).toBeInViewport()

  const scrollingRegions = await dialog.evaluate(element => [...element.querySelectorAll('*')].filter(child => {
    const style = window.getComputedStyle(child)
    return /(auto|scroll)/.test(style.overflowY) && child.scrollHeight > child.clientHeight
  }).length)
  expect(scrollingRegions).toBe(1)
  await dialog.getByRole('button', { name: 'Save review' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('single-scroll-review-drawer-mobile.png'), animations: 'disabled' })

  await dialog.getByRole('button', { name: 'Inspect transcript context' }).click()
  await expect(dialog.getByText('2 evidence passages')).toBeVisible()
  const evidenceScrollRegions = await dialog.evaluate(element => [...element.querySelectorAll('*')].filter(child => {
    const style = window.getComputedStyle(child)
    return /(auto|scroll)/.test(style.overflowY) && child.scrollHeight > child.clientHeight
  }).length)
  expect(evidenceScrollRegions).toBe(1)
  await dialog.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText('Review saved')).toBeVisible()
  expect(state.rows[0].review_revision).toBe(1)
})

test('team workload count drilldowns keep placeholder ownership grouped without swallowing real emails', async ({ page }) => {
  const realOwner = 'unassigned.owner@example.test'
  await reviewFixture(page, [
    alertRow('missing-owner', { assigned_manager_email: null }),
    alertRow('literal-owner', { assigned_manager_email: ' UnAssigned ' }),
    alertRow('real-owner', { assigned_manager_email: `  ${realOwner.toUpperCase()}  ` }),
  ], {
    god: true,
    managerNames: { [realOwner]: 'Manager Still Assigned' },
  })

  await page.goto('/dashboard/alerts')
  await page.getByText('Team workload', { exact: true }).click()

  await expect(page.getByRole('button', { name: 'Filter Needs manager assignment Received 2' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Filter Manager Still Assigned Received 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Filter Needs manager assignment Received 2' }).click()

  await expect(page.getByText('Manager: Needs manager assignment ×')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Review .* alert for Example/ })).toHaveCount(2)
  await expect(page.getByText('Team workload', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filter Needs manager assignment Received 2' })).toHaveCount(0)
})
