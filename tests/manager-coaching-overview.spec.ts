import { expect, test, type Page } from '@playwright/test'
import { alertRow, FULL_QA_RESULT, QUOTES, reviewFixture } from './review-fixture'

// Summary and coaching come only from the pinned review source; the alert row's live result is a decoy.
const PINNED = {
  ...FULL_QA_RESULT,
  call_overview: { ...FULL_QA_RESULT.call_overview, call_topic: 'Pinned topic: debt program options', call_purpose: 'Pinned purpose: review enrollment fit', call_outcome: 'Pinned outcome: customer asked for a follow-up call' },
  coaching_recommendations: {
    strengths: ['Pinned strength: calm opening'],
    areas_for_improvement: ['Pinned area: confirm consent before the credit pull'],
    specific_coaching_points: ['Pinned point: ask permission explicitly and wait for a yes'],
    training_recommendations: [],
  },
}
const LIVE = {
  ...FULL_QA_RESULT,
  call_overview: { ...FULL_QA_RESULT.call_overview, call_topic: 'LIVE TOPIC MUST NOT APPEAR', call_outcome: 'LIVE OUTCOME MUST NOT APPEAR' },
  coaching_recommendations: { strengths: [], areas_for_improvement: [], specific_coaching_points: ['LIVE COACHING MUST NOT APPEAR'], training_recommendations: ['LIVE TRAINING MUST NOT APPEAR'] },
}

async function openPinned(page: Page, id: string) {
  const state = await reviewFixture(page, [alertRow(id, { result_json: LIVE })])
  state.fullQaSources.set(id, structuredClone(PINNED))
  await page.goto(`/dashboard/alerts/${id}/full_qa`)
  return state
}

test('manager sees source-locked summary and AI coaching labeled as suggestions, never the mismatched live result', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openPinned(page, 'coaching-pinned')
  const review = page.getByRole('region', { name: 'Review workspace' })
  const summary = review.getByRole('region', { name: 'Call summary', exact: true })
  await expect(summary).toContainText('Pinned topic: debt program options')
  await expect(summary).toContainText('Pinned outcome: customer asked for a follow-up call')
  const coaching = review.getByRole('region', { name: 'AI coaching suggestions', exact: true })
  await expect(coaching).toContainText('Pinned point: ask permission explicitly and wait for a yes')
  await expect(coaching).toContainText('Pinned strength: calm opening')
  await expect(coaching).toContainText('not recorded as coaching or follow-up')
  await expect(coaching.getByRole('heading', { name: 'Training recommendations' })).toHaveCount(0)
  await expect(page.getByRole('dialog')).not.toContainText('MUST NOT APPEAR')

  // Flow order: summary → why flagged → AI coaching → evidence.
  const tops = await Promise.all([summary, review.getByRole('region', { name: 'Why Eavesly requested review', exact: true }), coaching, review.getByRole('region', { name: 'What Eavesly flagged', exact: true })]
    .map(async locator => (await locator.boundingBox())!.y))
  expect([...tops].sort((a, b) => a - b)).toEqual(tops)
})

test('missing summary and coaching show an honest fallback without inventing content', async ({ page }) => {
  await reviewFixture(page, [alertRow('coaching-missing')])
  await page.goto('/dashboard/alerts/coaching-missing/full_qa')
  const review = page.getByRole('region', { name: 'Review workspace' })
  await expect(review.getByText('No AI coaching suggestions were saved with this assessment.', { exact: true })).toBeVisible()
  await expect(review.getByRole('region', { name: 'Call summary', exact: true })).toHaveCount(0)
  await expect(review.getByRole('region', { name: 'AI coaching suggestions', exact: true })).toHaveCount(0)
  // Pre-v1 source without the key: context unknown, never "no history".
  await expect(review.getByText('Prior-call context not available for this assessment.', { exact: true })).toBeVisible()
  await expect(review).not.toContainText('No earlier calls')
})

test('agree saves with no typing: no decision preselected, suggestions not recorded as actions, untouched scores stay unconfirmed', async ({ page }) => {
  const state = await openPinned(page, 'coaching-agree')
  const footer = page.getByRole('contentinfo')
  const yes = page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true })
  const no = page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true })
  await expect(yes).not.toBeChecked()
  await expect(no).not.toBeChecked()
  await expect(footer.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()

  // Disagree requires a brief explanation.
  await no.check()
  await expect(footer.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()

  await yes.check()
  await footer.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0]).toMatchObject({ p_escalation_justified: true, p_corrections: [], p_findings: [], p_evidence_feedback: [] })
  const write = state.writes[0] as Record<string, unknown>
  expect(write.p_action ?? null).toBeNull()
  expect(write.p_action_details ?? null).toBeNull()
  expect(JSON.stringify(write)).not.toContain('Pinned point')
  expect(JSON.stringify(write)).not.toContain('Pinned area')
})

test('375px: coaching fits, and draft plus evidence response survive transcript navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const state = await openPinned(page, 'coaching-mobile')
  await page.getByRole('group', { name: 'Full QA workspace view' }).getByRole('button', { name: 'Review', exact: true }).click()
  const coaching = page.getByRole('region', { name: 'AI coaching suggestions', exact: true })
  await expect(coaching).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.getByRole('radio', { name: 'No, the alert was unnecessary', exact: true }).check()
  const explanation = page.getByRole('textbox', { name: 'Explain your decision', exact: true })
  await explanation.fill('Customer consented before the credit pull; the flag is wrong.')
  const occurrence = page.getByRole('article', { name: 'Credit pull consent', exact: true }).getByRole('group', { name: 'Credit pull consent evidence 1', exact: true })
  await occurrence.getByRole('radio', { name: 'Evidence: Partly correct', exact: true }).check()
  await occurrence.getByRole('button', { name: /^Find in transcript/ }).click()

  const transcript = page.getByRole('region', { name: 'Transcript workspace' })
  await expect(transcript.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await transcript.getByRole('button', { name: 'Back to evidence', exact: true }).click()
  await expect(occurrence.getByRole('radio', { name: 'Evidence: Partly correct', exact: true })).toBeChecked()
  await expect(explanation).toHaveValue('Customer consented before the credit pull; the flag is wrong.')
  await expect(coaching).toContainText('Pinned point: ask permission explicitly and wait for a yes')
  expect(state.writes).toEqual([])
})

// Synthetic prior-call snapshots (contract v1). Current call: step 2 missing (credited earlier), step 6 partial (prior conflicting).
const priorContext = (overrides: Record<string, unknown> = {}) => ({
  version: 1, policy: 'full_qa_prior_stage_credit_v1', status: 'included', reason: null,
  current_call: { call_id: 'current', sfdc_lead_id: 'LEAD-SYNTH', started_at: '2026-09-04T16:00:00Z', started_at_source: 'eavesly_calls' },
  max_prior_calls: 5, total_prior_calls: 3,
  prior_calls: [{
    call_id: 'PRIOR-A', started_at: '2026-09-01T15:00:00Z', agent_email: null, direction: 'outbound', talk_time: 300, campaign_name: null,
    disposition: 'Callback scheduled', notes: null, call_summary: 'Prior AI summary: reviewed credit report with the customer.', overall_score: null, compliance_rating: null,
    qa_status: 'found', qa_source: { table: 'eavesly_transcription_qa', row_id: 101, created_at: '2026-09-01T16:00:00Z', prompt_sha256: null, transcript_sha256: null },
    stages: [
      { step: 2, ai_status: 'complete', ai_listed_completed: true, ai_listed_attempted: true, ai_location: 'middle of call', credit: 'assessed_complete', evidence: [{ quote: 'Let us walk through your credit report.', speaker: 'handling agent' }] },
      { step: 6, ai_status: 'complete', ai_listed_completed: false, ai_listed_attempted: true, ai_location: null, credit: 'conflicting', evidence: [] },
    ],
  }, {
    call_id: 'PRIOR-B', started_at: '2026-08-28T15:00:00Z', agent_email: null, direction: null, talk_time: null, campaign_name: null,
    disposition: null, notes: null, call_summary: null, overall_score: null, compliance_rating: null, qa_status: 'ambiguous', qa_source: null, stages: [],
  }, {
    call_id: 'PRIOR-C', started_at: '2026-08-20T15:00:00Z', agent_email: null, direction: null, talk_time: null, campaign_name: null,
    disposition: 'No answer', notes: 'CRM note kept when QA failed', call_summary: null, overall_score: null, compliance_rating: null, qa_status: 'unavailable', qa_source: null, stages: [],
  }],
  stage_credits: [{ step: 2, basis: 'prior_ai_assessment', transcript_verified: false, manager_confirmed: false, source_call_id: 'PRIOR-A',
    source_started_at: '2026-09-01T15:00:00Z', source_qa_created_at: '2026-09-01T16:00:00Z', source_qa_row_id: 101, ai_location: 'middle of call', evidence: [] }],
  applicability: null,
  ...overrides,
})

// Current call attempted 1, 3, 5, 6 (6 only partly); step 2 was not attempted at all.
const CURRENT_SALES = { ...FULL_QA_RESULT.sales_process_scorecard, step2_credit_review: 'missing', step2_location: null, sections_attempted: [1, 3, 5, 6], sections_completed: [1, 3, 5] }

async function openPrior(page: Page, id: string, context: unknown, sales: Record<string, unknown> = CURRENT_SALES) {
  const source = { ...FULL_QA_RESULT, sales_process_scorecard: sales, _prior_call_context: context }
  const state = await reviewFixture(page, [alertRow(id, { result_json: LIVE })])
  state.fullQaSources.set(id, source)
  await page.goto(`/dashboard/alerts/${id}/full_qa`)
  return { state, review: page.getByRole('region', { name: 'Review workspace' }) }
}

test('prior-call credit is labeled AI-assessed, distinguishes step states, and never becomes a correction', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { state, review } = await openPrior(page, 'prior-complete', priorContext())
  const earlier = review.getByRole('region', { name: 'Earlier calls', exact: true })
  await expect(earlier).toContainText('not transcript-verified or manager-confirmed')
  const steps = earlier.getByRole('list', { name: 'Sales steps across calls' })
  await expect(steps.getByRole('listitem').filter({ hasText: 'step1 agenda setting' })).toContainText('Completed on this call')
  await expect(steps.getByRole('listitem').filter({ hasText: 'step2 credit review' })).toContainText('Completed previously (AI-assessed)')
  await expect(steps.getByRole('listitem').filter({ hasText: 'step2 credit review' })).toContainText('Call PRIOR-A')
  await expect(steps.getByRole('listitem').filter({ hasText: 'step6 debt resolution' })).toContainText('Outstanding')
  await expect(steps.getByRole('listitem').filter({ hasText: 'step6 debt resolution' })).toContainText('conflicting — not credited')
  await expect(steps.getByRole('listitem').filter({ hasText: 'step4 paydown projections' })).toContainText('Not applicable')

  await earlier.locator('summary', { hasText: 'Call PRIOR-A' }).click()
  await expect(earlier).toContainText('Callback scheduled')
  await expect(earlier).toContainText('Prior AI summary: reviewed credit report with the customer.')
  await expect(earlier).toContainText('Let us walk through your credit report.')
  await earlier.locator('summary', { hasText: 'Call PRIOR-B' }).click()
  await expect(earlier).toContainText('Prior AI assessment ambiguous — no step credit from this call.')
  await earlier.locator('summary', { hasText: 'Call PRIOR-C' }).click()
  await expect(earlier).toContainText('CRM note kept when QA failed')
  await expect(earlier).toContainText('Prior AI assessment unavailable — no step credit from this call.')
  // No fabricated audio jumps or call links for prior calls.
  await expect(earlier.getByRole('button', { name: /Play|Listen/ })).toHaveCount(0)
  await expect(earlier.getByRole('link')).toHaveCount(0)

  // Credited step keeps its original score, is not shown as an agent failure, and has adjacent prior credit.
  const step2 = review.getByRole('article', { name: 'step2 credit review', exact: true })
  await expect(step2).toBeHidden()
  await review.getByRole('button', { name: /^View full scorecard/ }).click()
  await expect(step2).toContainText('Eavesly’s result: Not covered')
  await expect(step2).toContainText('Prior-call credit')
  await expect(step2).not.toContainText('Eavesly score concern')
  await expect(review.getByRole('article', { name: 'step6 debt resolution', exact: true })).toContainText('Eavesly score concern')

  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await page.getByRole('contentinfo').getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes[0]).toMatchObject({ p_corrections: [], p_findings: [] })
})


const PRIOR_A = priorContext().prior_calls[0]
function withStages(stages: unknown[]) {
  return priorContext({ prior_calls: [{ ...PRIOR_A, stages }, ...priorContext().prior_calls.slice(1)] })
}

test('a reattempted partial step or unprovable attempt record is never masked by prior credit', async ({ page }) => {
  // Prior call completed step 6 (all three raw fields agree), but this call attempted it and scored it partial.
  const step6 = { step: 6, ai_status: 'complete', ai_listed_completed: true, ai_listed_attempted: true, ai_location: 'closing', credit: 'assessed_complete', evidence: [] }
  const credit6 = { ...priorContext().stage_credits[0], step: 6, ai_location: 'closing' }
  const context = priorContext({ prior_calls: [{ ...PRIOR_A, stages: [PRIOR_A.stages[0], step6] }, ...priorContext().prior_calls.slice(1)], stage_credits: [...priorContext().stage_credits, credit6] })
  const { review } = await openPrior(page, 'prior-reattempted', context)
  const steps = review.getByRole('list', { name: 'Sales steps across calls' })
  const row6 = steps.getByRole('listitem').filter({ hasText: 'step6 debt resolution' })
  await expect(row6).toContainText('Outstanding')
  await expect(row6).not.toContainText('Completed previously')
  await expect(row6).toContainText('Earlier call PRIOR-A completed this step (AI-assessed)')
  await expect(review.getByRole('article', { name: 'step6 debt resolution', exact: true })).toContainText('Eavesly score concern')
  await expect(review.getByRole('article', { name: 'step6 debt resolution', exact: true })).not.toContainText('Prior-call credit')
  // The non-attempted step 2 still receives the waiver.
  await expect(steps.getByRole('listitem').filter({ hasText: 'step2 credit review' })).toContainText('Completed previously (AI-assessed)')
  await page.unrouteAll({ behavior: 'ignoreErrors' })

  // Without current attempt lists, non-attempt cannot be proven: no waiver even for step 2.
  const { sections_attempted: _a, sections_completed: _c, ...unprovable } = CURRENT_SALES
  const second = await openPrior(page, 'prior-unprovable', priorContext(), unprovable)
  await expect(second.review.getByRole('list', { name: 'Sales steps across calls' }).getByRole('listitem').filter({ hasText: 'step2 credit review' })).toContainText('Outstanding')
  await expect(second.review.getByRole('article', { name: 'step2 credit review', exact: true })).toContainText('Eavesly score concern')
})

const priorCases = () => [
    ['prior-unavailable', priorContext({ status: 'unavailable', reason: 'identity_unproven', prior_calls: [], stage_credits: [] }), 'Prior-call context unavailable: the lead could not be confirmed.'],
    ['prior-none', priorContext({ status: 'none', prior_calls: [], stage_credits: [], total_prior_calls: 0 }), 'No earlier calls were found for this lead.'],
    ['prior-malformed', priorContext({ stage_credits: [{ ...priorContext().stage_credits[0], transcript_verified: true }] }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-mismatched-row', priorContext({ stage_credits: [{ ...priorContext().stage_credits[0], source_qa_row_id: 999 }] }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-missing-row', priorContext({ stage_credits: [{ ...priorContext().stage_credits[0], source_qa_row_id: null }] }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-not-attempted', withStages([{ ...PRIOR_A.stages[0], ai_listed_attempted: false }, PRIOR_A.stages[1]]), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-duplicate-step', withStages([PRIOR_A.stages[0], PRIOR_A.stages[0]]), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-duplicate-call', priorContext({ prior_calls: [PRIOR_A, { ...PRIOR_A, stages: [], qa_status: 'missing', qa_source: null }] }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-not-earlier', priorContext({ prior_calls: [{ ...PRIOR_A, started_at: '2026-09-04T16:00:00Z' }], stage_credits: [{ ...priorContext().stage_credits[0], source_started_at: '2026-09-04T16:00:00Z' }] }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-wrong-table', priorContext({ prior_calls: [{ ...PRIOR_A, qa_source: { ...PRIOR_A.qa_source, table: 'eavesly_module_results' } }, ...priorContext().prior_calls.slice(1)] }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-missing-table', priorContext({ prior_calls: [{ ...PRIOR_A, qa_source: { row_id: 101, created_at: '2026-09-01T16:00:00Z', prompt_sha256: null, transcript_sha256: null } }, ...priorContext().prior_calls.slice(1)] }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
    ['prior-no-current-time', priorContext({ current_call: { call_id: 'current', sfdc_lead_id: 'LEAD-SYNTH', started_at: null, started_at_source: null } }), 'Prior-call context couldn’t be read, so no prior-call credit is shown.'],
  ] as const

for (const [id, context, message] of priorCases()) {
  test(`${id}: prior context stays honest and grants no credit`, async ({ page }) => {
    const { review } = await openPrior(page, id, context)
    await expect(review.getByText(message, { exact: true })).toBeVisible()
    await expect(review).not.toContainText('Completed previously')
    // Without credit, the raw missing step remains a visible score concern.
    await expect(review.getByRole('article', { name: 'step2 credit review', exact: true })).toContainText('Eavesly score concern')
  })
}

// Valid context and credit for step 2, but the current call's own step-2 data is not provably "missing and not attempted".
const invalidCurrent = [
  ['current-status-unknown', { ...CURRENT_SALES, step2_credit_review: 'skipped' }],
  ['current-status-absent', (({ step2_credit_review: _s, ...rest }) => rest)(CURRENT_SALES)],
  ['current-status-not-applicable', { ...CURRENT_SALES, step2_credit_review: 'not_applicable' }],
  ['current-attempted-string-step', { ...CURRENT_SALES, sections_attempted: [1, 3, 5, 6, '2'] }],
  ['current-completed-invalid-step', { ...CURRENT_SALES, sections_completed: [1, 3, 5, 7] }],
] as const
for (const [id, sales] of invalidCurrent) {
  test(`${id}: invalid current score or attempt list fails closed (no waiver)`, async ({ page }) => {
    const { review } = await openPrior(page, id, priorContext(), sales)
    const row = review.getByRole('list', { name: 'Sales steps across calls' }).getByRole('listitem').filter({ hasText: 'step2 credit review' })
    await expect(row).not.toContainText('Completed previously')
    await review.getByRole('button', { name: /^View full scorecard/ }).click()
    await expect(review.getByRole('article', { name: 'step2 credit review', exact: true })).not.toContainText('Prior-call credit')
  })
}
