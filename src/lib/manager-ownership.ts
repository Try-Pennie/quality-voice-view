/** Presentation-only key for missing or placeholder ownership. */
export const NEEDS_MANAGER_ASSIGNMENT = '__unassigned__'

/** Normalize presentation grouping without changing assignment or authorization data. */
export function managerOwnershipKey(managerEmail: string | null | undefined): string {
  const normalized = managerEmail?.trim().toLowerCase()
  return !normalized || normalized === 'unassigned' || normalized === NEEDS_MANAGER_ASSIGNMENT
    ? NEEDS_MANAGER_ASSIGNMENT
    : normalized
}
