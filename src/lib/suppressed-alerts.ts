// Modules under production test that should not be visible in manager-facing
// alert surfaces yet. Results can still exist in Supabase for internal review.
export const SUPPRESSED_ALERT_MODULES = ['disposition_review'] as const

export function isSuppressedAlertModule(moduleName: string | null | undefined) {
  return !!moduleName && (SUPPRESSED_ALERT_MODULES as readonly string[]).includes(moduleName)
}

export function filterSuppressedAlertRows<
  T extends { module_name?: string | null },
>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(row => !isSuppressedAlertModule(row.module_name))
}
