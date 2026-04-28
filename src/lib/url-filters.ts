// URL parameter helpers for filter persistence across pages.
// Pages serialize their filter state into the URL so views are shareable
// (e.g. one manager sending another manager a link to a specific
// date+agent slice). Uses local-time YYYY-MM-DD to avoid timezone drift.

export function parseDateParam(
  raw: string | null,
  fallback: Date,
  endOfDay = false,
): Date {
  if (!raw) return fallback
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return fallback
  const d = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
  )
  if (endOfDay) d.setHours(23, 59, 59, 999)
  else d.setHours(0, 0, 0, 0)
  return d
}

export function formatDateParam(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseListParam(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}
