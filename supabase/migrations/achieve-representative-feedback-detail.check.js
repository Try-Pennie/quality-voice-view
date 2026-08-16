// Contract guard for Form + AI per-representative detail.
// Run: node supabase/migrations/achieve-representative-feedback-detail.check.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('./20260816120000_achieve_wc_agent_summary_ai.sql', import.meta.url), 'utf8')
const detail = sql.slice(sql.indexOf('create or replace function public.list_achieve_agent_feedback_for_rep'))

for (const required of [
  'private.achieve_agent_feedback_attributed(null, null)',
  'private.achieve_ordinary_qa_attributed(null, null)',
  'attributed.achieve_agent_email = normalized_agent_email',
  'qa.achieve_agent_email = normalized_agent_email',
  'nullif(btrim(feedback.notes)',
  "case when qa.ai_flagged then 'flagged' else 'pass' end",
  "'qa_rows'",
  "'qa_coverage'",
  'ponytail: this all-history detail path currently scales with complete Form',
  'materialized per-call exact-attribution relation',
  "set search_path = ''",
  'from public, anon, authenticated',
  'to service_role',
]) {
  assert.ok(detail.includes(required), `missing representative detail contract: ${required}`)
}

for (const forbidden of ['lead_phone_raw', 'matched_eavesly_call_id', 'matched_call_id', 'sfdc_lead_id', 'call_id']) {
  assert.ok(!detail.includes(forbidden), `internal identifier leaked into representative response: ${forbidden}`)
}
assert.doesNotMatch(detail, /grant execute[\s\S]{0,100}to authenticated/i)

console.log('achieve-representative-feedback-detail.check.js: all assertions passed')
