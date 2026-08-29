import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('./20260829160000_achieve_first_pay_enrollment_export_qa.sql', import.meta.url), 'utf8')
for (const expected of [
  'create function private.achieve_exact_call_clients',
  'having count(distinct candidate.sfdc_lead_id) = 1',
  'having count(distinct candidate.normalized_client_id) = 1',
  "lower(btrim(feedback.call_quality)) in ('good', 'fair', 'poor')",
  'private.achieve_is_ordinary_graded_qa',
  "set statement_timeout = '60s'",
  'bool_or(module_result.has_violation is true)',
  "when 'poor' then 3",
  'grant execute on function public.get_achieve_first_pay_export_qa_rollups()',
]) assert.ok(sql.includes(expected), `missing ${expected}`)
for (const forbidden of ['client name', 'address', 'balance', 'transcript', 'grant execute on function public.get_achieve_first_pay_export_qa_rollups()\n  to authenticated']) {
  assert.ok(!sql.toLowerCase().includes(forbidden), `unsafe export SQL contains ${forbidden}`)
}
console.log('achieve-first-pay-enrollment-export.check.js: all assertions passed')
