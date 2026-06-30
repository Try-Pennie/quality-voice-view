// Modules under production test that should not be visible in manager-facing
// alert surfaces yet. Results can still exist in Supabase for internal review.
export const ALWAYS_SUPPRESSED_ALERT_MODULES = ['disposition_review'] as const

// External-partner modules that only super-admin / god-mode users may see in
// internal Pennie surfaces. Normal Pennie managers should never see these rows.
export const SUPER_ADMIN_ONLY_ALERT_MODULES = ['achieve_welcome_call_qa'] as const

// Backwards-compatible alias for modules hidden from everyone.
export const SUPPRESSED_ALERT_MODULES = ALWAYS_SUPPRESSED_ALERT_MODULES

export type AlertVisibilityScope = { isGodMode?: boolean | null } | null | undefined

export function isAlwaysSuppressedAlertModule(moduleName: string | null | undefined) {
  return !!moduleName && (ALWAYS_SUPPRESSED_ALERT_MODULES as readonly string[]).includes(moduleName)
}

export function isSuperAdminOnlyAlertModule(moduleName: string | null | undefined) {
  return !!moduleName && (SUPER_ADMIN_ONLY_ALERT_MODULES as readonly string[]).includes(moduleName)
}

export function isSuppressedAlertModule(
  moduleName: string | null | undefined,
  scope?: AlertVisibilityScope,
) {
  if (isAlwaysSuppressedAlertModule(moduleName)) return true
  if (isSuperAdminOnlyAlertModule(moduleName)) return !scope?.isGodMode
  return false
}

export function filterSuppressedAlertRows<
  T extends { module_name?: string | null },
>(rows: T[] | null | undefined, scope?: AlertVisibilityScope): T[] {
  return (rows ?? []).filter(row => !isSuppressedAlertModule(row.module_name, scope))
}
