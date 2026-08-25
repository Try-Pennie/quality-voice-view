import { AchieveFeedbackOverview } from '@/components/achieve/AchieveFeedbackOverview'
import { AchieveRepresentativeTable } from '@/components/achieve/AchieveRepresentativeTable'
import {
  achieveManagementPeriod,
  persistentAchieveRanks,
  persistentAchieveRepresentatives,
  type AchieveManagementReport,
  type AchieveManagementWeeks,
} from '@/lib/achieve-management'

const periodEnd = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const activityTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

/** Existing Achieve table layout with persistent risk and completed-week controls. */
export function AchieveManagementOverview({
  report,
  selectedWeeks,
  onSelectedWeeksChange,
  onOpenQaMatching,
}: {
  report: AchieveManagementReport
  selectedWeeks: AchieveManagementWeeks
  onSelectedWeeksChange: (weeks: AchieveManagementWeeks) => void
  onOpenQaMatching: () => void
}) {
  const selectedPeriod = achieveManagementPeriod(report, selectedWeeks)
  const persistentRepresentatives = persistentAchieveRepresentatives(report, selectedWeeks)
  const ranks = persistentAchieveRanks(report)
  const completedThrough = new Date(Date.parse(report.completedThrough) - 1)
  const persistentCoverage = {
    total: persistentRepresentatives.length,
    loaded: persistentRepresentatives.length,
    limit: Math.max(1, persistentRepresentatives.length),
    offset: 0,
    capReached: false,
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Completed-week management view</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Monday–Sunday periods through {periodEnd.format(completedThrough)}. Form feedback drives risk; AI QA remains supporting context.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Trailing completed weeks">
            {([2, 4, 6] as const).map(weeks => (
              <button
                key={weeks}
                type="button"
                aria-pressed={selectedWeeks === weeks}
                onClick={() => onSelectedWeeksChange(weeks)}
                className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  selectedWeeks === weeks ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-950'
                }`}
              >
                {weeks} weeks
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Termination follow-through</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Normal Form and AI reporting stops at the effective time. Any exactly attributed activity after it is tracked here.
            </p>
          </div>
          <p className={`text-xs font-semibold ${
            report.terminations.some(termination => termination.postTerminationFormSubmissions + termination.postTerminationAiCalls > 0)
              ? 'text-red-700'
              : 'text-emerald-700'
          }`}>
            {report.terminations.some(termination => termination.postTerminationFormSubmissions + termination.postTerminationAiCalls > 0)
              ? 'Post-termination activity detected'
              : 'No post-termination activity'}
          </p>
        </div>
        {report.terminations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No effective terminations to monitor.</p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {report.terminations.map(termination => {
              const activityCount = termination.postTerminationFormSubmissions + termination.postTerminationAiCalls
              const latestActivity = [termination.latestPostTerminationFormAt, termination.latestPostTerminationAiAt]
                .filter((value): value is string => value !== null)
                .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
              return (
                <article
                  key={termination.agentEmail}
                  className={`rounded-xl border p-4 ${activityCount > 0 ? 'border-red-200 bg-red-50/60' : 'border-emerald-200 bg-emerald-50/50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="[overflow-wrap:anywhere] text-sm font-semibold text-slate-950">{termination.agentName}</h3>
                      <p className="[overflow-wrap:anywhere] text-xs text-slate-500">{termination.agentEmail}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${
                      activityCount > 0 ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {activityCount > 0 ? 'Check activity' : 'Clear'}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-600">Effective {activityTime.format(new Date(termination.terminatedAt))}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/80 p-2">
                      <dt className="text-[11px] text-slate-500">Forms after</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-slate-950">{termination.postTerminationFormSubmissions}</dd>
                    </div>
                    <div className="rounded-lg bg-white/80 p-2">
                      <dt className="text-[11px] text-slate-500">AI calls after</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-slate-950">{termination.postTerminationAiCalls}</dd>
                    </div>
                  </dl>
                  {latestActivity && <p className="mt-3 text-[11px] font-medium text-red-700">Latest {activityTime.format(new Date(latestActivity))}</p>}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {persistentRepresentatives.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Persistent High Risk</h2>
          <p className="mt-2 text-sm text-slate-600">No representative ranks in the Form-feedback top 10 across all three completed periods.</p>
        </section>
      ) : (
        <AchieveRepresentativeTable
          representatives={persistentRepresentatives}
          coverage={persistentCoverage}
          title="Persistent High Risk"
          description="Representatives ranked in the sample-adjusted Form Fair/Poor top 10 across the completed 2-, 4-, and 6-week periods. AI QA is supporting context only."
          showControls={false}
          periodRanks={ranks}
        />
      )}

      <AchieveFeedbackOverview
        dashboard={selectedPeriod.dashboard}
        onOpenQaMatching={onOpenQaMatching}
        exportFilenamePrefix={`achieve-wc-agent-summary-${selectedWeeks}-weeks`}
      />
    </div>
  )
}
