import { useMemo } from 'react'
import type { AlertWithFeedback } from '../../types/database'
import { summarizeReviewWorkload, type AlertQueueView } from '../../lib/alert-review-queue'

type WorkloadOutcome = 'all' | 'real' | 'false_alarm'

/** URL-level filters selected from one manager workload count. */
export type ManagerWorkloadSelection = {
  readonly managerEmail: string
  readonly view: AlertQueueView
  readonly outcome: WorkloadOutcome
}

/** Current-team ownership summary; recorded reviewers remain row-level evidence. */
export function ManagerWorkloadSummary({
  alerts,
  managerNames,
  selectedManager,
  loading,
  onSelect,
}: {
  alerts: readonly AlertWithFeedback[]
  managerNames: ReadonlyMap<string, string>
  selectedManager: string | null
  loading: boolean
  onSelect: (selection: ManagerWorkloadSelection) => void
}) {
  const rows = useMemo(() => {
    const grouped = new Map<string, AlertWithFeedback[]>()
    for (const alert of alerts) {
      const manager = alert.assigned_manager_email?.trim().toLowerCase() || '__unassigned__'
      const current = grouped.get(manager) ?? []
      current.push(alert)
      grouped.set(manager, current)
    }
    return Array.from(grouped, ([managerEmail, managerAlerts]) => ({
      managerEmail,
      name: managerEmail === '__unassigned__'
        ? 'Unassigned team'
        : managerNames.get(managerEmail) ?? managerEmail.split('@')[0],
      counts: summarizeReviewWorkload(managerAlerts),
    })).sort((a, b) => b.counts.awaitingManager - a.counts.awaitingManager || a.name.localeCompare(b.name))
  }, [alerts, managerNames])
  const showSystem = rows.some(row => row.counts.systemClosed > 0)

  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-4 sm:p-6" aria-labelledby="manager-workload-heading">
      <header className="mb-4">
        <p id="manager-workload-heading" className="pennie-label">Current team workload</p>
        <p className="mt-1 text-xs text-pennie-graphite/60">
          Ownership follows the current manager mapping. “Decision by” is the recorded reviewer. Changes requested are already reviewed and overlap Reviewed; select any count to filter this inbox.
        </p>
      </header>
      {loading ? (
        <div className="h-24 rounded-2xl bg-pennie-beige/60 animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-pennie-graphite/60">No received internal alerts in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-pennie-beige text-left text-[11px] font-bold uppercase tracking-wider text-pennie-graphite/60">
                <th className="py-2 pr-4">Manager</th>
                <th className="py-2 px-2 text-right">Received</th>
                <th className="py-2 px-2 text-right">Reviewed</th>
                <th className="py-2 px-2 text-right">Real</th>
                <th className="py-2 px-2 text-right">False alarm</th>
                <th className="py-2 px-2 text-right">Awaiting manager</th>
                <th className="py-2 px-2 text-right">Changes requested</th>
                {showSystem && <th className="py-2 pl-2 text-right">System closed</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.managerEmail} className={`border-b border-pennie-beige/60 ${selectedManager === row.managerEmail ? 'bg-pennie-blue-light/40' : ''}`}>
                  <th scope="row" className="py-3 pr-4 text-left font-semibold text-pennie-navy">{row.name}</th>
                  <CountCell manager={row} label="Received" value={row.counts.received} view="all" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Reviewed" value={row.counts.reviewed} view="reviewed" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Real" value={row.counts.real} view="reviewed" outcome="real" onSelect={onSelect} />
                  <CountCell manager={row} label="False alarm" value={row.counts.falseAlarm} view="reviewed" outcome="false_alarm" onSelect={onSelect} />
                  <CountCell manager={row} label="Awaiting manager" value={row.counts.awaitingManager} view="awaiting_manager" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Changes requested" value={row.counts.changesRequested} view="changes_requested" outcome="all" onSelect={onSelect} />
                  {showSystem && <td className="py-3 pl-2 text-right tabular-nums text-pennie-graphite/70">{row.counts.systemClosed}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CountCell({
  manager,
  label,
  value,
  view,
  outcome,
  onSelect,
}: {
  manager: { readonly managerEmail: string; readonly name: string }
  label: string
  value: number
  view: AlertQueueView
  outcome: WorkloadOutcome
  onSelect: (selection: ManagerWorkloadSelection) => void
}) {
  return (
    <td className="py-2 px-1 text-right">
      <button
        type="button"
        onClick={() => onSelect({ managerEmail: manager.managerEmail, view, outcome })}
        aria-label={`Filter ${manager.name} ${label} ${value}`}
        className="pennie-focus-ring min-w-[40px] min-h-[40px] rounded-full px-2 font-semibold tabular-nums text-pennie-blue-deeper hover:bg-pennie-blue-light"
      >
        {value}
      </button>
    </td>
  )
}
