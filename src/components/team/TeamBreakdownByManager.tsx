import { useMemo } from 'react'
import type { ManagerRollup } from '../../lib/team-queries'

export type ManagerSortKey =
  | 'call_count' | 'reviewable_call_count' | 'qa_count' | 'compliance_pass_rate' | 'escalation_rate' | 'csat_high_rate'
  | 'unreviewed_alerts_count' | 'total_alerts_count' | 'confirmed_issue_count' | 'agent_count'
  | 'reviewed_alerts_count' | 'false_positive_count'

const OUTCOMES: readonly { key: ManagerSortKey; label: string }[] = [
  { key: 'total_alerts_count', label: 'Received' },
  { key: 'confirmed_issue_count', label: 'Warranted' },
  { key: 'false_positive_count', label: 'Unnecessary' },
  { key: 'unreviewed_alerts_count', label: 'Awaiting manager' },
  { key: 'reviewed_alerts_count', label: 'Reviewed' },
]
const METRICS: readonly { key: ManagerSortKey; label: string }[] = [
  { key: 'agent_count', label: 'Agents' }, { key: 'reviewable_call_count', label: 'Reviewable calls' },
  { key: 'qa_count', label: 'AI-evaluated calls' }, { key: 'compliance_pass_rate', label: 'AI compliance' },
  { key: 'csat_high_rate', label: 'AI CSAT high' }, { key: 'escalation_rate', label: 'AI escalation' },
]

/** Team ownership is resolved at the reporting window's end, not today's queue ownership. */
export function TeamBreakdownByManager({ rows, loading, selectedManager, onSelect, sortKey, sortDesc, onSortChange }: {
  rows: ManagerRollup[]
  loading: boolean
  selectedManager: string | null
  onSelect: (row: ManagerRollup | null) => void
  sortKey: ManagerSortKey
  sortDesc: boolean
  onSortChange: (key: ManagerSortKey, desc: boolean) => void
}) {
  const showMetrics = sortKey === 'call_count' || METRICS.some(field => field.key === sortKey)
  const sorted = useMemo(() => [...rows].sort((a, b) => (sortDesc ? -1 : 1) * (a[sortKey] - b[sortKey]) || a.manager_email.localeCompare(b.manager_email)), [rows, sortKey, sortDesc])
  const fields = showMetrics ? METRICS : OUTCOMES
  return <section aria-label="Team outcomes by manager" className="rounded-3xl bg-pennie-white p-4 shadow-resting sm:p-6">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold text-pennie-navy">By manager’s team</h2><p className="mt-1 text-xs text-pennie-graphite/70">Teams as of the period end. Select a manager to filter representatives below.</p></div>
      <div className="flex flex-wrap gap-2">
        {selectedManager && <button type="button" onClick={() => onSelect(null)} className="pennie-focus-ring min-h-[44px] rounded-full px-3 text-sm font-semibold text-pennie-blue-deeper">Clear team filter</button>}
        <button type="button" aria-pressed={showMetrics} onClick={() => onSortChange(showMetrics ? 'confirmed_issue_count' : 'reviewable_call_count', true)} className="pennie-focus-ring min-h-[44px] rounded-full border border-border px-3 text-sm font-semibold text-pennie-blue-deeper">{showMetrics ? 'Team alert outcomes' : 'Team AI metrics'}</button>
      </div>
    </header>
    {showMetrics && <p className="mb-3 text-xs text-pennie-graphite/70">Reviewable = Regal confirms a conversation and a nonblank transcript is available. AI metrics use only these calls. Not yet evaluated includes pending or failed QA; total calls includes excluded calls.</p>}
    {loading ? <p className="py-6 text-sm">Loading teams…</p> : !rows.length ? <p className="py-6 text-sm">No managers with calls in this window.</p> : <div className="overflow-x-auto" role="group" tabIndex={0} aria-label="Team outcomes table">
      <table className="min-w-full text-sm tabular-nums">
        <thead><tr className="border-b border-border text-left text-xs text-pennie-graphite/70"><th scope="col" className="pr-4">Manager</th>{fields.map(field => <th key={field.key} scope="col" aria-sort={sortKey === field.key ? sortDesc ? 'descending' : 'ascending' : 'none'} className="px-2 text-right"><button type="button" onClick={() => onSortChange(field.key, sortKey === field.key ? !sortDesc : true)} className="pennie-focus-ring min-h-[44px] whitespace-nowrap font-semibold">{field.label}{sortKey === field.key && <span aria-hidden="true"> {sortDesc ? '↓' : '↑'}</span>}</button></th>)}</tr></thead>
        <tbody>{sorted.map(row => <tr key={row.manager_email} className={`border-b border-border/60 ${selectedManager === row.manager_email ? 'bg-pennie-blue-light/50' : ''}`}>
          <th scope="row" className="max-w-[220px] py-2 pr-4 text-left"><button type="button" aria-pressed={selectedManager === row.manager_email} onClick={() => onSelect(selectedManager === row.manager_email ? null : row)} className="pennie-focus-ring min-h-[44px] break-words text-left font-semibold text-pennie-blue-deeper hover:underline">{row.manager_email === '__unassigned__' ? 'Unassigned agents' : row.manager_full_name?.trim() || row.manager_email.split('@')[0]}</button>{row.manager_email !== '__unassigned__' && <p className="text-xs font-normal text-pennie-graphite/60">{row.manager_email}</p>}{row.system_closed_count > 0 && !showMetrics && <p className="text-xs font-normal text-pennie-graphite/70">{row.system_closed_count} system closed</p>}</th>
          {fields.map(field => <td key={field.key} className="px-2 py-3 text-right text-pennie-navy">{field.key.endsWith('_rate') ? row.qa_count ? `${row[field.key]}%` : '—' : row[field.key].toLocaleString()}{field.key === 'reviewable_call_count' && <p className="mt-1 whitespace-nowrap text-xs text-pennie-graphite/70">{row.call_count.toLocaleString()} total calls</p>}{field.key === 'qa_count' && <p className="mt-1 whitespace-nowrap text-xs text-pennie-graphite/70">{(row.reviewable_call_count - row.qa_count).toLocaleString()} not yet evaluated</p>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>
}
