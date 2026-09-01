const SYSTEM_AGENT_NAMES = new Set(['services interface', 'automated underwriting001'])
const POLL_ATTEMPTS = 45
const REQUEST_TIMEOUT_MS = 30_000

const OUTCOME_COLUMNS = [
  'source_as_of',
  'cohort_date',
  'agent_name',
  'agent_email',
  'n',
  'paid',
  'no_deposit',
  'rescinded',
  'never_paid',
  'source_aggregate_rows',
  'source_enrollments',
  'source_raw_rows',
  'source_distinct_enrollments',
] as const

const FIRST_PAY_ENROLLMENT_COLUMNS = [
  'source_as_of',
  'aff_number',
  'enrollment_date',
  'termination_date',
  'client_deposit_flag',
  'termination_before_first_pay_flag',
  'original_scheduled_first_pay_date',
  'wc_agent_email',
  'source_raw_rows',
  'source_distinct_enrollments',
  'export_rows',
  'source_distinct_aff_numbers',
  'source_blank_aff_numbers',
] as const

const TERMINATION_ENROLLMENT_COLUMNS = [
  'source_as_of',
  'enrollment_date',
  'agent_email',
  'enrollments',
  'source_aggregate_rows',
  'source_enrollments',
  'source_raw_rows',
  'source_distinct_enrollments',
] as const

const OUTCOME_QUERY = `with population as (
  select *
  from AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.ENROLLMENT__C
  where SERVICER__C = 'Achieve'
    and STATUS__C <> 'Pre-Enrollment'
    and ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C is not null
    and to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) <= dateadd(day, -10, current_date())
    and nullif(trim(WELCOME_CALL_AGENT_EMAIL_AER__C), '') is not null
    and lower(trim(WELCOME_CALL_AGENT_AER__C)) not in ('services interface', 'automated underwriting001')
),
source_control as (
  select
    count(*)::integer as raw_rows,
    count(distinct ID)::integer as distinct_enrollments
  from population
),
deduped as (
  select *
  from population
  qualify row_number() over (
    partition by ID
    order by SYSTEMMODSTAMP desc nulls last, LASTMODIFIEDDATE desc nulls last
  ) = 1
),
aggregates as (
  select
    to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) as cohort_date,
    max(trim(WELCOME_CALL_AGENT_AER__C)) as agent_name,
    lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C)) as agent_email,
    count(*)::integer as n,
    count_if(CLIENT_DEPOSIT_FLAG__C = true)::integer as paid,
    count_if(CLIENT_DEPOSIT_FLAG__C = false)::integer as no_deposit,
    count_if(
      CLIENT_DEPOSIT_FLAG__C = false
      and TERMINATION_BEFORE_FIRST_PAY_FLAG__C = true
    )::integer as rescinded,
    count_if(
      CLIENT_DEPOSIT_FLAG__C = false
      and TERMINATION_BEFORE_FIRST_PAY_FLAG__C = false
    )::integer as never_paid
  from deduped
  group by
    to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C),
    lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C))
)
select
  current_date()::date as "source_as_of",
  cohort_date as "cohort_date",
  agent_name as "agent_name",
  agent_email as "agent_email",
  n as "n",
  paid as "paid",
  no_deposit as "no_deposit",
  rescinded as "rescinded",
  never_paid as "never_paid",
  count(*) over ()::integer as "source_aggregate_rows",
  sum(n) over ()::integer as "source_enrollments",
  source_control.raw_rows as "source_raw_rows",
  source_control.distinct_enrollments as "source_distinct_enrollments"
from aggregates
cross join source_control
order by cohort_date, agent_email`

const FIRST_PAY_ENROLLMENT_QUERY = `with population as (
  select *
  from AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.ENROLLMENT__C
  where SERVICER__C = 'Achieve'
    and STATUS__C <> 'Pre-Enrollment'
    and WELCOME_CALL_AGENT_AER__C is not null
    and lower(trim(WELCOME_CALL_AGENT_AER__C)) <> 'services interface'
    and ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C is not null
),
source_control as (
  select
    count(*)::integer as raw_rows,
    count(distinct ID)::integer as distinct_enrollments
  from population
),
deduped as (
  select *
  from population
  qualify row_number() over (
    partition by ID
    order by SYSTEMMODSTAMP desc nulls last, LASTMODIFIEDDATE desc nulls last
  ) = 1
),
export_control as (
  select
    count(*)::integer as export_rows,
    count(distinct lower(trim(CLIENT_NO_AER__C)))::integer as distinct_aff_numbers,
    count_if(nullif(trim(CLIENT_NO_AER__C), '') is null)::integer as blank_aff_numbers
  from deduped
)
select
  current_date()::date as "source_as_of",
  trim(CLIENT_NO_AER__C) as "aff_number",
  to_date(DATE_ENROLLED__C) as "enrollment_date",
  to_date(TERMINATION_DATE_AER__C) as "termination_date",
  CLIENT_DEPOSIT_FLAG__C as "client_deposit_flag",
  TERMINATION_BEFORE_FIRST_PAY_FLAG__C as "termination_before_first_pay_flag",
  to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) as "original_scheduled_first_pay_date",
  lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C)) as "wc_agent_email",
  source_control.raw_rows as "source_raw_rows",
  source_control.distinct_enrollments as "source_distinct_enrollments",
  export_control.export_rows as "export_rows",
  export_control.distinct_aff_numbers as "source_distinct_aff_numbers",
  export_control.blank_aff_numbers as "source_blank_aff_numbers"
from deduped
cross join source_control
cross join export_control
order by lower(trim(CLIENT_NO_AER__C))`

const TERMINATION_ENROLLMENT_QUERY = `with population as (
  select *
  from AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.ENROLLMENT__C
  where SERVICER__C = 'Achieve'
    and STATUS__C <> 'Pre-Enrollment'
    and DATE_ENROLLED__C is not null
    and to_date(DATE_ENROLLED__C) between dateadd(day, -30, current_date()) and current_date()
    and nullif(trim(WELCOME_CALL_AGENT_EMAIL_AER__C), '') is not null
    and lower(trim(coalesce(WELCOME_CALL_AGENT_AER__C, ''))) not in ('services interface', 'automated underwriting001')
),
source_control as (
  select
    count(*)::integer as raw_rows,
    count(distinct ID)::integer as distinct_enrollments
  from population
),
deduped as (
  select *
  from population
  qualify row_number() over (
    partition by ID
    order by SYSTEMMODSTAMP desc nulls last, LASTMODIFIEDDATE desc nulls last
  ) = 1
),
aggregates as (
  select
    to_date(DATE_ENROLLED__C) as enrollment_date,
    lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C)) as agent_email,
    count(*)::integer as enrollments
  from deduped
  group by to_date(DATE_ENROLLED__C), lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C))
)
select
  current_date()::date as "source_as_of",
  enrollment_date as "enrollment_date",
  agent_email as "agent_email",
  enrollments as "enrollments",
  count(*) over ()::integer as "source_aggregate_rows",
  sum(enrollments) over ()::integer as "source_enrollments",
  source_control.raw_rows as "source_raw_rows",
  source_control.distinct_enrollments as "source_distinct_enrollments"
from aggregates
cross join source_control
order by enrollment_date, agent_email`

/** Stable, non-sensitive failure categories for the Snowflake outcome boundary. */
export type OutcomeSyncFailureCode =
  | 'snowflake_auth_failed'
  | 'snowflake_network_failed'
  | 'snowflake_query_failed'
  | 'snowflake_poll_timeout'
  | 'snowflake_response_invalid'
  | 'snowflake_result_incomplete'
  | 'snowflake_result_empty'
  | 'snowflake_result_stale'
  | 'snowflake_result_duplicate'
  | 'snowflake_result_unreconciled'

/** Expected Snowflake boundary failure without credentials or source rows. */
export class OutcomeSyncFailure extends Error {
  readonly name = 'OutcomeSyncFailure'

  constructor(
    readonly code: OutcomeSyncFailureCode,
    readonly status: number | null = null,
    readonly providerCode: string | null = null,
  ) {
    super(code)
  }
}

/** Parsed Snowflake connection settings used by the SQL API adapter. */
export type SnowflakeOutcomeConfig = {
  readonly accountUrl: string
  readonly accountIdentifier: string
  readonly user: string
  readonly role: string
  readonly warehouse: string
  readonly database: string
  readonly schema: string
  readonly privateKeyPem: string
}

function snowflakeIdentifier(value: string): string | null {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z][A-Z0-9_$]{0,254}$/.test(normalized) ? normalized : null
}

/** Parse the eight shared Snowflake secrets without exposing their values. */
export function snowflakeConfigFromEnv(
  get: (name: string) => string | undefined,
): SnowflakeOutcomeConfig | null {
  const accountIdentifier = get('SNOWFLAKE_ACCOUNT_IDENTIFIER')?.trim().toUpperCase() ?? ''
  const user = snowflakeIdentifier(get('SNOWFLAKE_USER') ?? '')
  const role = snowflakeIdentifier(get('SNOWFLAKE_ROLE') ?? '')
  const warehouse = snowflakeIdentifier(get('SNOWFLAKE_WAREHOUSE') ?? '')
  const database = snowflakeIdentifier(get('SNOWFLAKE_DATABASE') ?? '')
  const schema = snowflakeIdentifier(get('SNOWFLAKE_SCHEMA') ?? '')
  const privateKeyPem = get('SNOWFLAKE_PRIVATE_KEY')?.trim() ?? ''
  let accountUrl: string | null = null
  try {
    const candidate = new URL(get('SNOWFLAKE_ACCOUNT_URL') ?? '')
    if (
      candidate.protocol === 'https:'
      && candidate.hostname.endsWith('.snowflakecomputing.com')
      && candidate.pathname === '/'
      && candidate.username === ''
      && candidate.password === ''
      && candidate.search === ''
      && candidate.hash === ''
    ) accountUrl = candidate.origin
  } catch {
    accountUrl = null
  }
  if (
    !/^[A-Z0-9][A-Z0-9_-]{0,254}$/.test(accountIdentifier)
    || user === null || role === null || warehouse === null || database === null || schema === null
    || !privateKeyPem.includes('-----BEGIN PRIVATE KEY-----')
    || !privateKeyPem.includes('-----END PRIVATE KEY-----')
    || accountUrl === null
  ) return null
  return { accountUrl, accountIdentifier, user, role, warehouse, database, schema, privateKeyPem }
}

/** One validated aggregate row accepted by the transactional Supabase RPC. */
export type OutcomeAggregateRow = {
  readonly cohort_date: string
  readonly agent_name: string
  readonly agent_email: string
  readonly n: number
  readonly paid: number
  readonly no_deposit: number
  readonly rescinded: number
  readonly never_paid: number
}

/** Complete validated snapshot command for the transactional Supabase RPC. */
export type OutcomeSnapshotPlan = {
  readonly sourceAsOf: string
  readonly expectedAggregateRows: number
  readonly expectedEnrollments: number
  readonly sourceRawRows: number
  readonly sourceDistinctEnrollments: number
  readonly rows: ReadonlyArray<OutcomeAggregateRow>
}

/** One deduplicated enrollment held only in memory for the weekly attachment. */
export type FirstPayEnrollmentRow = {
  readonly affNumber: string
  readonly normalizedAffNumber: string
  readonly enrollmentDate: string | null
  readonly terminationDate: string | null
  readonly clientDepositFlag: boolean
  readonly terminationBeforeFirstPayFlag: boolean
  readonly originalScheduledFirstPayDate: string
  readonly wcAgentEmail: string
}

/** Complete source-reconciled full-history enrollment export. */
export type FirstPayEnrollmentPlan = {
  readonly sourceAsOf: string
  readonly sourceRawRows: number
  readonly sourceDistinctEnrollments: number
  readonly rows: ReadonlyArray<FirstPayEnrollmentRow>
}

/** One deduplicated Snowflake enrollment-date bucket by WC agent. */
export type TerminationEnrollmentAggregateRow = {
  readonly enrollment_date: string
  readonly agent_email: string
  readonly enrollments: number
}

/** Complete validated aggregate used to monitor terminated WC agents. */
export type TerminationEnrollmentPlan = {
  readonly sourceAsOf: string
  readonly expectedAggregateRows: number
  readonly expectedEnrollments: number
  readonly sourceRawRows: number
  readonly sourceDistinctEnrollments: number
  readonly rows: ReadonlyArray<TerminationEnrollmentAggregateRow>
}

type SnowflakeRequestOptions = {
  readonly fetcher?: typeof fetch
  readonly sleep?: (milliseconds: number) => Promise<void>
}

type SnowflakeResultMetadata = {
  readonly numRows: number
  readonly columns: ReadonlyArray<string>
  readonly partitionRows: ReadonlyArray<number>
}

function failure(
  code: OutcomeSyncFailureCode,
  status: number | null = null,
  providerCode: string | null = null,
): never {
  throw new OutcomeSyncFailure(code, status, providerCode)
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: The runtime checks establish the indexable record invariant.
  return value as Readonly<Record<string, unknown>>
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemBytes(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, '\n')
  const body = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  try {
    return Uint8Array.from(atob(body), character => character.charCodeAt(0))
  } catch {
    return failure('snowflake_auth_failed')
  }
}

async function snowflakeJwt(config: SnowflakeOutcomeConfig, now: Date): Promise<string> {
  const encoder = new TextEncoder()
  let privateKey: CryptoKey
  try {
    privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemBytes(config.privateKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['sign'],
    )
  } catch {
    return failure('snowflake_auth_failed')
  }

  let privateJwk: JsonWebKey
  try {
    privateJwk = await crypto.subtle.exportKey('jwk', privateKey)
  } catch {
    return failure('snowflake_auth_failed')
  }
  if (typeof privateJwk.n !== 'string' || typeof privateJwk.e !== 'string') {
    return failure('snowflake_auth_failed')
  }

  let publicKey: CryptoKey
  try {
    publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: privateJwk.n, e: privateJwk.e, alg: 'RS256', ext: true, key_ops: ['verify'] },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    )
  } catch {
    return failure('snowflake_auth_failed')
  }

  const publicDer = await crypto.subtle.exportKey('spki', publicKey)
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const fingerprint = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', publicDer)))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(44, '=')
  const qualifiedUser = `${config.accountIdentifier}.${config.user}`
  const issuedAt = Math.floor(now.getTime() / 1000)
  const claims = base64url(encoder.encode(JSON.stringify({
    iss: `${qualifiedUser}.SHA256:${fingerprint}`,
    sub: qualifiedUser,
    iat: issuedAt,
    exp: issuedAt + 300,
  })))
  const unsigned = `${header}.${claims}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, encoder.encode(unsigned))
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}

function providerCode(value: unknown): string | null {
  const body = record(value)
  return typeof body?.code === 'string' && body.code.length <= 32 ? body.code : null
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<{ readonly status: number; readonly body: unknown }> {
  let response: Response
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    return failure('snowflake_network_failed')
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return failure('snowflake_response_invalid', response.status)
  }
  if (response.status !== 200 && response.status !== 202) {
    return failure('snowflake_query_failed', response.status, providerCode(body))
  }
  return { status: response.status, body }
}

function statementHandle(value: unknown): string {
  const body = record(value)
  const handle = body?.statementHandle
  if (typeof handle !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(handle)) {
    return failure('snowflake_response_invalid')
  }
  return handle
}

function nonNegativeInteger(value: unknown, code: OutcomeSyncFailureCode): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return failure(code)
  }
  const parsed = typeof value === 'number' ? value : Number(String(value))
  if (!Number.isSafeInteger(parsed) || parsed < 0) return failure(code)
  return parsed
}

function resultMetadata(value: unknown): SnowflakeResultMetadata {
  const body = record(value)
  const metadata = record(body?.resultSetMetaData)
  if (!metadata || !Array.isArray(metadata.rowType) || !Array.isArray(metadata.partitionInfo)) {
    return failure('snowflake_response_invalid')
  }
  const columns = metadata.rowType.map(raw => {
    const column = record(raw)
    return typeof column?.name === 'string' ? column.name.toLowerCase() : ''
  })
  const partitionRows = metadata.partitionInfo.map(raw => {
    const partition = record(raw)
    return nonNegativeInteger(partition?.rowCount, 'snowflake_response_invalid')
  })
  const numRows = nonNegativeInteger(metadata.numRows, 'snowflake_response_invalid')
  if (
    columns.length === 0 || columns.some(column => column === '')
    || new Set(columns).size !== columns.length
    || partitionRows.length === 0
    || partitionRows.reduce((sum, count) => sum + count, 0) !== numRows
  ) return failure('snowflake_result_incomplete')
  return { numRows, columns, partitionRows }
}

function partitionRows(value: unknown, metadata: SnowflakeResultMetadata, partition: number): ReadonlyArray<ReadonlyArray<unknown>> {
  const body = record(value)
  if (!body || !Array.isArray(body.data)) return failure('snowflake_response_invalid')
  if (body.resultSetMetaData !== undefined) {
    const current = resultMetadata(value)
    if (
      current.numRows !== metadata.numRows
      || current.columns.join('\0') !== metadata.columns.join('\0')
      || current.partitionRows.join('\0') !== metadata.partitionRows.join('\0')
    ) return failure('snowflake_result_incomplete')
  }
  if (body.data.length !== metadata.partitionRows[partition]) return failure('snowflake_result_incomplete')
  return body.data.map(row => {
    if (!Array.isArray(row) || row.length !== metadata.columns.length) {
      return failure('snowflake_result_incomplete')
    }
    return row
  })
}

async function completedResponse(
  accountUrl: string,
  jwt: string,
  initial: { readonly status: number; readonly body: unknown },
  fetcher: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  let response = initial
  const handle = statementHandle(response.body)
  for (let attempt = 0; response.status === 202 && attempt < POLL_ATTEMPTS; attempt++) {
    await sleep(1_000)
    const query = new URLSearchParams({ requestId: crypto.randomUUID() })
    response = await requestJson(
      `${accountUrl}/api/v2/statements/${encodeURIComponent(handle)}?${query}`,
      { method: 'GET', headers: snowflakeHeaders(jwt) },
      fetcher,
    )
    if (statementHandle(response.body) !== handle) return failure('snowflake_response_invalid')
  }
  if (response.status !== 200) return failure('snowflake_poll_timeout')
  return response.body
}

async function completedPartition(
  accountUrl: string,
  jwt: string,
  handle: string,
  partition: number,
  initial: { readonly status: number; readonly body: unknown },
  fetcher: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  let response = initial
  for (let attempt = 0; response.status === 202 && attempt < POLL_ATTEMPTS; attempt++) {
    if (statementHandle(response.body) !== handle) return failure('snowflake_response_invalid')
    await sleep(1_000)
    const query = new URLSearchParams({ partition: String(partition), requestId: crypto.randomUUID() })
    response = await requestJson(
      `${accountUrl}/api/v2/statements/${encodeURIComponent(handle)}?${query}`,
      { method: 'GET', headers: snowflakeHeaders(jwt) },
      fetcher,
    )
  }
  if (response.status !== 200) return failure('snowflake_poll_timeout')
  return response.body
}

function snowflakeHeaders(jwt: string): Readonly<Record<string, string>> {
  return {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
  }
}

async function snowflakeRows(
  config: SnowflakeOutcomeConfig,
  statement: string,
  now: Date,
  options: SnowflakeRequestOptions,
): Promise<{ readonly columns: ReadonlyArray<string>; readonly rows: ReadonlyArray<ReadonlyArray<unknown>> }> {
  const fetcher = options.fetcher ?? fetch
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const jwt = await snowflakeJwt(config, now)
  const requestId = crypto.randomUUID()
  const submitted = await requestJson(
    `${config.accountUrl}/api/v2/statements?requestId=${encodeURIComponent(requestId)}&async=true`,
    {
      method: 'POST',
      headers: snowflakeHeaders(jwt),
      body: JSON.stringify({
        statement,
        timeout: 45,
        role: config.role,
        warehouse: config.warehouse,
        database: config.database,
        schema: config.schema,
        parameters: { DATE_OUTPUT_FORMAT: 'YYYY-MM-DD', TIMEZONE: 'UTC' },
      }),
    },
    fetcher,
  )
  const first = await completedResponse(config.accountUrl, jwt, submitted, fetcher, sleep)
  const handle = statementHandle(first)
  const metadata = resultMetadata(first)
  const rows: Array<ReadonlyArray<unknown>> = [...partitionRows(first, metadata, 0)]

  for (let partition = 1; partition < metadata.partitionRows.length; partition++) {
    const query = new URLSearchParams({ partition: String(partition), requestId: crypto.randomUUID() })
    const requested = await requestJson(
      `${config.accountUrl}/api/v2/statements/${encodeURIComponent(handle)}?${query}`,
      { method: 'GET', headers: snowflakeHeaders(jwt) },
      fetcher,
    )
    const page = await completedPartition(config.accountUrl, jwt, handle, partition, requested, fetcher, sleep)
    rows.push(...partitionRows(page, metadata, partition))
  }
  if (rows.length !== metadata.numRows) return failure('snowflake_result_incomplete')
  return { columns: metadata.columns, rows }
}

function isoDate(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return failure('snowflake_response_invalid')
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return failure('snowflake_response_invalid')
  }
  return text
}

function optionalIsoDate(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text === '' ? null : isoDate(text)
}

function booleanValue(value: unknown): boolean {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true
  if (value === false || String(value).trim().toLowerCase() === 'false') return false
  return failure('snowflake_response_invalid')
}

function positiveInteger(value: unknown): number {
  const parsed = nonNegativeInteger(value, 'snowflake_response_invalid')
  return parsed > 0 ? parsed : failure('snowflake_response_invalid')
}

function oneValue<T>(values: ReadonlySet<T>, code: OutcomeSyncFailureCode): T {
  if (values.size !== 1) return failure(code)
  const first = values.values().next()
  return first.done ? failure(code) : first.value
}

function planSnapshot(
  columns: ReadonlyArray<string>,
  values: ReadonlyArray<ReadonlyArray<unknown>>,
  expectedSourceAsOf: string,
): OutcomeSnapshotPlan {
  if (values.length === 0) return failure('snowflake_result_empty')
  if (columns.length !== OUTCOME_COLUMNS.length || OUTCOME_COLUMNS.some(column => !columns.includes(column))) {
    return failure('snowflake_response_invalid')
  }
  const indexes = new Map(columns.map((column, index) => [column, index]))
  const sourceDates = new Set<string>()
  const expectedRows = new Set<number>()
  const expectedEnrollments = new Set<number>()
  const rawRows = new Set<number>()
  const distinctEnrollments = new Set<number>()
  const keys = new Set<string>()
  const rows: Array<OutcomeAggregateRow> = []

  const field = (row: ReadonlyArray<unknown>, name: typeof OUTCOME_COLUMNS[number]): unknown => {
    const index = indexes.get(name)
    return index === undefined ? undefined : row[index]
  }

  for (const raw of values) {
    const sourceAsOf = isoDate(field(raw, 'source_as_of'))
    const cohortDate = isoDate(field(raw, 'cohort_date'))
    const agentName = String(field(raw, 'agent_name') ?? '').trim()
    const agentEmail = String(field(raw, 'agent_email') ?? '').trim().toLowerCase()
    const n = positiveInteger(field(raw, 'n'))
    const paid = nonNegativeInteger(field(raw, 'paid'), 'snowflake_response_invalid')
    const noDeposit = nonNegativeInteger(field(raw, 'no_deposit'), 'snowflake_response_invalid')
    const rescinded = nonNegativeInteger(field(raw, 'rescinded'), 'snowflake_response_invalid')
    const neverPaid = nonNegativeInteger(field(raw, 'never_paid'), 'snowflake_response_invalid')
    sourceDates.add(sourceAsOf)
    expectedRows.add(nonNegativeInteger(field(raw, 'source_aggregate_rows'), 'snowflake_response_invalid'))
    expectedEnrollments.add(nonNegativeInteger(field(raw, 'source_enrollments'), 'snowflake_response_invalid'))
    rawRows.add(nonNegativeInteger(field(raw, 'source_raw_rows'), 'snowflake_response_invalid'))
    distinctEnrollments.add(nonNegativeInteger(field(raw, 'source_distinct_enrollments'), 'snowflake_response_invalid'))

    const cutoff = new Date(`${sourceAsOf}T00:00:00Z`)
    cutoff.setUTCDate(cutoff.getUTCDate() - 10)
    if (
      !agentName || SYSTEM_AGENT_NAMES.has(agentName.toLowerCase())
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agentEmail)
      || cohortDate > cutoff.toISOString().slice(0, 10)
      || n !== paid + noDeposit
      || noDeposit !== rescinded + neverPaid
    ) return failure('snowflake_result_unreconciled')

    const key = `${cohortDate}\0${agentEmail}`
    if (keys.has(key)) return failure('snowflake_result_duplicate')
    keys.add(key)
    rows.push({
      cohort_date: cohortDate,
      agent_name: agentName,
      agent_email: agentEmail,
      n,
      paid,
      no_deposit: noDeposit,
      rescinded,
      never_paid: neverPaid,
    })
  }

  const sourceAsOf = oneValue(sourceDates, 'snowflake_result_unreconciled')
  if (sourceAsOf !== expectedSourceAsOf) return failure('snowflake_result_stale')
  const aggregateRows = oneValue(expectedRows, 'snowflake_result_unreconciled')
  const enrollments = oneValue(expectedEnrollments, 'snowflake_result_unreconciled')
  const sourceRawRows = oneValue(rawRows, 'snowflake_result_unreconciled')
  const sourceDistinctEnrollments = oneValue(distinctEnrollments, 'snowflake_result_unreconciled')
  const actualEnrollments = rows.reduce((sum, row) => sum + row.n, 0)
  if (
    aggregateRows !== rows.length
    || enrollments !== actualEnrollments
    || sourceRawRows !== sourceDistinctEnrollments
    || sourceDistinctEnrollments !== actualEnrollments
  ) return failure('snowflake_result_unreconciled')

  return {
    sourceAsOf,
    expectedAggregateRows: aggregateRows,
    expectedEnrollments: enrollments,
    sourceRawRows,
    sourceDistinctEnrollments,
    rows,
  }
}

function planTerminationEnrollments(
  columns: ReadonlyArray<string>,
  values: ReadonlyArray<ReadonlyArray<unknown>>,
  expectedSourceAsOf: string,
): TerminationEnrollmentPlan {
  if (values.length === 0) return failure('snowflake_result_empty')
  if (
    columns.length !== TERMINATION_ENROLLMENT_COLUMNS.length
    || TERMINATION_ENROLLMENT_COLUMNS.some(column => !columns.includes(column))
  ) return failure('snowflake_response_invalid')
  const indexes = new Map(columns.map((column, index) => [column, index]))
  const sourceDates = new Set<string>()
  const expectedRows = new Set<number>()
  const expectedEnrollments = new Set<number>()
  const rawRows = new Set<number>()
  const distinctEnrollments = new Set<number>()
  const keys = new Set<string>()
  const rows: Array<TerminationEnrollmentAggregateRow> = []
  const field = (row: ReadonlyArray<unknown>, name: typeof TERMINATION_ENROLLMENT_COLUMNS[number]): unknown => {
    const index = indexes.get(name)
    return index === undefined ? undefined : row[index]
  }

  for (const raw of values) {
    const sourceAsOf = isoDate(field(raw, 'source_as_of'))
    const enrollmentDate = isoDate(field(raw, 'enrollment_date'))
    const agentEmail = String(field(raw, 'agent_email') ?? '').trim().toLowerCase()
    const enrollments = positiveInteger(field(raw, 'enrollments'))
    sourceDates.add(sourceAsOf)
    expectedRows.add(nonNegativeInteger(field(raw, 'source_aggregate_rows'), 'snowflake_response_invalid'))
    expectedEnrollments.add(nonNegativeInteger(field(raw, 'source_enrollments'), 'snowflake_response_invalid'))
    rawRows.add(nonNegativeInteger(field(raw, 'source_raw_rows'), 'snowflake_response_invalid'))
    distinctEnrollments.add(nonNegativeInteger(field(raw, 'source_distinct_enrollments'), 'snowflake_response_invalid'))
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agentEmail)
      || enrollmentDate > sourceAsOf
    ) return failure('snowflake_result_unreconciled')
    const key = `${enrollmentDate}\0${agentEmail}`
    if (keys.has(key)) return failure('snowflake_result_duplicate')
    keys.add(key)
    rows.push({ enrollment_date: enrollmentDate, agent_email: agentEmail, enrollments })
  }

  const sourceAsOf = oneValue(sourceDates, 'snowflake_result_unreconciled')
  if (sourceAsOf !== expectedSourceAsOf) return failure('snowflake_result_stale')
  const aggregateRows = oneValue(expectedRows, 'snowflake_result_unreconciled')
  const enrollments = oneValue(expectedEnrollments, 'snowflake_result_unreconciled')
  const sourceRawRows = oneValue(rawRows, 'snowflake_result_unreconciled')
  const sourceDistinctEnrollments = oneValue(distinctEnrollments, 'snowflake_result_unreconciled')
  const actualEnrollments = rows.reduce((sum, row) => sum + row.enrollments, 0)
  if (
    aggregateRows !== rows.length
    || enrollments !== actualEnrollments
    || sourceRawRows < sourceDistinctEnrollments
    || sourceDistinctEnrollments !== actualEnrollments
  ) return failure('snowflake_result_unreconciled')
  return {
    sourceAsOf,
    expectedAggregateRows: aggregateRows,
    expectedEnrollments: enrollments,
    sourceRawRows,
    sourceDistinctEnrollments,
    rows,
  }
}

function planFirstPayEnrollments(
  columns: ReadonlyArray<string>,
  values: ReadonlyArray<ReadonlyArray<unknown>>,
  expectedSourceAsOf: string,
): FirstPayEnrollmentPlan {
  if (values.length === 0) return failure('snowflake_result_empty')
  if (
    columns.length !== FIRST_PAY_ENROLLMENT_COLUMNS.length
    || FIRST_PAY_ENROLLMENT_COLUMNS.some(column => !columns.includes(column))
  ) return failure('snowflake_response_invalid')
  const indexes = new Map(columns.map((column, index) => [column, index]))
  const sourceDates = new Set<string>()
  const rawRows = new Set<number>()
  const distinctEnrollments = new Set<number>()
  const exportRows = new Set<number>()
  const distinctAffNumbers = new Set<number>()
  const blankAffNumbers = new Set<number>()
  const keys = new Set<string>()
  const rows: Array<FirstPayEnrollmentRow> = []
  const field = (row: ReadonlyArray<unknown>, name: typeof FIRST_PAY_ENROLLMENT_COLUMNS[number]): unknown => {
    const index = indexes.get(name)
    return index === undefined ? undefined : row[index]
  }

  for (const raw of values) {
    const affNumber = String(field(raw, 'aff_number') ?? '').trim()
    const normalizedAffNumber = affNumber.toLowerCase()
    const wcAgentEmail = String(field(raw, 'wc_agent_email') ?? '').trim().toLowerCase()
    sourceDates.add(isoDate(field(raw, 'source_as_of')))
    rawRows.add(nonNegativeInteger(field(raw, 'source_raw_rows'), 'snowflake_response_invalid'))
    distinctEnrollments.add(nonNegativeInteger(field(raw, 'source_distinct_enrollments'), 'snowflake_response_invalid'))
    exportRows.add(nonNegativeInteger(field(raw, 'export_rows'), 'snowflake_response_invalid'))
    distinctAffNumbers.add(nonNegativeInteger(field(raw, 'source_distinct_aff_numbers'), 'snowflake_response_invalid'))
    blankAffNumbers.add(nonNegativeInteger(field(raw, 'source_blank_aff_numbers'), 'snowflake_response_invalid'))
    if (
      affNumber.length === 0 || affNumber.length > 255 || /[\r\n\0]/.test(affNumber)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wcAgentEmail)
      || wcAgentEmail.length > 254
      || keys.has(normalizedAffNumber)
    ) return failure(keys.has(normalizedAffNumber) ? 'snowflake_result_duplicate' : 'snowflake_result_unreconciled')
    keys.add(normalizedAffNumber)
    rows.push({
      affNumber,
      normalizedAffNumber,
      enrollmentDate: optionalIsoDate(field(raw, 'enrollment_date')),
      terminationDate: optionalIsoDate(field(raw, 'termination_date')),
      clientDepositFlag: booleanValue(field(raw, 'client_deposit_flag')),
      terminationBeforeFirstPayFlag: booleanValue(field(raw, 'termination_before_first_pay_flag')),
      originalScheduledFirstPayDate: isoDate(field(raw, 'original_scheduled_first_pay_date')),
      wcAgentEmail,
    })
  }

  const sourceAsOf = oneValue(sourceDates, 'snowflake_result_unreconciled')
  if (sourceAsOf !== expectedSourceAsOf) return failure('snowflake_result_stale')
  const sourceRawRows = oneValue(rawRows, 'snowflake_result_unreconciled')
  const sourceDistinctEnrollments = oneValue(distinctEnrollments, 'snowflake_result_unreconciled')
  const expectedRows = oneValue(exportRows, 'snowflake_result_unreconciled')
  const expectedDistinctAffNumbers = oneValue(distinctAffNumbers, 'snowflake_result_unreconciled')
  const expectedBlankAffNumbers = oneValue(blankAffNumbers, 'snowflake_result_unreconciled')
  if (
    sourceRawRows < sourceDistinctEnrollments
    || sourceDistinctEnrollments !== rows.length
    || expectedRows !== rows.length
    || expectedDistinctAffNumbers !== rows.length
    || expectedBlankAffNumbers !== 0
  ) return failure('snowflake_result_unreconciled')
  return { sourceAsOf, sourceRawRows, sourceDistinctEnrollments, rows }
}

/** Query every Snowflake result partition and return one fail-closed aggregate snapshot. */
export async function fetchSnowflakeOutcomeSnapshot(
  config: SnowflakeOutcomeConfig,
  now: Date,
  options: SnowflakeRequestOptions = {},
): Promise<OutcomeSnapshotPlan> {
  const result = await snowflakeRows(config, OUTCOME_QUERY, now, options)
  return planSnapshot(result.columns, result.rows, now.toISOString().slice(0, 10))
}

/** Return source-reconciled enrollment-date buckets for termination monitoring. */
export async function fetchSnowflakeTerminationEnrollments(
  config: SnowflakeOutcomeConfig,
  now: Date,
  options: SnowflakeRequestOptions = {},
): Promise<TerminationEnrollmentPlan> {
  const result = await snowflakeRows(config, TERMINATION_ENROLLMENT_QUERY, now, options)
  return planTerminationEnrollments(result.columns, result.rows, now.toISOString().slice(0, 10))
}

/** Return the source-reconciled full-history rows for one weekly email only. */
export async function fetchSnowflakeFirstPayEnrollments(
  config: SnowflakeOutcomeConfig,
  now: Date,
  options: SnowflakeRequestOptions = {},
): Promise<FirstPayEnrollmentPlan> {
  const result = await snowflakeRows(config, FIRST_PAY_ENROLLMENT_QUERY, now, options)
  return planFirstPayEnrollments(result.columns, result.rows, now.toISOString().slice(0, 10))
}
