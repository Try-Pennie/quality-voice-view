import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { fetchUserScope, type UserScope } from '../lib/alert-queries'
import { fetchTeamRollup, type AgentRollup } from '../lib/team-queries'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { TeamHeaderStats } from '../components/team/TeamHeaderStats'
import { TeamLeaderboard } from '../components/team/TeamLeaderboard'

type QuickFilter = 'all' | 'attention' | 'top' | 'alerts'

export default function TeamPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [startDate, setStartDate] = useState<Date>(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    date.setHours(0, 0, 0, 0)
    return date
  })
  const [endDate, setEndDate] = useState<Date>(() => {
    const date = new Date()
    date.setHours(23, 59, 59, 999)
    return date
  })

  const [scope, setScope] = useState<UserScope | null>(null)
  const [rollup, setRollup] = useState<AgentRollup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')

  useEffect(() => {
    if (!user?.email) return
    fetchUserScope(user.email).then(setScope)
  }, [user?.email])

  useEffect(() => {
    if (!scope) return
    setLoading(true)
    fetchTeamRollup(scope, startDate, endDate)
      .then(setRollup)
      .finally(() => setLoading(false))
  }, [scope, startDate, endDate])

  const filtered = useMemo(() => {
    let rows = rollup
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      rows = rows.filter(
        r =>
          (r.agent_full_name || '').toLowerCase().includes(s) ||
          r.agent_email.toLowerCase().includes(s),
      )
    }
    if (quickFilter === 'attention') rows = rows.filter(r => r.needs_attention)
    if (quickFilter === 'top')
      rows = [...rows]
        .filter(r => r.call_count > 0)
        .sort((a, b) => b.compliance_pass_rate - a.compliance_pass_rate)
        .slice(0, 10)
    if (quickFilter === 'alerts') rows = rows.filter(r => r.unreviewed_alerts_count > 0)
    return rows
  }, [rollup, search, quickFilter])

  const teamMetrics = useMemo(() => {
    if (rollup.length === 0) {
      return {
        agentCount: 0,
        callCount: 0,
        avgCompliance: 0,
        avgEscalation: 0,
        openAlerts: 0,
        topAgent: null as AgentRollup | null,
      }
    }
    const callCount = rollup.reduce((s, r) => s + r.call_count, 0)
    const withCalls = rollup.filter(r => r.call_count > 0)
    const avgCompliance =
      withCalls.length > 0
        ? withCalls.reduce((s, r) => s + r.compliance_pass_rate, 0) / withCalls.length
        : 0
    const avgEscalation =
      withCalls.length > 0
        ? withCalls.reduce((s, r) => s + r.escalation_rate, 0) / withCalls.length
        : 0
    const openAlerts = rollup.reduce((s, r) => s + r.unreviewed_alerts_count, 0)
    const topAgent = withCalls.length
      ? [...withCalls].sort(
          (a, b) => b.compliance_pass_rate - a.compliance_pass_rate,
        )[0]
      : null
    return {
      agentCount: rollup.length,
      callCount,
      avgCompliance: Math.round(avgCompliance),
      avgEscalation: Math.round(avgEscalation),
      openAlerts,
      topAgent,
    }
  }, [rollup])

  const noAgents = !loading && scope && !scope.isGodMode && scope.managedAgents.length === 0

  return (
    <div className="space-y-8 animate-pennie-rise">
      <TeamHeaderStats metrics={teamMetrics} loading={loading} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-5 items-end">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <div className="flex flex-col">
            <label htmlFor="agent-search" className="pennie-label mb-2">
              Search
            </label>
            <input
              id="agent-search"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name or email"
              className="min-h-[40px] px-4 py-2 rounded-full bg-pennie-white border border-border text-sm text-pennie-graphite placeholder:text-pennie-graphite/40 focus:outline-none focus:border-pennie-blue-dark transition-colors w-64"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
        {(
          [
            { value: 'all', label: 'All agents' },
            { value: 'attention', label: 'Needs attention' },
            { value: 'top', label: 'Top performers' },
            { value: 'alerts', label: 'Has open alerts' },
          ] as { value: QuickFilter; label: string }[]
        ).map(f => (
          <button
            key={f.value}
            type="button"
            aria-pressed={quickFilter === f.value}
            onClick={() => setQuickFilter(f.value)}
            className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-200 ${
              quickFilter === f.value
                ? 'bg-pennie-navy text-pennie-white border-pennie-navy'
                : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {noAgents ? (
        <div className="text-center py-12 bg-pennie-white rounded-3xl shadow-resting">
          <p className="text-pennie-graphite font-medium">
            No agents are assigned to you yet.
          </p>
          <p className="text-sm text-pennie-graphite/70 mt-2">
            Talk to an admin to set up your team mapping.
          </p>
        </div>
      ) : (
        <TeamLeaderboard
          rows={filtered}
          loading={loading}
          onSelect={agent => navigate(`/dashboard/team/${encodeURIComponent(agent.agent_email)}`)}
        />
      )}
    </div>
  )
}
