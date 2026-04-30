import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MODULE_LABELS,
  type AlertBreakdownCell,
} from '../../lib/alert-queries'
import type { AgentRollup } from '../../lib/team-queries'
import { formatDateParam } from '../../lib/url-filters'

const MAX_AGENTS = 12

export function AlertHeatmap({
  cells,
  rollups,
  loading,
  compact = false,
  startDate,
  endDate,
}: {
  cells: AlertBreakdownCell[]
  rollups: AgentRollup[]
  loading: boolean
  compact?: boolean
  startDate: Date
  endDate: Date
}) {
  const navigate = useNavigate()

  const { modules, agents, lookup, max, totalsByModule, totalsByAgent } = useMemo(() => {
    const moduleSet = new Set<string>()
    const agentTotals = new Map<string, number>()
    const cellLookup = new Map<string, AlertBreakdownCell>()
    let max = 0
    for (const c of cells) {
      moduleSet.add(c.module)
      cellLookup.set(`${c.module}::${c.agent_email}`, c)
      agentTotals.set(c.agent_email, (agentTotals.get(c.agent_email) || 0) + c.total)
      if (c.total > max) max = c.total
    }
    const nameByEmail = new Map<string, string | null>()
    for (const r of rollups) {
      nameByEmail.set(r.agent_email, r.agent_full_name)
    }
    const agents = Array.from(agentTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_AGENTS)
      .map(([email, total]) => ({
        email,
        name: nameByEmail.get(email) || null,
        total,
      }))
    const totalsByModule = new Map<string, number>()
    for (const c of cells) {
      totalsByModule.set(c.module, (totalsByModule.get(c.module) || 0) + c.total)
    }
    const modules = Array.from(moduleSet).sort(
      (a, b) => (totalsByModule.get(b) || 0) - (totalsByModule.get(a) || 0),
    )
    return {
      modules,
      agents,
      lookup: cellLookup,
      max,
      totalsByModule,
      totalsByAgent: agentTotals,
    }
  }, [cells, rollups])

  const totalAgentsInData = totalsByAgent.size

  // Mobile flattens the 2D matrix to a sorted "hottest cells" list. Rotated
  // labels and 12-wide columns are unusable on a 390px viewport; the list
  // surfaces the same drill-in interactions in a single column. Computed
  // unconditionally so hook order stays stable across loading/empty states.
  const hotCells = useMemo(() => {
    const sorted = [...cells].sort((a, b) => b.total - a.total)
    return sorted.filter(c => c.total > 0).slice(0, 8)
  }, [cells])

  const nameByEmail = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const r of rollups) m.set(r.agent_email, r.agent_full_name)
    return m
  }, [rollups])

  if (loading) {
    return (
      <section className="bg-pennie-white rounded-3xl shadow-resting p-4 sm:p-6">
        <Header compact={compact} />
        <div className="h-48 rounded-2xl bg-pennie-beige/60 animate-pulse mt-4" />
      </section>
    )
  }

  if (cells.length === 0) {
    return (
      <section className="bg-pennie-white rounded-3xl shadow-resting p-4 sm:p-6">
        <Header compact={compact} />
        <div className="py-8 text-center text-sm text-pennie-graphite/50">
          No violations in this window.
        </div>
      </section>
    )
  }

  const dateParams = () => ({
    start: formatDateParam(startDate),
    end: formatDateParam(endDate),
  })

  const onCellClick = (module: string, agentEmail: string) => {
    const params = new URLSearchParams({
      ...dateParams(),
      module,
      search: agentEmail,
      status: 'new',
    })
    navigate(`/dashboard/alerts?${params.toString()}`)
  }

  const onModuleClick = (module: string) => {
    const params = new URLSearchParams({
      ...dateParams(),
      module,
      status: 'new',
    })
    navigate(`/dashboard/alerts?${params.toString()}`)
  }

  const onAgentClick = (agentEmail: string) => {
    const params = new URLSearchParams({
      ...dateParams(),
      search: agentEmail,
      status: 'new',
    })
    navigate(`/dashboard/alerts?${params.toString()}`)
  }

  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-4 sm:p-6">
      <Header compact={compact} hiddenAgents={Math.max(0, totalAgentsInData - agents.length)} />

      {/* Mobile — list of the hottest (module × agent) pairs. */}
      <ul className="sm:hidden mt-4 divide-y divide-border/60">
        {hotCells.length === 0 ? (
          <li className="py-8 text-center text-sm text-pennie-graphite/50">
            No violations in this window.
          </li>
        ) : (
          hotCells.map(cell => {
            const name = nameByEmail.get(cell.agent_email) || cell.agent_email
            const fpRate =
              cell.reviewed > 0 ? cell.false_positives / cell.reviewed : 0
            const flagFP = cell.reviewed >= 3 && fpRate >= 0.5
            return (
              <li key={`${cell.module}::${cell.agent_email}`}>
                <button
                  type="button"
                  onClick={() => onCellClick(cell.module, cell.agent_email)}
                  className="pennie-focus-ring-inset w-full text-left flex items-center gap-3 px-1 py-3 hover:bg-pennie-beige/40 active:bg-pennie-beige/60 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-pennie-navy truncate">
                      {MODULE_LABELS[cell.module] ?? cell.module}
                    </p>
                    <p className="text-xs text-pennie-graphite/70 truncate">
                      {shortenName(
                        nameByEmail.get(cell.agent_email) ?? null,
                        cell.agent_email,
                      )}
                      {cell.unreviewed > 0 && (
                        <span className="ml-2 text-pennie-peach-deeper font-semibold">
                          {cell.unreviewed} unreviewed
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`min-w-[44px] h-9 px-2.5 rounded-full inline-flex items-center justify-center text-sm font-semibold tabular-nums ${
                      flagFP
                        ? 'bg-pennie-yellow-light text-pennie-yellow-dark ring-1 ring-pennie-yellow-dark'
                        : 'bg-pennie-peach-light text-pennie-peach-deeper'
                    }`}
                    title={
                      flagFP
                        ? `${Math.round(fpRate * 100)}% flagged in error`
                        : `${cell.total} violations`
                    }
                  >
                    {cell.total}
                  </span>
                  <span className="sr-only">View alerts for {name}</span>
                </button>
              </li>
            )
          })
        )}
      </ul>

      {/* Desktop / tablet — full matrix. */}
      <div className="hidden sm:block overflow-x-auto overflow-y-visible -mx-2 px-2 pt-4 pr-12">
        <table className="min-w-full text-sm border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-[11px] uppercase tracking-wider text-pennie-graphite/60 font-semibold pr-3 sticky left-0 bg-pennie-white z-10">
                Module
              </th>
              {agents.map(a => (
                <th
                  key={a.email}
                  scope="col"
                  className="px-1 align-bottom h-24 overflow-visible"
                >
                  <div className="h-full flex items-end justify-start">
                    <button
                      type="button"
                      onClick={() => onAgentClick(a.email)}
                      className="text-[11px] text-pennie-navy/80 font-semibold tracking-wide hover:text-pennie-navy whitespace-nowrap rotate-[-30deg] origin-bottom-left translate-y-1 inline-block"
                      title={a.name || a.email}
                    >
                      {shortenName(a.name, a.email)}
                    </button>
                  </div>
                </th>
              ))}
              <th className="text-left text-[11px] uppercase tracking-wider text-pennie-graphite/60 font-semibold pl-3">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {modules.map(module => (
              <tr key={module}>
                <th
                  scope="row"
                  className="text-left pr-3 align-middle sticky left-0 bg-pennie-white z-10"
                >
                  <button
                    type="button"
                    onClick={() => onModuleClick(module)}
                    className="text-sm text-pennie-navy font-semibold hover:underline whitespace-nowrap"
                  >
                    {MODULE_LABELS[module] ?? module}
                  </button>
                </th>
                {agents.map(a => {
                  const cell = lookup.get(`${module}::${a.email}`)
                  return (
                    <td key={a.email} className="p-0">
                      <HeatCell
                        cell={cell}
                        max={max}
                        onClick={() => onCellClick(module, a.email)}
                      />
                    </td>
                  )
                })}
                <td className="pl-3 text-sm text-pennie-navy font-semibold tabular-nums">
                  {totalsByModule.get(module) || 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Legend explains the matrix intensity buckets — only relevant when the
          matrix itself is visible. */}
      <div className="hidden sm:block">
        <Legend />
      </div>
    </section>
  )
}

function Header({
  compact,
  hiddenAgents,
}: {
  compact?: boolean
  hiddenAgents?: number
}) {
  return (
    <header className="mb-5">
      <p className="pennie-label">{compact ? 'By alert type × agent' : 'Alert breakdown'}</p>
      {!compact && (
        <p className="text-xs text-pennie-graphite/60 mt-1">
          Rows lit up signal a systemic issue (training or product); columns lit
          up signal a single agent needing 1:1 coaching. Click any cell, row, or
          column to drill in.
        </p>
      )}
      {hiddenAgents && hiddenAgents > 0 ? (
        <p className="text-[11px] text-pennie-graphite/50 mt-2">
          Showing top {MAX_AGENTS} agents by violation volume. {hiddenAgents}{' '}
          additional agent{hiddenAgents === 1 ? '' : 's'} not shown.
        </p>
      ) : null}
    </header>
  )
}

function HeatCell({
  cell,
  max,
  onClick,
}: {
  cell: AlertBreakdownCell | undefined
  max: number
  onClick: () => void
}) {
  const total = cell?.total ?? 0
  const fpRate =
    cell && cell.reviewed > 0 ? cell.false_positives / cell.reviewed : 0
  const intensity = max > 0 ? total / max : 0

  // Three intensity buckets to keep contrast readable in monochrome
  const bg =
    total === 0
      ? 'bg-pennie-beige/30'
      : intensity > 0.66
      ? 'bg-pennie-peach-dark text-pennie-white'
      : intensity > 0.33
      ? 'bg-pennie-peach-dark/60 text-pennie-navy'
      : 'bg-pennie-peach-dark/25 text-pennie-navy'

  // Border highlights cells where reviewed feedback flagged most as false positives
  const borderHighFP =
    cell && cell.reviewed >= 3 && fpRate >= 0.5
      ? 'ring-2 ring-pennie-yellow-dark'
      : ''

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={total === 0}
      title={
        cell
          ? `${total} violation${total === 1 ? '' : 's'}, ${cell.unreviewed} unreviewed${
              cell.reviewed > 0
                ? `, ${Math.round(fpRate * 100)}% flagged in error`
                : ''
            }`
          : 'No violations'
      }
      className={`w-12 h-10 rounded-lg flex items-center justify-center text-sm font-semibold tabular-nums transition-transform ${bg} ${borderHighFP} ${
        total > 0
          ? 'hover:scale-[1.05] cursor-pointer'
          : 'cursor-default'
      }`}
    >
      {total > 0 ? total : ''}
    </button>
  )
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-pennie-graphite/70">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded bg-pennie-peach-dark/25" />
        <span className="w-3 h-3 rounded bg-pennie-peach-dark/60" />
        <span className="w-3 h-3 rounded bg-pennie-peach-dark" />
        <span>Volume (low → high)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded bg-pennie-beige/40 ring-2 ring-pennie-yellow-dark" />
        <span>≥50% flagged in error (≥3 reviewed)</span>
      </div>
    </div>
  )
}

function shortenName(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1][0]}.`
    return name
  }
  return email.split('@')[0]
}
