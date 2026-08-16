// Focused contract guard for the WC Agent Summary AI migration.
// Run: node supabase/migrations/achieve-feedback-leadership-overview.check.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationUrl = new URL('./20260816120000_achieve_wc_agent_summary_ai.sql', import.meta.url)
const sql = readFileSync(migrationUrl, 'utf8')

for (const required of [
  'private.achieve_is_ordinary_graded_qa',
  'private.achieve_exact_call_agents',
  'private.achieve_ordinary_qa_attributed',
  'public.get_achieve_agent_feedback_overview',
  'public.list_achieve_agent_feedback_by_rep',
  'public.get_achieve_agent_feedback_dashboard',
  'public.list_achieve_agent_feedback_for_rep',
  "p_module_name = 'achieve_welcome_call_qa'",
  `coalesce(p_result_json->'grading_skipped', 'false'::jsonb) = 'false'::jsonb`,
  `coalesce(p_result_json#>'{transcript_segment,used_full_transcript_fallback}', 'false'::jsonb) = 'false'::jsonb`,
  `p_result_json->>'skip_reason' is distinct from 'competitor_transfer'`,
  'having count(distinct candidate.sfdc_lead_id) = 1',
  'having count(distinct candidate.normalized_client_id) = 1',
  "having count(distinct nullif(lower(btrim(log.welcome_call_agent_email)), '')) = 1",
  "when 'fair' then true",
  "when 'poor' then true",
  "feedback.rating <> 'other'",
  "'all_graded'",
  "'exact_agent_attributed'",
  "'agent_unavailable'",
  "'both_clear'",
  "'both_concern'",
  "'human_only'",
  "'ai_only'",
  "'distinct_any_agents'",
  "'qa_rows'",
  'qa.module_result_id',
  "set search_path = ''",
  'from public, anon, authenticated',
  'to service_role',
]) {
  assert.ok(sql.includes(required), `missing WC Agent Summary contract: ${required}`)
}

assert.equal(
  (sql.match(/where private\.achieve_is_ordinary_graded_qa\(/g) ?? []).length,
  2,
  'exact attribution and all-QA totals must share the ordinary-grade predicate',
)
assert.equal(
  (sql.match(/p_result_json->'grading_skipped'/g) ?? []).length,
  1,
  'ordinary-grade exclusions must have one SQL definition',
)
assert.doesNotMatch(sql, /grant execute[\s\S]{0,100}to authenticated/i)
assert.doesNotMatch(sql, /lead_phone_raw|contact_phone|original_transcript/, 'summary RPC must not expose private call fields')
assert.match(
  sql,
  /count\(\*\) filter \(where qa\.ai_flagged\)/,
  'attributed QA outcomes must count module results',
)

console.log('achieve-feedback-leadership-overview.check.js: all assertions passed')
