// Daily Snowflake -> Supabase aggregate sync for Achieve first-pay outcomes.
//
// pg_cron invokes this before the Monday 9 AM ET report. Snowflake is queried
// with a five-minute key-pair JWT; only validated agent/cohort aggregates reach
// the existing transactional snapshot RPC. Raw enrollment rows and credentials
// are never persisted or logged.
//
// Required function secrets:
//   ACHIEVE_WEEKLY_REPORT_SECRET — shared with the existing report cron Vault secret
//   SNOWFLAKE_ACCOUNT_URL
//   SNOWFLAKE_ACCOUNT_IDENTIFIER
//   SNOWFLAKE_USER
//   SNOWFLAKE_ROLE
//   SNOWFLAKE_WAREHOUSE
//   SNOWFLAKE_DATABASE
//   SNOWFLAKE_SCHEMA
//   SNOWFLAKE_PRIVATE_KEY
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  fetchSnowflakeOutcomeSnapshot,
  OutcomeSyncFailure,
  snowflakeConfigFromEnv,
  type OutcomeSnapshotPlan,
  type SnowflakeOutcomeConfig,
} from '../_shared/achieve-first-pay-outcomes.ts'

type RequestAction = 'scheduled' | 'test'
type Config = SnowflakeOutcomeConfig & {
  readonly requestSecret: string
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
}

class SyncRunFailure extends Error {
  readonly name = 'SyncRunFailure'

  constructor(readonly code: 'ingest_failed' | 'ingest_response_invalid' | 'run_status_update_failed') {
    super(code)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: The runtime checks establish the indexable record invariant.
  return value as Readonly<Record<string, unknown>>
}

function parseAction(value: unknown): RequestAction | null {
  const body = record(value)
  if (!body || Object.keys(body).length !== 1) return null
  return body.action === 'scheduled' || body.action === 'test' ? body.action : null
}

function parseConfig(): Config | null {
  const requestSecret = Deno.env.get('ACHIEVE_WEEKLY_REPORT_SECRET')?.trim() ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? ''
  const snowflake = snowflakeConfigFromEnv(name => Deno.env.get(name))
  if (!requestSecret || !supabaseUrl || !serviceRoleKey || snowflake === null) return null
  return { requestSecret, supabaseUrl, serviceRoleKey, ...snowflake }
}

async function secretsMatch(supplied: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(suppliedHash)
  const right = new Uint8Array(expectedHash)
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

function rpcResultMatches(value: unknown, plan: OutcomeSnapshotPlan): boolean {
  const result = record(value)
  return result?.source_as_of === plan.sourceAsOf
    && Number(result?.aggregate_rows) === plan.expectedAggregateRows
    && Number(result?.enrollments) === plan.expectedEnrollments
}

function safeFailure(cause: unknown): {
  readonly code: string
  readonly dependencyStatus: number | null
  readonly providerCode: string | null
} {
  if (cause instanceof OutcomeSyncFailure) {
    return { code: cause.code, dependencyStatus: cause.status, providerCode: cause.providerCode }
  }
  if (cause instanceof SyncRunFailure) {
    return { code: cause.code, dependencyStatus: null, providerCode: null }
  }
  return { code: 'unexpected_failure', dependencyStatus: null, providerCode: null }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const config = parseConfig()
  if (!config) return json({ error: 'not_configured' }, 503)
  const suppliedSecret = request.headers.get('x-report-secret') ?? ''
  if (!suppliedSecret || !(await secretsMatch(suppliedSecret, config.requestSecret))) {
    return json({ error: 'unauthorized' }, 401)
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const action = parseAction(rawBody)
  if (!action) return json({ error: 'bad_request' }, 400)

  const now = new Date()
  const runDate = now.toISOString().slice(0, 10)
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey)
  let claimed = false

  if (action === 'scheduled') {
    const claim = await admin
      .from('achieve_first_pay_outcome_sync_runs')
      .insert({ run_date: runDate, status: 'running' })
    if (claim.error?.code === '23505') return json({ ok: true, skipped: 'already_claimed', run_date: runDate })
    if (claim.error) {
      console.error('achieve first-pay sync claim failed', { databaseCode: claim.error.code })
      return json({ error: 'claim_failed' }, 500)
    }
    claimed = true
  }

  try {
    const plan = await fetchSnowflakeOutcomeSnapshot(config, now)
    if (action === 'test') {
      return json({
        ok: true,
        mode: 'test',
        source_as_of: plan.sourceAsOf,
        aggregate_rows: plan.expectedAggregateRows,
        enrollments: plan.expectedEnrollments,
        source_raw_rows: plan.sourceRawRows,
        source_distinct_enrollments: plan.sourceDistinctEnrollments,
      })
    }

    const ingested = await admin.rpc('ingest_achieve_first_pay_outcome_snapshot', {
      p_source_as_of: plan.sourceAsOf,
      p_expected_aggregate_rows: plan.expectedAggregateRows,
      p_expected_enrollments: plan.expectedEnrollments,
      p_rows: plan.rows,
    })
    if (ingested.error) throw new SyncRunFailure('ingest_failed')
    if (!rpcResultMatches(ingested.data, plan)) throw new SyncRunFailure('ingest_response_invalid')

    const completed = await admin
      .from('achieve_first_pay_outcome_sync_runs')
      .update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
        source_as_of: plan.sourceAsOf,
        aggregate_rows: plan.expectedAggregateRows,
        enrollments: plan.expectedEnrollments,
        error_code: null,
      })
      .eq('run_date', runDate)
      .eq('status', 'running')
    if (completed.error) throw new SyncRunFailure('run_status_update_failed')

    return json({
      ok: true,
      mode: 'scheduled',
      run_date: runDate,
      source_as_of: plan.sourceAsOf,
      aggregate_rows: plan.expectedAggregateRows,
      enrollments: plan.expectedEnrollments,
    })
  } catch (cause: unknown) {
    const failure = safeFailure(cause)
    if (claimed) {
      const failed = await admin
        .from('achieve_first_pay_outcome_sync_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), error_code: failure.code })
        .eq('run_date', runDate)
        .eq('status', 'running')
      if (failed.error) {
        console.error('achieve first-pay sync failure status update failed', { databaseCode: failed.error.code })
      }
    }
    console.error('achieve first-pay sync failed', failure)
    return json({ error: failure.code }, 500)
  }
})
