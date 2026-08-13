// Focused migration contract check. This does not replace applying the migration
// to representative Postgres; it guards the high-risk audit/association clauses
// against accidental removal during review.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationUrl = new URL('./20260813120000_achieve_feedback_matcher_v3.sql', import.meta.url)
const sql = readFileSync(migrationUrl, 'utf8')

for (const required of [
  "feedback.matched_call_id is null\n      and feedback.matched_eavesly_call_id is null",
  "matched_call_id = case when decision.has_ordinary_qa then decision.selected_call_id else null end",
  "module_result.module_name = 'achieve_welcome_call_qa'",
  "module_result.result_json @> '{\"backfill\":{\"audit_only\":true}}'::jsonb",
  "not (module_result.result_json @> '{\"backfill\":{\"audit_only\":true}}'::jsonb)",
  "resolution.phone_normalized is null or resolution.phone_normalized !~ '^[0-9]{10}$' then null",
  "'unique_qa_phone_time'",
  "'transcript_agent_name_phone_time'",
  "cardinality(regexp_split_to_array(resolution.achieve_name_normalized, '[[:space:]]+')) >= 2",
  "when call_match_provenance = 'deterministic' then null",
  "'unique_phone_time_no_submitter'",
  'report_achieve_agent_feedback_matches_v3',
  'get_achieve_feedback_match_totals',
  'list_achieve_feedback_exceptions',
  'set search_path = \'\'',
]) {
  assert.ok(sql.includes(required), `missing migration contract: ${required}`)
}

assert.match(
  sql,
  /revoke execute on function public\.match_achieve_agent_feedback\(\)[\s\S]*?from public, anon, authenticated;[\s\S]*?grant execute[\s\S]*?to service_role;/,
)
assert.doesNotMatch(
  sql,
  /phone_normalized !~ '\^\[0-9\]\{10\}\$'[\s\S]{0,300}global_calls\.unique_call_id/,
  'invalid phones must not fall through to global call matching',
)
assert.match(
  sql,
  /p_category = 'true_qa_absent'[\s\S]*?not exists \([\s\S]*?module_result\.module_name = 'achieve_welcome_call_qa'/,
)

console.log('achieve-feedback-matcher-v3.check.js: all assertions passed')
