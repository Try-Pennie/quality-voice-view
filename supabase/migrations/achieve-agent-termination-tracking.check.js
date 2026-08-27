// Static guard for termination seeds, service-only access, and post-term monitoring.
// Run: node supabase/migrations/achieve-agent-termination-tracking.check.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('./20260824120000_achieve_agent_termination_tracking.sql', import.meta.url), 'utf8')

for (const required of [
  'create table public.achieve_agent_terminations',
  'alter table public.achieve_agent_terminations enable row level security',
  'alter table public.achieve_agent_terminations force row level security',
  'revoke all on table public.achieve_agent_terminations from public, anon, authenticated',
  "('aadigun@achieve.com', 'Aliyu Adigun', '2026-08-25 04:00:00+00')",
  "('ddesravines@achieve.com', 'Darios Desravines', '2026-08-24 04:00:00+00')",
  "('whall@achieve.com', 'Wilma Hall', '2026-08-24 04:00:00+00')",
  'or attributed.submitted_at < termination.terminated_at',
  'or attributed.graded_at < termination.terminated_at',
  'create function public.list_achieve_agent_termination_monitoring',
  "log.last_seen_on >= (termination.terminated_at at time zone 'America/New_York')::date",
  'report_activity.latest_activity_on is not null as activity',
  'revoke execute on function public.list_achieve_agent_termination_monitoring(timestamptz)',
]) {
  assert.ok(sql.includes(required), `missing termination invariant: ${required}`)
}

console.log('achieve-agent-termination-tracking.check.js: all assertions passed')
