import { useMemo } from 'react'
import type { AlertWithFeedback } from '../../types/database'
import {
  FIRST_REVIEW_AGES,
  firstReviewAgeBucket,
  reviewAgeLabel,
  type FirstReviewAge,
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
  readonly age?: FirstReviewAge | null
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
          Current team ownership. Select a count to see its alerts.
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
                <th className="py-2 px-2 text-right">Warranted</th>
                <th className="py-2 px-2 text-right">Unnecessary</th>
                <th className="py-2 px-2 text-right">Awaiting manager</th>
                <th className="py-2 px-2 text-right">Awaiting Kris’s approval</th>
                <th className="py-2 px-2 text-right">Changes requested by Kris</th>
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
                  <CountCell manager={row} label="Warranted" value={row.counts.real} view="reviewed" outcome="real" onSelect={onSelect} />
                  <CountCell manager={row} label="Unnecessary" value={row.counts.falseAlarm} view="reviewed" outcome="false_alarm" onSelect={onSelect} />
                  <CountCell manager={row} label="Awaiting manager" value={row.counts.awaitingManager} view="awaiting_manager" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Awaiting Kris’s approval" value={row.counts.awaitingApproval} view="awaiting_approval" outcome="all" onSelect={onSelect} />
                  <CountCell manager={row} label="Changes requested by Kris" value={row.counts.changesRequested} view="changes_requested" outcome="all" onSelect={onSelect} />
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

/** All-time first reviews only; returned reviews and deferred coaching are separate work. */
export function ManagerReviewAging({ alerts, managerNames, now, loading, onSelect }: {
  alerts: readonly AlertWithFeedback[]
  managerNames: ReadonlyMap<string, string>
  now: number
  loading: boolean
  onSelect: (selection: ManagerWorkloadSelection) => void
}) {
  const rows = useMemo(() => {
    const grouped = new Map<string, { managerEmail: string; name: string; total: number; oldest: number | null; counts: Record<FirstReviewAge, number> }>()
    for (const alert of alerts) {
      const bucket = firstReviewAgeBucket(alert, now)
      if (bucket === null) continue
      const managerEmail = managerOwnershipKey(alert.assigned_manager_email)
      const row = grouped.get(managerEmail) ?? { managerEmail,
        name: managerEmail === NEEDS_MANAGER_ASSIGNMENT ? 'Needs manager assignment' : managerNames.get(managerEmail) ?? managerEmail.split('@')[0],
        total: 0, oldest: null, counts: { within_24h: 0, hours_24_48: 0, hours_48_72: 0, over_72h: 0, unknown: 0 } }
      row.total += 1
      row.counts[bucket] += 1
      if (bucket !== 'unknown') row.oldest = Math.min(row.oldest ?? Infinity, Date.parse(alert.alert_created_at))
      grouped.set(managerEmail, row)
    }
    const late = (row: { counts: Record<FirstReviewAge, number> }) => row.counts.hours_24_48 + row.counts.hours_48_72 + row.counts.over_72h
    return [...grouped.values()].sort((a, b) => late(b) - late(a) || (a.oldest ?? Infinity) - (b.oldest ?? Infinity) || a.name.localeCompare(b.name))
  }, [alerts, managerNames, now])
  const buckets = (Object.keys(FIRST_REVIEW_AGES) as FirstReviewAge[]).filter(key => key !== 'unknown' || rows.some(row => row.counts.unknown > 0))
  return <details className="rounded-3xl bg-pennie-white shadow-resting">
    <summary className="pennie-focus-ring-inset min-h-[52px] cursor-pointer rounded-3xl px-4 py-4 text-sm font-semibold text-pennie-navy sm:px-6">Manager response times</summary>
    <section aria-label="Manager response times" className="px-4 pb-5 sm:px-6">
      <p className="mb-3 text-xs text-pennie-graphite/70">First review due within 24 elapsed hours of the alert. All dates · current manager · oldest first within each bucket.</p>
      {loading ? <p>Loading response times…</p> : rows.length === 0 ? <p className="text-sm text-pennie-graphite">No first reviews outstanding.</p> : <div className="overflow-x-auto" role="group" tabIndex={0} aria-label="Manager response times table">
        <table className="min-w-full text-sm tabular-nums">
          <thead><tr className="border-b border-border text-left text-xs text-pennie-graphite/70"><th scope="col" className="py-2 pr-3">Manager</th><th scope="col" className="px-2 text-right">Awaiting review</th>{buckets.map(bucket => <th scope="col" key={bucket} className="whitespace-nowrap px-2 text-right">{FIRST_REVIEW_AGES[bucket]}</th>)}<th scope="col" className="pl-3 text-right">Oldest</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.managerEmail} className="border-b border-border/60">
            <th scope="row" className="max-w-[200px] break-words py-3 pr-3 text-left font-semibold text-pennie-navy">{row.name}</th>
            <CountCell manager={row} label="Awaiting review" value={row.total} view="awaiting_manager" outcome="all" onSelect={onSelect} />
            {buckets.map(bucket => <CountCell key={bucket} manager={row} label={FIRST_REVIEW_AGES[bucket]} value={row.counts[bucket]} view="awaiting_manager" outcome="all" age={bucket} onSelect={onSelect} />)}
            <td className="whitespace-nowrap pl-3 text-right text-pennie-graphite">{row.oldest === null ? 'Age unavailable' : reviewAgeLabel(new Date(row.oldest).toISOString(), now)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </details>
}

function CountCell({
  manager,
  label,
  value,
  view,
  outcome,
  onSelect,
  age = null,
}: {
  manager: { readonly managerEmail: string; readonly name: string }
  label: string
  value: number
  view: AlertQueueView
  outcome: WorkloadOutcome
  onSelect: (selection: ManagerWorkloadSelection) => void
  age?: FirstReviewAge | null
}) {
  return (
    <td className="py-2 px-1 text-right">
      {value === 0 ? <span className="inline-block min-w-[44px] px-2 text-center tabular-nums text-muted-foreground">0</span> : <button
        type="button"
        onClick={() => onSelect({ managerEmail: manager.managerEmail, view, outcome, age })}
        aria-label={`Filter ${manager.name} ${label} ${value}`}
        className="pennie-focus-ring min-w-[44px] min-h-[44px] rounded-full px-2 font-semibold tabular-nums text-pennie-blue-deeper hover:bg-pennie-blue-light"
      >
        {value}
      </button>}
    </td>
  )
}
