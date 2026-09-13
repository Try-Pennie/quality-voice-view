import { useMemo } from 'react'
import type { AlertWithFeedback } from '../../types/database'
import {
  isHumanReviewed,
  needsCoachingFollowUp,
  summarizeReviewWorkload,
  type AlertQueueView,
} from '../../lib/alert-review-queue'
import { managerOwnershipKey, NEEDS_MANAGER_ASSIGNMENT } from '../../lib/manager-ownership'

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
      const manager = managerOwnershipKey(alert.assigned_manager_email)
      const current = grouped.get(manager) ?? []
      current.push(alert)
      grouped.set(manager, current)
    }
    return Array.from(grouped, ([managerEmail, managerAlerts]) => ({
      managerEmail,
      name: managerEmail === NEEDS_MANAGER_ASSIGNMENT
        ? 'Needs manager assignment'
        : managerNames.get(managerEmail) ?? managerEmail.split('@')[0],
      counts: {
        ...summarizeReviewWorkload(managerAlerts),
        awaitingApproval: managerAlerts.filter(alert => isHumanReviewed(alert) && alert.current_decision === null).length,
        coachingDue: managerAlerts.filter(needsCoachingFollowUp).length,
      },
    })).sort((a, b) => b.counts.awaitingManager - a.counts.awaitingManager || a.name.localeCompare(b.name))
  }, [alerts, managerNames])
  const showSystem = rows.some(row => row.counts.systemClosed > 0)

  return (
    <section className="rounded-2xl border border-pennie-beige p-3 sm:p-4" aria-labelledby="manager-workload-heading">
      <header className="mb-4">
        <p id="manager-workload-heading" className="pennie-label">By current manager</p>
        <p className="mt-1 text-xs text-pennie-graphite/60">
          Received = manager reviewed + awaiting manager + system closed. Corrections and coaching can overlap manager-reviewed work. Select a count to filter this queue.
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
                <th className="py-2 px-2 text-right">Manager reviewed</th>
                <th className="py-2 px-2 text-right">Real</th>
                <th className="py-2 px-2 text-right">False alarm</th>
                <th className="py-2 px-2 text-right">Awaiting manager</th>
                <th className="py-2 px-2 text-right">Awaiting director approval</th>
                <th className="py-2 px-2 text-right">Changes requested</th>
                <th className="py-2 px-2 text-right">Coaching due</th>
                {showSystem && <th className="py-2 pl-2 text-right">System closed</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.managerEmail} className={`border-b border-pennie-beige/60 ${selectedManager === row.managerEmail ? 'bg-pennie-blue-light/40' : ''}`}>
                  <th scope="row" className="py-3 pr-4 text-left font-semibold text-pennie-navy">{row.name}</th>
                  <CountCell manager={row} label="Received" value={row.counts.received} view="all" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Manager reviewed" value={row.counts.reviewed} view="reviewed" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Real" value={row.counts.real} view="reviewed" outcome="real" onSelect={onSelect} />
                  <CountCell manager={row} label="False alarm" value={row.counts.falseAlarm} view="reviewed" outcome="false_alarm" onSelect={onSelect} />
                  <CountCell manager={row} label="Awaiting manager" value={row.counts.awaitingManager} view="awaiting_manager" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Awaiting director approval" value={row.counts.awaitingApproval} view="awaiting_approval" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Changes requested" value={row.counts.changesRequested} view="changes_requested" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Coaching due" value={row.counts.coachingDue} view="coaching_due" outcome="all" onSelect={onSelect} />
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
