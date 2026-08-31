// Behavior check for Snowflake JWT auth, SQL API polling/partitions, and the
// fail-closed aggregate parser. Run:
//   npx tsx supabase/functions/_shared/achieve-first-pay-outcomes.check.ts
import assert from 'node:assert/strict'
import {
  fetchSnowflakeFirstPayEnrollments,
  fetchSnowflakeOutcomeSnapshot,
  fetchSnowflakeTerminationEnrollments,
  OutcomeSyncFailure,
  snowflakeConfigFromEnv,
  type SnowflakeOutcomeConfig,
} from './achieve-first-pay-outcomes.ts'

const HANDLE = '019c06a4-0000-df4f-0000-00100006589e'
const COLUMNS = [
  'source_as_of', 'cohort_date', 'agent_name', 'agent_email', 'n', 'paid', 'no_deposit',
  'rescinded', 'never_paid', 'source_aggregate_rows', 'source_enrollments',
  'source_raw_rows', 'source_distinct_enrollments',
]
const enrollmentColumns = [
  'source_as_of', 'aff_number', 'enrollment_date', 'termination_date', 'client_deposit_flag',
  'termination_before_first_pay_flag', 'original_scheduled_first_pay_date', 'wc_agent_email',
  'source_raw_rows', 'source_distinct_enrollments', 'export_rows',
  'source_distinct_aff_numbers', 'source_blank_aff_numbers',
]
const enrollmentRows = [
  ['2026-09-01', 'AFF-1', '2026-08-01', '', 'true', 'false', '2026-08-10', 'Agent@One.Test', '3', '2', '2', '2', '0'],
  ['2026-09-01', 'AFF-2', '2026-08-02', '2026-08-20', 'false', 'true', '2026-08-11', 'agent@fdr.com', '3', '2', '2', '2', '0'],
]
const terminationColumns = [
  'source_as_of', 'enrollment_date', 'agent_email', 'enrollments',
  'source_aggregate_rows', 'source_enrollments', 'source_raw_rows', 'source_distinct_enrollments',
]
const terminationRows = [
  ['2026-09-01', '2026-08-24', 'Agent@One.Test', '2', '2', '3', '4', '3'],
  ['2026-09-01', '2026-08-25', 'agent@fdr.com', '1', '2', '3', '4', '3'],
]
const rows = [
  ['2026-09-01', '2026-08-18', 'Agent A', 'A@EXAMPLE.TEST', '30', '15', '15', '10', '5', '2', '60', '60', '60'],
  ['2026-09-01', '2026-08-18', 'Agent B', 'b@example.test', '30', '24', '6', '1', '5', '2', '60', '60', '60'],
]

const generated = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)
const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', generated.privateKey))
const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateDer).toString('base64').match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`
const config: SnowflakeOutcomeConfig = {
  accountUrl: 'https://example-account.snowflakecomputing.com',
  accountIdentifier: 'EXAMPLE-ACCOUNT',
  user: 'EAVESLY_ACHIEVE_REPORT_SVC',
  role: 'EAVESLY_ACHIEVE_REPORT_READER',
  warehouse: 'AIRBYTE_SFDC_WAREHOUSE',
  database: 'AIRBYTE_SFDC_DATABASE',
  schema: 'AIRBYTE_SFDC_SCHEMA',
  privateKeyPem,
}
assert.deepStrictEqual(snowflakeConfigFromEnv(name => ({
  SNOWFLAKE_ACCOUNT_URL: config.accountUrl,
  SNOWFLAKE_ACCOUNT_IDENTIFIER: config.accountIdentifier,
  SNOWFLAKE_USER: config.user,
  SNOWFLAKE_ROLE: config.role,
  SNOWFLAKE_WAREHOUSE: config.warehouse,
  SNOWFLAKE_DATABASE: config.database,
  SNOWFLAKE_SCHEMA: config.schema,
  SNOWFLAKE_PRIVATE_KEY: config.privateKeyPem,
} as Readonly<Record<string, string>>)[name]), config)

function resultSet(data: ReadonlyArray<ReadonlyArray<unknown>>, partitionRows: ReadonlyArray<number>, numRows = rows.length) {
  return {
    resultSetMetaData: {
      numRows,
      format: 'jsonv2',
      rowType: COLUMNS.map(name => ({ name: name.toUpperCase() })),
      partitionInfo: partitionRows.map(rowCount => ({ rowCount })),
    },
    data,
    code: '090001',
    statementHandle: HANDLE,
  }
}

const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = []
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input)
  requests.push({ url, init })
  if (init?.method === 'POST') {
    return Response.json({ code: '333334', statementHandle: HANDLE }, { status: 202 })
  }
  const partition = new URL(url).searchParams.get('partition')
  return Response.json(partition === '1' ? { data: [rows[1]] } : resultSet([rows[0]], [1, 1]))
}

const plan = await fetchSnowflakeOutcomeSnapshot(config, new Date('2026-09-01T12:00:00Z'), {
  fetcher,
  sleep: async () => undefined,
})
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
assert.strictEqual(requests.length, 3)
assert.strictEqual(new URL(requests[0].url).searchParams.get('async'), 'true')
assert.strictEqual(new URL(requests[1].url).searchParams.get('partition'), null)
assert.strictEqual(new URL(requests[2].url).searchParams.get('partition'), '1')

const submitted = JSON.parse(String(requests[0].init?.body))
assert.match(submitted.statement, /partition by ID/)
assert.match(submitted.statement, /count\(distinct ID\)/)
assert.match(submitted.statement, /source_control\.raw_rows as "source_raw_rows"/)
assert.match(submitted.statement, /automated underwriting001/)
assert.deepStrictEqual(submitted.parameters, { DATE_OUTPUT_FORMAT: 'YYYY-MM-DD', TIMEZONE: 'UTC' })

const enrollmentRequests: Array<RequestInit | undefined> = []
const enrollmentFetcher: typeof fetch = async (_input, init) => {
  enrollmentRequests.push(init)
  return Response.json({
    resultSetMetaData: {
      numRows: enrollmentRows.length,
      rowType: enrollmentColumns.map(name => ({ name: name.toUpperCase() })),
      partitionInfo: [{ rowCount: enrollmentRows.length }],
    },
    data: enrollmentRows,
    statementHandle: HANDLE,
  })
}
const enrollmentPlan = await fetchSnowflakeFirstPayEnrollments(
  config,
  new Date('2026-09-01T12:00:00Z'),
  { fetcher: enrollmentFetcher },
)
assert.deepStrictEqual(enrollmentPlan, {
  sourceAsOf: '2026-09-01',
  sourceRawRows: 3,
  sourceDistinctEnrollments: 2,
  rows: [
    {
      affNumber: 'AFF-1', normalizedAffNumber: 'aff-1', enrollmentDate: '2026-08-01', terminationDate: null,
      clientDepositFlag: true, terminationBeforeFirstPayFlag: false,
      originalScheduledFirstPayDate: '2026-08-10', wcAgentEmail: 'agent@one.test',
    },
    {
      affNumber: 'AFF-2', normalizedAffNumber: 'aff-2', enrollmentDate: '2026-08-02', terminationDate: '2026-08-20',
      clientDepositFlag: false, terminationBeforeFirstPayFlag: true,
      originalScheduledFirstPayDate: '2026-08-11', wcAgentEmail: 'agent@fdr.com',
    },
  ],
})
const enrollmentStatement = JSON.parse(String(enrollmentRequests[0]?.body)).statement
assert.match(enrollmentStatement, /CLIENT_NO_AER__C/)
assert.match(enrollmentStatement, /DATE_ENROLLED__C/)
assert.match(enrollmentStatement, /TERMINATION_DATE_AER__C/)
assert.match(enrollmentStatement, /WELCOME_CALL_AGENT_AER__C/)
assert.doesNotMatch(enrollmentStatement, /dateadd\(day, -10/)
assert.doesNotMatch(enrollmentStatement, /automated underwriting001/)

const terminationRequests: Array<RequestInit | undefined> = []
const terminationFetcher: typeof fetch = async (_input, init) => {
  terminationRequests.push(init)
  return Response.json({
    resultSetMetaData: {
      numRows: terminationRows.length,
      rowType: terminationColumns.map(name => ({ name: name.toUpperCase() })),
      partitionInfo: [{ rowCount: terminationRows.length }],
    },
    data: terminationRows,
    statementHandle: HANDLE,
  })
}
const terminationPlan = await fetchSnowflakeTerminationEnrollments(
  config,
  new Date('2026-09-01T12:00:00Z'),
  { fetcher: terminationFetcher },
)
assert.deepStrictEqual(terminationPlan, {
  sourceAsOf: '2026-09-01',
  expectedAggregateRows: 2,
  expectedEnrollments: 3,
  sourceRawRows: 4,
  sourceDistinctEnrollments: 3,
  rows: [
    { enrollment_date: '2026-08-24', agent_email: 'agent@one.test', enrollments: 2 },
    { enrollment_date: '2026-08-25', agent_email: 'agent@fdr.com', enrollments: 1 },
  ],
})
const terminationStatement = JSON.parse(String(terminationRequests[0]?.body)).statement
assert.match(terminationStatement, /DATE_ENROLLED__C/)
assert.match(terminationStatement, /partition by ID/)
assert.match(terminationStatement, /count\(distinct ID\)/)
assert.match(terminationStatement, /between dateadd\(day, -30, current_date\(\)\) and current_date\(\)/)
assert.doesNotMatch(terminationStatement, /ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C/)

const authorization = new Headers(requests[0].init?.headers).get('Authorization')
assert.ok(authorization?.startsWith('Bearer '))
if (authorization === null) throw new Error('missing test authorization header')
const jwt = authorization.slice('Bearer '.length)
const [encodedHeader, encodedClaims, encodedSignature] = jwt.split('.')
assert.deepStrictEqual(JSON.parse(Buffer.from(encodedHeader, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' })
const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString())
const publicDer = new Uint8Array(await crypto.subtle.exportKey('spki', generated.publicKey))
const fingerprint = Buffer.from(await crypto.subtle.digest('SHA-256', publicDer)).toString('base64')
assert.deepStrictEqual(claims, {
  iss: `EXAMPLE-ACCOUNT.EAVESLY_ACHIEVE_REPORT_SVC.SHA256:${fingerprint}`,
  sub: 'EXAMPLE-ACCOUNT.EAVESLY_ACHIEVE_REPORT_SVC',
  iat: 1788264000,
  exp: 1788264300,
})
assert.strictEqual(
  await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    generated.publicKey,
    Buffer.from(encodedSignature, 'base64url'),
    new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
  ),
  true,
)

async function expectFailure(
  sourceRows: ReadonlyArray<ReadonlyArray<unknown>>,
  now: Date,
  code: OutcomeSyncFailure['code'],
  metadataRows = sourceRows.length,
): Promise<void> {
  const onePage: typeof fetch = async () => Response.json(resultSet(sourceRows, [sourceRows.length], metadataRows))
  await assert.rejects(
    fetchSnowflakeOutcomeSnapshot(config, now, { fetcher: onePage, sleep: async () => undefined }),
    error => error instanceof OutcomeSyncFailure && error.code === code,
  )
}

await expectFailure(rows, new Date('2026-09-01T12:00:00Z'), 'snowflake_result_incomplete', 3)
const nullCount: unknown[] = [...rows[0]]
nullCount[4] = null
await expectFailure([nullCount], new Date('2026-09-01T12:00:00Z'), 'snowflake_response_invalid')
await expectFailure(rows, new Date('2026-09-02T12:00:00Z'), 'snowflake_result_stale')
await expectFailure(
  [rows[0], [...rows[0],]],
  new Date('2026-09-01T12:00:00Z'),
  'snowflake_result_duplicate',
)
await expectFailure(
  [[...rows[0].slice(0, 8), '4', '1', '30', '30', '30']],
  new Date('2026-09-01T12:00:00Z'),
  'snowflake_result_unreconciled',
)
await expectFailure(
  [[...rows[0].slice(0, 9), '1', '30', '31', '30']],
  new Date('2026-09-01T12:00:00Z'),
  'snowflake_result_unreconciled',
)

async function expectEnrollmentFailure(
  sourceRows: ReadonlyArray<ReadonlyArray<unknown>>,
  now: Date,
  code: OutcomeSyncFailure['code'],
): Promise<void> {
  const onePage: typeof fetch = async () => Response.json({
    resultSetMetaData: {
      numRows: sourceRows.length,
      rowType: enrollmentColumns.map(name => ({ name: name.toUpperCase() })),
      partitionInfo: [{ rowCount: sourceRows.length }],
    },
    data: sourceRows,
    statementHandle: HANDLE,
  })
  await assert.rejects(
    fetchSnowflakeFirstPayEnrollments(config, now, { fetcher: onePage }),
    error => error instanceof OutcomeSyncFailure && error.code === code,
  )
}
await expectEnrollmentFailure(enrollmentRows, new Date('2026-09-02T12:00:00Z'), 'snowflake_result_stale')
await expectEnrollmentFailure([
  enrollmentRows[0],
  [...enrollmentRows[1].slice(0, 1), ' aff-1 ', ...enrollmentRows[1].slice(2)],
], new Date('2026-09-01T12:00:00Z'), 'snowflake_result_duplicate')
await expectEnrollmentFailure([
  [...enrollmentRows[0].slice(0, 10), '3', '2', '0'],
  [...enrollmentRows[1].slice(0, 10), '3', '2', '0'],
], new Date('2026-09-01T12:00:00Z'), 'snowflake_result_unreconciled')
const blankAff = [...enrollmentRows[0]]
blankAff[1] = ''
blankAff[8] = '1'
blankAff[9] = '1'
blankAff[10] = '1'
blankAff[11] = '0'
blankAff[12] = '1'
await expectEnrollmentFailure([blankAff], new Date('2026-09-01T12:00:00Z'), 'snowflake_result_unreconciled')
const blankEmail = [...enrollmentRows[0]]
blankEmail[7] = ''
blankEmail[8] = '1'
blankEmail[9] = '1'
blankEmail[10] = '1'
blankEmail[11] = '1'
await expectEnrollmentFailure([blankEmail], new Date('2026-09-01T12:00:00Z'), 'snowflake_result_unreconciled')

async function expectTerminationFailure(
  sourceRows: ReadonlyArray<ReadonlyArray<unknown>>,
  code: OutcomeSyncFailure['code'],
): Promise<void> {
  const onePage: typeof fetch = async () => Response.json({
    resultSetMetaData: {
      numRows: sourceRows.length,
      rowType: terminationColumns.map(name => ({ name: name.toUpperCase() })),
      partitionInfo: [{ rowCount: sourceRows.length }],
    },
    data: sourceRows,
    statementHandle: HANDLE,
  })
  await assert.rejects(
    fetchSnowflakeTerminationEnrollments(config, new Date('2026-09-01T12:00:00Z'), { fetcher: onePage }),
    error => error instanceof OutcomeSyncFailure && error.code === code,
  )
}
await expectTerminationFailure([
  terminationRows[0],
  [...terminationRows[0]],
], 'snowflake_result_duplicate')
await expectTerminationFailure([
  [...terminationRows[0].slice(0, 3), '2', '1', '3', '4', '3'],
], 'snowflake_result_unreconciled')

console.log('achieve-first-pay-outcomes.check.ts: all assertions passed')
