import { useState, useMemo } from 'react'
import type { AgentRollup } from '../../lib/team-queries'
import { formatDuration } from '../../lib/utils'
import { AgentSparkline } from './AgentSparkline'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'

type SortKey =
  | 'attention'
  | 'name'
  | 'calls'
  | 'reviewed'
  | 'compliance'
  | 'csat'
  | 'escalation'
  | 'alerts'
  | 'total_alerts'

export function TeamLeaderboard({
  rows,
  loading,
  onSelect,
}: {
  rows: AgentRollup[]
  loading: boolean
  onSelect: (agent: AgentRollup) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('attention')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'attention':
          // Needs attention first, then by call count desc, then name asc
          if (a.needs_attention !== b.needs_attention)
            return a.needs_attention ? -1 : 1
          cmp = b.call_count - a.call_count
          if (cmp === 0) cmp = (a.agent_full_name || a.agent_email).localeCompare(
            b.agent_full_name || b.agent_email,
          )
          return cmp
        case 'name':
          cmp = (a.agent_full_name || a.agent_email).localeCompare(
            b.agent_full_name || b.agent_email,
          )
          break
        case 'calls':
          cmp = a.call_count - b.call_count
          break
        case 'reviewed':
          cmp = a.qa_count - b.qa_count
          break
        case 'compliance':
          cmp = a.compliance_pass_rate - b.compliance_pass_rate
          break
        case 'csat':
          cmp = a.csat_high_rate - b.csat_high_rate
          break
        case 'escalation':
          cmp = a.escalation_rate - b.escalation_rate
          break
        case 'alerts':
          cmp = a.unreviewed_alerts_count - b.unreviewed_alerts_count
          break
        case 'total_alerts':
          cmp = a.total_alerts_count - b.total_alerts_count
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [rows, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Sensible defaults: name ascending, everything else descending
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-pennie-beige/60">
            <tr>
              <Th srOnly>Severity</Th>
              <SortableTh
                label="Agent"
                active={sortKey === 'name'}
                dir={sortDir}
                onClick={() => handleSort('name')}
              />
              <SortableTh
                label="Calls"
                active={sortKey === 'calls'}
                dir={sortDir}
                onClick={() => handleSort('calls')}
                align="right"
              />
              <SortableTh
                label="Reviewed"
                active={sortKey === 'reviewed'}
                dir={sortDir}
                onClick={() => handleSort('reviewed')}
                align="right"
              />
              <SortableTh
                label="Compliance"
                active={sortKey === 'compliance'}
                dir={sortDir}
                onClick={() => handleSort('compliance')}
                align="right"
              />
              <SortableTh
                label="CSAT high"
                active={sortKey === 'csat'}
                dir={sortDir}
                onClick={() => handleSort('csat')}
                align="right"
              />
              <SortableTh
                label="Escalation"
                active={sortKey === 'escalation'}
                dir={sortDir}
                onClick={() => handleSort('escalation')}
                align="right"
              />
              <SortableTh
                label="Open alerts"
                active={sortKey === 'alerts'}
                dir={sortDir}
                onClick={() => handleSort('alerts')}
                align="right"
              />
              <SortableTh
                label="Total alerts"
                active={sortKey === 'total_alerts'}
                dir={sortDir}
                onClick={() => handleSort('total_alerts')}
                align="right"
              />
              <Th>Trend</Th>
              <th
                className="text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em] px-6 py-3"
                aria-label="View"
              />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr
                  key={`sk-${i}`}
                  className={i !== 0 ? 'border-t border-border/60' : ''}
                >
                  <td className="px-3 py-4" aria-hidden="true">
                    <span className="block w-2 h-2 rounded-full bg-pennie-beige animate-pulse" />
                  </td>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <td key={j} className="px-6 py-4 align-top">
                      <span
                        className="block h-3 rounded-full bg-pennie-beige animate-pulse"
                        style={{ width: `${45 + ((i * 10 + j) % 6) * 8}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-6 py-12 text-center text-pennie-graphite/70">
                  No agents match your filters.
                </td>
              </tr>
            ) : (
              sorted.map((agent, i) => {
                const stripeColor = agent.needs_attention
                  ? agent.unreviewed_alerts_count > 0
                    ? 'before:bg-pennie-peach-dark'
                    : 'before:bg-pennie-yellow-dark'
                  : 'before:bg-transparent'
                return (
                  <tr
                    key={agent.agent_email}
                    className={`cursor-pointer transition-colors duration-150 hover:bg-pennie-beige/40 ${
                      i !== 0 ? 'border-t border-border/60' : ''
                    }`}
                    onClick={() => onSelect(agent)}
                  >
                    <td
                      className={`px-3 py-4 whitespace-nowrap text-center relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${stripeColor}`}
                      aria-hidden="true"
                    >
                      {agent.needs_attention ? (
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            agent.unreviewed_alerts_count > 0
                              ? 'bg-pennie-peach-dark'
                              : 'bg-pennie-yellow-dark'
                          }`}
                        />
                      ) : null}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-pennie-navy">
                        {agent.agent_full_name || 'Unknown'}
                      </div>
                      <div className="text-xs text-pennie-graphite/60 mt-0.5">
                        {agent.agent_email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-pennie-graphite tabular-nums text-right">
                      {agent.call_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-pennie-graphite tabular-nums text-right">
                      {agent.qa_count > 0 ? (
                        agent.qa_count
                      ) : (
                        <span className="text-pennie-graphite/40">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <PercentCell
                        value={agent.compliance_pass_rate}
                        zero={agent.qa_count === 0}
                        threshold={80}
                        warnBelow
                      />
                      <div className="text-[10px] text-pennie-graphite/50 mt-0.5">
                        {formatDuration(agent.avg_talk_time)} avg
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <PercentCell
                        value={agent.csat_high_rate}
                        zero={agent.qa_count === 0}
                        threshold={50}
                        warnBelow
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <PercentCell
                        value={agent.escalation_rate}
                        zero={agent.qa_count === 0}
                        threshold={10}
                        warnAbove
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <AlertCountPill
                        unreviewed={agent.unreviewed_alerts_count}
                        total={agent.open_alerts_count}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-pennie-graphite tabular-nums text-right">
                      {agent.total_alerts_count > 0 ? (
                        agent.total_alerts_count
                      ) : (
                        <span className="text-pennie-graphite/40">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <AgentSparkline points={agent.trend_points} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-pennie-blue-dark font-semibold text-sm">
                        View profile →
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PercentCell({
  value,
  zero,
  threshold,
  warnBelow,
  warnAbove,
}: {
  value: number
  zero: boolean
  threshold: number
  warnBelow?: boolean
  warnAbove?: boolean
}) {
  if (zero) {
    return <span className="text-sm text-pennie-graphite/40 tabular-nums">—</span>
  }
  const isWarn =
    (warnBelow && value < threshold) || (warnAbove && value >= threshold)
  return (
    <span
      className={`text-sm font-semibold tabular-nums ${
        isWarn ? 'text-pennie-peach-dark' : 'text-pennie-navy'
      }`}
    >
      {value}%
    </span>
  )
}

function AlertCountPill({
  unreviewed,
  total,
}: {
  unreviewed: number
  total: number
}) {
  if (total === 0) {
    return <span className="text-sm text-pennie-graphite/40 tabular-nums">0</span>
  }
  const tone =
    unreviewed > 0
      ? 'bg-pennie-peach-light text-pennie-peach-dark'
      : 'bg-pennie-beige text-pennie-navy'
  return (
    <span
      className={`pennie-pill ${tone} tabular-nums`}
      title={`${unreviewed} unreviewed of ${total} total`}
    >
      {unreviewed > 0 ? `${unreviewed} new` : `${total} reviewed`}
    </span>
  )
}

function Th({
  children,
  srOnly,
}: {
  children: React.ReactNode
  srOnly?: boolean
}) {
  if (srOnly) {
    // Empty <th> would auto-collapse and de-sync column widths between
    // thead and tbody — force a concrete width that matches the matching <td>.
    return (
      <th
        className="px-3 py-3 w-8"
        aria-label={typeof children === 'string' ? children : undefined}
      />
    )
  }
  return (
    <th className="text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em] px-6 py-3">
      {children}
    </th>
  )
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  align?: 'left' | 'right'
}) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      className={`text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em] px-6 py-3 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-pennie-navy ${
          active ? 'text-pennie-navy' : ''
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        <Icon className="w-3 h-3" aria-hidden="true" />
        {label}
      </button>
    </th>
  )
}
