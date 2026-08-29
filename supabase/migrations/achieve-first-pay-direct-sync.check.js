// Static guard for the daily direct Snowflake sync ledger, security boundary,
// and pre-report schedule. Run:
//   node supabase/migrations/achieve-first-pay-direct-sync.check.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('./20260829150000_achieve_first_pay_direct_sync.sql', import.meta.url), 'utf8')
const config = await readFile(new URL('../config.toml', import.meta.url), 'utf8')

for (const required of [
  'create table public.achieve_first_pay_outcome_sync_runs',
  "status text not null check (status in ('running', 'succeeded', 'failed'))",
  'alter table public.achieve_first_pay_outcome_sync_runs enable row level security',
  'alter table public.achieve_first_pay_outcome_sync_runs force row level security',
  'revoke all on table public.achieve_first_pay_outcome_sync_runs from public, anon, authenticated',
  "where jobname = 'achieve_first_pay_outcome_sync'",
  "'0 12 * * *'",
  '/functions/v1/achieve-first-pay-sync',
  "where name = 'achieve_weekly_report_secret'",
  `body := '{"action":"scheduled"}'::jsonb`,
  'timeout_milliseconds := 120000',
]) assert.ok(sql.includes(required), `missing direct-sync invariant: ${required}`)

assert.ok(config.includes('[functions.achieve-first-pay-sync]'))
assert.match(config, /\[functions\.achieve-first-pay-sync\][\s\S]*?verify_jwt = false/)
assert.doesNotMatch(sql, /grant[^;]*delete[^;]*achieve_first_pay_outcome_sync_runs/i)

console.log('achieve-first-pay-direct-sync.check.js: all assertions passed')
