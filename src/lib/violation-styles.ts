/*
  Centralized mapping of violation types and review status to Pennie accent
  families. Use these helpers everywhere a chip or pill is rendered — never
  hard-code Tailwind palette colors (bg-red-100 / bg-green-600 / etc.) at
  call sites.

  Each accent family has the same shape: light bg + dark text, used in pills.
  See .pennie-pill in index.css for the visual treatment (incl. leading dot).
*/

export type AccentFamily = 'blue' | 'green' | 'yellow' | 'peach' | 'indigo' | 'navy'

const PILL_BG_BY_ACCENT: Record<AccentFamily, string> = {
  blue: 'bg-pennie-blue-light',
  green: 'bg-pennie-green-light',
  yellow: 'bg-pennie-yellow-light',
  peach: 'bg-pennie-peach-light',
  // Indigo / Navy don't have a light variant in the brand spec — use beige.
  indigo: 'bg-pennie-beige',
  navy: 'bg-pennie-beige',
}

const PILL_TEXT_BY_ACCENT: Record<AccentFamily, string> = {
  blue: 'text-pennie-blue-dark',
  green: 'text-pennie-green-dark',
  yellow: 'text-pennie-yellow-dark',
  peach: 'text-pennie-peach-dark',
  indigo: 'text-pennie-indigo-dark',
  navy: 'text-pennie-navy',
}

/**
 * Compose a className for a Pennie pill of a given accent family.
 * Combine with the `pennie-pill` base class for the dot + tracking treatment.
 */
export function pillClasses(accent: AccentFamily): string {
  return `pennie-pill ${PILL_BG_BY_ACCENT[accent]} ${PILL_TEXT_BY_ACCENT[accent]}`
}

/**
 * Map a violation type (the QA module that fired) to its accent family.
 * Severity intent: peach for direct compliance / litigation issues, yellow
 * for soft policy expectations, blue for routing/transfer, green for
 * neutral / structural escalations.
 */
export function accentForViolation(violationType: string): AccentFamily {
  switch (violationType) {
    case 'manager_escalation':
      return 'navy'
    case 'budget_compliance':
      return 'peach'
    case 'litigation_check':
      return 'peach'
    case 'warm_transfer':
      return 'blue'
    case 'program_expectations':
      return 'yellow'
    default:
      return 'navy'
  }
}

/**
 * Map review status to an accent family.
 *  - new: yellow (needs attention, hasn't been reviewed)
 *  - accurate: green (manager confirmed the alert was correct)
 *  - false-positive: peach (manager flagged the alert as wrong)
 *  - reviewed (no accuracy set): navy / neutral
 */
export type ReviewStatus = 'new' | 'accurate' | 'false_positive' | 'reviewed_neutral'

export function accentForReviewStatus(status: ReviewStatus): AccentFamily {
  switch (status) {
    case 'new':
      return 'yellow'
    case 'accurate':
      return 'green'
    case 'false_positive':
      return 'peach'
    case 'reviewed_neutral':
      return 'navy'
  }
}

/**
 * Map a generic QA score / rating string to an accent family.
 * Used by the legacy DashboardPage chips (excellent / pass / good / fail / etc.)
 */
export function accentForScore(score: string | null | undefined): AccentFamily {
  switch (score?.toLowerCase()) {
    case 'excellent':
    case 'pass':
    case 'high':
      return 'green'
    case 'good':
    case 'medium':
      return 'blue'
    case 'needs_improvement':
    case 'fair':
    case 'low':
      return 'yellow'
    case 'poor':
    case 'fail':
      return 'peach'
    default:
      return 'navy'
  }
}
