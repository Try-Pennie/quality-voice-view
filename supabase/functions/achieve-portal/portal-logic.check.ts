// Self-check for the achieve-portal server boundary logic — no test runner in
// this repo by design. Run: npx tsx supabase/functions/achieve-portal/portal-logic.check.ts
import assert from 'node:assert'
import {
  ACHIEVE_MODULE_NAME,
  MAX_TRANSCRIPT_CHARS,
  buildAgentFeedbackView,
  buildPortalListRow,
  buildPortalRow,
  canSubmitPortalFeedback,
  feedbackLeadershipSnapshotsAgree,
  isAuditOnlyResult,
  isCompetitorTransfer,
  isQueueRow,
  isWithheld,
  parseWelcomeAgentLookupRow,
  partitionPortalRows,
  sanitizeResultJson,
  trimTranscript,
  validateFeedback,
} from './portal-logic'

// --- trimTranscript ----------------------------------------------------------

const transcript = 'line0\nline1\nline2\nline3'
const goodSeg = { transcript_segment: { start_line: 2, segmentation_confidence: 'high' } }

// Legacy rows without end_line trim from the segmenter's 0-based start_line.
assert.strictEqual(trimTranscript(transcript, goodSeg), 'line2\nline3')
// New rows are bounded at the inclusive 0-based end_line.
assert.strictEqual(
  trimTranscript(transcript, { transcript_segment: { start_line: 1, end_line: 2, segmentation_confidence: 'high' } }),
  'line1\nline2',
)
// Invalid boundaries fail closed instead of returning unrelated transcript text.
assert.strictEqual(trimTranscript(transcript, { transcript_segment: { start_line: 2, end_line: 1 } }), '')
assert.strictEqual(trimTranscript(transcript, { transcript_segment: { start_line: 1, end_line: 99 } }), '')
// Leading blank lines remain part of the segmenter's original coordinate system.
assert.strictEqual(
  trimTranscript(`\n${transcript}`, { transcript_segment: { start_line: 2, end_line: 3 } }),
  'line1\nline2',
)
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
// Explicit historical backfills are audit-only even when they are graded violations.
const auditOnlyResult = {
  ...graded,
  backfill: { audit_only: true },
}
assert.strictEqual(isAuditOnlyResult(auditOnlyResult), true)
assert.strictEqual(isQueueRow({ has_violation: true, result_json: auditOnlyResult }), false)
// Similar-looking or malformed persisted JSON must remain on the normal path.
assert.strictEqual(isAuditOnlyResult({ backfill: { audit_only: false } }), false)
assert.strictEqual(isAuditOnlyResult({ backfill: { audit_only: 'true' } }), false)
assert.strictEqual(isAuditOnlyResult(null), false)
// Audit-only rows are read-only at the server decision boundary.
assert.strictEqual(canSubmitPortalFeedback(auditOnlyResult), false)
assert.strictEqual(canSubmitPortalFeedback(graded), true)
assert.strictEqual(canSubmitPortalFeedback({ backfill: { audit_only: 'true' } }), true)

const partitionedRows = partitionPortalRows([
  { id: 1, result_json: graded },
  { id: 2, result_json: auditOnlyResult },
  { id: 3, result_json: { backfill: { audit_only: false } } },
])
assert.deepStrictEqual(partitionedRows.normalRows.map(row => row.id), [1, 3])
assert.deepStrictEqual(partitionedRows.auditRows.map(row => row.id), [2])

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

// --- parseWelcomeAgentLookupRow ------------------------------------------------

assert.deepStrictEqual(
  parseWelcomeAgentLookupRow({
    sfdc_lead_id: 'LEAD1',
    achieve_agent_name: 'Achieve Representative',
    achieve_agent_email: 'representative@achieve.test',
  }),
  {
    sfdc_lead_id: 'LEAD1',
    achieve_agent_name: 'Achieve Representative',
    achieve_agent_email: 'representative@achieve.test',
  },
)
assert.strictEqual(parseWelcomeAgentLookupRow(null), null)
assert.strictEqual(parseWelcomeAgentLookupRow([]), null)
assert.strictEqual(parseWelcomeAgentLookupRow({ sfdc_lead_id: 'LEAD1' }), null)
assert.strictEqual(parseWelcomeAgentLookupRow({
  sfdc_lead_id: ' ',
  achieve_agent_name: 'Achieve Representative',
  achieve_agent_email: 'representative@achieve.test',
}), null)

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
// No welcome-agent bridge match and no matched agent feedback stay explicit.
assert.strictEqual(gradedRow.achieve_agent_name, null)
assert.strictEqual(gradedRow.achieve_agent_email, null)
assert.deepStrictEqual(gradedRow.agent_feedback, [])

const attributedRow = buildPortalRow(
  {
    id: 9,
    call_id: 'CA789',
    module_name: ACHIEVE_MODULE_NAME,
    sfdc_lead_id: 'INTERNAL_LEAD_ID',
    result_json: { ...graded, transcript_segment: { start_line: 0 } },
  },
  { call_id: 'CA789', original_transcript: transcript },
  undefined,
  [],
  { achieve_agent_name: 'Achieve Representative', achieve_agent_email: 'representative@achieve.test' },
)
assert.strictEqual(attributedRow.achieve_agent_name, 'Achieve Representative')
assert.strictEqual(attributedRow.achieve_agent_email, 'representative@achieve.test')
assert.strictEqual(attributedRow.sfdc_lead_id, null)
assert.ok(!JSON.stringify(attributedRow).includes('INTERNAL_LEAD_ID'))

const approvedDetailRow = buildPortalRow(
  {
    id: 10,
    call_id: 'CA-DETAIL',
    module_name: ACHIEVE_MODULE_NAME,
    call_summary: 'Approved detail summary',
    result_json: {
      script_adherence: {
        violation_reason: 'Approved detail reason',
        key_evidence_quotes: ['Approved detail quote'],
      },
      assessment_confidence: {
        rationale: 'Approved detail rationale',
        limitations: ['Approved detail limitation'],
      },
      transfer_experience: {
        poor_transfer: true,
        reasons: ['ivr_reentry_before_later_live_agent'],
        evidence: [{ line: 3, quote: 'Approved transfer evidence' }],
        agent_attempts: [{ line: 2, quote: 'Approved agent attempt' }],
      },
      transcript_segment: { start_line: 0 },
    },
  },
  { original_transcript: 'Approved transcript' },
  undefined,
)
const approvedDetailJson = JSON.stringify(approvedDetailRow)
for (const approvedContent of [
  'Approved detail summary',
  'Approved detail reason',
  'Approved detail quote',
  'Approved detail rationale',
  'Approved detail limitation',
  'Approved transfer evidence',
  'Approved agent attempt',
  'Approved transcript',
]) {
  assert.ok(approvedDetailJson.includes(approvedContent))
}

// --- buildPortalListRow --------------------------------------------------------

const sentinelAgentFeedback = {
  id: 70,
  achieve_agent_name: 'SENTINEL form agent',
  accent: false,
  background_noise: true,
  connection_issues: null,
  call_quality: 'Poor',
  notes: 'SENTINEL agent notes',
  submitted_by: 'Pennie Agent',
  submitted_at: '2026-07-04T12:00:00Z',
  matched_call_id: 'CA-LIGHT',
}
const lightweightRow = buildPortalListRow(
  {
    module_result_id: 10,
    alert_created_at: '2026-07-04T00:00:00Z',
    call_id: 'CA-LIGHT',
    module_name: ACHIEVE_MODULE_NAME,
    has_violation: true,
    contact_name: 'Client',
    contact_phone: '555-0100',
    recording_link: 'SENTINEL recording URL',
    transcript_url: 'SENTINEL transcript URL',
    call_summary: 'SENTINEL summary',
    result_json: {
      script_version: 'fdr_wholesale_db_pilot_v1',
      script_adherence: {
        greeting_and_identity_completed: true,
        recording_disclosure_provided: false,
        missing_elements: ['recording_disclosure'],
        overall_script_adherence: 'substantial',
        violation: true,
        violation_reason: 'SENTINEL rationale',
        key_evidence_quotes: ['SENTINEL quote'],
      },
      assessment_confidence: {
        level: 'high',
        score: 0.87,
        rationale: 'SENTINEL confidence rationale',
        limitations: ['SENTINEL limitation'],
      },
      transfer_experience: {
        poor_transfer: true,
        reasons: ['ivr_reentry_before_later_live_agent'],
        evidence: [{ line: 3, quote: 'SENTINEL transfer evidence' }],
        agent_attempts: [{ line: 2, quote: 'SENTINEL agent attempt' }],
      },
    },
  },
  { id: 4, call_id: 'CA-LIGHT', module_name: ACHIEVE_MODULE_NAME, manager_email: 'manager@achieve.test', accurate: false, action_taken: null, inaccuracy_reason: 'wrong_context', comment: 'SENTINEL manager comment', reviewed_at: '2026-07-05T00:00:00Z' },
  [sentinelAgentFeedback],
  { achieve_agent_name: 'Achieve Representative', achieve_agent_email: 'representative@achieve.test' },
)
const lightweightJson = JSON.stringify(lightweightRow)
assert.strictEqual(lightweightRow.result_json.script_adherence.recording_disclosure_provided, false)
assert.deepStrictEqual(lightweightRow.result_json.script_adherence.missing_elements, ['recording_disclosure'])
assert.strictEqual(lightweightRow.result_json.script_adherence.overall_script_adherence, 'substantial')
assert.strictEqual(lightweightRow.result_json.script_adherence.violation, true)
assert.strictEqual(lightweightRow.result_json.assessment_confidence.level, 'high')
assert.strictEqual(lightweightRow.result_json.assessment_confidence.score, 0.87)
assert.strictEqual(lightweightRow.result_json.transfer_experience.poor_transfer, true)
assert.deepStrictEqual(lightweightRow.result_json.transfer_experience.reasons, ['ivr_reentry_before_later_live_agent'])
assert.strictEqual(lightweightRow.agent_feedback[0].call_quality, 'Poor')
assert.strictEqual(lightweightRow.agent_feedback[0].accent, false)
assert.strictEqual(lightweightRow.is_reviewed, true)
assert.strictEqual(lightweightRow.achieve_agent_name, 'Achieve Representative')
assert.ok(!lightweightJson.includes('SENTINEL'))
assert.ok(!('recording_link' in lightweightRow))
assert.ok(!('transcript_url' in lightweightRow))
assert.ok(!('call_summary' in lightweightRow))
assert.ok(!('trimmed_transcript' in lightweightRow))

const withheldLightweightRow = buildPortalListRow(
  {
    id: 11,
    call_id: 'CA-WITHHELD',
    module_name: ACHIEVE_MODULE_NAME,
    call_summary: 'SENTINEL withheld summary',
    result_json: fallbackResult,
  },
  undefined,
  [sentinelAgentFeedback],
)
assert.strictEqual(withheldLightweightRow.result_json.transcript_segment.used_full_transcript_fallback, true)
assert.ok(!JSON.stringify(withheldLightweightRow).includes('SENTINEL'))

// --- buildAgentFeedbackView / agent_feedback on rows ---------------------------

const agentFeedbackRow = {
  id: 7,
  lead_phone_raw: '(555) 123-4567',
  achieve_agent_name: 'Jasmine',
  accent: false,
  background_noise: true,
  connection_issues: null,
  call_quality: 'Fair',
  notes: 'a bit robotic',
  submitted_by: 'Pennie Agent',
  submitted_at: '2026-07-15T17:45:12Z',
  // internal fields that must not leak through the projection:
  phone_normalized: '5551234567',
  matched_call_id: 'CA456',
  matched_at: '2026-07-15T18:00:00Z',
  created_at: '2026-07-15T18:00:00Z',
}

// Matched view: no phone (the call row identifies it), no internal fields.
const matchedView = buildAgentFeedbackView(agentFeedbackRow)
assert.strictEqual(matchedView.lead_phone_raw, undefined)
assert.strictEqual(matchedView.call_quality, 'Fair')
assert.strictEqual(matchedView.notes, 'a bit robotic')
assert.strictEqual(matchedView.submitted_by, 'Pennie Agent')
assert.ok(!('phone_normalized' in matchedView))
assert.ok(!('matched_call_id' in matchedView))
assert.ok(!('created_at' in matchedView))
assert.strictEqual(matchedView.qa_match_status, 'qa_matched')

const inferredFeedbackRow = {
  ...agentFeedbackRow,
  matched_call_id: null,
  matched_eavesly_call_id: 'CA_INFERRED',
  call_match_status: 'matched',
  call_match_confidence: 'high',
  call_match_reason: 'matched_unique_qa_phone_time',
  call_match_provenance: 'inferred',
  call_match_method: 'unique_qa_phone_time',
  call_match_evidence: {
    matcher_version: 3,
    same_agent_phone_time_candidate_count: 2,
    qa_candidate_count: 1,
    absolute_delta_seconds: 90,
    qa_scope: 'ordinary',
    selected_call_id: 'MUST_NOT_LEAK',
  },
}
const qaAbsentView = buildAgentFeedbackView(inferredFeedbackRow, {
  includePhone: true,
  qaStatus: 'qa_absent',
})
assert.strictEqual(qaAbsentView.qa_match_status, 'qa_absent')
assert.strictEqual(qaAbsentView.call_match_confidence, 'high')
assert.strictEqual(qaAbsentView.call_match_reason, 'matched_unique_qa_phone_time')
assert.strictEqual(qaAbsentView.call_match_provenance, 'inferred')
assert.strictEqual(qaAbsentView.call_match_method, 'unique_qa_phone_time')
assert.deepStrictEqual(qaAbsentView.call_match_evidence, {
  matcher_version: 3,
  same_agent_phone_time_candidate_count: 2,
  qa_candidate_count: 1,
  absolute_delta_seconds: 90,
  qa_scope: 'ordinary',
})
assert.ok(!JSON.stringify(qaAbsentView).includes('MUST_NOT_LEAK'))
assert.ok(!('matched_eavesly_call_id' in qaAbsentView))

const auditQaView = buildAgentFeedbackView(inferredFeedbackRow, { qaStatus: 'qa_audit' })
assert.strictEqual(auditQaView.qa_match_status, 'qa_audit')
assert.strictEqual(auditQaView.lead_phone_raw, undefined)

const inferredMatchedView = buildAgentFeedbackView({
  ...inferredFeedbackRow,
  matched_call_id: 'CA_INFERRED',
}, { qaStatus: 'qa_matched' })
assert.strictEqual(inferredMatchedView.qa_match_status, 'qa_matched')
assert.strictEqual(inferredMatchedView.call_match_provenance, 'inferred')

const legacyMatchedView = buildAgentFeedbackView({
  ...agentFeedbackRow,
  call_match_confidence: null,
  call_match_reason: 'legacy_module_match',
  call_match_provenance: 'deterministic',
  call_match_method: 'legacy_module_association',
  call_match_evidence: { matcher_version: 1 },
})
assert.strictEqual(legacyMatchedView.qa_match_status, 'qa_matched')
assert.strictEqual(legacyMatchedView.call_match_confidence, null)
assert.strictEqual(legacyMatchedView.call_match_reason, 'legacy_module_match')
assert.strictEqual(legacyMatchedView.call_match_provenance, 'deterministic')
assert.strictEqual(legacyMatchedView.call_match_method, 'legacy_module_association')
assert.strictEqual(buildAgentFeedbackView({
  ...agentFeedbackRow,
  call_match_reason: 'unknown_future_reason',
  call_match_provenance: 'unknown',
  call_match_method: 'unknown',
  call_match_evidence: ['not-an-object'],
}).call_match_reason, null)
assert.strictEqual(buildAgentFeedbackView({
  ...agentFeedbackRow,
  call_match_reason: 'unknown_future_reason',
  call_match_provenance: 'unknown',
  call_match_method: 'unknown',
  call_match_evidence: ['not-an-object'],
}).call_match_provenance, null)

// Unmatched view keeps the raw phone so the reviewer can identify the call.
const unmatchedView = buildAgentFeedbackView(agentFeedbackRow, { includePhone: true })
assert.strictEqual(unmatchedView.lead_phone_raw, '(555) 123-4567')

// Empty submitted_by ('' in the DB) normalizes to null for display.
assert.strictEqual(buildAgentFeedbackView({ ...agentFeedbackRow, submitted_by: '' }).submitted_by, null)

// Rows carry matched agent feedback through buildPortalRow.
const rowWithAgentFeedback = buildPortalRow(
  {
    id: 12,
    call_id: 'CA456',
    module_name: ACHIEVE_MODULE_NAME,
    has_violation: false,
    result_json: { transcript_segment: { start_line: 0 } },
  },
  { call_id: 'CA456', original_transcript: transcript },
  undefined,
  [agentFeedbackRow],
)
assert.strictEqual(rowWithAgentFeedback.agent_feedback.length, 1)
assert.strictEqual(rowWithAgentFeedback.agent_feedback[0].call_quality, 'Fair')
assert.strictEqual(rowWithAgentFeedback.agent_feedback[0].lead_phone_raw, undefined)

// --- feedbackLeadershipSnapshotsAgree ------------------------------------------

const feedbackOverview = {
  coverage: { exact_agent_attributed: 2 },
  distinct_exact_agents: 1,
  distinct_any_agents: 2,
  qa: {
    coverage: { exact_agent_attributed: 2 },
    outcomes: { pass: 1, flagged: 1 },
    alignment: { overlap_calls: 1, both_clear: 0, both_concern: 1, human_only: 0, ai_only: 0 },
    distinct_exact_agents: 2,
  },
}
const feedbackRepresentatives = {
  coverage: { total: 2, loaded: 2, limit: 200, offset: 0, cap_reached: false },
  rows: [
    {
      achieve_agent_email: 'rep-a@example.test',
      total_submissions: 2,
      ai_total: 1,
      ai_pass: 1,
      ai_flagged: 0,
      overlap_calls: 1,
      both_clear: 0,
      both_concern: 1,
      human_only: 0,
      ai_only: 0,
    },
    {
      achieve_agent_email: 'rep-b@example.test',
      total_submissions: 0,
      ai_total: 1,
      ai_pass: 0,
      ai_flagged: 1,
      overlap_calls: 0,
      both_clear: 0,
      both_concern: 0,
      human_only: 0,
      ai_only: 0,
    },
  ],
}
assert.strictEqual(feedbackLeadershipSnapshotsAgree(feedbackOverview, feedbackRepresentatives), true)
assert.strictEqual(
  feedbackLeadershipSnapshotsAgree(feedbackOverview, {
    ...feedbackRepresentatives,
    rows: feedbackRepresentatives.rows.map((row, index) => index === 0 ? { ...row, ai_total: 2 } : row),
  }),
  false,
)

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
