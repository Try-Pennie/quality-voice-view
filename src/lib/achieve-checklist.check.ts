// Self-check for deriveChecklist — no test runner in this repo by design.
// Run: npx tsx src/lib/achieve-checklist.check.ts
import assert from 'node:assert'
import { deriveChecklist } from './achieve-checklist'

// 1. Booleans-only input: two false flags -> 4 covered.
const bools = deriveChecklist({
  welcome_greeting_completed: true,
  program_overview_covered: false,
  payment_process_explained: true,
  timeline_expectations_covered: false,
  client_communication_process_covered: true,
  next_steps_provided: true,
})
assert.strictEqual(bools.coveredCount, 4)
assert.strictEqual(bools.rows.find(r => r.key === 'program_overview')!.isCovered, false)
assert.strictEqual(bools.rows.find(r => r.key === 'welcome_greeting')!.isCovered, true)

// 2. missing_elements-only, base spelling (matches real screenshot data).
const baseMissing = deriveChecklist({
  missing_elements: ['program_overview', 'timeline_expectations', 'client_communication_process'],
})
assert.strictEqual(baseMissing.coveredCount, 3)
assert.strictEqual(baseMissing.rows.find(r => r.key === 'program_overview')!.isCovered, false)

// 3. missing_elements-only, suffixed spelling -> loose startsWith still catches it.
const suffixMissing = deriveChecklist({ missing_elements: ['next_steps_provided'] })
assert.strictEqual(suffixMissing.rows.find(r => r.key === 'next_steps')!.isCovered, false)
assert.strictEqual(suffixMissing.coveredCount, 5)

// 4. Both present and agreeing -> counted once.
const both = deriveChecklist({ program_overview_covered: false, missing_elements: ['program_overview'] })
assert.strictEqual(both.rows.find(r => r.key === 'program_overview')!.isCovered, false)
assert.strictEqual(both.coveredCount, 5)

// 5. Empty / undefined -> all 6 default to covered.
assert.strictEqual(deriveChecklist({}).coveredCount, 6)
assert.strictEqual(deriveChecklist(undefined).coveredCount, 6)

console.log('achieve-checklist: all checks passed')
