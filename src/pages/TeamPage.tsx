import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  fetchUserScope,
  fetchAlertBreakdown,
  type UserScope,
  type AlertBreakdownCell,
} from '../lib/alert-queries'
import {
  fetchTeamRollup,
  aggregateTeamTrend,
  fetchTeamCoachingThemes,
  fetchAgentManagerMapping,
  aggregateManagerRollups,
  fetchManagerNames,
  type AgentRollup,
  type ManagerRollup,
} from '../lib/team-queries'
import type { TeamCoachingThemes as TeamCoachingThemesType } from '../lib/coaching-aggregation'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { TeamHeaderStats } from '../components/team/TeamHeaderStats'
import { TeamLeaderboard } from '../components/team/TeamLeaderboard'
import { TeamTrendSection } from '../components/team/TeamTrendSection'
import { TeamCoachingThemes } from '../components/team/TeamCoachingThemes'
import { TeamBreakdownByManager } from '../components/team/TeamBreakdownByManager'
import { AlertHeatmap } from '../components/alerts/AlertHeatmap'

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
  const [teamThemes, setTeamThemes] = useState<TeamCoachingThemesType | null>(null)
  const [themesLoading, setThemesLoading] = useState(true)
  const [breakdown, setBreakdown] = useState<AlertBreakdownCell[]>([])
  const [breakdownLoading, setBreakdownLoading] = useState(true)
  const [managerMapping, setManagerMapping] = useState<
    { manager_email: string; agent_email: string }[]
  >([])
  const [managerNames, setManagerNames] = useState<Map<string, string>>(
    new Map(),
  )
  const [selectedManager, setSelectedManager] = useState<ManagerRollup | null>(
    null,
  )

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

  useEffect(() => {
    if (!scope) return
    setThemesLoading(true)
    fetchTeamCoachingThemes(scope, startDate, endDate)
      .then(setTeamThemes)
      .finally(() => setThemesLoading(false))
  }, [scope, startDate, endDate])

  useEffect(() => {
    if (!scope) return
    setBreakdownLoading(true)
    fetchAlertBreakdown(scope, startDate, endDate)
      .then(setBreakdown)
      .finally(() => setBreakdownLoading(false))
  }, [scope, startDate, endDate])

  // Manager mapping is only relevant for god-mode users — regular managers
  // already see only their own team via scope.managedAgents.
  useEffect(() => {
    if (!scope?.isGodMode) {
      setManagerMapping([])
      setManagerNames(new Map())
      return
    }
    fetchAgentManagerMapping().then(async mapping => {
      setManagerMapping(mapping)
      const uniqueManagers = Array.from(
        new Set(mapping.map(m => m.manager_email)),
      )
      const names = await fetchManagerNames(uniqueManagers)
      setManagerNames(names)
    })
  }, [scope])

  const managerRollups = useMemo(() => {
    if (!scope?.isGodMode) return []
    return aggregateManagerRollups(rollup, managerMapping, managerNames)
  }, [scope, rollup, managerMapping, managerNames])

  const filtered = useMemo(() => {
    let rows = rollup
    if (selectedManager) {
      const agentSet = new Set(selectedManager.agent_emails)
      rows = rows.filter(r => agentSet.has(r.agent_email))
    }
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
  }, [rollup, search, quickFilter, selectedManager])

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

  const teamTrend = useMemo(() => aggregateTeamTrend(rollup), [rollup])

  const leaderboardRef = useRef<HTMLDivElement>(null)

  const focusAttentionList = () => {
    setQuickFilter('attention')
    setSearch('')
    requestAnimationFrame(() => {
      leaderboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const goToAlerts = () => {
    navigate('/dashboard/alerts')
  }

  const noAgents = !loading && scope && !scope.isGodMode && scope.managedAgents.length === 0

  return (
    <div className="space-y-8 animate-pennie-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          maxRangeDays={30}
        />
      </div>

      <TeamHeaderStats
        metrics={teamMetrics}
        loading={loading}
        onComplianceClick={focusAttentionList}
        onEscalationClick={focusAttentionList}
        onAlertsClick={goToAlerts}
      />

      <TeamTrendSection points={teamTrend} loading={loading} />

      {scope?.isGodMode && (
        <TeamBreakdownByManager
          rows={managerRollups}
          loading={loading}
          selectedManager={selectedManager?.manager_email ?? null}
          onSelect={mgr => {
            setSelectedManager(mgr)
            if (mgr) {
              requestAnimationFrame(() => {
                leaderboardRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                })
              })
            }
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-5 items-end">
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

      <div ref={leaderboardRef} className="scroll-mt-8">
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

      {!noAgents && (
        <AlertHeatmap
          cells={breakdown}
          rollups={rollup}
          loading={breakdownLoading}
        />
      )}

      {!noAgents && (
        <TeamCoachingThemes
          themes={teamThemes}
          loading={themesLoading}
          totalAgents={teamMetrics.agentCount}
        />
      )}
    </div>
  )
}
