// Static deployment-safety guard; runtime behavior is covered by the adjacent
// TypeScript orchestration checks and PostgreSQL integration check.
// Run: node supabase/migrations/achieve-report-reliability.check.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('./20260921211000_achieve_report_reliability.sql', import.meta.url), 'utf8')
const weekly = await readFile(new URL('../functions/achieve-weekly-report/index.ts', import.meta.url), 'utf8')
const sync = await readFile(new URL('../functions/achieve-first-pay-sync/index.ts', import.meta.url), 'utf8')
const orchestration = await readFile(new URL('../functions/achieve-weekly-report/orchestration.ts', import.meta.url), 'utf8')

for (const required of [
  'begin;',
  "set local lock_timeout = '5s'",
  "set local statement_timeout = '30s'",
  'create function public.get_achieve_termination_monitoring_report',
  'create table public.achieve_reliability_alert_deliveries',
  'create function public.achieve_report_reliability_snapshot',
  'unexpected achieve weekly cron template; refusing reliability rewrite',
  'perform cron.alter_job(',
  "schedule := '*/15 * * * *'",
  'command := bounded_command',
  "'timeout_milliseconds := 120000'",
  'commit;',
]) assert.ok(migration.includes(required), `missing reliability SQL invariant: ${required}`)
assert.ok(!migration.includes('update cron.job'), 'Migration must use the supported cron.alter_job API')
assert.ok(!migration.includes('cron.schedule('), 'Staging-safe migration must not create an HTTP cron job')
assert.ok(!migration.includes('net.http_post('), 'Migration must only rewrite the existing authorized endpoint')

for (const source of [weekly, sync]) {
  const gate = source.indexOf('if (!isAchieveExternalIoAllowed(runtime))')
  assert.ok(gate >= 0, 'Missing explicit production external-I/O gate')
  for (const operation of ['fetchSnowflake', 'createClient(']) {
    const occurrence = source.indexOf(operation, gate)
    assert.ok(occurrence < 0 || gate < occurrence, `${operation} precedes the environment gate`)
  }
  assert.ok(source.includes('AbortSignal.timeout(HANDLER_DEADLINE_MS)'))
}
assert.ok(weekly.includes('parseAchieveSlackConfig(name => Deno.env.get(name))'))
assert.ok(weekly.includes("import { isAchieveExternalIoAllowed }"))
assert.ok(sync.includes("import { isAchieveExternalIoAllowed }"))
assert.ok(weekly.includes('postAchieveSlackAlert(slack, payload.text'))
assert.ok(weekly.includes("admin.rpc('achieve_report_cron_healthy')"))
assert.ok(!weekly.includes(".from('achieve_weekly_report_sends')\n        .delete()"), 'Ambiguous delivery claims must be retained')
assert.ok(orchestration.includes('markSent(weekEnding, messageId, { signal: AbortSignal.timeout(5_000) })'),
  'Confirmed Gmail delivery must get a fresh bounded five-second ledger write')

console.log('achieve-report-reliability.check.js: all assertions passed')
