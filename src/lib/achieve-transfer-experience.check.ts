// Self-check for the additive transfer-experience result parser.
// Run: npx tsx src/lib/achieve-transfer-experience.check.ts
import assert from 'node:assert'
import {
  humanizeTransferReason,
  parseTransferExperience,
  transferExperienceSummary,
} from './achieve-transfer-experience'

// Historical rows and malformed additive values do not gain transfer UI.
assert.strictEqual(parseTransferExperience(undefined), null)
assert.strictEqual(parseTransferExperience(null), null)
assert.strictEqual(parseTransferExperience({}), null)
assert.strictEqual(parseTransferExperience({ poor_transfer: 'yes' }), null)

const canonicalExplanation =
  'The client reached a live representative, returned to the automated phone menu, and then reached another live representative.'

const parsed = parseTransferExperience({
  poor_transfer: true,
  reasons: ['live_rep_then_ivr_reentry_then_live_rep', 42, ''],
  ivr_reentry_lines: [18, -1, 3.5, '20'],
  agent_attempts: [
    { line: 14, name_asr: 'Jonn', quote: 'Let me connect you now.' },
    { line: 22, name_asr: null, quote: 'Thank you for calling.' },
    { line: 'bad', name_asr: 'Ignored', quote: 'Malformed line.' },
  ],
  evidence: [
    { line: 18, quote: 'Please say or enter your selection.' },
    { line: 19, quote: '' },
  ],
  detection_version: 'achieve_poor_transfer_v1',
})
assert.ok(parsed)
assert.strictEqual(parsed.poorTransfer, true)
assert.deepStrictEqual(parsed.reasons, ['live_rep_then_ivr_reentry_then_live_rep'])
assert.deepStrictEqual(parsed.ivrReentryLines, [18])
assert.deepStrictEqual(parsed.agentAttempts, [
  { line: 14, nameAsr: 'Jonn', quote: 'Let me connect you now.' },
  { line: 22, nameAsr: null, quote: 'Thank you for calling.' },
])
assert.deepStrictEqual(parsed.evidence, [
  { line: 18, quote: 'Please say or enter your selection.' },
])
assert.strictEqual(parsed.detectionVersion, 'achieve_poor_transfer_v1')

const canonicalReasonText = humanizeTransferReason('live_rep_then_ivr_reentry_then_live_rep')
assert.strictEqual(canonicalReasonText, canonicalExplanation)
assert.notStrictEqual(canonicalReasonText, 'Transfer issue: live rep then ivr reentry then live rep.')
assert.strictEqual(
  humanizeTransferReason('unexpected_hold_loop'),
  'Transfer issue: unexpected hold loop.',
)
assert.strictEqual(
  humanizeTransferReason('not partner-safe prose!'),
  'An unrecognized transfer issue was detected.',
)
assert.strictEqual(transferExperienceSummary(parsed), canonicalExplanation)

const noReasons = parseTransferExperience({ poor_transfer: true, reasons: [] })
assert.ok(noReasons)
assert.strictEqual(
  transferExperienceSummary(noReasons),
  'The handoff experience did not complete smoothly.',
)

console.log('achieve-transfer-experience: all checks passed')
