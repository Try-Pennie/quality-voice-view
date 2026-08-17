/* Hallmark · genre: modern-minimal · macrostructure: Stat-Led · theme: existing Pennie portal · designed-as-app · contrast: pass · responsive: pass */
import { AchieveFeedbackCoverage } from '@/components/achieve/AchieveFeedbackCoverage'
import { AchieveRepresentativeTable } from '@/components/achieve/AchieveRepresentativeTable'
import type { AchieveFeedbackDashboard } from '@/lib/achieve-feedback-overview'

const scopeDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const updatedDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100
}

function RatingMetric({ label, count, total, tone }: {
  label: string
  count: number
  total: number
  tone: 'good' | 'fair' | 'poor' | 'other'
}) {
  const style = {
    good: 'bg-emerald-500',
    fair: 'bg-amber-400',
    poor: 'bg-red-500',
    other: 'bg-slate-400',
  }[tone]
  const percent = percentage(count, total)
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm font-semibold text-slate-200">{label}</dt>
        <dd className="tabular-nums text-slate-300">{count} · {percent.toFixed(1)}%</dd>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-label={`${label}: ${count} of ${total} submissions`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={count}
      >
        <span className={`block h-full rounded-full ${style}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function FlagMetric({ label, count, total }: {
  label: string
  count: number
  total: number
}) {
  return (
    <div className="min-w-0 border-t border-slate-100 p-5 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0 sm:p-6">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-slate-950">{count}</span>
        <span className="text-xs tabular-nums text-slate-500">{percentage(count, total).toFixed(1)}%</span>
      </dd>
    </div>
  )
}

/** Complete Form + ordinary AI QA leadership view, independent of the capped call list. */
export function AchieveFeedbackOverview({ dashboard, onOpenQaMatching }: {
  dashboard: AchieveFeedbackDashboard
  onOpenQaMatching: () => void
}) {
  const { overview, representatives, representativeCoverage } = dashboard
  const { scope, ratings, flags } = overview
  const hasScope = scope.firstSubmittedAt !== null && scope.lastSubmittedAt !== null
  const scopeLabel = hasScope
    ? `${scopeDate.format(new Date(scope.firstSubmittedAt))}–${scopeDate.format(new Date(scope.lastSubmittedAt))}`
    : 'No submissions in this period'

  if (scope.totalSubmissions === 0 && overview.qa.coverage.allGraded === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">No WC Agent Summary data yet</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          The complete Form and ordinary AI QA aggregates returned no records for this period.
        </p>
        <button
          type="button"
          onClick={onOpenQaMatching}
          className="mt-5 min-h-11 whitespace-nowrap rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Open QA &amp; Matching
        </button>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-sm">
        <div className="grid min-w-0 gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,1.1fr)] lg:items-end">
          <div className="min-w-0">
            <div className="text-6xl font-semibold tabular-nums tracking-tight text-white sm:text-7xl">{scope.totalSubmissions}</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Form feedback submissions</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">{scopeLabel} · UTC</p>
            <p className="mt-3 text-xs text-slate-400">Updated {updatedDate.format(new Date(overview.generatedAt))} UTC</p>
          </div>
          <dl className="grid min-w-0 gap-4 border-t border-slate-700 pt-5 sm:grid-cols-2 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
            <RatingMetric label="Good" count={ratings.good} total={scope.totalSubmissions} tone="good" />
            <RatingMetric label="Fair" count={ratings.fair} total={scope.totalSubmissions} tone="fair" />
            <RatingMetric label="Poor" count={ratings.poor} total={scope.totalSubmissions} tone="poor" />
            <RatingMetric label="Other / not supplied" count={ratings.other} total={scope.totalSubmissions} tone="other" />
          </dl>
        </div>
      </section>

      <section aria-labelledby="ai-qa-heading" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <h2 id="ai-qa-heading" className="text-lg font-semibold text-slate-950">AI QA</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Ordinary graded welcome calls only. This denominator is separate from Form submissions.
          </p>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-5">
          {[
            ['All graded', overview.qa.coverage.allGraded],
            ['Exact attributed', overview.qa.coverage.exactAgentAttributed],
            ['Unavailable', overview.qa.coverage.agentUnavailable],
            ['Pass', overview.qa.outcomes.pass],
            ['Flagged', overview.qa.outcomes.flagged],
          ].map(([label, count]) => (
            <div key={label} className="border-t border-slate-100 p-4 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0 sm:p-5">
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{count}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="reported-conditions-heading" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <h2 id="reported-conditions-heading" className="text-lg font-semibold text-slate-950">Reported call conditions</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Accent is context, not a standalone performance measure. Noise and connection issues may be operational.
          </p>
        </div>
        <dl className="grid sm:grid-cols-3">
          <FlagMetric label="Background noise" count={flags.backgroundNoise} total={scope.totalSubmissions} />
          <FlagMetric label="Accent / communication" count={flags.accent} total={scope.totalSubmissions} />
          <FlagMetric label="Connection issue" count={flags.connectionIssues} total={scope.totalSubmissions} />
        </dl>
      </section>

      <AchieveFeedbackCoverage overview={overview} onOpenQaMatching={onOpenQaMatching} />
      <AchieveRepresentativeTable representatives={representatives} coverage={representativeCoverage} />
    </div>
  )
}
