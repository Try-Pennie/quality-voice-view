// Self-check for gota-stats — no test runner in this repo by design.
// Run: npx tsx src/lib/gota-stats.check.ts
import assert from 'node:assert'
import {
  GOTA_BEATS,
  aggregateGotaByAgent,
  aggregateGotaDaily,
  aggregateGotaSummary,
  parseGotaResult,
  type GotaEvaluation,
} from './gota-stats'

// --- parseGotaResult ---------------------------------------------------------

// Malformed input degrades safely.
const empty = parseGotaResult(null)
assert.strictEqual(empty.enrollment_completed, false)
assert.strictEqual(empty.gota_conducted, false)
assert.strictEqual(empty.gota_type, 'unknown')
assert.deepStrictEqual(empty.missing_beats, [])
for (const beat of GOTA_BEATS) assert.strictEqual(empty.beats[beat.key], false)

// Unknown packet strings coerce to 'unknown'; booleans must be literal true.
assert.strictEqual(parseGotaResult({ gota_type: 'beyond' }).gota_type, 'unknown')
assert.strictEqual(parseGotaResult({ gota_conducted: 'true' }).gota_conducted, false)
assert.strictEqual(
  parseGotaResult({ fee_structure_beat_covered: true }).beats.fee_structure,
  true,
)

// --- fixtures ---------------------------------------------------------------

function evaluation(overrides: Partial<GotaEvaluation> & { call_id: string }): GotaEvaluation {
  return {
    agent_email: 'agent@trypennie.com',
    contact_name: null,
    alert_created_at: '2026-07-21T15:00:00Z',
    has_violation: false,
    is_reviewed: false,
    accurate: null,
    result: parseGotaResult({}),
    ...overrides,
  }
}

const allBeats = Object.fromEntries(GOTA_BEATS.map(b => [`${b.key}_beat_covered`, true]))

const conducted = evaluation({
  call_id: 'c1',
  result: parseGotaResult({
    enrollment_completed: true,
    gota_conducted: true,
    gota_type: 'fdr_green',
    wc_transfer_occurred: true,
    ...allBeats,
  }),
})
const conductedMissingBeats = evaluation({
  call_id: 'c2',
  agent_email: 'other@trypennie.com',
  alert_created_at: '2026-07-22T15:00:00Z',
  result: parseGotaResult({
    enrollment_completed: true,
    gota_conducted: true,
    gota_type: 'turnbull_red',
    ...allBeats,
    banking_readback_beat_covered: false,
    ssn_verification_beat_covered: false,
  }),
})
const violation = evaluation({
  call_id: 'c3',
  has_violation: true,
  alert_created_at: '2026-07-22T18:00:00Z',
  result: parseGotaResult({ enrollment_completed: true, gota_conducted: false }),
})
const noSigning = evaluation({
  call_id: 'c4',
  result: parseGotaResult({ enrollment_completed: false }),
})

const rows = [conducted, conductedMissingBeats, violation, noSigning]

// --- aggregateGotaSummary -----------------------------------------------------

const summary = aggregateGotaSummary(rows)
assert.strictEqual(summary.evaluated, 4)
assert.strictEqual(summary.signings, 3)
assert.strictEqual(summary.conducted, 2)
assert.strictEqual(summary.adoptionRate, 67) // 2/3
assert.strictEqual(summary.violations, 1)
assert.strictEqual(summary.overturned, 0)
assert.strictEqual(summary.packetMix.fdr_green, 1)
assert.strictEqual(summary.packetMix.turnbull_red, 1)
assert.strictEqual(summary.packetMix.unknown, 1) // the violation row
// Beat coverage is among CONDUCTED walkthroughs, worst first.
assert.strictEqual(summary.beatCoverage[0].rate, 50) // banking or ssn: 1/2
assert.ok(['banking_readback', 'ssn_verification'].includes(summary.beatCoverage[0].key))
const feeBeat = summary.beatCoverage.find(b => b.key === 'fee_structure')!
assert.strictEqual(feeBeat.rate, 100)

// Overturned violations are counted.
const overturnedSummary = aggregateGotaSummary([
  { ...violation, accurate: false },
])
assert.strictEqual(overturnedSummary.overturned, 1)

// Empty window → null rates, zero everything.
const zero = aggregateGotaSummary([])
assert.strictEqual(zero.adoptionRate, null)
assert.strictEqual(zero.evaluated, 0)

// --- aggregateGotaByAgent -----------------------------------------------------

const agents = aggregateGotaByAgent(rows)
assert.strictEqual(agents.length, 2)
// Coaching order: the agent with the violation sorts first.
assert.strictEqual(agents[0].agent_email, 'agent@trypennie.com')
assert.strictEqual(agents[0].violations, 1)
assert.strictEqual(agents[0].signings, 2) // c1 + c3 (c4 had no signing)
assert.strictEqual(agents[0].adoptionRate, 50)
assert.strictEqual(agents[0].evaluated, 3)
assert.strictEqual(agents[0].avgMissedBeats, 0) // only c1 conducted, all beats hit
assert.strictEqual(agents[0].lastCallAt, '2026-07-22T18:00:00Z')
assert.strictEqual(agents[1].agent_email, 'other@trypennie.com')
assert.strictEqual(agents[1].adoptionRate, 100)
assert.strictEqual(agents[1].avgMissedBeats, 2)

// Rows without an agent_email are skipped, not crashed on.
assert.strictEqual(
  aggregateGotaByAgent([evaluation({ call_id: 'c5', agent_email: null })]).length,
  0,
)

// --- aggregateGotaDaily ---------------------------------------------------------

const daily = aggregateGotaDaily(rows)
assert.strictEqual(daily.length, 2)
assert.ok(daily[0].day < daily[1].day) // ascending
assert.strictEqual(daily[0].signings, 1)
assert.strictEqual(daily[0].adoptionRate, 100)
assert.strictEqual(daily[1].signings, 2) // c2 + c3
assert.strictEqual(daily[1].conducted, 1)
assert.strictEqual(daily[1].violations, 1)
assert.strictEqual(daily[1].adoptionRate, 50)

console.log('gota-stats.check.ts: all assertions passed')
