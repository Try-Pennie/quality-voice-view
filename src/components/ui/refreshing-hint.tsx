import { useEffect, useState } from 'react'

// Subtle "Refreshing…" pill shown when a filter change triggers a background
// refetch. Pages keep stale data on screen via React Query's keepPreviousData,
// so without this the change feels like it didn't take. Suppressed on the
// first ~120ms of any fetch — short refreshes shouldn't flash.
export function RefreshingHint({ active }: { active: boolean }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!active) {
      setShow(false)
      return
    }
    const id = setTimeout(() => setShow(true), 120)
    return () => clearTimeout(id)
  }, [active])

  if (!show) return null

  return (
    <span
      className="inline-flex items-center gap-2 text-xs font-medium text-pennie-graphite/70 px-3 py-1.5 rounded-full bg-pennie-beige/80"
      role="status"
      aria-live="polite"
    >
      <span
        className="block w-2 h-2 rounded-full bg-pennie-blue-dark animate-pulse"
        aria-hidden="true"
      />
      Refreshing…
    </span>
  )
}
