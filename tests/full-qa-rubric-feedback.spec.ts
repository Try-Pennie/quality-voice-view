import { test, expect, type Page } from '@playwright/test'
import { alertRow, FULL_QA_CRITERIA, FULL_QA_RESULT, openAlert, reviewFixture } from './review-fixture'

const response = (page: Page, criterion: string) => page.getByRole('radiogroup', { name: `${criterion} disposition` })

const correctionReason = 'The available call context confirms the corrected judgment.'
const contextReason = 'The audio is unavailable, so this criterion remains uncertain.'
const findingSummary = 'A distinct inaccurate representation requires coaching.'
const findingEvidence = 'The synthetic evidence confirms this underlying assertion once.'
const escalationReason = 'The alert escalation is unnecessary because only one distinct compliance issue is confirmed.'
const actionDetails = 'The manager retained the finding and scheduled specific coaching despite dismissing escalation.'

test('Full QA saves string-scale corrections, uncertainty, and a retained finding independently from dismissed escalation', async ({ page }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('rubric-flow')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'rubric-flow')

  await expect(page.getByRole('heading', { name: 'Check what Eavesly found' })).toBeVisible()
  await expect(response(page, 'Call recording disclosure')).toBeHidden()
  await page.getByText('Scoring policy & source', { exact: true }).click()
  await expect(page.getByText(/Exact production rubric/)).toContainText('1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37')
  await expect(page.locator('[role="radiogroup"]')).toHaveCount(23)
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('Eavesly flagged this', { exact: true })).toBeVisible()
  await expect(consent.getByText('Evidence Eavesly used', { exact: true })).toBeVisible()
  await expect(consent.locator('blockquote')).toHaveText('Your credit may be affected.')
  await expect(consent.locator('pre')).toBeHidden()
  await expect(consent.getByText('Exact synthetic rule for Credit pull consent.')).toBeHidden()
  await page.getByText('Scoring policy & source', { exact: true }).click()
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  await expect(page.getByRole('radiogroup')).toHaveCount(23)

  await response(page, 'Call recording disclosure').getByRole('radio', { name: 'Need more context', exact: true }).check()
  await page.getByRole('textbox', { name: 'Call recording disclosure correction reason' }).fill(contextReason)
  await response(page, 'Credit pull consent').getByRole('radio', { name: 'Disagree', exact: true }).check()
  await expect(page.getByRole('combobox', { name: 'Credit pull consent corrected value' })).toHaveValue('pass')
  await page.getByRole('textbox', { name: 'Credit pull consent correction reason' }).fill(correctionReason)
  await response(page, 'professional tone').getByRole('radio', { name: 'Disagree', exact: true }).check()
  await page.getByRole('combobox', { name: 'professional tone corrected value' }).selectOption('poor')
  await page.getByRole('textbox', { name: 'professional tone correction reason' }).fill('The manager identified a tone concern the AI initially missed.')
  await page.getByRole('button', { name: 'Show only issues & changes' }).click()
  await expect(response(page, 'Call recording disclosure').getByRole('radio', { name: 'Need more context', exact: true })).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'professional tone corrected value' })).toHaveValue('poor')
  await expect(response(page, 'Social security verification')).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await response(page, 'Credit pull consent').scrollIntoViewIfNeeded()
  await expect(page.getByRole('combobox', { name: 'Credit pull consent corrected value' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('full-qa-rubric-mobile.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 720 })

  await page.getByRole('button', { name: 'Add confirmed issue' }).click()
  await page.getByRole('listbox', { name: 'Finding 1 related criteria' }).selectOption(['accurate_representations'])
  await page.getByRole('textbox', { name: 'Finding 1 summary' }).fill(findingSummary)
  await page.getByRole('textbox', { name: 'Finding 1 evidence' }).fill(findingEvidence)
  await expect(page.getByRole('button', { name: 'No, the alert was unnecessary' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('textbox', { name: 'Explain your decision' }).fill(escalationReason)
  await page.getByRole('combobox', { name: 'Why was the alert unnecessary?' }).selectOption('wrong_context')
  await page.getByRole('combobox', { name: 'What did you do about the issue?' }).selectOption('follow_up_later')
  await page.getByRole('textbox', { name: 'Coaching or next steps' }).fill(actionDetails)

  await page.screenshot({ path: testInfo.outputPath('full-qa-dismissed-retained-finding-desktop.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved')).toBeVisible()

  const write = state.writes.find(value => value && typeof value === 'object' && 'p_corrections' in value)
  expect(write).toMatchObject({
    p_escalation_justified: false,
    p_inaccuracy_reason: 'wrong_context',
    p_action: 'follow_up_later',
    p_action_details: actionDetails,
  })
  expect(write).toHaveProperty('p_corrections')
  expect((write as { p_corrections: unknown[] }).p_corrections).toHaveLength(23)
  expect((write as { p_corrections: unknown[] }).p_corrections).toEqual(expect.arrayContaining([
    { criterion_key: 'social_security_verification', disposition: 'confirmed', corrected_value: 'pass', reason: null },
    { criterion_key: 'step4_paydown_projections', disposition: 'confirmed', corrected_value: 'not_applicable', reason: null },
    { criterion_key: 'professional_tone', disposition: 'corrected', corrected_value: 'poor', reason: 'The manager identified a tone concern the AI initially missed.' },
  ]))
  expect((write as { p_findings: unknown[] }).p_findings).toHaveLength(1)
  expect(state.writes.some(value => value && typeof value === 'object' && 'p_verdict' in value)).toBe(false)
  expect(state.rows[0].accurate).toBe(false)
  expect(state.rows[0].action_taken).toBe('follow_up_later')
  await page.getByRole('combobox', { name: 'Queue' }).selectOption('coaching_due')
  await expect(page.getByRole('button', { name: /Review .* Example rubric-flow/ })).toBeVisible()
  await openAlert(page, 'rubric-flow')
  await expect(page.getByText('Coaching follow-up is still open.')).toBeVisible()
  await expect(page.getByText('Needs more context', { exact: true })).toBeVisible()
  await expect(page.getByText('Changed to: Meets the rule', { exact: true })).toBeVisible()
  await page.getByText('Candidate rule proposals', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Current criterion for proposal' }).selectOption('credit_pull_consent')
  await page.getByRole('textbox', { name: 'Proposed rule content' }).fill('Require an explicit needs-context result when consent audio is unavailable.')
  await page.getByRole('textbox', { name: 'Why change this rule?' }).fill('Unavailable audio must not become a confirmed pass or failure.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Close (Esc)' }).click()
  await expect(page.getByRole('textbox', { name: 'Proposed rule content' })).toHaveValue('Require an explicit needs-context result when consent audio is unavailable.')
  await page.getByRole('button', { name: 'Propose for evaluation' }).click()
  await expect(page.getByText(/Rule proposed for evaluation review/)).toBeVisible()
  await page.getByRole('button', { name: 'Close (Esc)' }).click()

  const adminPage = await page.context().newPage()
  await reviewFixture(adminPage, state.rows, { god: true, email: 'director@example.test', fullQaReviews: state.fullQaReviews, fullQaProposals: state.fullQaProposals })
  await adminPage.goto('/dashboard/alerts?status=awaiting_approval')
  await openAlert(adminPage, 'rubric-flow')
  await expect(adminPage.getByRole('radiogroup')).toHaveCount(0)
  await expect(adminPage.getByText('Needs more context', { exact: true })).toBeVisible()
  await expect(adminPage.getByText('Changed to: Poor', { exact: true })).toBeVisible()
  const humanOnly = adminPage.getByRole('article', { name: 'professional tone', exact: true })
  await expect(humanOnly.getByText('Manager review item', { exact: true })).toBeVisible()
  await expect(humanOnly.getByText('Eavesly flagged this', { exact: true })).toHaveCount(0)
  await expect(adminPage.getByRole('heading', { name: 'Social security verification', exact: true })).toBeHidden()
  await adminPage.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Social security verification', exact: true })).toBeVisible()
  await expect(adminPage.getByRole('radiogroup')).toHaveCount(0)
  await adminPage.getByRole('button', { name: 'Show only issues & changes' }).click()
  const savedTreatment = adminPage.getByText('Changed to: Meets the rule', { exact: true })
  await expect(savedTreatment).toBeVisible()
  await savedTreatment.scrollIntoViewIfNeeded()
  await adminPage.screenshot({ path: testInfo.outputPath('full-qa-approval-desktop.png'), fullPage: true, animations: 'disabled' })
  await adminPage.getByText('Candidate rule proposals', { exact: true }).click()
  await adminPage.getByRole('textbox', { name: /Proposal .* decision reason/ }).fill('Approved for bounded candidate evaluation only.')
  await adminPage.getByRole('button', { name: 'Approve for evaluation' }).click()
  await expect(adminPage.getByRole('region', { name: 'Full QA rubric review' }).getByText('Approved for evaluation — not published')).toBeVisible()
  await expect(adminPage.getByRole('button', { name: 'Approve review' })).toBeEnabled()
  await adminPage.getByRole('button', { name: 'Approve review' }).click()
  await expect(adminPage.getByText('Review approved')).toBeVisible()
  await adminPage.close()
})

test('focused scorecard respects categorical concerns and enrollment gating, while toggling preserves edits', async ({ page }, testInfo) => {
  const result = {
    ...structuredClone(FULL_QA_RESULT),
    customer_experience_scorecard: { ...FULL_QA_RESULT.customer_experience_scorecard, professional_tone: 'poor' },
    sales_process_scorecard: { ...FULL_QA_RESULT.sales_process_scorecard, step2_credit_review: 'missing' },
    program_expectations_scorecard: { ...FULL_QA_RESULT.program_expectations_scorecard, enrollment_completed: false, section_status: 'not_applicable' },
  }
  await reviewFixture(page, [alertRow('focused', { result_json: result })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'focused')
  await expect(page.getByRole('radiogroup')).toHaveCount(6)
  for (const label of ['Credit pull consent', 'Accurate representations', 'professional tone', 'patience empathy', 'step2 credit review', 'step6 debt resolution']) {
    await expect(response(page, label)).toBeVisible()
  }
  for (const label of ['Call recording disclosure', 'active listening', 'step1 agenda setting', 'step4 paydown projections', 'phase recovery covered']) {
    await expect(response(page, label)).toBeHidden()
  }
  const coaching = page.getByRole('article', { name: 'professional tone', exact: true })
  await expect(coaching.getByText('Eavesly coaching concern', { exact: true })).toBeVisible()
  await expect(coaching.getByText('Eavesly flagged this', { exact: true })).toHaveCount(0)
  const agree = response(page, 'Credit pull consent').getByRole('radio', { name: 'Agree with Eavesly', exact: true })
  await agree.focus()
  await page.keyboard.press('ArrowRight')
  await expect(response(page, 'Credit pull consent').getByRole('radio', { name: 'Disagree', exact: true })).toBeChecked()
  await page.getByRole('textbox', { name: 'Credit pull consent correction reason' }).fill(correctionReason)
  const expand = page.getByRole('button', { name: 'View full scorecard · 23 criteria' })
  await expand.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('radiogroup')).toHaveCount(23)
  await response(page, 'phase recovery covered').getByRole('radio', { name: 'Need more context', exact: true }).check()
  await page.getByRole('textbox', { name: 'phase recovery covered correction reason' }).fill(contextReason)
  await page.getByRole('button', { name: 'Show only issues & changes' }).click()
  await expect(page.getByRole('radiogroup')).toHaveCount(7)
  await expect(page.getByRole('textbox', { name: 'phase recovery covered correction reason' })).toHaveValue(contextReason)
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await expand.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(expand).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath('focused-scorecard.png'), animations: 'disabled' })
})

test('evidence shows readable quotes with context, keeps notes distinct, and preserves unfamiliar data under details', async ({ page }) => {
  const result = { ...FULL_QA_RESULT, compliance_scorecard: {
    ...FULL_QA_RESULT.compliance_scorecard,
    credit_pull_consent_evidence: [
      { speaker: 'Customer', quote: 'Yes, I authorize that credit review.', context: 'The agent asked permission immediately before this response.', process_step: 'Step 1 Agenda Setting' },
      { unfamiliar_field: 'Unfamiliar evidence must remain available.' },
    ],
    accurate_representations_violations: ['The model describes an unqualified outcome promise.'],
  } }
  await reviewFixture(page, [alertRow('readable-evidence', { result_json: result })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'readable-evidence')
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('Eavesly flagged this', { exact: true })).toBeVisible()
  await expect(consent.locator('blockquote')).toHaveText('Yes, I authorize that credit review.')
  await expect(consent.locator('figcaption')).toHaveText('Customer · Step 1 Agenda Setting')
  await expect(consent.getByText('The agent asked permission immediately before this response.', { exact: true })).toBeVisible()
  await expect(consent.getByText('Some evidence is only available in the saved details below.', { exact: true })).toBeVisible()
  await expect(consent.locator('pre')).toBeHidden()
  await consent.getByText('View saved evidence details', { exact: true }).click()
  await expect(consent.locator('pre')).toContainText('Unfamiliar evidence must remain available.')
  const note = page.getByRole('article', { name: 'Accurate representations', exact: true })
  await expect(note.getByText('The model describes an unqualified outcome promise.', { exact: true })).toBeVisible()
  await expect(note.locator('blockquote')).toHaveCount(0)
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  const empty = page.getByRole('article', { name: 'Social security verification', exact: true })
  await expect(empty.getByText('Other Eavesly score', { exact: true })).toBeVisible()
  await expect(empty.getByText('No readable excerpt was saved. Check the transcript before deciding.', { exact: true })).toBeVisible()
})

test('valid unfamiliar rubric values stay readable rather than appearing unavailable', async ({ page }) => {
  const result = { ...FULL_QA_RESULT, compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard, credit_pull_consent: 'requires_follow_up' } }
  const criteria = FULL_QA_CRITERIA.map(item => item.key === 'credit_pull_consent'
    ? { ...item, domain: ['requires_follow_up', 'policy_exception'] } : item)
  await reviewFixture(page, [alertRow('new-domain', { result_json: result })], { fullQaCriteria: criteria })
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'new-domain')
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('requires follow up', { exact: true })).toBeVisible()
  await consent.getByRole('radio', { name: 'Disagree', exact: true }).check()
  const corrected = consent.getByRole('combobox', { name: 'Credit pull consent corrected value' })
  await expect(corrected).toHaveValue('policy_exception')
  await expect(corrected.locator('option')).toHaveText(['requires follow up', 'policy exception'])
  await expect(consent.getByText('Unavailable', { exact: true })).toHaveCount(0)
})

test('empty focus is not a cleared alert and an unavailable score stays visible for context', async ({ page }) => {
  const scorecards: Record<string, Record<string, unknown>> = {}
  for (const criterion of FULL_QA_CRITERIA) {
    const [section, field] = criterion.score_path.split('.')
    scorecards[section] ??= {}
    scorecards[section][field] = criterion.domain[0]
  }
  const clean = { ...FULL_QA_RESULT, ...scorecards }
  const missing = { ...clean, compliance_scorecard: { ...scorecards.compliance_scorecard, social_security_verification: null } }
  await reviewFixture(page, [alertRow('no-concerns', { result_json: clean }), alertRow('missing-score', { result_json: missing })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'no-concerns')
  await expect(page.getByText(/No flagged criteria or review changes to show/)).toContainText('this does not clear the alert')
  await expect(page.getByRole('radiogroup')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'View full scorecard · 23 criteria' }).click()
  await expect(page.getByRole('radiogroup')).toHaveCount(23)
  await page.getByRole('button', { name: 'Close (Esc)' }).click()
  await openAlert(page, 'missing-score')
  await expect(page.getByRole('radiogroup')).toHaveCount(1)
  await expect(response(page, 'Social security verification').getByRole('radio', { name: 'Need more context', exact: true })).toBeChecked()
  await expect(response(page, 'Social security verification').getByRole('radio', { name: 'Agree with Eavesly', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Social security verification correction reason' })).toBeVisible()
})

test('a stale Full QA source keeps the draft but cannot silently pair it with a refreshed token', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('stale-source')])
  await page.goto('/dashboard/alerts?status=awaiting_manager')
  await openAlert(page, 'stale-source')
  const reason = page.getByRole('textbox', { name: 'Explain your decision' })
  await reason.fill('No escalation is justified after reviewing this synthetic call.')
  await page.getByRole('combobox', { name: 'Why was the alert unnecessary?' }).selectOption('other')
  state.fullQaSourceFingerprints.set('stale-source', 'd'.repeat(64))
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText(/This review changed while you were working/)).toBeVisible()
  await expect(reason).toHaveValue('No escalation is justified after reviewing this synthetic call.')
  await expect(page.getByText('Saved source or revision changed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Reload review and discard draft' }).click()
  await expect(reason).toHaveValue('')
})

test('Full QA provenance never presents an unknown stamped hash as current, while unstamped legacy is reference-only', async ({ page }) => {
  const unknown = structuredClone(FULL_QA_RESULT)
  unknown._evaluation_provenance.prompt_sha256 = 'f'.repeat(64)
  const legacy = structuredClone(FULL_QA_RESULT) as Record<string, unknown>
  delete legacy._evaluation_provenance
  await reviewFixture(page, [alertRow('unknown-hash', { result_json: unknown }), alertRow('legacy-source', { result_json: legacy })])
  await page.goto('/dashboard/alerts?status=awaiting_manager')

  await openAlert(page, 'unknown-hash')
  await expect(page.getByText('Original rubric unavailable for this stamped hash; current field map only.')).toBeVisible()
  await page.getByText('Scoring policy & source', { exact: true }).click()
  await expect(page.getByText(/Original rubric unavailable for stamped hash/)).toContainText('f'.repeat(64))
  await expect(page.locator('article:visible').getByText('Original rule unavailable for this stamped hash.').first()).toBeVisible()
  await expect(page.getByText('Exact synthetic rule for Call recording disclosure.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close (Esc)' }).click()

  await openAlert(page, 'legacy-source')
  await expect(page.getByText('Original rubric unknown; current reference only.', { exact: true })).toBeVisible()
  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(consent.getByText('Exact synthetic rule for Credit pull consent.')).toBeHidden()
  await consent.getByText('View scoring rule', { exact: true }).click()
  await expect(consent.getByText('Exact synthetic rule for Credit pull consent.')).toBeVisible()
})

test('an unmapped approved finding fails closed rather than disappearing from recurrence totals', async ({ page }) => {
  await reviewFixture(page, [], { fullQaOccurrences: [{
    occurrence_kind: 'finding', call_id: 'unmapped', feedback_revision: 1,
    call_started_at: '2026-09-06T12:00:00Z', window_basis: 'call_started_at',
    status: 'approved', confirmed: true, category: 'unrecognized_category',
    review_saved_at: '2026-09-07T12:00:00Z',
  }] })
  await page.goto('/dashboard/team/agent%40example.test?start=2026-08-09&end=2026-09-07')
  await expect(page.getByText("Couldn't load Full QA recurrence")).toBeVisible()
  await expect(page.getByText('Confirmed occurrence rows (0)')).toHaveCount(0)
})

test('Agent profile reconciles approved findings and keeps pending, needs-context, and legacy rows uncounted', async ({ page }, testInfo) => {
  const occurrences = [
    { occurrence_kind: 'finding', call_id: 'dismissed-real', feedback_revision: 2, call_started_at: '2026-09-06T12:00:00Z', window_basis: 'call_started_at', status: 'approved', confirmed: true, finding_id: 'finding-1', category: 'compliance', related_criteria: ['credit_pull_consent'], summary: findingSummary, evidence: findingEvidence, action_taken: 'coached', action_details: actionDetails, review_saved_at: '2026-09-05T12:00:00Z', coaching_review_proxy_saved_at: '2026-09-05T12:00:00Z', coaching_timing: 'after_recorded_coached_review' },
    { occurrence_kind: 'finding', call_id: 'pending', feedback_revision: 1, call_started_at: '2026-09-07T12:00:00Z', window_basis: 'call_started_at', status: 'pending', confirmed: false, finding_id: 'finding-2', category: 'compliance', related_criteria: ['accurate_representations'], summary: 'Pending manager finding.', evidence: 'Pending synthetic evidence.', action_taken: 'follow_up_later', action_details: actionDetails, review_saved_at: '2026-09-07T13:00:00Z', coaching_review_proxy_saved_at: null, coaching_timing: 'no_prior_recorded_coaching' },
    { occurrence_kind: 'needs_context', call_id: 'uncertain', feedback_revision: 1, call_started_at: null, window_basis: 'alert_created_at_fallback', status: 'approved', confirmed: false, criterion_key: 'credit_pull_consent', reason: contextReason, review_saved_at: '2026-09-07T13:00:00Z', coaching_timing: 'unknown' },
    { occurrence_kind: 'legacy_unmapped', call_id: 'legacy', feedback_revision: 1, call_started_at: '2026-09-04T12:00:00Z', window_basis: 'call_started_at', status: 'legacy_unmapped', confirmed: false, review_saved_at: '2026-09-04T13:00:00Z', coaching_timing: 'unknown' },
  ]
  await reviewFixture(page, [], { fullQaOccurrences: occurrences })
  await page.goto('/dashboard/team/agent%40example.test?start=2026-08-09&end=2026-09-07')
  const panel = page.getByRole('region', { name: 'Approved Full QA recurrence' })
  await expect(panel).toContainText('Compliance: 1')
  await expect(panel).toContainText('Confirmed occurrence rows (1)')
  await expect(panel).toContainText('Not counted (3)')
  await expect(panel).toContainText('After recorded coached review (review-date proxy)')
  await expect(panel).toContainText('Needs context: credit_pull_consent')
  await expect(panel).toContainText('Legacy review — no criterion mapping')
  await expect(panel).toContainText('Call time missing; timing unknown')
  await page.screenshot({ path: testInfo.outputPath('agent-full-qa-recurrence-desktop.png'), fullPage: true, animations: 'disabled' })
})
