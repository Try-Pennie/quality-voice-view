import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  formatDateParam,
  parseDateParam,
} from '../lib/url-filters'
import { ymdInBusinessTZ } from '../lib/time-zone'
import {
  aggregateTeamTrend,
  aggregateManagerRollups,
  type ManagerRollup,
} from '../lib/team-queries'
import {
  useUserScope,
  useTeamRollup,
  useAlertBreakdown,
  useTeamCoachingThemes,
  useAgentManagerMappingAt,
  useManagerNames,
} from '../hooks/use-queries'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { TeamHeaderStats } from '../components/team/TeamHeaderStats'
import { TeamLeaderboard } from '../components/team/TeamLeaderboard'
import { TeamTrendSection } from '../components/team/TeamTrendSection'
import { TeamCoachingThemes } from '../components/team/TeamCoachingThemes'
import {
  TeamBreakdownByManager,
  type ManagerSortKey,
} from '../components/team/TeamBreakdownByManager'

const MANAGER_SORT_KEYS: readonly ManagerSortKey[] = [
  'call_count',
  'qa_count',
  'compliance_pass_rate',
  'escalation_rate',
  'csat_high_rate',
  'unreviewed_alerts_count',
  'total_alerts_count',
  'agent_count',
]
import { AlertHeatmap } from '../components/alerts/AlertHeatmap'

type QuickFilter = 'all' | 'attention' | 'top' | 'alerts'

const WIDE_RANGE_DAYS = 60

function WideRangeLoadingHint({
  loading,
  startDate,
  endDate,
}: {
  loading: boolean
  startDate: Date
  endDate: Date
}) {
  const days = Math.round(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
  )
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!loading) {
      setElapsed(0)
      return
    }
    const start = Date.now()
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [loading, startDate, endDate])

  if (!loading || days < WIDE_RANGE_DAYS) return null
  return (
    <span
      className="inline-flex items-center gap-2 text-xs font-medium text-pennie-graphite/70 px-3 py-1.5 rounded-full bg-pennie-beige/80"
      role="status"
      aria-live="polite"
    >
      <span
        className="block w-2 h-2 rounded-full bg-pennie-blue-dark animate-pulse"
        aria-hidden="true"
      />
      Loading {days} days{elapsed > 0 ? ` · ${elapsed}s` : '…'}
    </span>
  )
}

export default function TeamPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Filter state lazy-inits from URL so /dashboard/team?start=…&qf=…&mgr=…
  // is shareable. A useEffect below writes it back on every change.
  // Defaults are scoped to Eastern time so all viewers (regardless of their
  // browser timezone) see the same window. Picker-state Date carries the
  // intended ET Y/M/D in its local components — fetch + bucket layers convert
  // to absolute UTC moments via startOfBusinessDay / endOfBusinessDay.
  const [startDate, setStartDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('start'), (() => {
      const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
      const local = new Date(y, m - 1, d)
      local.setDate(local.getDate() - 6) // last 7 days inclusive
      local.setHours(0, 0, 0, 0)
      return local
    })()),
  )
  const [endDate, setEndDate] = useState<Date>(() =>
    parseDateParam(
      searchParams.get('end'),
      (() => {
        const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
        const local = new Date(y, m - 1, d)
        local.setHours(23, 59, 59, 999)
        return local
      })(),
      true,
    ),
  )

  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => {
    const q = searchParams.get('qf')
    return q === 'attention' || q === 'top' || q === 'alerts' || q === 'all'
      ? q
      : 'all'
  })
  // Manager email persisted from URL, hydrated to ManagerRollup once
  // managerRollups are computed (god-mode only).
  const initialManagerEmail = searchParams.get('mgr')
  const [selectedManager, setSelectedManager] = useState<ManagerRollup | null>(
    null,
  )

  const [breakdownSortKey, setBreakdownSortKey] = useState<ManagerSortKey>(() => {
    const raw = searchParams.get('sort')
    return (MANAGER_SORT_KEYS as readonly string[]).includes(raw ?? '')
      ? (raw as ManagerSortKey)
      : 'call_count'
  })
  const [breakdownSortDesc, setBreakdownSortDesc] = useState<boolean>(
    () => searchParams.get('dir') !== 'asc',
  )

  const { data: scope } = useUserScope(user?.email)

  const { data: rollupData, isPending: rollupPending } = useTeamRollup(
    scope,
    startDate,
    endDate,
  )
  const rollup = useMemo(() => rollupData ?? [], [rollupData])
  const loading = rollupPending && !rollupData

  const { data: breakdownData, isPending: breakdownPending } = useAlertBreakdown(
    scope,
    startDate,
    endDate,
  )
  const breakdown = useMemo(() => breakdownData ?? [], [breakdownData])
  const breakdownLoading = breakdownPending && !breakdownData

  // Manager mapping is only relevant for god-mode users — regular managers
  // already see only their own team via scope.managedAgents. Resolved as of
  // the window's end date (issue #15) so historical date ranges attribute
  // agents to whoever managed them then, not whoever manages them now.
  const { data: managerMappingData } = useAgentManagerMappingAt(
    endDate,
    !!scope?.isGodMode,
  )
  const managerMapping = useMemo(
    () => managerMappingData ?? [],
    [managerMappingData],
  )

  const uniqueManagerEmails = useMemo(
    () => Array.from(new Set(managerMapping.map(m => m.manager_email))),
    [managerMapping],
  )
  const { data: managerNamesData } = useManagerNames(uniqueManagerEmails)
  const managerNames = useMemo(
    () => managerNamesData ?? new Map<string, string>(),
    [managerNamesData],
  )

  const managerRollups = useMemo(() => {
    if (!scope?.isGodMode) return []
    return aggregateManagerRollups(rollup, managerMapping, managerNames)
  }, [scope, rollup, managerMapping, managerNames])

  // Hydrate selectedManager from URL once the manager rollups exist. Tracked
  // by a ref so we only attempt hydration on the first qualifying render.
  const hydratedManagerRef = useRef(false)
  useEffect(() => {
    if (hydratedManagerRef.current) return
    if (!scope?.isGodMode) return
    if (managerRollups.length === 0) return
    if (initialManagerEmail) {
      const match = managerRollups.find(
        m => m.manager_email === initialManagerEmail,
      )
      if (match) setSelectedManager(match)
    }
    hydratedManagerRef.current = true
  }, [scope, managerRollups, initialManagerEmail])

  // Write filter state back to URL so the current view is shareable.
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    if (search.trim()) params.set('search', search.trim())
    if (quickFilter !== 'all') params.set('qf', quickFilter)
    if (selectedManager) params.set('mgr', selectedManager.manager_email)
    if (breakdownSortKey !== 'call_count') params.set('sort', breakdownSortKey)
    if (!breakdownSortDesc) params.set('dir', 'asc')
    setSearchParams(params, { replace: true })
  }, [
    startDate,
    endDate,
    search,
    quickFilter,
    selectedManager,
    breakdownSortKey,
    breakdownSortDesc,
    setSearchParams,
  ])

  // selectedManager scopes everything on the page (header stats, trends,
  // heatmap, themes, leaderboard). search + quickFilter further narrow only
  // the leaderboard — they're inspection tools, not data filters.
  const scopedRollup = useMemo(() => {
    if (!selectedManager) return rollup
    const agentSet = new Set(selectedManager.agent_emails)
    return rollup.filter(r => agentSet.has(r.agent_email))
  }, [rollup, selectedManager])

  const filtered = useMemo(() => {
    let rows = scopedRollup
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
  }, [scopedRollup, search, quickFilter])

  const teamMetrics = useMemo(() => {
    if (scopedRollup.length === 0) {
      return {
        agentCount: 0,
        callCount: 0,
        avgCompliance: 0,
        avgEscalation: 0,
        openAlerts: 0,
        topAgent: null as AgentRollup | null,
      }
    }
    const callCount = scopedRollup.reduce((s, r) => s + r.call_count, 0)
    const withCalls = scopedRollup.filter(r => r.call_count > 0)
    const avgCompliance =
      withCalls.length > 0
        ? withCalls.reduce((s, r) => s + r.compliance_pass_rate, 0) / withCalls.length
        : 0
    const avgEscalation =
      withCalls.length > 0
        ? withCalls.reduce((s, r) => s + r.escalation_rate, 0) / withCalls.length
        : 0
    const openAlerts = scopedRollup.reduce((s, r) => s + r.unreviewed_alerts_count, 0)
    const topAgent = withCalls.length
      ? [...withCalls].sort(
          (a, b) => b.compliance_pass_rate - a.compliance_pass_rate,
        )[0]
      : null
    return {
      agentCount: scopedRollup.length,
      callCount,
      avgCompliance: Math.round(avgCompliance),
      avgEscalation: Math.round(avgEscalation),
      openAlerts,
      topAgent,
    }
  }, [scopedRollup])

  const teamTrend = useMemo(() => aggregateTeamTrend(scopedRollup), [scopedRollup])

  // Heatmap cells filtered to scoped agents — avoids a second round-trip.
  const scopedBreakdown = useMemo(() => {
    if (!selectedManager) return breakdown
    const agentSet = new Set(selectedManager.agent_emails)
    return breakdown.filter(c => agentSet.has(c.agent_email))
  }, [breakdown, selectedManager])

  // Coaching themes refetch when selectedManager changes — themes are
  // pre-aggregated server-side, so we re-run with a synthesized scope.
  const themesScope = useMemo(() => {
    if (!scope) return null
    return selectedManager
      ? {
          email: scope.email,
          isGodMode: false,
          managedAgents: selectedManager.agent_emails,
        }
      : scope
  }, [scope, selectedManager])
  const { data: teamThemesData, isPending: themesPending } =
    useTeamCoachingThemes(themesScope, startDate, endDate)
  const teamThemes = teamThemesData ?? null
  const themesLoading = themesPending && !teamThemesData

  const leaderboardRef = useRef<HTMLDivElement>(null)

  const focusAttentionList = () => {
    setQuickFilter('attention')
    setSearch('')
    requestAnimationFrame(() => {
      leaderboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const goToAlerts = () => {
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    navigate(`/dashboard/alerts?${params.toString()}`)
  }

  const noAgents = !loading && scope && !scope.isGodMode && scope.managedAgents.length === 0

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />
        <WideRangeLoadingHint
          loading={loading}
          startDate={startDate}
          endDate={endDate}
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
          sortKey={breakdownSortKey}
          sortDesc={breakdownSortDesc}
          onSortChange={(key, desc) => {
            setBreakdownSortKey(key)
            setBreakdownSortDesc(desc)
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3 sm:gap-5 items-end">
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
              className="min-h-[40px] px-4 py-2 rounded-full bg-pennie-white border border-border text-sm text-pennie-graphite placeholder:text-pennie-graphite/40 focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper transition-colors w-64"
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
          cells={scopedBreakdown}
          rollups={scopedRollup}
          loading={breakdownLoading}
          startDate={startDate}
          endDate={endDate}
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
