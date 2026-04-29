import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import type { ManagerRollup } from '../../lib/team-queries'

type SortKey =
  | 'call_count'
  | 'qa_count'
  | 'compliance_pass_rate'
  | 'escalation_rate'
  | 'csat_high_rate'
  | 'unreviewed_alerts_count'
  | 'total_alerts_count'
  | 'agent_count'

export function TeamBreakdownByManager({
  rows,
  loading,
  selectedManager,
  onSelect,
}: {
  rows: ManagerRollup[]
  loading: boolean
  selectedManager: string | null
  onSelect: (row: ManagerRollup | null) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('call_count')
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey] as number
      const bv = b[sortKey] as number
      return sortDesc ? bv - av : av - bv
    })
    return copy
  }, [rows, sortKey, sortDesc])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc(d => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="pennie-label">Breakout by team</p>
          <p className="text-xs text-pennie-graphite/60 mt-1">
            One row per manager. Click a row to filter the leaderboard below to
            that team only.
          </p>
        </div>
        {selectedManager && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-pennie-blue-dark hover:underline"
          >
            Clear team filter
            <X className="w-3 h-3" />
          </button>
        )}
      </header>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-10 rounded-xl bg-pennie-beige/60 animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="py-8 text-center text-sm text-pennie-graphite/50">
          No managers with calls in this window.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-pennie-graphite/60 border-b border-pennie-beige">
                <th className="py-2 pr-4 font-semibold">Manager</th>
                <SortHeader
                  label="Agents"
                  active={sortKey === 'agent_count'}
                  desc={sortDesc}
                  onClick={() => toggleSort('agent_count')}
                />
                <SortHeader
                  label="Calls"
                  active={sortKey === 'call_count'}
                  desc={sortDesc}
                  onClick={() => toggleSort('call_count')}
                />
                <SortHeader
                  label="Reviewed"
                  active={sortKey === 'qa_count'}
                  desc={sortDesc}
                  onClick={() => toggleSort('qa_count')}
                />
                <SortHeader
                  label="Compliance"
                  active={sortKey === 'compliance_pass_rate'}
                  desc={sortDesc}
                  onClick={() => toggleSort('compliance_pass_rate')}
                />
                <SortHeader
                  label="CSAT high"
                  active={sortKey === 'csat_high_rate'}
                  desc={sortDesc}
                  onClick={() => toggleSort('csat_high_rate')}
                />
                <SortHeader
                  label="Escalation"
                  active={sortKey === 'escalation_rate'}
                  desc={sortDesc}
                  onClick={() => toggleSort('escalation_rate')}
                />
                <SortHeader
                  label="Open alerts"
                  active={sortKey === 'unreviewed_alerts_count'}
                  desc={sortDesc}
                  onClick={() => toggleSort('unreviewed_alerts_count')}
                />
                <SortHeader
                  label="Total alerts"
                  active={sortKey === 'total_alerts_count'}
                  desc={sortDesc}
                  onClick={() => toggleSort('total_alerts_count')}
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const isSelected = selectedManager === r.manager_email
                const isUnassigned = r.manager_email === '__unassigned__'
                return (
                  <tr
                    key={r.manager_email}
                    className={`border-b border-pennie-beige/60 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-pennie-blue-dark/5'
                        : 'hover:bg-pennie-beige/40'
                    }`}
                    onClick={() => onSelect(isSelected ? null : r)}
                    aria-selected={isSelected}
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-pennie-navy">
                          {isUnassigned
                            ? 'Unassigned agents'
                            : managerDisplayName(
                                r.manager_full_name,
                                r.manager_email,
                              )}
                        </span>
                        {r.needs_attention && (
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-pennie-peach-dark/15 text-pennie-peach-dark font-semibold"
                            title="At least one team metric is below target"
                          >
                            Attention
                          </span>
                        )}
                      </div>
                      {!isUnassigned && r.manager_full_name && (
                        <div className="text-[11px] text-pennie-graphite/60 mt-0.5 tabular-nums">
                          {r.manager_email}
                        </div>
                      )}
                      {r.top_agent && (
                        <div className="text-[11px] text-pennie-graphite/60 mt-0.5">
                          Top:{' '}
                          {r.top_agent.agent_full_name || r.top_agent.agent_email}
                          {' · '}
                          {r.top_agent.compliance_pass_rate}% compliance
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-pennie-navy">
                      {r.agent_count}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-pennie-navy">
                      {r.call_count.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-pennie-navy">
                      {r.qa_count > 0 ? (
                        r.qa_count.toLocaleString()
                      ) : (
                        <span className="text-pennie-graphite/40">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      <Bar value={r.compliance_pass_rate} target={80} positiveAbove />
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      <Bar value={r.csat_high_rate} target={50} positiveAbove />
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      <Bar
                        value={r.escalation_rate}
                        target={10}
                        positiveAbove={false}
                      />
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-pennie-navy">
                      {r.unreviewed_alerts_count}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-pennie-navy">
                      {r.total_alerts_count}
                    </td>
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

function SortHeader({
  label,
  active,
  desc,
  onClick,
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
}) {
  return (
    <th className="py-2 pr-4 font-semibold">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-pennie-navy ${
          active ? 'text-pennie-navy' : ''
        }`}
      >
        {label}
        {active && <span aria-hidden>{desc ? '▾' : '▴'}</span>}
      </button>
    </th>
  )
}

// Show the manager's first name when we have one, falling back to the email
// local-part. The full email is rendered separately as secondary text.
function managerDisplayName(fullName: string | null, email: string): string {
  if (fullName) {
    const first = fullName.trim().split(/\s+/)[0]
    if (first) return first
  }
  return email.split('@')[0]
}

function Bar({
  value,
  target,
  positiveAbove,
}: {
  value: number
  target: number
  positiveAbove: boolean
}) {
  const isGood = positiveAbove ? value >= target : value < target
  const tone = isGood ? 'text-pennie-green-dark' : 'text-pennie-peach-dark'
  return <span className={`font-semibold ${tone}`}>{value}%</span>
}
