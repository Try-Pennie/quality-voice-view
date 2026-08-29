// Behavior check for QA rollup parsing/joining and Geoff's exact CSV format.
// Run: npx tsx supabase/functions/_shared/achieve-first-pay-enrollment-export.check.ts
import assert from 'node:assert/strict'
import {
  achieveFirstPayEnrollmentCsv,
  parseFirstPayQaRollups,
} from './achieve-first-pay-enrollment-export.ts'
import type { FirstPayEnrollmentPlan, FirstPayEnrollmentRow } from './achieve-first-pay-outcomes.ts'

function enrollment(affNumber: string, overrides: Partial<FirstPayEnrollmentRow> = {}): FirstPayEnrollmentRow {
  return {
    affNumber,
    normalizedAffNumber: affNumber.toLowerCase(),
    enrollmentDate: '2026-08-01',
    terminationDate: null,
    clientDepositFlag: false,
    terminationBeforeFirstPayFlag: true,
    originalScheduledFirstPayDate: '2026-08-10',
    wcAgentEmail: 'agent@fdr.com',
    ...overrides,
  }
}

const qa = parseFirstPayQaRollups({
  rows: [
    { client_id: 'aff-poor', agent_rating: 'poor', ai_reviewed: true, ai_flagged: true },
    { client_id: 'aff-ai-pass', agent_rating: null, ai_reviewed: true, ai_flagged: false },
    { client_id: 'aff-fair', agent_rating: 'fair', ai_reviewed: false, ai_flagged: false },
  ],
  coverage: { rows: 3, human_clients: 2, ai_clients: 2 },
})
const plan: FirstPayEnrollmentPlan = {
  sourceAsOf: '2026-08-31',
  sourceRawRows: 5,
  sourceDistinctEnrollments: 5,
  rows: [
    enrollment('AFF-UNREVIEWED'),
    enrollment('AFF-POOR', { clientDepositFlag: true, terminationBeforeFirstPayFlag: false }),
    enrollment('AFF-AI-PASS'),
    enrollment('=AFF-FAIR'),
    enrollment('AFF-FAIR'),
  ],
}
const csv = achieveFirstPayEnrollmentCsv(plan, qa)
const lines = csv.split('\r\n')
assert.strictEqual(lines[0], 'AFF Number,Enrollment Date,Termination Date,Client Deposit Flag,Termination Before First Pay Flag,Original Scheduled First Pay Date,WC Agent Email,Agent Rating,AI Flag')
assert.strictEqual(lines.length, 7)
assert.ok(!csv.replaceAll('\r\n', '').includes('\n'))
assert.ok(csv.includes('"AFF-UNREVIEWED","2026-08-01","","false","true","2026-08-10","agent@fdr.com","",""'))
assert.ok(csv.includes('"AFF-POOR","2026-08-01","","true","false","2026-08-10","agent@fdr.com","Poor","true"'))
assert.ok(csv.includes('"AFF-AI-PASS","2026-08-01","","false","true","2026-08-10","agent@fdr.com","","false"'))
assert.ok(csv.includes('"AFF-FAIR","2026-08-01","","false","true","2026-08-10","agent@fdr.com","Fair",""'))
assert.ok(csv.includes('"\'=AFF-FAIR"'))
assert.ok(csv.indexOf('"\'=AFF-FAIR"') < csv.indexOf('"AFF-AI-PASS"'))

assert.throws(() => parseFirstPayQaRollups({
  rows: [
    { client_id: 'duplicate', agent_rating: 'good', ai_reviewed: false, ai_flagged: false },
    { client_id: ' DUPLICATE ', agent_rating: 'fair', ai_reviewed: false, ai_flagged: false },
  ],
  coverage: { rows: 2, human_clients: 2, ai_clients: 0 },
}), /achieve_first_pay_qa_rollup_invalid/)
assert.throws(() => parseFirstPayQaRollups({
  rows: [{ client_id: 'invalid', agent_rating: null, ai_reviewed: false, ai_flagged: false }],
  coverage: { rows: 1, human_clients: 0, ai_clients: 0 },
}), /achieve_first_pay_qa_rollup_invalid/)

console.log('achieve-first-pay-enrollment-export.check.ts: all assertions passed')
