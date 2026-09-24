import { test, expect } from '@playwright/test'
import { alertRow, FULL_QA_RESULT, QUOTES, reviewFixture } from './review-fixture'

test('one flag list pairs saved failures with passages without losing contexts or inventing score responses', async ({ page }, testInfo) => {
  const consent = { quote: QUOTES[0], speaker: 'handling agent', process_step: 'Step 2 Credit Review', context: 'Saved criterion context.' }
  const guarantee = { quote: QUOTES[1], speaker: 'handling agent', process_step: 'Step 6 Debt Resolution', context: 'Saved red flag context.' }
  const unlinked = { quote: 'Please consider the implications.', speaker: 'handling agent', context: 'Saved call-level concern without a failed rule.' }
  const result = {
    ...FULL_QA_RESULT,
    call_overview: { manager_review_reason: 'Inspect the two saved failures in context.', manager_focus_areas: [
      { ...consent, context: 'Additional call-level context for consent.' },
      { ...guarantee, context: 'Additional call-level context for the guarantee.' }, unlinked,
    ] },
    compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard, credit_pull_consent_evidence: [consent], critical_red_flag_hits: [
      { red_flag: 'Outcome guarantee', evidence: [guarantee] },
      { red_flag: 'No credit pull consent', evidence: [{ ...consent, context: 'Additional red-flag context for consent.' }] },
    ] },
  }
  const state = await reviewFixture(page, [alertRow('consolidated', { result_json: result })])
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dashboard/alerts/consolidated/full_qa?status=all')
  const flags = page.getByRole('region', { name: 'What Eavesly flagged', exact: true })
  await expect(flags).toBeVisible()
  await expect(page.getByRole('heading', { name: /^(Flagged passages|Scores to review)$/ })).toHaveCount(0)
  await expect(flags.locator('blockquote:visible')).toHaveCount(6)
  const credit = flags.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(credit).toContainText('Saved criterion context.')
  await expect(credit).not.toContainText('Additional call-level context for consent.')
  await expect(credit).not.toContainText('Additional red-flag context for consent.')
  const outcome = flags.getByRole('article', { name: 'Outcome guarantee', exact: true })
  await expect(outcome.locator('blockquote')).toHaveText(QUOTES[1])
  await expect(outcome).toContainText('Saved red flag context.')
  await expect(outcome).not.toContainText('Additional call-level context for the guarantee.')
  await expect(outcome.getByRole('radio')).toHaveCount(3)
  const general = flags.getByRole('article', { name: 'General review focus', exact: true })
  await expect(general).toHaveCount(3)
  const additional = general.filter({ has: page.locator('blockquote').filter({ hasText: unlinked.quote }) })
  await expect(additional).toContainText('not linked to a specific claim')
  await expect(additional.getByRole('radio')).toHaveCount(3)
  const notes = flags.getByRole('article', { name: 'Accurate representations', exact: true })
  await expect(notes).toContainText('Synthetic inaccurate statement')
  await expect(notes.getByRole('button', { name: /Find in transcript|Listen/ })).toHaveCount(0)
  await outcome.getByRole('button', { name: /^Find in transcript/ }).focus()
  await page.keyboard.press('Enter')
  const transcript = page.getByRole('region', { name: 'Transcript context', exact: true })
  await expect(transcript.locator('mark[aria-current="true"]')).toHaveText(QUOTES[1])
  await page.screenshot({ path: testInfo.outputPath('consolidated-flags-desktop.png') })
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const views = page.getByRole('group', { name: 'Full QA workspace view' })
    await views.getByRole('button', { name: 'Review', exact: true }).click()
    await credit.getByRole('button', { name: /^Find in transcript/ }).click()
    await expect(transcript.locator('mark[aria-current="true"]')).toHaveText(QUOTES[0])
    await expect(transcript.locator('mark[aria-current="true"]')).toBeInViewport()
    await views.getByRole('button', { name: 'Review', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width === 375) { await outcome.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('consolidated-flags-mobile.png') }) }
  }
  await page.getByRole('button', { name: 'Your decision', exact: true }).click()
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.writes).toContainEqual(expect.objectContaining({ p_escalation_justified: true, p_corrections: [], p_findings: [] }))
  expect(errors).toEqual([])
})

test('a critical label stays on its exact supporting quote and duplicate passage contexts keep their source', async ({ page }) => {
  const first = { quote: QUOTES[0], speaker: 'handling agent', context: 'Criterion context for the first quote.' }
  const second = { quote: QUOTES[1], speaker: 'handling agent', context: 'Criterion context for the second quote.' }
  const result = { ...FULL_QA_RESULT,
    call_overview: { manager_review_reason: 'Inspect the supporting quote, not the neighboring quote.', manager_focus_areas: [
      { ...second, context: 'Call-level context for the second quote.' },
      { ...second, context: 'Another call-level context for the second quote.' },
    ] },
    compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard, credit_pull_consent_evidence: [first, second, { ...second, context: 'Another criterion context for the second quote.' }],
      critical_red_flag_hits: [{ red_flag: 'Outcome guarantee', evidence: [{ ...second, context: 'Flag-specific context for the second quote.' }] }],
    },
  }
  await reviewFixture(page, [alertRow('exact-association', { result_json: result })])
  await page.goto('/dashboard/alerts/exact-association/full_qa')
  const flags = page.getByRole('region', { name: 'What Eavesly flagged', exact: true })
  const credit = flags.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(credit.locator('figure')).toHaveCount(3)
  await expect(credit).toContainText('Criterion context for the first quote.')
  await expect(credit).toContainText('Criterion context for the second quote.')
  await expect(credit).toContainText('Another criterion context for the second quote.')
  await expect(credit).not.toContainText('Call-level context for the second quote.')
  await expect(credit).not.toContainText('Flag-specific context for the second quote.')
  const outcome = flags.getByRole('article', { name: 'Outcome guarantee', exact: true })
  await expect(outcome).toContainText('Flag-specific context for the second quote.')
  await expect(outcome).not.toContainText('Another criterion context for the second quote.')
  const general = flags.getByRole('article', { name: 'General review focus', exact: true })
  await expect(general).toHaveCount(2)
  await expect(general.nth(1)).toContainText('Another call-level context for the second quote.')
})

test('same words from a different speaker stay unlinked and a flag without an excerpt stays honest', async ({ page }) => {
  const result = { ...FULL_QA_RESULT,
    call_overview: { manager_review_reason: 'Inspect saved source attribution.', manager_focus_areas: [{ quote: QUOTES[0], speaker: 'contact', context: 'Customer statement, not agent evidence.' }] },
    compliance_scorecard: { ...FULL_QA_RESULT.compliance_scorecard,
      credit_pull_consent_evidence: [{ quote: QUOTES[0], speaker: 'handling agent' }],
      critical_red_flag_hits: [{ red_flag: 'Outcome guarantee', evidence: [] }, { red_flag: 42, evidence: null }],
    },
  }
  const state = await reviewFixture(page, [alertRow('unlinked', { result_json: result })])
  await page.goto('/dashboard/alerts/unlinked/full_qa')
  const flags = page.getByRole('region', { name: 'What Eavesly flagged', exact: true })
  const credit = flags.getByRole('article', { name: 'Credit pull consent', exact: true })
  await expect(credit).not.toContainText('Customer statement, not agent evidence.')
  await expect(flags.getByRole('article', { name: 'General review focus', exact: true })).toContainText('Customer statement, not agent evidence.')
  const guarantee = flags.getByRole('article', { name: 'Outcome guarantee', exact: true })
  await expect(guarantee).toContainText('No readable evidence was saved')
  await expect(guarantee.getByRole('button', { name: /Find in transcript|Listen/ })).toHaveCount(0)
  await expect(guarantee.getByRole('radio')).toHaveCount(0)
  expect(state.writes).toEqual([])
})
