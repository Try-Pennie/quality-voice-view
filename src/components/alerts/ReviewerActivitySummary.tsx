import { useMemo } from 'react'
import type { AlertWithFeedback } from '../../types/database'
import { isHumanReviewed } from '../../lib/alert-review-queue'
import { formatDateParam } from '../../lib/url-filters'

/** URL-level filter selected from one reviewer decision count. */
export type ReviewerActivitySelection = {
  readonly reviewerEmail: string
  readonly outcome: 'all' | 'real' | 'false_alarm'
}

/** Latest-decision reporting grouped by the persisted feedback author. */
export function ReviewerActivitySummary({
  alerts,
  startDate,
  endDate,
  selectedReviewer,
  onSelect,
}: {
  alerts: readonly AlertWithFeedback[]
  startDate: Date
  endDate: Date
  selectedReviewer: string | null
  onSelect: (selection: ReviewerActivitySelection) => void
}) {
  const rows = useMemo(() => {
    const grouped = new Map<string, { reviewed: number; real: number; falseAlarm: number }>()
    for (const alert of alerts) {
      if (!isHumanReviewed(alert)) continue
      const reviewerEmail = alert.feedback_by?.trim().toLowerCase()
      if (!reviewerEmail) continue
      const counts = grouped.get(reviewerEmail) ?? { reviewed: 0, real: 0, falseAlarm: 0 }
      counts.reviewed += 1
      if (alert.accurate === true) counts.real += 1
      else counts.falseAlarm += 1
      grouped.set(reviewerEmail, counts)
    }
    return Array.from(grouped, ([reviewerEmail, counts]) => ({ reviewerEmail, ...counts }))
      .sort((a, b) => b.reviewed - a.reviewed || a.reviewerEmail.localeCompare(b.reviewerEmail))
  }, [alerts])

  return (
    <section className="rounded-2xl border border-pennie-beige p-3 sm:p-4" aria-labelledby="reviewer-activity-heading">
      <header className="mb-4">
        <p id="reviewer-activity-heading" className="pennie-label">By actual reviewer</p>
        <p className="mt-1 text-xs text-pennie-graphite/60">
          Latest recorded decisions for alerts received {formatDateParam(startDate)} – {formatDateParam(endDate)} (ET).
          Manager verdicts, not Kris approvals.
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-pennie-graphite/60">No attributed human decisions in this alert-received cohort.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-pennie-beige text-left text-[11px] font-bold uppercase tracking-wider text-pennie-graphite/60">
                <th className="py-2 pr-4">Reviewer</th>
                <th className="py-2 px-2 text-right">Reviewed</th>
                <th className="py-2 px-2 text-right">Warranted</th>
                <th className="py-2 px-2 text-right">Unnecessary</th>
                <th className="py-2 pl-2 text-right">Unnecessary / reviewed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const name = row.reviewerEmail.split('@')[0]
                const rate = Math.round(row.falseAlarm / row.reviewed * 100)
                return (
                  <tr key={row.reviewerEmail} className={`border-b border-pennie-beige/60 ${selectedReviewer === row.reviewerEmail ? 'bg-pennie-blue-light/40' : ''}`}>
                    <th scope="row" className="py-3 pr-4 text-left font-semibold text-pennie-navy">{name}</th>
                    <ReviewerCount reviewer={row} label="Reviewed" value={row.reviewed} outcome="all" onSelect={onSelect} />
                    <ReviewerCount reviewer={row} label="Warranted" value={row.real} outcome="real" onSelect={onSelect} />
                    <ReviewerCount reviewer={row} label="Unnecessary" value={row.falseAlarm} outcome="false_alarm" onSelect={onSelect} />
                    <ReviewerCount reviewer={row} label="Unnecessary share" value={`${rate}%`} empty={row.falseAlarm === 0} outcome="false_alarm" onSelect={onSelect} last />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ReviewerCount({
  reviewer,
  label,
  value,
  empty = value === 0,
  outcome,
  onSelect,
  last = false,
}: {
  reviewer: { readonly reviewerEmail: string }
  label: string
  value: number | string
  empty?: boolean
  outcome: ReviewerActivitySelection['outcome']
  onSelect: (selection: ReviewerActivitySelection) => void
  last?: boolean
}) {
  const name = reviewer.reviewerEmail.split('@')[0]
  return (
    <td className={`py-2 ${last ? 'pl-1' : 'px-1'} text-right`}>
      {empty ? <span className="inline-block min-w-[44px] px-2 text-center tabular-nums text-muted-foreground">{value}</span> : <button
        type="button"
        onClick={() => onSelect({ reviewerEmail: reviewer.reviewerEmail, outcome })}
        aria-label={`Filter ${name} ${label} ${value}`}
        className="pennie-focus-ring min-w-[44px] min-h-[44px] rounded-full px-2 font-semibold tabular-nums text-pennie-blue-deeper hover:bg-pennie-blue-light"
      >
        {value}
      </button>}
    </td>
  )
}
