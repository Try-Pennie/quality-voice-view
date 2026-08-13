import type {
  AchieveAgentRating,
  AchieveAnalyticsSummary,
  AchieveTrends,
  AchieveTrendBucket,
} from '@/lib/achieve-analytics'

const RATINGS: ReadonlyArray<AchieveAgentRating> = ['Good', 'Fair', 'Poor', 'Other']

const RATING_STYLES: Readonly<Record<AchieveAgentRating, string>> = {
  Good: 'bg-emerald-500',
  Fair: 'bg-amber-400',
  Poor: 'bg-red-500',
  Other: 'bg-slate-400',
}

function displayPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

function countPercent(count: number, denominator: number): number {
  return denominator === 0 ? 0 : (count / denominator) * 100
}

/** Leadership-first view of the separate AI QA and Pennie-agent signals. */
export function AchieveOverview({
  summary,
  trends,
  selectedElement,
  onSelectElement,
}: {
  summary: AchieveAnalyticsSummary
  trends: AchieveTrends
  selectedElement: string | null
  onSelectElement: (key: string | null) => void
}) {
  const { ai, agent } = summary

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
        Coverage note: this overview summarizes recent calls currently available in the portal. Older history may not be included.
      </p>

      <section className="grid min-w-0 gap-4 lg:grid-cols-12">
        <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-white shadow-sm lg:col-span-7">
          <div className="grid min-h-full gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.72fr)] md:items-end">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Eavesly AI QA</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">Script and transfer review</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                Automated checks are shown on their own denominator. Skipped grades and unreliable full-transcript fallbacks are excluded.
              </p>
              <p className="mt-5 text-xs leading-5 text-slate-400">
                {ai.scoredCalls} scored of {summary.loadedCalls} recent calls currently available · {ai.notGradedCalls} not graded
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-3 border-t border-slate-700 pt-4 md:grid-cols-1 md:border-l md:border-t-0 md:pl-6 md:pt-0">
              <Metric label="Pass rate" value={displayPercent(ai.passRate)} dark />
              <Metric label="Passed" value={ai.passedCalls} dark />
              <Metric label="Flagged" value={ai.flaggedCalls} dark />
            </dl>
          </div>
        </article>

        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:col-span-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Pennie-agent signal</p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">Observed call rating</h2>
              <p className="mt-1 text-sm text-slate-500">Worst rating wins when a call has multiple matched submissions.</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-3xl font-semibold tabular-nums text-slate-950">{agent.matchedCalls}</div>
              <div className="text-xs text-slate-500">matched calls</div>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {RATINGS.map(rating => (
              <RatingBar
                key={rating}
                rating={rating}
                count={agent.ratings[rating]}
                denominator={agent.matchedCalls}
              />
            ))}
          </div>
          <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
            {agent.submissions} matched feedback {agent.submissions === 1 ? 'submission' : 'submissions'} across {summary.loadedCalls} recent calls currently available. Calls without matched feedback are not rated.
          </p>
        </article>
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.75fr)]">
        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Issue concentration</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Top missed script elements</h2>
            </div>
            <div className="sm:text-right">
              <p className="text-sm font-semibold tabular-nums text-red-700">{ai.scriptIssueCalls} script-issue calls</p>
              <p className="text-xs leading-5 text-slate-500">within {ai.scoredCalls} recent scored calls currently available</p>
            </div>
          </div>
          {ai.missedElements.length > 0 ? (
            <ol className="mt-5 space-y-3">
              {ai.missedElements.slice(0, 6).map((element, index) => {
                const active = selectedElement === element.key
                return (
                  <li key={element.key}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelectElement(active ? null : element.key)}
                      className={`grid w-full min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="text-xs font-semibold tabular-nums text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800">{element.label}</span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className="block h-full rounded-full bg-red-500"
                            style={{ width: `${countPercent(element.count, ai.scoredCalls)}%` }}
                          />
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-950">{element.count} calls</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              No missed script elements appear among the recent scored calls currently available.
            </p>
          )}
          {ai.missedElements.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">Select an element to constrain Needs review and All calls; select it again to clear.</p>
          )}
        </article>

        <article className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Transfer concentration</p>
          <div className="mt-5 text-5xl font-semibold tabular-nums tracking-tight text-slate-950">{ai.poorTransferCalls}</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">Poor-transfer calls</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Handoff quality is kept separate from required script completion.
          </p>
          <p className="mt-6 border-t border-amber-200 pt-4 text-xs leading-5 text-amber-900">
            {ai.poorTransferCalls} of {ai.scoredCalls} recent scored calls currently available
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Pennie-agent observations</p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-lg font-semibold text-slate-950">Call-condition flags</h2>
            <p className="text-xs leading-5 text-slate-500">Calls flagged by at least one matched submission · {agent.matchedCalls} matched-call denominator</p>
          </div>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <FlagMetric label="Accent" count={agent.flags.accent} denominator={agent.matchedCalls} />
          <FlagMetric label="Background noise" count={agent.flags.backgroundNoise} denominator={agent.matchedCalls} />
          <FlagMetric label="Connection issue" count={agent.flags.connectionIssue} denominator={agent.matchedCalls} />
        </dl>
        <p className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">
          Based only on feedback matched to the {summary.loadedCalls} recent calls currently available. Unmatched and QA-missing submissions remain visible below but do not enter these counts.
        </p>
      </section>

      <section aria-labelledby="achieve-trends-heading" className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Direction</p>
          <h2 id="achieve-trends-heading" className="mt-1 text-lg font-semibold text-slate-950">Separate signal trends</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Recent calls currently available, grouped {trends.granularity === 'day' ? 'daily' : 'weekly'} in UTC. This is not a requested or complete-history date range.
          </p>
        </div>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <AiTrendPanel trends={trends} />
          <AgentTrendPanel trends={trends} />
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value, dark = false }: { label: string; value: string | number; dark?: boolean }) {
  return (
    <div>
      <dt className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${dark ? 'text-white' : 'text-slate-950'}`}>{value}</dd>
    </div>
  )
}

function RatingBar({ rating, count, denominator }: { rating: AchieveAgentRating; count: number; denominator: number }) {
  const percent = countPercent(count, denominator)
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-slate-700">{rating}</span>
        <span className="tabular-nums text-slate-500">{count} · {Math.round(percent)}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${RATING_STYLES[rating]}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function FlagMetric({ label, count, denominator }: { label: string; count: number; denominator: number }) {
  return (
    <div className="p-5 sm:p-6">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-slate-950">{count}</span>
        <span className="text-xs text-slate-500">of {denominator} matched calls</span>
      </dd>
    </div>
  )
}

function AiTrendPanel({ trends }: { trends: AchieveTrends }) {
  const maximum = Math.max(1, ...trends.buckets.map(bucket => bucket.ai.scoredCalls))
  const passed = trends.buckets.reduce((total, bucket) => total + bucket.ai.passedCalls, 0)
  const flagged = trends.buckets.reduce((total, bucket) => total + bucket.ai.flaggedCalls, 0)
  const ariaLabel = trendAriaLabel('Eavesly AI QA', trends.buckets, bucket =>
    `${bucket.ai.passedCalls} passed and ${bucket.ai.flaggedCalls} flagged`,
  )

  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Eavesly AI QA trend</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">Pass and flagged volume</h3>
        </div>
        <div className="shrink-0 text-right text-xs leading-5 text-slate-500">
          <div><span className="font-semibold text-slate-800">{passed}</span> passed</div>
          <div><span className="font-semibold text-slate-800">{flagged}</span> flagged</div>
        </div>
      </div>
      <TrendChart roleLabel={ariaLabel} buckets={trends.buckets} emptyLabel="No dated scored calls appear in the current view.">
        {bucket => (
          <div className="flex h-full w-full items-end justify-center gap-px" title={`${bucket.label}: ${bucket.ai.passedCalls} passed, ${bucket.ai.flaggedCalls} flagged`}>
            <span className="w-1/2 min-w-px rounded-t-sm bg-blue-600" style={{ height: barHeight(bucket.ai.passedCalls, maximum) }} />
            <span className="w-1/2 min-w-px rounded-t-sm border border-red-600 bg-red-100" style={{ height: barHeight(bucket.ai.flaggedCalls, maximum) }} />
          </div>
        )}
      </TrendChart>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <LegendMark className="bg-blue-600" label="Passed" />
        <LegendMark className="border border-red-600 bg-red-100" label="Flagged" />
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {passed + flagged} recent scored calls currently available · {trends.granularity === 'day' ? 'daily' : 'weekly'} UTC buckets
      </p>
    </article>
  )
}

function AgentTrendPanel({ trends }: { trends: AchieveTrends }) {
  const maximum = Math.max(1, ...trends.buckets.map(bucket => bucket.agent.matchedCalls))
  const totals = trends.buckets.reduce(
    (result, bucket) => {
      for (const rating of RATINGS) result[rating] += bucket.agent.ratings[rating]
      return result
    },
    { Good: 0, Fair: 0, Poor: 0, Other: 0 } as Record<AchieveAgentRating, number>,
  )
  const matched = RATINGS.reduce((total, rating) => total + totals[rating], 0)
  const ariaLabel = trendAriaLabel('Pennie-agent rating', trends.buckets, bucket =>
    `${bucket.agent.matchedCalls} matched calls: ${RATINGS.map(rating => `${bucket.agent.ratings[rating]} ${rating}`).join(', ')}`,
  )

  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Pennie-agent trend</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">Observed rating mix</h3>
        </div>
        <div className="shrink-0 text-right text-xs leading-5 text-slate-500">
          <div><span className="font-semibold text-slate-800">{matched}</span> matched calls</div>
          <div>{totals.Poor} Poor · {totals.Fair} Fair</div>
        </div>
      </div>
      <TrendChart roleLabel={ariaLabel} buckets={trends.buckets} emptyLabel="No dated matched feedback appears in the current view.">
        {bucket => (
          <div className="flex h-full w-full flex-col-reverse" title={`${bucket.label}: ${bucket.agent.matchedCalls} matched calls`}>
            {RATINGS.map(rating => {
              const count = bucket.agent.ratings[rating]
              return count === 0 ? null : (
                <span
                  key={rating}
                  className={`block w-full ${RATING_STYLES[rating]}`}
                  style={{ height: `${(count / maximum) * 100}%` }}
                />
              )
            })}
          </div>
        )}
      </TrendChart>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        {RATINGS.map(rating => <LegendMark key={rating} className={RATING_STYLES[rating]} label={`${rating} ${totals[rating]}`} />)}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {matched} matched calls among recent calls currently available · {trends.granularity === 'day' ? 'daily' : 'weekly'} UTC buckets
      </p>
    </article>
  )
}

function TrendChart({
  roleLabel,
  buckets,
  emptyLabel,
  children,
}: {
  roleLabel: string
  buckets: ReadonlyArray<AchieveTrendBucket>
  emptyLabel: string
  children: (bucket: AchieveTrendBucket) => React.ReactNode
}) {
  if (buckets.length === 0) {
    return <div className="mt-5 flex h-40 items-center justify-center rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-500">{emptyLabel}</div>
  }

  return (
    <div className="mt-5" role="img" aria-label={roleLabel}>
      <div
        className="grid h-40 min-w-0 items-end gap-px border-b border-slate-200"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
      >
        {buckets.map(bucket => <div key={bucket.key} className="flex h-full min-w-0 items-end">{children(bucket)}</div>)}
      </div>
      <div className="mt-2 flex justify-between gap-2 text-[10px] text-slate-400">
        <span>{buckets[0]?.label}</span>
        {buckets.length > 1 && <span className="text-right">{buckets[buckets.length - 1]?.label}</span>}
      </div>
    </div>
  )
}

function LegendMark({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function barHeight(value: number, maximum: number): string {
  if (value === 0) return '0%'
  return `${Math.max(5, (value / maximum) * 100)}%`
}

function trendAriaLabel(
  title: string,
  buckets: ReadonlyArray<AchieveTrendBucket>,
  describe: (bucket: AchieveTrendBucket) => string,
): string {
  if (buckets.length === 0) return `${title} trend: no dated values appear in the current view.`
  return `${title} trend in UTC. ${buckets.map(bucket => `${bucket.label}: ${describe(bucket)}`).join('. ')}.`
}
