const positions = new Map<string, number>()
const MAX_POSITIONS = 20

/** Remember only a numeric window position for an opaque router history key. */
export function rememberCallsScroll(historyKey: string, scrollY: number): void {
  if (!Number.isFinite(scrollY) || scrollY < 0) return
  positions.delete(historyKey)
  positions.set(historyKey, scrollY)
  if (positions.size <= MAX_POSITIONS) return
  const oldest = positions.keys().next().value
  if (typeof oldest === 'string') positions.delete(oldest)
}

/** Read the numeric position associated with an opaque router history key. */
export function callsScrollFor(historyKey: string): number | undefined {
  return positions.get(historyKey)
}
