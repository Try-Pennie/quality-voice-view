import assert from 'node:assert/strict'
import {
  ingestOutcomeSnapshot,
  planOutcomeSnapshot,
} from './achieve-first-pay-outcomes-pipedream.js'

const rows = [
  { source_as_of: '2026-09-01', cohort_date: '2026-08-18', agent_name: 'Agent A', agent_email: 'A@EXAMPLE.TEST', n: 30, paid: 15, no_deposit: 15, rescinded: 10, never_paid: 5, source_aggregate_rows: 2, source_enrollments: 60, source_raw_rows: 60, source_distinct_enrollments: 60 },
  { SOURCE_AS_OF: '2026-09-01', COHORT_DATE: '2026-08-18', AGENT_NAME: 'Agent B', AGENT_EMAIL: 'b@example.test', N: 30, PAID: 24, NO_DEPOSIT: 6, RESCINDED: 1, NEVER_PAID: 5, SOURCE_AGGREGATE_ROWS: 2, SOURCE_ENROLLMENTS: 60, SOURCE_RAW_ROWS: 60, SOURCE_DISTINCT_ENROLLMENTS: 60 },
]
const plan = planOutcomeSnapshot(JSON.stringify(rows))
assert.deepStrictEqual(plan, {
  sourceAsOf: '2026-09-01',
  expectedAggregateRows: 2,
  expectedEnrollments: 60,
  sourceRawRows: 60,
  sourceDistinctEnrollments: 60,
  rows: [
    { cohort_date: '2026-08-18', agent_name: 'Agent A', agent_email: 'a@example.test', n: 30, paid: 15, no_deposit: 15, rescinded: 10, never_paid: 5 },
    { cohort_date: '2026-08-18', agent_name: 'Agent B', agent_email: 'b@example.test', n: 30, paid: 24, no_deposit: 6, rescinded: 1, never_paid: 5 },
  ],
})
assert.throws(() => planOutcomeSnapshot([{ ...rows[0], never_paid: 4, source_aggregate_rows: 1, source_enrollments: 30 }]), /does not reconcile/)
assert.throws(() => planOutcomeSnapshot([{ ...rows[0], paid: 14, source_aggregate_rows: 1, source_enrollments: 30 }]), /paid and no_deposit/)
assert.throws(() => planOutcomeSnapshot([rows[0]]), /row count does not reconcile/)
assert.throws(() => planOutcomeSnapshot([rows[0], { ...rows[1], SOURCE_AS_OF: '2026-08-31' }]), /one source_as_of/)
assert.throws(
  () => planOutcomeSnapshot([{ ...rows[0], source_aggregate_rows: 1, source_enrollments: 30, source_raw_rows: 31, source_distinct_enrollments: 30 }]),
  /duplicate enrollment IDs/,
)
assert.throws(
  () => planOutcomeSnapshot([{ ...rows[0], source_aggregate_rows: 1, source_enrollments: 30, source_raw_rows: 30, source_distinct_enrollments: 29 }]),
  /duplicate enrollment IDs/,
)
assert.throws(
  () => planOutcomeSnapshot([{ ...rows[0], source_aggregate_rows: 1, source_enrollments: 30, source_raw_rows: 29, source_distinct_enrollments: 29 }]),
  /distinct enrollment count does not reconcile/,
)

const requests = []
const response = await ingestOutcomeSnapshot(
  'https://project.supabase.co/',
  'service-secret',
  plan,
  async (url, init) => {
    requests.push({ url, init })
    return new Response('{"aggregate_rows":2,"enrollments":60}', { status: 200 })
  },
)
assert.deepStrictEqual(response, { aggregate_rows: 2, enrollments: 60 })
assert.strictEqual(requests[0]?.url, 'https://project.supabase.co/rest/v1/rpc/ingest_achieve_first_pay_outcome_snapshot')
assert.strictEqual(requests[0]?.init.headers.apikey, 'service-secret')
assert.deepStrictEqual(JSON.parse(requests[0]?.init.body), {
  p_source_as_of: '2026-09-01',
  p_expected_aggregate_rows: 2,
  p_expected_enrollments: 60,
  p_rows: plan.rows,
})

console.log('achieve-first-pay-outcomes-pipedream: all checks passed')
