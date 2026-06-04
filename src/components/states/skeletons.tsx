/**
 * Shared loading skeletons built on the same shimmer idiom as the existing
 * SkeletonAlertsTable in AlertsPage. Use where a page currently shows a bare
 * spinner or "Loading…" text.
 */

function Bar({ widthPct }: { widthPct: number }) {
  return (
    <span
      className="block h-3 rounded-full bg-pennie-beige animate-pulse"
      style={{ width: `${widthPct}%` }}
    />
  )
}

/** Body-row shimmer. Caller supplies the surrounding <table>/<thead>. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody role="status" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className={i !== 0 ? 'border-t border-border/60' : ''}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-6 py-4 align-top">
              <Bar widthPct={50 + ((i * 7 + j) % 5) * 8} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="bg-pennie-white rounded-3xl shadow-resting p-6 space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <Bar key={i} widthPct={i === 0 ? 40 : 70 + (i % 3) * 8} />
      ))}
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div role="status" aria-live="polite" className="bg-pennie-white rounded-3xl shadow-resting p-6">
      <Bar widthPct={30} />
      <div className="mt-6 h-40 rounded-2xl bg-pennie-beige animate-pulse" />
    </div>
  )
}
