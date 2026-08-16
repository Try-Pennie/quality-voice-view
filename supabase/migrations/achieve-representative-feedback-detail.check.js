// Contract guard for per-representative Pennie feedback detail.
// Run: node supabase/migrations/achieve-representative-feedback-detail.check.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationUrl = new URL('./20260816110000_achieve_representative_feedback_detail.sql', import.meta.url)
const sql = readFileSync(migrationUrl, 'utf8')

for (const required of [
  'public.list_achieve_agent_feedback_for_rep',
  "normalized_agent_email text := nullif(lower(btrim(p_agent_email)), '')",
  'private.achieve_agent_feedback_attributed(null, null)',
  'attributed.achieve_agent_email = normalized_agent_email',
  'attributed.feedback_id',
  'attributed.submitted_at',
  'attributed.rating',
  'nullif(btrim(feedback.notes)',
  'nullif(btrim(feedback.submitted_by)',
  "set search_path = ''",
  'from public, anon, authenticated',
  'to service_role',
]) {
  assert.ok(sql.includes(required), `missing representative detail contract: ${required}`)
}

for (const forbidden of [
  'lead_phone_raw',
  'matched_eavesly_call_id',
  'matched_call_id',
  'sfdc_lead_id',
]) {
  assert.ok(!sql.includes(forbidden), `internal identifier leaked into detail migration: ${forbidden}`)
}

assert.doesNotMatch(sql, /grant execute[\s\S]{0,100}to authenticated/i)

console.log('achieve-representative-feedback-detail.check.js: all assertions passed')
