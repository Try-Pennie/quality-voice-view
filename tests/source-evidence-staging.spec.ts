import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { parseFullQaEvidenceReferences, parseFullQaSourceCandidate, projectFullQaEvidence } from '../src/lib/full-qa-evidence'
import { alertRow, FULL_QA_CRITERIA, reviewFixture } from './review-fixture'

const mixedSource: unknown = JSON.parse(readFileSync(new URL('./fixtures/source-evidence-candidate-mixed.json', import.meta.url), 'utf8'))

function copy<T>(value: T): T {
  return structuredClone(value)
}

function sourceWithTurns(rows: readonly (readonly [string, string, 'handling_agent' | 'customer'])[], citedOrdinals: readonly number[]) {
  const fingerprint = 'd'.repeat(64)
  const transcript = rows.map(([speaker, text]) => `[${speaker}]: ${text}`).join('\n')
  let offset = 0
  const turns = rows.map(([sourceLabel, text, role], ordinal) => {
    const rawText = `[${sourceLabel}]: ${text}`
    const turn = {
      ordinal, raw_start: offset, raw_end: offset + rawText.length, raw_text: rawText,
      text_start: offset + sourceLabel.length + 4, text_end: offset + rawText.length, text,
      speaker: { source_label: sourceLabel, role, attribution_basis: 'caller_supplied_not_identity_proof' },
      turn_id: `turn_v1_${fingerprint}_${String(ordinal).padStart(6, '0')}`,
    }
    offset += rawText.length + 1
    return turn
  })
  const findings = citedOrdinals.map((ordinal, index) => ({
    claim_id: `fqac1_${String(index + 1).repeat(64)}`,
    claim: { rule_key: 'call_recording_disclosure', finding_type: 'statement', text: `Disclosure occurrence ${index + 1} is cited.`, interpretation: 'unverified_ai_assessment_not_source_evidence' },
    evidence_occurrences: [{ evidence_id: `fqae1_${String(index + 5).repeat(64)}`, supporting_turn_ids: [turns[ordinal].turn_id] }],
    reviewed_source: null,
  }))
  return { source_candidate: { transcript, candidate: {
    metadata: { schema_version: 'full_qa_evidence_candidate_v1', index_version: 'full_qa_transcript_index_v1', prompt_version: 'full_qa_evidence_candidate_prompt_v1',
      prompt_sha256: 'a'.repeat(64), rubric_version: 'full_qa_high_risk_subset_v1', model: { provider: 'synthetic', model_id: 'source-turn-check', declared_by: 'caller' },
      provenance: 'unverified_submission', prompt_role: 'contract_reference_not_execution_attestation' },
    source: { index_version: 'full_qa_transcript_index_v1', source_id: 'source-turn-check', source_revision: '1', source_fingerprint: fingerprint,
      transcript_sha256: 'b'.repeat(64), offset_unit: 'utf16_code_unit', raw_start: 0, raw_end: transcript.length, turns },
    findings,
  } } }
}

function repeatedSource() {
  return sourceWithTurns([
    ['handling agent', 'This call is recorded.', 'handling_agent'],
    ['contact', 'Thank you.', 'customer'],
    ['handling agent', 'This call is recorded.', 'handling_agent'],
    ['contact', 'Understood.', 'customer'],
  ], [0, 2])
}

test('source candidate parser rejects changed versions, omitted turns, forged references, and bad offsets', () => {
  const parsed = parseFullQaSourceCandidate(mixedSource)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok || !parsed.value) return
  expect(parsed.value.findings.map(finding => finding.findingType)).toEqual(['statement', 'statement', 'omission'])
  const references = projectFullQaEvidence(mixedSource, FULL_QA_CRITERIA.map(item => ({ key: item.key, label: item.label, evidencePath: item.evidence_path })), 'c'.repeat(64))
  expect(references).toHaveLength(3)
  expect(references[0]).toMatchObject({ claimKind: 'source_finding', evidenceKind: 'source_passages', sourcePath: 'source_candidate.candidate.findings[0].evidence_occurrences[0]' })
  expect(references[0].sourcePassages.map(turn => turn.ordinal)).toEqual([2, 4])
  expect(references[2]).toMatchObject({ evidenceKind: 'omission', sourcePath: 'source_candidate.candidate.findings[2].reviewed_source', sourcePassages: [] })

  const coercibleRole: unknown = JSON.parse(JSON.stringify(mixedSource), (key, value: unknown) => key === 'role' ? [value] : value)
  expect(parseFullQaSourceCandidate(coercibleRole).ok).toBe(false)
  expect(parseFullQaEvidenceReferences([{ reference_id: 'test', claim_kind: 'general_focus', claim_key: '0',
    claim_label: 'Test', source_path: 'test', evidence_kind: ['note'], text: 'Note', speaker: null,
    context: null, process_step: null }]).ok).toBe(false)

  const changedVersion = copy(mixedSource)
  changedVersion.source_candidate.candidate.metadata.schema_version = 'future'
  expect(parseFullQaSourceCandidate(changedVersion).ok).toBe(false)
  const omittedTurn = copy(mixedSource)
  omittedTurn.source_candidate.candidate.source.turns.splice(3, 1)
  expect(parseFullQaSourceCandidate(omittedTurn).ok).toBe(false)
  const forgedReference = copy(mixedSource)
  forgedReference.source_candidate.candidate.findings[0].evidence_occurrences[0].supporting_turn_ids[0] = `turn_v1_${'0'.repeat(64)}_000002`
  expect(parseFullQaSourceCandidate(forgedReference).ok).toBe(false)
  const reversedReference = copy(mixedSource)
  reversedReference.source_candidate.candidate.findings[0].evidence_occurrences[0].supporting_turn_ids.reverse()
  expect(parseFullQaSourceCandidate(reversedReference).ok).toBe(false)
  const badOffset = copy(mixedSource)
  badOffset.source_candidate.candidate.source.turns[2].text_start += 1
  expect(parseFullQaSourceCandidate(badOffset).ok).toBe(false)
})

test('manager reviews exact candidate occurrences, omission, save/reload/clear, and immutable source on mobile', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('source-evidence-mixed', { result_json: mixedSource })], {
    transcriptionQaRows: [{ original_transcript: '[handling agent]: Independently refreshed text must not appear.', recording_link: null }],
  })
  await page.goto('/dashboard/alerts/source-evidence-mixed/full_qa?status=all')

  await expect(page.getByRole('complementary', { name: 'Experimental source review' })).toContainText('Six-rule synthetic trial')
  await expect(page.getByRole('region', { name: 'Six-rule experimental findings' })).toBeVisible()
  await expect(page.getByRole('button', { name: /View full scorecard/ })).toHaveCount(0)
  await expect(page.getByText('Suggest a rule change', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Scoring policy & source', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Independently refreshed text must not appear.')).toHaveCount(0)
  await expect(page.getByText('Immutable source saved with this review')).toBeVisible()

  const firstFinding = page.getByRole('article', { name: 'Outcome guarantee finding 1', exact: true })
  const secondFinding = page.getByRole('article', { name: 'Outcome guarantee finding 2', exact: true })
  const omissionFinding = page.getByRole('article', { name: 'Call recording disclosure finding 3', exact: true })
  const firstOccurrence = firstFinding.getByRole('group', { name: 'Outcome guarantee evidence 1', exact: true })
  const secondOccurrence = secondFinding.getByRole('group', { name: 'Outcome guarantee evidence 1', exact: true })
  const omission = omissionFinding.getByRole('group', { name: 'Call recording disclosure evidence 1', exact: true })
  await expect(firstOccurrence.locator('blockquote')).toHaveText(['We guarantee that your credit', 'will be fully restored in twelve months.'])
  await expect(firstOccurrence).toContainText('Listen unavailable — candidate timing is not verified')
  await expect(omission).toContainText('No passage is claimed')
  await expect(omission.getByRole('button', { name: /Find|Listen/ })).toHaveCount(0)

  await firstOccurrence.getByRole('button', { name: 'Find exact source turns', exact: true }).click()
  const transcript = page.getByRole('region', { name: 'Transcript workspace', exact: true })
  await expect(transcript.locator('mark[data-evidence-reference]')).toHaveText(['We guarantee that your credit', 'will be fully restored in twelve months.'])
  await expect(transcript.getByText('Really?', { exact: true })).toBeVisible()
  await expect(transcript.getByText('Really?', { exact: true }).locator('mark')).toHaveCount(0)
  await transcript.getByRole('button', { name: 'Back to evidence', exact: true }).click()
  await expect(firstOccurrence).toBeFocused()

  await firstOccurrence.getByRole('radio', { name: 'Evidence: Correct', exact: true }).check()
  await secondOccurrence.getByRole('radio', { name: 'Evidence: Incorrect', exact: true }).check()
  await omission.getByRole('radio', { name: 'Evidence: Partly correct', exact: true }).check()
  await omission.getByRole('button', { name: 'Add comment', exact: true }).click()
  await omission.getByRole('textbox', { name: 'Call recording disclosure evidence comment', exact: true }).fill('Scoped to the supplied source only.')
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.fullQaReviews.get('source-evidence-mixed')?.evidence_feedback).toHaveLength(3)

  await page.goto('/dashboard/alerts/source-evidence-mixed/full_qa?status=all')
  await expect(firstOccurrence.getByRole('radio', { name: 'Evidence: Correct', exact: true })).toBeChecked()
  await expect(secondOccurrence.getByRole('radio', { name: 'Evidence: Incorrect', exact: true })).toBeChecked()
  await expect(omission.getByText('Scoped to the supplied source only.', { exact: true })).toBeVisible()
  await omission.getByRole('button', { name: 'Clear assessment response', exact: true }).click()
  await page.getByRole('button', { name: 'Update review', exact: true }).click()
  await expect(page.getByText('Full QA review saved', { exact: true })).toBeVisible()
  expect(state.fullQaReviews.get('source-evidence-mixed')?.evidence_feedback).toHaveLength(2)

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Six-rule experimental findings' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a changed candidate source synchronously drops the old selected occurrence', async ({ page }) => {
  const state = await reviewFixture(page, [alertRow('source-evidence-change', { result_json: mixedSource })])
  await page.goto('/dashboard/alerts/source-evidence-change/full_qa?status=all')
  const first = page.getByRole('article', { name: 'Outcome guarantee finding 1', exact: true })
  await first.getByRole('button', { name: 'Find exact source turns', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Selected evidence', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to evidence', exact: true }).click()
  await first.getByRole('radio', { name: 'Evidence: Correct', exact: true }).check()
  await page.getByRole('radio', { name: 'Yes, the alert was warranted', exact: true }).check()
  state.fullQaSources.set('source-evidence-change', repeatedSource())
  state.fullQaSourceFingerprints.set('source-evidence-change', 'e'.repeat(64))
  await page.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(page.getByText(/saved source or revision changed/i)).toBeVisible()
  await expect(page.getByRole('article', { name: 'Call recording disclosure finding 1', exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Selected evidence', exact: true })).toHaveCount(0)
  await expect(page.getByText('We guarantee that your credit', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Transcript workspace', exact: true }).getByText('This call is recorded.', { exact: true })).toHaveCount(2)
})

test('validated three-turn source with a long speaker label navigates without the legacy transcript heuristic', async ({ page }) => {
  const source = sourceWithTurns([
    ['handling agent with a deliberately long source label', 'Opening source turn.', 'handling_agent'],
    ['contact', 'Middle source turn.', 'customer'],
    ['handling agent with a deliberately long source label', 'Cited final source turn.', 'handling_agent'],
  ], [2])
  await reviewFixture(page, [alertRow('source-evidence-three-turn', { result_json: source })])
  await page.goto('/dashboard/alerts/source-evidence-three-turn/full_qa?status=all')
  await page.getByRole('article', { name: 'Call recording disclosure finding 1', exact: true })
    .getByRole('button', { name: 'Find exact source turns', exact: true }).click()
  const transcript = page.getByRole('region', { name: 'Transcript workspace', exact: true })
  await expect(transcript.locator('li')).toHaveCount(3)
  await expect(transcript.locator('li').nth(2).locator('mark')).toHaveText('Cited final source turn.')
})

test('repeated source text navigates only to the cited ordinal', async ({ page }) => {
  const source = repeatedSource()
  await reviewFixture(page, [alertRow('source-evidence-repeated', { result_json: source })])
  await page.goto('/dashboard/alerts/source-evidence-repeated/full_qa?status=all')
  const second = page.getByRole('article', { name: 'Call recording disclosure finding 2', exact: true })
  await second.getByRole('button', { name: 'Find exact source turns', exact: true }).click()
  const transcript = page.getByRole('region', { name: 'Transcript workspace', exact: true })
  await expect(transcript.getByText('This call is recorded.', { exact: true })).toHaveCount(2)
  const marked = transcript.locator('mark[data-evidence-reference]')
  await expect(marked).toHaveCount(1)
  await expect(marked).toHaveText('This call is recorded.')
  await expect(transcript.locator('li').nth(0).locator('mark')).toHaveCount(0)
  await expect(transcript.locator('li').nth(2).locator('mark')).toHaveCount(1)
})
