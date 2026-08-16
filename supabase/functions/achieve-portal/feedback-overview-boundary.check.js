// Contract guard for the complete-Form aggregate path across the authenticated
// Edge Function and browser query adapter.
// Run: node supabase/functions/achieve-portal/feedback-overview-boundary.check.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const queries = readFileSync(new URL('../../../src/lib/achieve-queries.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../../src/pages/AchievePortalPage.tsx', import.meta.url), 'utf8')

for (const required of [
  'body.action === "get_feedback_overview"',
  'get_achieve_agent_feedback_dashboard',
  'p_representative_limit: MAX_FEEDBACK_REPRESENTATIVES',
]) {
  assert.ok(index.includes(required), `missing Edge Function aggregate contract: ${required}`)
}

assert.doesNotMatch(
  index,
  /Promise\.all\([\s\S]{0,400}get_achieve_agent_feedback_(?:overview|by_rep)/,
  'dashboard aggregates must come from one database RPC snapshot',
)
assert.ok(queries.includes("invokePortal('get_feedback_overview')"))
assert.ok(queries.includes('parseAchieveFeedbackDashboard(response)'))
assert.ok(page.includes("useState<'agent-feedback' | 'qa-matching'>('agent-feedback')"))
assert.ok(page.includes('dashboard={feedbackDashboardQuery.data}'))
assert.ok(page.includes('QA &amp; Matching'))

console.log('feedback-overview-boundary.check.js: all assertions passed')
