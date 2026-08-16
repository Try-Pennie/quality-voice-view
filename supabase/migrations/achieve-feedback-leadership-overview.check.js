// Focused contract guard for the complete-Form Achieve leadership RPCs.
// Run: node supabase/migrations/achieve-feedback-leadership-overview.check.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationUrl = new URL('./20260816100000_achieve_feedback_leadership_overview.sql', import.meta.url)
const sql = readFileSync(migrationUrl, 'utf8')

for (const required of [
  'private.achieve_agent_feedback_attributed',
  'public.get_achieve_agent_feedback_overview',
  'public.list_achieve_agent_feedback_by_rep',
  'public.get_achieve_agent_feedback_dashboard',
  "feedback.matched_eavesly_call_id is not null",
  "module_result.module_name = 'achieve_welcome_call_qa'",
  'having count(distinct candidate.sfdc_lead_id) = 1',
  "having count(distinct nullif(lower(btrim(log.welcome_call_agent_email)), '')) = 1",
  "feedback.call_match_reason = 'call_ambiguous'",
  "set search_path = ''",
  'from public, anon, authenticated',
  'to service_role',
]) {
  assert.ok(sql.includes(required), `missing leadership aggregate contract: ${required}`)
}

assert.doesNotMatch(sql, /grant execute[\s\S]{0,100}to authenticated/i)
assert.doesNotMatch(sql, /matched_call_id\s+is\s+not\s+null[\s\S]{0,80}total_submissions/i)
assert.match(
  sql,
  /count\(\*\) filter \(where feedback\.rating = 'good'\)/,
  'ratings must count individual Form submissions',
)
assert.match(
  sql,
  /select jsonb_build_object\([\s\S]*'overview',[\s\S]*'representatives'/,
  'dashboard RPC must return both aggregates from one SQL statement snapshot',
)

console.log('achieve-feedback-leadership-overview.check.js: all assertions passed')
