// Self-check for the achieve-portal server boundary logic — no test runner in
// this repo by design. Run: npx tsx supabase/functions/achieve-portal/portal-logic.check.ts
import assert from 'node:assert'
import {
  ACHIEVE_MODULE_NAME,
  MAX_TRANSCRIPT_CHARS,
  buildPortalRow,
  isCompetitorTransfer,
  isQueueRow,
  isWithheld,
  sanitizeResultJson,
  trimTranscript,
  validateFeedback,
} from './portal-logic'

// --- trimTranscript ----------------------------------------------------------

const transcript = 'line0\nline1\nline2\nline3'
const goodSeg = { transcript_segment: { start_line: 2, segmentation_confidence: 'high' } }

// Trims from the segmenter's 0-based start_line.
assert.strictEqual(trimTranscript(transcript, goodSeg), 'line2\nline3')
// Negative start_line clamps to 0.
assert.strictEqual(trimTranscript(transcript, { transcript_segment: { start_line: -3 } }), transcript)
// All unreliable-boundary cases return '' (never an unbounded transcript):
assert.strictEqual(trimTranscript(transcript, {}), '') // no segment metadata
assert.strictEqual(trimTranscript(transcript, { transcript_segment: {} }), '') // no start_line
assert.strictEqual(trimTranscript(transcript, { transcript_segment: { start_line: 0, used_full_transcript_fallback: true } }), '')
assert.strictEqual(trimTranscript(transcript, { ...goodSeg, grading_skipped: true }), '')
assert.strictEqual(trimTranscript(transcript, { transcript_segment: { start_line: 0, segment_found: false } }), '')
assert.strictEqual(trimTranscript(null, goodSeg), '')
// Hard cap: even a "good" segment never ships more than MAX_TRANSCRIPT_CHARS.
const huge = 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1000)
const capped = trimTranscript(huge, { transcript_segment: { start_line: 0 } })
assert.ok(capped.length <= MAX_TRANSCRIPT_CHARS + 30)
assert.ok(capped.endsWith('[transcript truncated]'))

// --- sanitizeResultJson / isWithheld ------------------------------------------

const fallbackResult = {
  script_version: 'fdr_wholesale_db_pilot_v1',
  script_adherence: { violation_reason: 'SENSITIVE', key_evidence_quotes: ['SENSITIVE'] },
  assessment_confidence: { rationale: 'SENSITIVE' },
  transcript_segment: { used_full_transcript_fallback: true, marker: 'SENSITIVE' },
}
const sanitizedFallback = sanitizeResultJson(fallbackResult)
assert.ok(isWithheld(fallbackResult))
assert.strictEqual(sanitizedFallback.transcript_segment.used_full_transcript_fallback, true)
assert.strictEqual(sanitizedFallback.script_version, 'fdr_wholesale_db_pilot_v1')
assert.ok(!JSON.stringify(sanitizedFallback).includes('SENSITIVE'))

const skippedResult = { grading_skipped: true, skip_reason: 'transfer_leg_too_short', call_notes: 'SENSITIVE' }
const sanitizedSkipped = sanitizeResultJson(skippedResult)
assert.ok(isWithheld(skippedResult))
assert.strictEqual(sanitizedSkipped.grading_skipped, true)
assert.strictEqual(sanitizedSkipped.skip_reason, 'transfer_leg_too_short')
assert.ok(!JSON.stringify(sanitizedSkipped).includes('SENSITIVE'))

// Graded rows pass through untouched.
const graded = { script_adherence: { overall_script_adherence: 'substantial' }, transcript_segment: { start_line: 1 } }
assert.deepStrictEqual(sanitizeResultJson(graded), graded)
assert.ok(!isWithheld(graded))

// --- isQueueRow ----------------------------------------------------------------

// A graded violation belongs in the Needs-review queue.
assert.strictEqual(isQueueRow({ has_violation: true, result_json: graded }), true)
// No violation → not in the queue.
assert.strictEqual(isQueueRow({ has_violation: false, result_json: graded }), false)
// Skipped grade is audit-only even if flagged has_violation.
assert.strictEqual(isQueueRow({ has_violation: true, result_json: skippedResult }), false)
// Pre-hardening full-transcript fallback is withheld → audit-only.
assert.strictEqual(isQueueRow({ has_violation: true, result_json: fallbackResult }), false)

// --- isCompetitorTransfer ------------------------------------------------------

// A call mis-transferred to Beyond Finance (Achieve's competitor) is dropped
// from the portal entirely — it must not appear in alerts or all_calls.
const competitorResult = { grading_skipped: true, skip_reason: 'competitor_transfer' }
assert.strictEqual(isCompetitorTransfer(competitorResult), true)
// Ordinary grading_skipped rows (e.g. no transfer leg) are NOT competitor
// transfers — they stay visible in all_calls as "Not graded", as today.
assert.strictEqual(isCompetitorTransfer({ grading_skipped: true, skip_reason: 'no_transfer_leg' }), false)
assert.strictEqual(isCompetitorTransfer(skippedResult), false)
assert.strictEqual(isCompetitorTransfer(graded), false)
assert.strictEqual(isCompetitorTransfer(null), false)
assert.strictEqual(isCompetitorTransfer({}), false)
// A competitor-transfer row is still withheld (its free text stays server-side)
// on the paths that do surface it, but the list handler filters it out first.
assert.ok(isWithheld(competitorResult))

// --- buildPortalRow ------------------------------------------------------------

const withheldRow = buildPortalRow(
  {
    id: 7,
    created_at: '2026-07-01T00:00:00Z',
    call_id: 'CA123',
    module_name: ACHIEVE_MODULE_NAME,
    agent_email: 'internal@pennie.com',
    sfdc_lead_id: 'LEAD1',
    call_summary: 'SENSITIVE summary referencing Pennie content',
    result_json: fallbackResult,
  },
  { call_id: 'CA123', original_transcript: transcript, recording_link: 'https://rec' },
  undefined,
)
// Internal identifiers and withheld content never leave the server.
assert.strictEqual(withheldRow.agent_email, null)
assert.strictEqual(withheldRow.sfdc_lead_id, null)
assert.strictEqual(withheldRow.call_summary, null)
assert.strictEqual(withheldRow.trimmed_transcript, null)
assert.strictEqual(withheldRow.recording_link, 'https://rec')
assert.ok(!JSON.stringify(withheldRow).includes('SENSITIVE'))

const gradedRow = buildPortalRow(
  {
    module_result_id: 8,
    alert_created_at: '2026-07-02T00:00:00Z',
    call_id: 'CA456',
    module_name: ACHIEVE_MODULE_NAME,
    has_violation: true,
    call_summary: 'ok summary',
    result_json: { ...graded, transcript_segment: { start_line: 2 } },
  },
  { call_id: 'CA456', original_transcript: transcript },
  { id: 1, call_id: 'CA456', module_name: ACHIEVE_MODULE_NAME, manager_email: 'r@a.com', accurate: true, action_taken: 'coached', inaccuracy_reason: null, comment: 'note', reviewed_at: '2026-07-03T00:00:00Z' },
)
assert.strictEqual(gradedRow.trimmed_transcript, 'line2\nline3')
assert.strictEqual(gradedRow.call_summary, 'ok summary')
assert.strictEqual(gradedRow.is_reviewed, true)
assert.strictEqual(gradedRow.feedback_by, 'r@a.com')

// --- validateFeedback -----------------------------------------------------------

const okAccurate = validateFeedback({ call_id: ' CA1 ', reviewer_email: 'a@b.co', accurate: true, action_taken: 'coached', comment: ' hi ' })
assert.ok(okAccurate.ok)
assert.strictEqual(okAccurate.ok && okAccurate.payload.call_id, 'CA1')
assert.strictEqual(okAccurate.ok && okAccurate.payload.module_name, ACHIEVE_MODULE_NAME)
assert.strictEqual(okAccurate.ok && okAccurate.payload.inaccuracy_reason, null)
assert.strictEqual(okAccurate.ok && okAccurate.payload.comment, 'hi')

const okInaccurate = validateFeedback({ call_id: 'CA1', reviewer_email: 'a@b.co', accurate: false, inaccuracy_reason: 'covered_not_verbatim' })
assert.ok(okInaccurate.ok && okInaccurate.payload.action_taken === null)
assert.ok(okInaccurate.ok && okInaccurate.payload.inaccuracy_reason === 'covered_not_verbatim')

// Defaults when the choice is omitted (mirrors the form's fallbacks).
const defaulted = validateFeedback({ call_id: 'CA1', reviewer_email: 'a@b.co', accurate: true })
assert.ok(defaulted.ok && defaulted.payload.action_taken === 'no_action_needed')

// Rejections.
assert.strictEqual(validateFeedback({ reviewer_email: 'a@b.co', accurate: true }).ok, false)
assert.strictEqual(validateFeedback({ call_id: 'CA1', reviewer_email: 'nope', accurate: true }).ok, false)
assert.strictEqual(validateFeedback({ call_id: 'CA1', reviewer_email: 'a@b.co', accurate: 'yes' }).ok, false)
assert.strictEqual(validateFeedback({ call_id: 'CA1', reviewer_email: 'a@b.co', accurate: true, action_taken: 'DROP TABLE' }).ok, false)
assert.strictEqual(validateFeedback({ call_id: 'CA1', reviewer_email: 'a@b.co', accurate: false, inaccuracy_reason: 'bogus' }).ok, false)
assert.strictEqual(validateFeedback({ call_id: 'CA1', reviewer_email: 'a@b.co', accurate: true, comment: 'x'.repeat(4001) }).ok, false)

console.log('portal-logic.check.ts: all assertions passed')
