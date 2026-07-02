// Required FDR welcome-call script elements the Achieve QA checker scores.
// Labels + definitions come from the FDR Welcome Call Script (Wholesale — DB
// Pilot); see docs/superpowers/specs/2026-07-02-achieve-pdf-mirror-v1-design.md.
// `flag` is the boolean key on script_adherence; `missingKey` is the base name
// used in its missing_elements list (no suffix). `section` groups the element
// under the script section managers recognize. Derivation checks flag + list.

export type AchieveElement = {
  flag: string
  missingKey: string
  label: string
  definition: string
  section: string
}

// v0 (fdr_wholesale_db_pilot_v0) — 6 loosely-thematic elements. Kept verbatim
// so historical rows scored under v0 still render with their original labels.
export const ACHIEVE_ELEMENTS_V0: AchieveElement[] = [
  {
    flag: 'welcome_greeting_completed',
    missingKey: 'welcome_greeting',
    label: 'Welcome & greeting',
    section: 'Introduction',
    definition:
      'Agent greeted the client, verified their identity, and gave the "recorded for quality" disclosure. (Script section 1 — Introduction)',
  },
  {
    flag: 'program_overview_covered',
    missingKey: 'program_overview',
    label: 'Program overview',
    section: 'Program',
    definition:
      'Explained how the program works: the Dedicated Account, creditor negotiation, and restructured repayment terms (the "three keys"). (Script section 1)',
  },
  {
    flag: 'payment_process_explained',
    missingKey: 'payment_process',
    label: 'Payment process',
    section: 'Program',
    definition:
      'Gave the client their first deposit date and how often deposits are made into the Dedicated Account. (Script — first key)',
  },
  {
    flag: 'timeline_expectations_covered',
    missingKey: 'timeline_expectations',
    label: 'Timeline expectations',
    section: 'Program',
    definition:
      'Set expectations on settlement timing and authorizing new terms quickly to keep the program on track. (Script — keys 2 & 3)',
  },
  {
    flag: 'client_communication_process_covered',
    missingKey: 'client_communication_process',
    label: 'Client communication',
    section: 'Dashboard & tools',
    definition:
      'Covered how the client hears from FDR: app/dashboard/email/text notifications, the customer-service line (800-655-6303), and "here 7 days a week". (Script — Dashboard/Closing)',
  },
  {
    flag: 'next_steps_provided',
    missingKey: 'next_steps',
    label: 'Next steps',
    section: 'Closing',
    definition:
      'Walked through account/app setup and the Program Guide email so the client knows what to do after the call. (Script — Dashboard/Tools)',
  },
]

// v1 (fdr_wholesale_db_pilot_v1) — 10 PDF-faithful elements, one graded beat
// per transcript-gradable line of the agreed Achieve/FDR welcome-call script.
// Definitions are verbatim-anchored to the PDF (mirrors the prompt's
// <script_elements>). Sections mirror the script structure managers recognize.
export const ACHIEVE_ELEMENTS_V1: AchieveElement[] = [
  {
    flag: 'greeting_and_identity_completed',
    missingKey: 'greeting_and_identity',
    label: 'Greeting & identity',
    section: 'Introduction',
    definition:
      'Agent introduced themselves as a Client Success Advocate and welcomed the client to get started with their Freedom Debt Relief program. On direct-inbound calls the agent also verified identity (first/last name + phone, plus one of: DOB, last 4 of SSN, or physical address). On warm-transfer calls identity verification may have occurred pre-handoff and is not required within this segment. (Script §1 — Introduction / Greeting)',
  },
  {
    flag: 'recording_disclosure_provided',
    missingKey: 'recording_disclosure',
    label: 'Recording disclosure',
    section: 'Introduction',
    definition:
      'Compliance — verbatim. Agent stated the call is recorded: "this call will be recorded for quality and training purposes." (Script §1 — marked Must-be-Verbatim)',
  },
  {
    flag: 'company_credibility_covered',
    missingKey: 'company_credibility',
    label: 'Company credibility',
    section: 'Introduction',
    definition:
      'Agent conveyed FDR credibility/reassurance: 20+ years as an industry leader, 1M+ clients served, recognition from trusted sources (BBB, USA Today, TrustPilot), a company that delivers on its promises. (Script §1)',
  },
  {
    flag: 'call_agenda_provided',
    missingKey: 'call_agenda',
    label: 'Call agenda',
    section: 'Introduction',
    definition:
      'Agent previewed the 3-part agenda: (1) keys to being successful, (2) setting up the client account/dashboard, (3) walking through helpful tools. (Script §1)',
  },
  {
    flag: 'dedicated_account_deposits_explained',
    missingKey: 'dedicated_account_deposits',
    label: 'Dedicated Account & deposits',
    section: 'Three keys to success',
    definition:
      'Agent explained the Dedicated Account: instead of paying enrolled creditors directly, the deposit is made automatically into the Dedicated Account; gave the first deposit date and frequency; stressed deposits in full and on time. (Script §1 — first key)',
  },
  {
    flag: 'creditor_negotiation_explained',
    missingKey: 'creditor_negotiation',
    label: 'Creditor negotiation',
    section: 'Three keys to success',
    definition:
      "Agent explained negotiations: FDR's patented technology creates a customized plan to negotiate with each creditor at the best time for maximum savings; referenced the client's estimated first settlements. (Script §1 — second key)",
  },
  {
    flag: 'settlement_authorizations_explained',
    missingKey: 'settlement_authorizations',
    label: 'Settlement authorizations',
    section: 'Three keys to success',
    definition:
      'Agent explained authorizations: FDR restructures repayment terms as fast as possible; when new terms are ready the client is notified via app, web dashboard, email, or text; settlement offers are time-sensitive and authorizing quickly keeps the program on track and maximizes savings. (Script §1 — third key)',
  },
  {
    flag: 'dashboard_account_setup_covered',
    missingKey: 'dashboard_account_setup',
    label: 'Dashboard setup',
    section: 'Dashboard & tools',
    definition:
      'Agent walked the client through (or offered to walk through) setting up the client dashboard on web + app: locating the setup email, resetting the password, logging in; and offered help downloading the FDR app. If the client declined, the agent should still have offered. (Script §2 — Dashboard)',
  },
  {
    flag: 'tools_and_resources_covered',
    missingKey: 'tools_and_resources',
    label: 'Tools & resources',
    section: 'Dashboard & tools',
    definition:
      'Agent covered tools/resources: the Program Guide email arriving the next day, and that the app is the first place for program info (program status, Dedicated Account balance, notifications, web dashboard access). (Script — Tools)',
  },
  {
    flag: 'closing_and_support_provided',
    missingKey: 'closing_and_support',
    label: 'Closing & support',
    section: 'Closing',
    definition:
      'Agent closed with support info: encouraged adding FDR to contacts, gave the Customer Service number (800-655-6303), referenced the Program Success Team and availability ("here for you 7 days a week"), warm congratulatory close. (Script — Closing)',
  },
]

// Default set for anything that imports ACHIEVE_ELEMENTS directly (Key terms
// glossary, humanizeElementKeys fallback). New calls are graded under v1.
export const ACHIEVE_ELEMENTS = ACHIEVE_ELEMENTS_V1

// Section display order for v1, so managers read the script top-to-bottom.
export const ACHIEVE_SECTION_ORDER: string[] = [
  'Introduction',
  'Three keys to success',
  'Dashboard & tools',
  'Closing',
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
  section: string
  isCovered: boolean
}
export type Checklist = { rows: ChecklistRow[]; coveredCount: number; total: number }

type Adherence = { missing_elements?: unknown; [flag: string]: unknown }

// True when the script_version string names v1 or a later version (e.g.
// `fdr_wholesale_db_pilot_v1`). v0 rows carry `..._v0` and resolve to false.
function isV1Version(scriptVersion?: string | null): boolean {
  if (!scriptVersion) return false
  const match = scriptVersion.match(/_v(\d+)\b/i)
  return match ? Number(match[1]) >= 1 : false
}

// True when the adherence object carries any flag that only exists in v1. This
// is the robust default: a v1 result renders under v1 labels even if the
// script_version field is missing.
function hasV1Flag(adherence?: Adherence | null): boolean {
  if (!adherence || typeof adherence !== 'object') return false
  return ACHIEVE_ELEMENTS_V1.some(el => el.flag in adherence)
}

// Pick the element set for a result: v1 when the version says so OR when a
// v1-only flag is present; otherwise the historical v0 set.
export function selectAchieveElements(
  scriptVersion?: string | null,
  adherence?: Adherence | null,
): AchieveElement[] {
  if (isV1Version(scriptVersion) || hasV1Flag(adherence)) return ACHIEVE_ELEMENTS_V1
  return ACHIEVE_ELEMENTS_V0
}

export function deriveChecklist(
  adherence: Adherence | null | undefined,
  scriptVersion?: string | null,
): Checklist {
  const a = adherence ?? {}
  const elements = selectAchieveElements(scriptVersion, a)
  const missing = Array.isArray(a.missing_elements)
    ? (a.missing_elements as unknown[]).filter((m): m is string => typeof m === 'string')
    : []

  const rows: ChecklistRow[] = elements.map(el => {
    const isMissing =
      a[el.flag] === false ||
      missing.some(m => m === el.missingKey || m.startsWith(el.missingKey))
    return {
      key: el.missingKey,
      label: el.label,
      definition: el.definition,
      section: el.section,
      isCovered: !isMissing,
    }
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
// label so the reason reads plainly and matches the checklist above it. Uses
// the element set that matches the result's script_version.
export function humanizeElementKeys(text: string, scriptVersion?: string | null): string {
  let out = text
  for (const el of selectAchieveElements(scriptVersion)) {
    out = out.replace(new RegExp(el.missingKey, 'g'), el.label)
  }
  return out
}
