// Required FDR welcome-call script elements the Achieve QA checker scores.
// Labels + definitions come from the FDR Welcome Call Script (Wholesale — DB
// Pilot); see docs/superpowers/specs/2026-07-02-achieve-drawer-clarity-design.md.
// `flag` is the boolean key on script_adherence; `missingKey` is the base name
// used in its missing_elements list (no suffix). Derivation checks both.

export type AchieveElement = {
  flag: string
  missingKey: string
  label: string
  definition: string
}

export const ACHIEVE_ELEMENTS: AchieveElement[] = [
  {
    flag: 'welcome_greeting_completed',
    missingKey: 'welcome_greeting',
    label: 'Welcome & greeting',
    definition:
      'Agent greeted the client, verified their identity, and gave the "recorded for quality" disclosure. (Script section 1 — Introduction)',
  },
  {
    flag: 'program_overview_covered',
    missingKey: 'program_overview',
    label: 'Program overview',
    definition:
      'Explained how the program works: the Dedicated Account, creditor negotiation, and restructured repayment terms (the "three keys"). (Script section 1)',
  },
  {
    flag: 'payment_process_explained',
    missingKey: 'payment_process',
    label: 'Payment process',
    definition:
      'Gave the client their first deposit date and how often deposits are made into the Dedicated Account. (Script — first key)',
  },
  {
    flag: 'timeline_expectations_covered',
    missingKey: 'timeline_expectations',
    label: 'Timeline expectations',
    definition:
      'Set expectations on settlement timing and authorizing new terms quickly to keep the program on track. (Script — keys 2 & 3)',
  },
  {
    flag: 'client_communication_process_covered',
    missingKey: 'client_communication_process',
    label: 'Client communication',
    definition:
      'Covered how the client hears from FDR: app/dashboard/email/text notifications, the customer-service line (800-655-6303), and "here 7 days a week". (Script — Dashboard/Closing)',
  },
  {
    flag: 'next_steps_provided',
    missingKey: 'next_steps',
    label: 'Next steps',
    definition:
      'Walked through account/app setup and the Program Guide email so the client knows what to do after the call. (Script — Dashboard/Tools)',
  },
]

// Jargon shown around the drawer, defined self-contained (external reviewers
// cannot reach the internal /dashboard/help glossary).
export const ACHIEVE_TERMS: Record<string, { label: string; definition: string }> = {
  script_adherence: {
    label: 'Script adherence',
    definition:
      'How closely the agent followed the required welcome-call script. "Full" = every required element covered; "minimal" = most required elements missing.',
  },
  confidence: {
    label: 'Confidence',
    definition:
      'How sure the automated checker is about this result, based on transcript and audio quality. Low confidence is worth a closer listen to the recording.',
  },
  needs_review: {
    label: 'Needs review',
    definition: "A human reviewer hasn't confirmed this automated result yet.",
  },
  supporting_quotes: {
    label: 'Supporting quotes',
    definition:
      'Verbatim snippets pulled from the call transcript that the checker used as evidence for its result.',
  },
}

export type ChecklistRow = {
  key: string
  label: string
  definition: string
  isCovered: boolean
}
export type Checklist = { rows: ChecklistRow[]; coveredCount: number; total: number }

type Adherence = { missing_elements?: unknown; [flag: string]: unknown }

export function deriveChecklist(adherence: Adherence | null | undefined): Checklist {
  const a = adherence ?? {}
  const missing = Array.isArray(a.missing_elements)
    ? (a.missing_elements as unknown[]).filter((m): m is string => typeof m === 'string')
    : []

  const rows: ChecklistRow[] = ACHIEVE_ELEMENTS.map(el => {
    const isMissing =
      a[el.flag] === false ||
      missing.some(m => m === el.missingKey || m.startsWith(el.missingKey))
    return { key: el.missingKey, label: el.label, definition: el.definition, isCovered: !isMissing }
  })

  return { rows, coveredCount: rows.filter(r => r.isCovered).length, total: rows.length }
}

// The checker's overall_script_adherence is a bare jargon word ("minimal").
// Map it to a plain phrase reviewers can read at a glance; fall back to the
// capitalized raw value for anything unrecognized.
const ADHERENCE_LABELS: Record<string, string> = {
  full: 'Full — every required element covered',
  substantial: 'Substantial — most required elements covered',
  partial: 'Partial — some required elements missing',
  minimal: 'Minimal — most required elements missing',
  none: 'None — required elements not covered',
}

export function adherenceLabel(level: string | null | undefined): string {
  if (!level) return '—'
  return ADHERENCE_LABELS[level.toLowerCase()] ?? level.charAt(0).toUpperCase() + level.slice(1)
}

// The checker's violation_reason prose embeds raw element keys
// ("program_overview, timeline_expectations"). Swap each for its friendly
// label so the reason reads plainly and matches the checklist above it.
export function humanizeElementKeys(text: string): string {
  let out = text
  for (const el of ACHIEVE_ELEMENTS) {
    out = out.replace(new RegExp(el.missingKey, 'g'), el.label)
  }
  return out
}
