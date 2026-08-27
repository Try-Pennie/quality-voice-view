import { AchieveFeedbackOverview } from '@/components/achieve/AchieveFeedbackOverview'
import { AchieveFirstPayOutcomes } from '@/components/achieve/AchieveFirstPayOutcomes'
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

const reportDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
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

      <AchieveFirstPayOutcomes outcomes={report.outcomes} />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-950">Termination follow-through</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Activity means the representative appeared in the Achieve daily report on or after the effective date.
        </p>
        {report.terminations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No effective terminations to monitor.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200">
            {report.terminations.map(termination => (
              <div key={termination.agentEmail} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <p className="font-semibold text-slate-950">
                  {termination.agentName}
                  <span className="ml-2 font-normal text-slate-500">Effective {activityTime.format(new Date(termination.terminatedAt))}</span>
                </p>
                <p className={`font-semibold ${termination.activity ? 'text-red-700' : 'text-emerald-700'}`}>
                  Activity: {termination.activity ? 'Yes' : 'No'}
                  {termination.latestActivityOn && <span className="font-normal"> · Listed {reportDate.format(new Date(termination.latestActivityOn))}</span>}
                </p>
              </div>
            ))}
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
