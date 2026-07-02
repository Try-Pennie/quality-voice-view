// Self-check for deriveChecklist — no test runner in this repo by design.
// Run: npx tsx src/lib/achieve-checklist.check.ts
import assert from 'node:assert'
import {
  ACHIEVE_ELEMENTS_V0,
  ACHIEVE_ELEMENTS_V1,
  adherenceLabel,
  deriveChecklist,
  humanizeElementKeys,
  selectAchieveElements,
} from './achieve-checklist'

// --- Element set selection -------------------------------------------------

// V1 chosen by explicit script version, and by any later version.
assert.strictEqual(selectAchieveElements('fdr_wholesale_db_pilot_v1'), ACHIEVE_ELEMENTS_V1)
assert.strictEqual(selectAchieveElements('fdr_wholesale_db_pilot_v2'), ACHIEVE_ELEMENTS_V1)
// V0 chosen by explicit v0 version, or with no signal at all.
assert.strictEqual(selectAchieveElements('fdr_wholesale_db_pilot_v0'), ACHIEVE_ELEMENTS_V0)
assert.strictEqual(selectAchieveElements(), ACHIEVE_ELEMENTS_V0)
// Robust default: a v1-only flag forces V1 even when the version is missing.
assert.strictEqual(
  selectAchieveElements(undefined, { recording_disclosure_provided: false }),
  ACHIEVE_ELEMENTS_V1,
)
// A v0-only flag keeps V0.
assert.strictEqual(
  selectAchieveElements(undefined, { welcome_greeting_completed: true }),
  ACHIEVE_ELEMENTS_V0,
)

assert.strictEqual(ACHIEVE_ELEMENTS_V1.length, 10)
assert.strictEqual(ACHIEVE_ELEMENTS_V0.length, 6)
// Every element carries a non-empty section for grouping.
assert.ok(ACHIEVE_ELEMENTS_V1.every(el => typeof el.section === 'string' && el.section.length > 0))
assert.ok(ACHIEVE_ELEMENTS_V0.every(el => typeof el.section === 'string' && el.section.length > 0))

// --- V1 derivation ---------------------------------------------------------

// Booleans-only V1 input: recording disclosure missing -> 9/10 covered, and
// rows carry their script section.
const v1 = deriveChecklist(
  {
    greeting_and_identity_completed: true,
    recording_disclosure_provided: false,
    company_credibility_covered: true,
    call_agenda_provided: true,
    dedicated_account_deposits_explained: true,
    creditor_negotiation_explained: true,
    settlement_authorizations_explained: true,
    dashboard_account_setup_covered: true,
    tools_and_resources_covered: true,
    closing_and_support_provided: true,
  },
  'fdr_wholesale_db_pilot_v1',
)
assert.strictEqual(v1.total, 10)
assert.strictEqual(v1.coveredCount, 9)
assert.strictEqual(v1.rows.find(r => r.key === 'recording_disclosure')!.isCovered, false)
assert.strictEqual(v1.rows.find(r => r.key === 'recording_disclosure')!.section, 'Introduction')
assert.strictEqual(v1.rows.find(r => r.key === 'dedicated_account_deposits')!.section, 'Three keys to success')
assert.strictEqual(v1.rows.find(r => r.key === 'dashboard_account_setup')!.section, 'Dashboard & tools')
assert.strictEqual(v1.rows.find(r => r.key === 'closing_and_support')!.section, 'Closing')

// missing_elements base spelling under V1 (auto-detected via the v1-only flag,
// no explicit version needed).
const v1Missing = deriveChecklist({
  recording_disclosure_provided: false,
  missing_elements: ['recording_disclosure', 'tools_and_resources'],
})
assert.strictEqual(v1Missing.total, 10)
assert.strictEqual(v1Missing.coveredCount, 8)
assert.strictEqual(v1Missing.rows.find(r => r.key === 'tools_and_resources')!.isCovered, false)

// --- V0 derivation still works for historical rows -------------------------

// Booleans-only: two false flags -> 4 covered.
const v0 = deriveChecklist(
  {
    welcome_greeting_completed: true,
    program_overview_covered: false,
    payment_process_explained: true,
    timeline_expectations_covered: false,
    client_communication_process_covered: true,
    next_steps_provided: true,
  },
  'fdr_wholesale_db_pilot_v0',
)
assert.strictEqual(v0.total, 6)
assert.strictEqual(v0.coveredCount, 4)
assert.strictEqual(v0.rows.find(r => r.key === 'program_overview')!.isCovered, false)

// missing_elements-only, base spelling.
const baseMissing = deriveChecklist({
  missing_elements: ['program_overview', 'timeline_expectations', 'client_communication_process'],
})
assert.strictEqual(baseMissing.coveredCount, 3)
assert.strictEqual(baseMissing.rows.find(r => r.key === 'program_overview')!.isCovered, false)

// missing_elements-only, suffixed spelling -> loose startsWith still catches it.
const suffixMissing = deriveChecklist({ missing_elements: ['next_steps_provided'] })
assert.strictEqual(suffixMissing.rows.find(r => r.key === 'next_steps')!.isCovered, false)
assert.strictEqual(suffixMissing.coveredCount, 5)

// Empty / undefined -> V0 default, all 6 covered.
assert.strictEqual(deriveChecklist({}).coveredCount, 6)
assert.strictEqual(deriveChecklist(undefined).coveredCount, 6)

// --- adherenceLabel (unchanged, all 5 levels) ------------------------------
assert.strictEqual(adherenceLabel('minimal'), 'Minimal — most required elements missing')
assert.strictEqual(adherenceLabel('substantial'), 'Substantial — most required elements covered')
assert.strictEqual(adherenceLabel('FULL'), 'Full — every required element covered')
assert.strictEqual(adherenceLabel('weird'), 'Weird')
assert.strictEqual(adherenceLabel(null), '—')

// --- humanizeElementKeys ----------------------------------------------------
// V1 keys swapped for friendly labels.
assert.strictEqual(
  humanizeElementKeys(
    'Missing: recording_disclosure, dedicated_account_deposits.',
    'fdr_wholesale_db_pilot_v1',
  ),
  'Missing: Recording disclosure, Dedicated Account & deposits.',
)
// V0 keys still humanize for old rows (no version -> V0).
assert.strictEqual(
  humanizeElementKeys('Missing: program_overview, timeline_expectations.'),
  'Missing: Program overview, Timeline expectations.',
)
assert.strictEqual(humanizeElementKeys('no keys here'), 'no keys here')

console.log('achieve-checklist: all checks passed')
