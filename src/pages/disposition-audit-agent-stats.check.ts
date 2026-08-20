// Self-check for disposition-audit-agent-stats — this repo has no test runner.
// Run: npx tsx src/pages/disposition-audit-agent-stats.check.ts
import assert from 'node:assert/strict'
import { aggregateDispositionAuditByAgent } from './disposition-audit-agent-stats'

type Row = Parameters<typeof aggregateDispositionAuditByAgent>[0][number]

function row(overrides: Partial<Row> = {}): Row {
  return {
    agent_email: 'agent@trypennie.com',
    current_disposition: '1.5 - Not Interested',
    suggested_disposition: '1.3 - Interested',
    talk_time: 120,
    is_reviewed: false,
    accurate: null,
    ...overrides,
  }
}

const source = [
  row(),
  row({ agent_email: ' Agent@TryPennie.com ', talk_time: 300, is_reviewed: true, accurate: true }),
  row({ suggested_disposition: '1.4 - Converted', talk_time: 60 }),
  row({ talk_time: 5, is_reviewed: true, accurate: false, suggested_disposition: 'False alarm target' }),
  row({ agent_email: 'other@trypennie.com', suggested_disposition: '1.4 - Converted' }),
  row({ agent_email: null, current_disposition: null, suggested_disposition: null, talk_time: 0 }),
] as const

const snapshot = structuredClone(source)
const stats = aggregateDispositionAuditByAgent(source)

assert.deepEqual(source, snapshot, 'aggregation must not mutate query rows')
assert.equal(stats.length, 3)
assert.deepEqual(stats[0], {
  agentEmail: 'agent@trypennie.com',
  potentialIssues: 3,
  toReview: 2,
  confirmedIssues: 1,
  falseAlarms: 1,
  medianTalkTimeSeconds: 120,
  topMismatch: {
    currentDisposition: '1.5 - Not Interested',
    suggestedDisposition: '1.3 - Interested',
    count: 2,
  },
})
assert.equal(stats[1].agentEmail, null)
assert.equal(stats[1].medianTalkTimeSeconds, 0, 'zero-second calls are valid duration evidence')
assert.deepEqual(stats[1].topMismatch, {
  currentDisposition: 'Unknown disposition',
  suggestedDisposition: 'Unknown disposition',
  count: 1,
})
assert.equal(stats[2].agentEmail, 'other@trypennie.com')

const falseAlarmOnly = aggregateDispositionAuditByAgent([
  row({ is_reviewed: true, accurate: false }),
])[0]
assert.equal(falseAlarmOnly.potentialIssues, 0)
assert.equal(falseAlarmOnly.falseAlarms, 1)
assert.equal(falseAlarmOnly.medianTalkTimeSeconds, null)
assert.equal(falseAlarmOnly.topMismatch, null)

const tied = aggregateDispositionAuditByAgent([
  row({ suggested_disposition: 'Zulu' }),
  row({ suggested_disposition: 'Alpha' }),
])[0]
assert.equal(tied.topMismatch?.suggestedDisposition, 'Alpha', 'mismatch ties must be deterministic')

const ranked = aggregateDispositionAuditByAgent([
  row({ agent_email: 'zulu@example.com' }),
  row({ agent_email: 'alpha@example.com' }),
  row({ agent_email: 'confirmed@example.com', is_reviewed: true, accurate: true }),
])
assert.deepEqual(
  ranked.map(stat => stat.agentEmail),
  ['alpha@example.com', 'zulu@example.com', 'confirmed@example.com'],
  'agent ties must rank by to-review count, then email',
)

const evenMedian = aggregateDispositionAuditByAgent([
  row({ talk_time: 60 }),
  row({ talk_time: 120 }),
])[0]
assert.equal(evenMedian.medianTalkTimeSeconds, 90)

assert.deepEqual(aggregateDispositionAuditByAgent([]), [])
console.log('disposition-audit-agent-stats checks passed')
