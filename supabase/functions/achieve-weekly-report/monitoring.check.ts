// Behavior check for PII-free Slack monitoring and hourly transport dedupe.
// Run: npx tsx supabase/functions/achieve-weekly-report/monitoring.check.ts
import assert from 'node:assert/strict'
import {
  parseAchieveReliabilitySnapshot,
  runAchieveReliabilityAlert,
  type AchieveReliabilityAlertOperations,
} from './monitoring.ts'

const raw = {
  ok: false,
  expected_source_as_of: '2026-09-21',
  outcome_source_as_of: '2026-09-20',
  termination_source_as_of: '2026-09-21',
  expected_week_ending: '2026-09-20',
  stuck_sync_claims: 0,
  stuck_delivery_claims: 1,
  issues: ['outcome_snapshot_not_current', 'snapshot_source_mismatch', 'weekly_delivery_claim_stuck'],
}
const snapshot = parseAchieveReliabilitySnapshot(raw)
assert.ok(snapshot)
assert.equal(parseAchieveReliabilitySnapshot({ ...raw, customer_email: 'must-not-pass@example.test' })?.ok, false)
assert.equal(parseAchieveReliabilitySnapshot({ ...raw, issues: ['unknown_issue'] }), null)

const claims = new Set<string>()
const payloads: Array<{ readonly text: string }> = []
const controller = new AbortController()
const operations: AchieveReliabilityAlertOperations = {
  claim: async (fingerprint, hour, options) => {
    assert.strictEqual(options.signal, controller.signal)
    const key = `${fingerprint}:${hour}`
    if (claims.has(key)) return 'duplicate'
    claims.add(key)
    return 'claimed'
  },
  send: async (payload, options) => {
    assert.strictEqual(options.signal, controller.signal)
    payloads.push(payload)
  },
}

assert.deepStrictEqual(
  await runAchieveReliabilityAlert(snapshot, new Date('2026-09-21T18:17:00Z'), controller.signal, operations),
  { status: 'sent', issues: raw.issues },
)
assert.equal(payloads.length, 1)
assert.match(payloads[0]?.text ?? '', /No report was resent and no claim was deleted/)
assert.doesNotMatch(payloads[0]?.text ?? '', /@example|webhook|secret/i)
assert.deepStrictEqual(
  await runAchieveReliabilityAlert(snapshot, new Date('2026-09-21T18:59:00Z'), controller.signal, operations),
  { status: 'duplicate' },
)
assert.equal(payloads.length, 1)
assert.deepStrictEqual(
  await runAchieveReliabilityAlert(snapshot, new Date('2026-09-21T19:00:00Z'), controller.signal, operations),
  { status: 'sent', issues: raw.issues },
)
assert.equal(payloads.length, 2)

const healthy = parseAchieveReliabilitySnapshot({
  ...raw,
  ok: true,
  outcome_source_as_of: '2026-09-21',
  stuck_delivery_claims: 0,
  issues: [],
})
assert.ok(healthy)
assert.deepStrictEqual(
  await runAchieveReliabilityAlert(healthy, new Date('2026-09-21T19:15:00Z'), controller.signal, operations),
  { status: 'healthy' },
)
assert.equal(payloads.length, 2)

console.log('achieve-weekly-report monitoring: all checks passed')
