// Static guard for the weekly report ledger, security boundary, and ET-safe cron.
// Run: node supabase/migrations/achieve-weekly-management-report.check.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('./20260821163126_achieve_weekly_management_report.sql', import.meta.url), 'utf8')

for (const required of [
  'create table if not exists public.achieve_weekly_report_sends',
  "status in ('sending', 'sent')",
  'alter table public.achieve_weekly_report_sends enable row level security',
  'alter table public.achieve_weekly_report_sends force row level security',
  'revoke all on table public.achieve_weekly_report_sends from public, anon, authenticated',
  "'*/15 13,14 * * 1'",
  "where name = 'achieve_weekly_report_secret'",
  '/functions/v1/achieve-weekly-report',
  "'x-report-secret'",
]) {
  assert.ok(sql.includes(required), `missing weekly report invariant: ${required}`)
}
assert.match(sql, /body\s*:=\s*'\{"action":"scheduled"\}'::jsonb/)
assert.match(sql, /timeout_milliseconds\s*:=\s*30000/)

console.log('achieve-weekly-management-report.check.js: all assertions passed')
