import { test, expect } from '@playwright/test'
import { projectFullQaEvidence } from '../src/lib/full-qa-evidence'
import { alertRow, FULL_QA_RESULT, QUOTES, reviewFixture } from './review-fixture'

const sameQuote = QUOTES[0]

function evidenceResult() {
  return {
    ...FULL_QA_RESULT,
    call_overview: {
      manager_review_reason: 'Review each saved claim and evidence association independently.',
      manager_focus_areas: [{ quote: sameQuote, speaker: 'handling agent', context: 'General focus with no saved claim link.' }],
    },
    compliance_scorecard: {
      ...FULL_QA_RESULT.compliance_scorecard,
      credit_pull_consent_evidence: [{ quote: sameQuote, speaker: 'handling agent', context: 'Consent claim context.' }],
      accurate_representations_violations: [{ quote: sameQuote, speaker: 'handling agent', context: 'Representation claim context.' }],
      no_misleading_claims: 'fail',
      misleading_claims_violations: [{ quote: QUOTES[1], speaker: 'handling agent', context: 'A different claim and quote.' }],
      social_security_verification: 'fail',
      social_security_verification_evidence: ['Saved QA note only; this is not a transcript quote.'],
      critical_red_flag_hits: [{ red_flag: 'Claim without saved evidence', evidence: [] }],
    },
  }
}

test('client evidence projection keeps malformed and scalar source provenance exact', () => {
  const references = projectFullQaEvidence({
    edge: [{ quote: '\n\t Quote \r', speaker: '\tAgent\n', context: '\n Context\t' }, { quote: 42, context: { not: 'text' } }, true, [1], ' \t\n'],
    scalar: 'Scalar note', null_value: null, empty_array: [], empty_string: ' \t\n',
    compliance_scorecard: { critical_red_flag_hits: [{ red_flag: '\n Scalar flag\t', evidence: { quote: '\tFlag quote\n' } }] },
    call_overview: { manager_focus_areas: null },
  }, [
    { key: 'edge', label: 'Edge', evidencePath: 'edge' },
    { key: 'scalar', label: 'Scalar', evidencePath: 'scalar' },
    { key: 'null_value', label: 'Null', evidencePath: 'null_value' },
    { key: 'empty_array', label: 'Empty array', evidencePath: 'empty_array' },
    { key: 'empty_string', label: 'Empty string', evidencePath: 'empty_string' },
  ], 'a'.repeat(64))

  expect(references).toHaveLength(10)
  expect(references.filter(item => item.claimKind === 'general_focus')).toEqual([])
  expect(references.find(item => item.sourcePath === 'edge[0]')).toMatchObject({ evidenceKind: 'quote', text: 'Quote', speaker: 'Agent', context: 'Context' })
  for (const path of ['edge[1]', 'edge[2]', 'edge[3]', 'edge[4]']) {
    expect(references.find(item => item.sourcePath === path)?.evidenceKind).toBe('missing')
  }
  expect(references.find(item => item.claimKey === 'scalar')).toMatchObject({ sourcePath: 'scalar', evidenceKind: 'note', text: 'Scalar note' })
  expect(references.find(item => item.claimKey === 'null_value')).toMatchObject({ sourcePath: 'null_value[missing]', evidenceKind: 'missing' })
  expect(references.find(item => item.claimKey === 'empty_array')).toMatchObject({ sourcePath: 'empty_array[missing]', evidenceKind: 'missing' })
  expect(references.find(item => item.claimKey === 'empty_string')).toMatchObject({ sourcePath: 'empty_string', evidenceKind: 'missing' })
  expect(references.find(item => item.claimKind === 'critical_flag')).toMatchObject({
    sourcePath: 'compliance_scorecard.critical_red_flag_hits[0].evidence', claimLabel: 'Scalar flag', text: 'Flag quote',
  })
})

test('passage judgments stay independent, optional, source-bound, and survive save failures', async ({ page, browser }, testInfo) => {
  const state = await reviewFixture(page, [alertRow('evidence-feedback', { result_json: evidenceResult() })])
  await page.goto('/dashboard/alerts/evidence-feedback/full_qa?status=all')

  const consent = page.getByRole('article', { name: 'Credit pull consent', exact: true })
  const representation = page.getByRole('article', { name: 'Accurate representations', exact: true })
  const consentEvidence = consent.getByRole('group', { name: 'Credit pull consent evidence 1', exact: true })
  const representationEvidence = representation.getByRole('group', { name: 'Accurate representations evidence 1', exact: true })
  const differentEvidence = page.getByRole('article', { name: 'No misleading claims', exact: true })
    .getByRole('group', { name: 'No misleading claims evidence 1', exact: true })
  await expect(consentEvidence.locator('blockquote')).toHaveText(sameQuote)
  await expect(representationEvidence.locator('blockquote')).toHaveText(sameQuote)
  await expect(consentEvidence.getByRole('radio', { name: 'Evidence: Correct', exact: true })).not.toBeChecked()
  await expect(representationEvidence.getByRole('radio', { name: 'Evidence: Correct', exact: true })).not.toBeChecked()
  await expect(consent.getByRole('radio')).toHaveCount(3)
  await expect(consent.locator('summary').filter({ hasText: 'Optional criterion score adjustment' })).toBeVisible()

  const note = page.getByRole('article', { name: 'Social security verification', exact: true })
  await expect(note).toContainText('Saved note — not a transcript quote')
  await expect(note).toContainText('Saved QA note only; this is not a transcript quote.')
  await expect(note.getByRole('button', { name: /Find in transcript|Listen/ })).toHaveCount(0)

  const missing = page.getByRole('article', { name: 'Claim without saved evidence', exact: true })
  await expect(missing).toContainText('No readable evidence was saved for this claim')
  await expect(missing.getByRole('radio')).toHaveCount(0)
  await expect(missing).toContainText('no readable evidence was saved')

  const general = page.getByRole('article', { name: 'General review focus', exact: true })
  await expect(general).toContainText('not linked to a specific claim')
  const generalEvidence = general.getByRole('group', { name: 'General review focus (no specific claim saved) evidence 1', exact: true })
  await expect(generalEvidence).toContainText('Was Eavesly right to flag this passage for review?')
  await expect(generalEvidence).not.toContainText('support Eavesly’s claim')

  await page.getByRole('button', { name: /View full scorecard/ }).click()
  const disclosure = page.getByRole('article', { name: 'Call recording disclosure', exact: true })
  const disclosureEvidence = disclosure.getByRole('group', { name: 'Call recording disclosure evidence 1', exact: true })
  await disclosureEvidence.getByRole('radio', { name: 'Evidence: Correct', exact: true }).check()
  await page.getByRole('button', { name: 'Show only items to check', exact: true }).click()
  await expect(disclosure).toBeVisible()

  await consentEvidence.getByRole('radio', { name: 'Evidence: Correct', exact: true }).check()
  await representationEvidence.getByRole('radio', { name: 'Evidence: Incorrect', exact: true }).check()
  await representationEvidence.getByRole('textbox', { name: 'Accurate representations evidence comment', exact: true }).fill('  x  ')
  await differentEvidence.getByRole('radio', { name: 'Evidence: Partly correct', exact: true }).check()
  await generalEvidence.getByRole('radio', { name: 'Evidence: Partly correct', exact: true }).check()
  await generalEvidence.getByRole('textbox', { name: 'General review focus (no specific claim saved) evidence comment', exact: true }).fill('   ')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await consentEvidence.screenshot({ path: testInfo.outputPath('evidence-feedback-card-desktop.png') })

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await consentEvidence.getByRole('radio', { name: 'Evidence: Correct', exact: true }).focus()
  await page.keyboard.press('Space')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('evidence-feedback-mobile-375.png'), fullPage: true })

  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  const firstWrite = state.writes.find(write => write && typeof write === 'object' && 'p_evidence_feedback' in write)
  expect(firstWrite).toMatchObject({ p_corrections: [], p_findings: [], p_evidence_feedback: [
    expect.objectContaining({ disposition: 'correct', comment: null }),
    expect.objectContaining({ disposition: 'correct', comment: null }),
    expect.objectContaining({ disposition: 'incorrect', comment: 'x' }),
    expect.objectContaining({ disposition: 'partly_correct', comment: null }),
    expect.objectContaining({ disposition: 'partly_correct', comment: null }),
  ] })
  const saved = state.fullQaReviews.get('evidence-feedback')
  expect(saved?.evidence_feedback).toHaveLength(5)
  await expect(representationEvidence.getByRole('textbox', { name: 'Accurate representations evidence comment', exact: true })).toHaveValue('x')
  await expect(generalEvidence.getByRole('textbox', { name: 'General review focus (no specific claim saved) evidence comment', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Update review', exact: true })).toBeDisabled()
  await expect(page.getByRole('contentinfo').getByRole('status')).toContainText('No unsaved review changes.')

  await page.goto('/dashboard/alerts/evidence-feedback/full_qa?status=all')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(disclosure).toBeVisible()
  await expect(disclosureEvidence.getByRole('radio', { name: 'Evidence: Correct', exact: true })).toBeChecked()
  await expect(consentEvidence.getByRole('radio', { name: 'Evidence: Correct', exact: true })).toBeChecked()
  await expect(representationEvidence.getByRole('radio', { name: 'Evidence: Incorrect', exact: true })).toBeChecked()
  await expect(representationEvidence.getByRole('textbox', { name: 'Accurate representations evidence comment', exact: true })).toHaveValue('x')
  await generalEvidence.getByRole('button', { name: 'Clear passage response', exact: true }).click()
  state.failFeedback = true
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect(page.getByText(/Couldn't save Full QA review/)).toBeVisible()
  await expect(generalEvidence.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(representationEvidence.getByRole('textbox', { name: 'Accurate representations evidence comment', exact: true })).toHaveValue('x')
  state.failFeedback = false
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.fullQaReviews.get('evidence-feedback')?.evidence_feedback).toHaveLength(4)

  const approver = await browser.newPage()
  await reviewFixture(approver, state.rows, { god: true, email: 'director@example.test', fullQaReviews: state.fullQaReviews })
  await approver.goto('/dashboard/alerts/evidence-feedback/full_qa')
  const outcome = approver.getByRole('region', { name: 'Manager’s review', exact: true })
  await expect(outcome).toContainText('Passage-level responses (4)')
  await expect(outcome).toContainText('Accurate representations: Incorrect — x')
  await expect(approver.getByRole('group', { name: 'Credit pull consent evidence 1', exact: true })).toContainText('Saved passage response')
  await expect(approver.getByRole('group', { name: 'Claim without saved evidence evidence 1', exact: true }).getByRole('radio')).toHaveCount(0)
  await approver.close()
})
