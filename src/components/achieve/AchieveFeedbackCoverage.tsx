import type { AchieveFeedbackOverview } from '@/lib/achieve-feedback-overview'

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100
}

function CoverageRow({ label, count, total, tone }: {
  label: string
  count: number
  total: number
  tone: 'blue' | 'indigo' | 'amber' | 'slate'
}) {
  const percent = percentage(count, total)
  const toneClass = {
    blue: 'bg-blue-600',
    indigo: 'bg-indigo-600',
    amber: 'bg-amber-500',
    slate: 'bg-slate-500',
  }[tone]
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-600">{count} · {percent.toFixed(1)}%</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={`${label}: ${count} of ${total} submissions`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={count}
      >
        <span className={`block h-full rounded-full ${toneClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** Coverage rail that keeps separate Form/AI attribution and alignment visible. */
export function AchieveFeedbackCoverage({ overview, onOpenQaMatching }: {
  overview: AchieveFeedbackOverview
  onOpenQaMatching: () => void
}) {
  const { totalSubmissions } = overview.scope
  const { coverage, unresolvedReasons } = overview
  const reasonRows = [
    ['Multiple plausible calls', unresolvedReasons.callAmbiguous],
    ['No call in approved window', unresolvedReasons.noCallInWindow],
    ['Invalid or incomplete phone', unresolvedReasons.invalidPhone],
    ['Submitter not in directory', unresolvedReasons.submitterNotFound],
    ['Other unresolved reason', unresolvedReasons.other],
  ] as const

  return (
    <section aria-labelledby="feedback-coverage-heading" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-w-0 gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <div className="min-w-0">
          <h2 id="feedback-coverage-heading" className="text-lg font-semibold text-slate-950">Attribution coverage</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            All submissions remain in totals; representative results require exact daily-report attribution.
          </p>
          <div className="mt-5 space-y-4">
            <CoverageRow label="Call associated" count={coverage.callAssociated} total={totalSubmissions} tone="blue" />
            <CoverageRow label="Exact Achieve representative" count={coverage.exactAgentAttributed} total={totalSubmissions} tone="indigo" />
            <CoverageRow label="Call known · representative unavailable" count={coverage.agentUnavailable} total={totalSubmissions} tone="amber" />
            <CoverageRow label="Unresolved call association" count={coverage.unresolved} total={totalSubmissions} tone="slate" />
          </div>
        </div>

        <div className="min-w-0 border-t border-slate-200 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Unresolved reasons</p>
          {coverage.unresolved === 0 ? (
            <p className="mt-3 rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
              Every submission in this period has a call association.
            </p>
          ) : (
            <dl className="mt-3 divide-y divide-slate-100">
              {reasonRows.filter(([, count]) => count > 0).map(([label, count]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-sm text-slate-600">{label}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-slate-950">{count}</dd>
                </div>
              ))}
            </dl>
          )}
          <button
            type="button"
            onClick={onOpenQaMatching}
            className="mt-5 inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Open QA &amp; Matching
          </button>
        </div>
      </div>
      <div className="border-t border-slate-200 p-5 sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-950">Human / AI call alignment</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Worst recognized Form rating per overlapping call. Other-only feedback is excluded.
            </p>
          </div>
          <p className="text-xs tabular-nums text-slate-500">{overview.distinctAnyAgents} representatives across either source</p>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Overlap', overview.qa.alignment.overlapCalls],
            ['Both clear', overview.qa.alignment.bothClear],
            ['Both concern', overview.qa.alignment.bothConcern],
            ['Human only', overview.qa.alignment.humanOnly],
            ['AI only', overview.qa.alignment.aiOnly],
          ].map(([label, count]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{count}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
