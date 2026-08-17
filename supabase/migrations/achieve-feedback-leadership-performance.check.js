// Contract guard for bounding the leadership attribution query to the selected
// feedback calls instead of scanning the complete Eavesly call corpus.
// Run: node supabase/migrations/achieve-feedback-leadership-performance.check.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationUrl = new URL('./20260816101000_optimize_achieve_feedback_attribution_scope.sql', import.meta.url)
const sql = readFileSync(migrationUrl, 'utf8')
const summaryScopeSql = readFileSync(
  new URL('./20260817141000_optimize_achieve_wc_summary_scope.sql', import.meta.url),
  'utf8',
)

for (const required of [
  'with filtered_feedback as materialized',
  'requested_calls as',
  'select distinct feedback.matched_eavesly_call_id as call_id',
  "where nullif(btrim(feedback.matched_eavesly_call_id), '') is not null",
  'join public.eavesly_calls as calls',
  'on calls.call_id = requested.call_id',
  'join public.eavesly_module_results as module_result',
  'module_result.call_id = requested.call_id',
  "module_result.module_name = 'achieve_welcome_call_qa'",
  'requested_clients as',
  "set search_path = ''",
]) {
  assert.ok(sql.includes(required), `missing bounded attribution contract: ${required}`)
}

assert.doesNotMatch(
  sql,
  /from public\.eavesly_calls as calls\s+where/,
  'call lookup must be driven by requested feedback call IDs',
)
assert.doesNotMatch(
  sql,
  /from public\.eavesly_module_results as module_result\s+where/,
  'module lookup must be driven by requested feedback call IDs',
)

assert.equal(
  (summaryScopeSql.match(/where module_result\.module_name = 'achieve_welcome_call_qa'\s+and private\.achieve_is_ordinary_graded_qa\(/g) ?? []).length,
  2,
  'ordinary QA detail and total scans must expose the Achieve module scope to the planner',
)
assert.doesNotMatch(
  summaryScopeSql,
  /from public\.eavesly_module_results as module_result\s+where private\.achieve_is_ordinary_graded_qa\(/,
  'ordinary QA scans must not hide module scope inside the SECURITY DEFINER predicate',
)

console.log('achieve-feedback-leadership-performance.check.js: all assertions passed')
