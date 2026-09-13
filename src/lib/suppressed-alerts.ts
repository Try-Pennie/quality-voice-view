// Modules under production test that should not appear in review workloads.
export const ALWAYS_SUPPRESSED_ALERT_MODULES = ['disposition_review'] as const

// External-partner modules have a separate god-mode-only workload.
export const SUPER_ADMIN_ONLY_ALERT_MODULES = ['achieve_welcome_call_qa'] as const

// Backwards-compatible alias for modules hidden from internal surfaces.
export const SUPPRESSED_ALERT_MODULES = [
  ...ALWAYS_SUPPRESSED_ALERT_MODULES,
  ...SUPER_ADMIN_ONLY_ALERT_MODULES,
] as const

/** Named workload prevents viewer privilege from changing Pennie accountability counts. */
export type AlertWorkload = 'internal' | 'partner_qa'

export type AlertVisibilityScope = { isGodMode?: boolean | null } | null | undefined

export function isAlwaysSuppressedAlertModule(moduleName: string | null | undefined) {
  return !!moduleName && (ALWAYS_SUPPRESSED_ALERT_MODULES as readonly string[]).includes(moduleName)
}

export function isSuperAdminOnlyAlertModule(moduleName: string | null | undefined) {
  return !!moduleName && (SUPER_ADMIN_ONLY_ALERT_MODULES as readonly string[]).includes(moduleName)
}

/** Whether a module is unavailable in a named workload for this viewer. */
export function isSuppressedAlertModule(
  moduleName: string | null | undefined,
  scope?: AlertVisibilityScope,
  workload: AlertWorkload = 'internal',
) {
  if (!moduleName || isAlwaysSuppressedAlertModule(moduleName)) return true
  if (workload === 'partner_qa') {
    return !scope?.isGodMode || !isSuperAdminOnlyAlertModule(moduleName)
  }
  return isSuperAdminOnlyAlertModule(moduleName)
}

/** Filter rows to one explicit workload; internal is the safe default. */
export function filterAlertWorkloadRows<
  T extends { module_name?: string | null },
>(rows: readonly T[] | null | undefined, scope?: AlertVisibilityScope, workload: AlertWorkload = 'internal'): T[] {
  return (rows ?? []).filter(row => !isSuppressedAlertModule(row.module_name, scope, workload))
}

/** Internal-workload compatibility name used by existing manager surfaces. */
export function filterSuppressedAlertRows<
  T extends { module_name?: string | null },
>(rows: readonly T[] | null | undefined, scope?: AlertVisibilityScope): T[] {
  return filterAlertWorkloadRows(rows, scope, 'internal')
}
