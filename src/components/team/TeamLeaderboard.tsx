import { useState, useMemo } from 'react'
import type { AgentRollup } from '../../lib/team-queries'
import { agentDisplayName, formatDuration } from '../../lib/utils'
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
  | 'confirmed_issues'
  | 'rushed'

export function TeamLeaderboard({
  rows,
  loading,
  onSelect,
  onSelectAlerts,
}: {
  rows: AgentRollup[]
  loading: boolean
  onSelect: (agent: AgentRollup) => void
  onSelectAlerts: (agent: AgentRollup, view: 'all' | 'reviewed' | 'awaiting_manager', outcome?: 'real' | 'false_alarm') => void
}) {
  const [showMetrics, setShowMetrics] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('confirmed_issues')
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
        case 'confirmed_issues':
          cmp = a.confirmed_issue_count - b.confirmed_issue_count
          break
        case 'rushed':
          cmp = a.rushed_pitch_count - b.rushed_pitch_count
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
    <section aria-label="Alerts by representative" className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
        <div><h2 className="text-base font-semibold text-pennie-navy">Alerts by representative</h2><p className="mt-1 text-xs text-pennie-graphite/70">Manager verdicts · not Kris approvals. One alert per call and alert type.</p></div>
        <button type="button" aria-pressed={showMetrics} onClick={() => { setShowMetrics(value => !value); if (showMetrics) { setSortKey('confirmed_issues'); setSortDir('desc') } }} className="pennie-focus-ring min-h-[44px] rounded-full border border-border px-4 text-sm font-semibold text-pennie-blue-deeper">{showMetrics ? 'Alert outcomes' : 'More metrics'}</button>
      </header>
      {!showMetrics && <div className="px-4 pb-3 sm:px-6"><label className="text-xs font-semibold text-pennie-graphite">Sort alerts <select value={sortKey === 'name' ? 'name' : sortKey === 'alerts' ? 'alerts' : sortKey === 'total_alerts' ? 'total_alerts' : 'confirmed_issues'} onChange={event => { const key = event.target.value; if (key === 'name' || key === 'alerts' || key === 'total_alerts' || key === 'confirmed_issues') { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') } }} className="pennie-focus-ring ml-2 min-h-[44px] rounded-full border border-border bg-white px-3"><option value="confirmed_issues">Warranted alerts</option><option value="alerts">Awaiting manager</option><option value="total_alerts">Received alerts</option><option value="name">Representative name</option></select></label></div>}
      {!showMetrics ? <AlertOutcomes rows={sorted} loading={loading} onSelect={onSelect} onSelectAlerts={onSelectAlerts} /> : <>
      {/* Mobile sort control — the desktop table sorts via column headers,
          which collapse on phone, so expose a single dropdown instead. */}
      <div className="md:hidden border-b border-border bg-pennie-beige/40 px-4 py-3 flex items-center justify-between gap-2">
        <label
          htmlFor="team-leaderboard-mobile-sort"
          className="pennie-label flex-none"
        >
          Sort
        </label>
        <select
          id="team-leaderboard-mobile-sort"
          value={`${sortKey}:${sortDir}`}
          onChange={e => {
            const [k, d] = e.target.value.split(':') as [SortKey, 'asc' | 'desc']
            setSortKey(k)
            setSortDir(d)
          }}
          className="pennie-focus-ring flex-1 min-h-[40px] rounded-full border border-border bg-pennie-white px-3 text-sm font-semibold text-pennie-navy"
        >
          <option value="attention:desc">Needs attention first</option>
          <option value="name:asc">Agent name (A → Z)</option>
          <option value="calls:desc">Calls (high → low)</option>
          <option value="compliance:asc">Compliance (low → high)</option>
          <option value="csat:asc">CSAT high (low → high)</option>
          <option value="escalation:desc">Escalation (high → low)</option>
          <option value="alerts:desc">Awaiting manager (high → low)</option>
          <option value="total_alerts:desc">Received alerts (high → low)</option>
          <option value="confirmed_issues:desc">Manager-confirmed issues (high → low)</option>
          <option value="rushed:desc">Pitch calls under 30 min (high → low)</option>
        </select>
      </div>

      {/* Mobile card list */}
      <ul className="md:hidden divide-y divide-border/60">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <li key={`sk-mob-${i}`} className="px-4 py-4">
              <span
                className="block h-3 rounded-full bg-pennie-beige animate-pulse"
                style={{ width: `${45 + (i % 5) * 8}%` }}
              />
              <span
                className="mt-2 block h-2.5 rounded-full bg-pennie-beige animate-pulse"
                style={{ width: `${30 + (i % 4) * 10}%` }}
              />
            </li>
          ))
        ) : sorted.length === 0 ? (
          <li className="px-6 py-10 text-center text-pennie-graphite/70">
            No agents match your filters.
          </li>
        ) : (
          sorted.map(agent => {
            const stripeBg = agent.needs_attention
              ? agent.unreviewed_alerts_count > 0
                ? 'bg-pennie-peach-dark'
                : 'bg-pennie-yellow-dark'
              : 'bg-transparent'
            return (
              <li key={`mob-${agent.agent_email}`}>
                <button
                  type="button"
                  onClick={() => onSelect(agent)}
                  className="pennie-focus-ring-inset relative w-full text-left px-4 py-4 flex gap-3 items-start hover:bg-pennie-beige/40 active:bg-pennie-beige/60 transition-colors"
                >
                  <span
                    className={`mt-1 w-1 self-stretch rounded-full ${stripeBg}`}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-pennie-navy truncate">
                      {agentDisplayName(agent.agent_full_name, agent.agent_email)}
                    </p>
                    <p className="mt-0.5 text-xs text-pennie-graphite/60 truncate">
                      {agent.agent_email}
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-pennie-graphite/50 font-bold">
                          Compliance
                        </dt>
                        <dd className="mt-0.5">
                          <PercentCell
                            value={agent.compliance_pass_rate}
                            zero={agent.qa_count === 0}
                            threshold={80}
                            warnBelow
                          />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-pennie-graphite/50 font-bold">
                          Calls
                        </dt>
                        <dd className="mt-0.5 text-sm font-semibold text-pennie-navy tabular-nums">
                          {agent.call_count}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-pennie-graphite/50 font-bold">
                          Awaiting manager
                        </dt>
                        <dd className="mt-0.5">
                          <AlertCountPill
                            unreviewed={agent.unreviewed_alerts_count}
                            total={agent.open_alerts_count}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-pennie-graphite/50 font-bold">
                          Confirmed issues
                        </dt>
                        <dd className="mt-0.5 text-sm font-semibold text-pennie-navy tabular-nums">
                          {agent.confirmed_issue_count}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-pennie-graphite/50 font-bold">
                          Pitch calls under 30 min
                        </dt>
                        <dd className="mt-0.5">
                          <RushedPitchCell agent={agent} />
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <span
                    aria-hidden="true"
                    className="self-center text-pennie-graphite/40 flex-none text-lg leading-none"
                  >
                    ›
                  </span>
                  <span className="sr-only">View {agent.agent_full_name || agent.agent_email}'s profile</span>
                </button>
              </li>
            )
          })
        )}
      </ul>

      {/* Desktop / tablet table */}
      <div className="hidden md:block overflow-x-auto">
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
                label="AI-evaluated calls"
                active={sortKey === 'reviewed'}
                dir={sortDir}
                onClick={() => handleSort('reviewed')}
                align="right"
              />
              <SortableTh
                label="AI compliance"
                active={sortKey === 'compliance'}
                dir={sortDir}
                onClick={() => handleSort('compliance')}
                align="right"
              />
              <SortableTh
                label="AI CSAT high"
                active={sortKey === 'csat'}
                dir={sortDir}
                onClick={() => handleSort('csat')}
                align="right"
              />
              <SortableTh
                label="AI escalation"
                active={sortKey === 'escalation'}
                dir={sortDir}
                onClick={() => handleSort('escalation')}
                align="right"
              />
              <SortableTh
                label="Awaiting manager"
                active={sortKey === 'alerts'}
                dir={sortDir}
                onClick={() => handleSort('alerts')}
                align="right"
              />
              <SortableTh
                label="Received alerts"
                active={sortKey === 'total_alerts'}
                dir={sortDir}
                onClick={() => handleSort('total_alerts')}
                align="right"
              />
              <SortableTh
                label="Warranted alerts"
                active={sortKey === 'confirmed_issues'}
                dir={sortDir}
                onClick={() => handleSort('confirmed_issues')}
                align="right"
              />
              <SortableTh
                label="Pitch calls under 30 min"
                active={sortKey === 'rushed'}
                dir={sortDir}
                onClick={() => handleSort('rushed')}
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
                  {Array.from({ length: 12 }).map((__, j) => (
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
                <td colSpan={13} className="px-6 py-12 text-center text-pennie-graphite/70">
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
                        {agentDisplayName(agent.agent_full_name, agent.agent_email)}
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
                      {agent.total_alerts_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-pennie-graphite tabular-nums text-right">
                      {agent.confirmed_issue_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <RushedPitchCell agent={agent} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <AgentSparkline points={agent.trend_points} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-pennie-blue-deeper font-semibold text-sm">
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
      </>}
    </section>
  )
}

const OUTCOMES = [
  { label: 'Received', key: 'total_alerts_count', view: 'all' },
  { label: 'Warranted', key: 'confirmed_issue_count', view: 'reviewed', outcome: 'real' },
  { label: 'Unnecessary', key: 'false_positive_count', view: 'reviewed', outcome: 'false_alarm' },
  { label: 'Awaiting manager', key: 'unreviewed_alerts_count', view: 'awaiting_manager' },
] as const

function AlertOutcomes({ rows, loading, onSelect, onSelectAlerts }: {
  rows: AgentRollup[]
  loading: boolean
  onSelect: (agent: AgentRollup) => void
  onSelectAlerts: (agent: AgentRollup, view: 'all' | 'reviewed' | 'awaiting_manager', outcome?: 'real' | 'false_alarm') => void
}) {
  if (loading) return <p className="px-6 py-8 text-sm text-pennie-graphite">Loading alert outcomes…</p>
  if (!rows.length) return <p className="px-6 py-8 text-sm text-pennie-graphite">No agents match your filters.</p>
  const name = (agent: AgentRollup) => agentDisplayName(agent.agent_full_name, agent.agent_email)
  const coverage = (agent: AgentRollup) => `${agent.reviewed_alerts_count} / ${agent.total_alerts_count - agent.system_closed_count} reviewed`
  const profile = (agent: AgentRollup) => <button type="button" onClick={() => onSelect(agent)} className="pennie-focus-ring min-h-[44px] text-left font-semibold text-pennie-blue-deeper hover:underline">{name(agent)}<span className="sr-only"> · {agent.agent_email} · View profile</span></button>
  const count = (agent: AgentRollup, field: typeof OUTCOMES[number]) => agent[field.key] === 0 ? <span className="inline-block min-w-[44px] px-2 text-center tabular-nums text-muted-foreground">0</span> : <button type="button" aria-label={`Filter ${name(agent)} ${field.label} ${agent[field.key]}`} onClick={() => onSelectAlerts(agent, field.view, 'outcome' in field ? field.outcome : undefined)} className="pennie-focus-ring min-h-[44px] min-w-[44px] rounded-full px-2 font-semibold tabular-nums text-pennie-blue-deeper hover:bg-pennie-blue-light">{agent[field.key]}</button>
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="min-w-full text-sm"><thead className="bg-pennie-beige/60 text-left text-xs text-pennie-graphite/70"><tr><th scope="col" className="px-6 py-3">Representative</th>{OUTCOMES.map(field => <th scope="col" key={field.key} className="px-3 py-3 text-right">{field.label}</th>)}<th scope="col" className="px-6 py-3 text-right">Review coverage</th></tr></thead><tbody>{rows.map(agent => <tr key={agent.agent_email} className="border-t border-border/60"><th scope="row" className="px-6 py-2 text-left">{profile(agent)}</th>{OUTCOMES.map(field => <td key={field.key} className="px-3 py-2 text-right">{count(agent, field)}</td>)}<td className="px-6 py-2 text-right tabular-nums text-pennie-graphite">{agent.reviewed_alerts_count === 0 ? <span className="text-muted-foreground">{coverage(agent)}</span> : <button type="button" onClick={() => onSelectAlerts(agent, 'reviewed')} className="pennie-focus-ring min-h-[44px] text-pennie-blue-deeper hover:underline">{coverage(agent)}</button>}{agent.system_closed_count > 0 && <p className="text-xs text-pennie-graphite/70">{agent.system_closed_count} system closed · excluded</p>}</td></tr>)}</tbody></table></div>
    <ul className="divide-y divide-border md:hidden">{rows.map(agent => <li key={agent.agent_email} className="px-4 py-3">{profile(agent)}<p className="text-xs tabular-nums text-pennie-graphite/70">{coverage(agent)}{agent.system_closed_count > 0 ? ` · ${agent.system_closed_count} system closed (excluded)` : ''}</p><dl className="mt-2 grid grid-cols-2 gap-2">{OUTCOMES.map(field => <div key={field.key} className="flex items-center justify-between gap-1"><dt className="text-xs text-pennie-graphite">{field.label}</dt><dd>{count(agent, field)}</dd></div>)}</dl></li>)}</ul>
  </>
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
        isWarn ? 'text-pennie-peach-deeper' : 'text-pennie-navy'
      }`}
    >
      {value}%
    </span>
  )
}

// Under-30-minute pitch-call heuristic + rate. Rate uses eligible pitch calls.
// calls; dash when the agent took no pitch calls in the window.
function RushedPitchCell({ agent }: { agent: AgentRollup }) {
  const pitch = agent.pitch_call_count
  const rushed = agent.rushed_pitch_count
  if (pitch === 0) {
    return <span className="text-sm text-pennie-graphite/40 tabular-nums">—</span>
  }
  const rate = Math.round((rushed / pitch) * 100)
  return (
    <span
      title={`${rushed} pitch call${rushed === 1 ? '' : 's'} under 30 minutes of ${pitch} eligible (${rate}%). This is a talk-time heuristic, not a confirmed issue.`}
    >
      <span
        className={`text-sm font-semibold tabular-nums ${
          rushed > 0 ? 'text-pennie-peach-deeper' : 'text-pennie-navy'
        }`}
      >
        {rushed}
      </span>
      <span className="ml-1 text-[11px] text-pennie-graphite/50 tabular-nums">
        ({rate}%)
      </span>
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
      ? 'bg-pennie-peach-light text-pennie-peach-deeper'
      : 'bg-pennie-beige text-pennie-navy'
  return (
    <span
      className={`pennie-pill ${tone} tabular-nums`}
      title={`${unreviewed} awaiting manager of ${total} received`}
    >
      {unreviewed > 0 ? `${unreviewed} waiting` : '0'}
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
