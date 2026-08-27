// Pipedream action placed immediately after the native Snowflake enrollment
// aggregate query documented in achieve-first-pay-outcomes.md.

const RPC_NAME = 'ingest_achieve_first_pay_outcome_snapshot'

function rowsFrom(value) {
  let parsed = value
  if (typeof parsed === 'string') parsed = JSON.parse(parsed)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['rows', 'data', 'results']) {
    if (Array.isArray(parsed?.[key])) return parsed[key]
  }
  throw new Error('Snowflake outcome input was not a row array')
}

function field(row, name) {
  return row?.[name] ?? row?.[name.toUpperCase()]
}

function isoDate(value, label) {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be YYYY-MM-DD`)
  }
  return text
}

function count(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`)
  return parsed
}

/** Parse the Snowflake aggregate into the strict service-role RPC command. */
export function planOutcomeSnapshot(value) {
  const source = rowsFrom(value)
  if (source.length === 0) throw new Error('Snowflake outcome snapshot was empty')
  const sourceDates = new Set()
  const expectedAggregateRows = new Set()
  const expectedEnrollments = new Set()
  const sourceRawRows = new Set()
  const sourceDistinctEnrollments = new Set()
  const keys = new Set()
  const rows = source.map((raw, index) => {
    const sourceAsOf = isoDate(field(raw, 'source_as_of'), `row ${index + 1} source_as_of`)
    const cohortDate = isoDate(field(raw, 'cohort_date'), `row ${index + 1} cohort_date`)
    const agentName = String(field(raw, 'agent_name') ?? '').trim()
    const agentEmail = String(field(raw, 'agent_email') ?? '').trim().toLowerCase()
    const n = count(field(raw, 'n'), `row ${index + 1} n`)
    const paid = count(field(raw, 'paid'), `row ${index + 1} paid`)
    const noDeposit = count(field(raw, 'no_deposit'), `row ${index + 1} no_deposit`)
    const rescinded = count(field(raw, 'rescinded'), `row ${index + 1} rescinded`)
    const neverPaid = count(field(raw, 'never_paid'), `row ${index + 1} never_paid`)
    const sourceAggregateRows = count(field(raw, 'source_aggregate_rows'), `row ${index + 1} source_aggregate_rows`)
    const sourceEnrollments = count(field(raw, 'source_enrollments'), `row ${index + 1} source_enrollments`)
    const rawRows = count(field(raw, 'source_raw_rows'), `row ${index + 1} source_raw_rows`)
    const distinctEnrollments = count(field(raw, 'source_distinct_enrollments'), `row ${index + 1} source_distinct_enrollments`)
    if (!agentName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agentEmail) || n === 0 || noDeposit > n) {
      throw new Error(`row ${index + 1} has invalid agent or enrollment counts`)
    }
    if (n !== paid + noDeposit) throw new Error(`row ${index + 1} does not reconcile paid and no_deposit`)
    if (noDeposit !== rescinded + neverPaid) throw new Error(`row ${index + 1} does not reconcile no_deposit`)
    const cutoff = new Date(`${sourceAsOf}T00:00:00Z`)
    cutoff.setUTCDate(cutoff.getUTCDate() - 10)
    if (cohortDate > cutoff.toISOString().slice(0, 10)) throw new Error(`row ${index + 1} is not mature`)
    const key = `${cohortDate}\0${agentEmail}`
    if (keys.has(key)) throw new Error(`row ${index + 1} duplicates a cohort and agent`)
    keys.add(key)
    sourceDates.add(sourceAsOf)
    expectedAggregateRows.add(sourceAggregateRows)
    expectedEnrollments.add(sourceEnrollments)
    sourceRawRows.add(rawRows)
    sourceDistinctEnrollments.add(distinctEnrollments)
    return {
      cohort_date: cohortDate,
      agent_name: agentName,
      agent_email: agentEmail,
      n,
      paid,
      no_deposit: noDeposit,
      rescinded,
      never_paid: neverPaid,
    }
  })
  if (sourceDates.size !== 1) throw new Error('Snowflake rows must have one source_as_of date')
  if (expectedAggregateRows.size !== 1 || [...expectedAggregateRows][0] !== rows.length) {
    throw new Error('Snowflake snapshot row count does not reconcile')
  }
  const enrollmentTotal = rows.reduce((sum, row) => sum + row.n, 0)
  if (expectedEnrollments.size !== 1 || [...expectedEnrollments][0] !== enrollmentTotal) {
    throw new Error('Snowflake snapshot enrollment count does not reconcile')
  }
  if (sourceRawRows.size !== 1 || sourceDistinctEnrollments.size !== 1) {
    throw new Error('Snowflake source controls must be consistent')
  }
  const rawRows = [...sourceRawRows][0]
  const distinctEnrollments = [...sourceDistinctEnrollments][0]
  if (rawRows !== distinctEnrollments) throw new Error('Snowflake source contains duplicate enrollment IDs')
  if (distinctEnrollments !== enrollmentTotal) throw new Error('Snowflake distinct enrollment count does not reconcile')
  return {
    sourceAsOf: [...sourceDates][0],
    expectedAggregateRows: rows.length,
    expectedEnrollments: enrollmentTotal,
    sourceRawRows: rawRows,
    sourceDistinctEnrollments: distinctEnrollments,
    rows,
  }
}

/** Send one atomic full-snapshot RPC through an injectable HTTP seam. */
export async function ingestOutcomeSnapshot(url, serviceRoleKey, plan, fetcher = fetch) {
  const response = await fetcher(`${url.trim().replace(/\/+$/, '')}/rest/v1/rpc/${RPC_NAME}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_source_as_of: plan.sourceAsOf,
      p_expected_aggregate_rows: plan.expectedAggregateRows,
      p_expected_enrollments: plan.expectedEnrollments,
      p_rows: plan.rows,
    }),
  })
  if (!response.ok) throw new Error(`Supabase outcome snapshot RPC failed (${response.status})`)
  return response.json()
}

const define = globalThis.defineComponent ?? (component => component)

export default define({
  name: 'Achieve first-pay outcomes → Supabase',
  key: 'achieve-first-pay-outcomes-supabase',
  version: '0.1.0',
  type: 'action',
  props: {
    snowflakeRowsInput: {
      type: 'any',
      label: 'Snowflake enrollment aggregate rows',
      description: 'Set to {{steps.fetch_achieve_first_pay_outcomes.$return_value}}.',
    },
    supabaseUrl: { type: 'string', label: 'Supabase project URL' },
    supabaseServiceRoleKey: { type: 'string', label: 'Supabase service-role key', secret: true },
    dryRun: { type: 'boolean', label: 'Dry run', default: true },
  },
  async run({ $ }) {
    const plan = planOutcomeSnapshot(this.snowflakeRowsInput)
    const result = this.dryRun
      ? {
          dryRun: true,
          sourceAsOf: plan.sourceAsOf,
          aggregateRows: plan.expectedAggregateRows,
          enrollments: plan.expectedEnrollments,
          sourceRawRows: plan.sourceRawRows,
          sourceDistinctEnrollments: plan.sourceDistinctEnrollments,
        }
      : await ingestOutcomeSnapshot(this.supabaseUrl, this.supabaseServiceRoleKey, plan)
    $.export('outcomeSnapshot', result)
    return result
  },
})
