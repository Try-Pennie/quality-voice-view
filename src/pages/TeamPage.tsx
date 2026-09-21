import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  formatDateParam,
  parseDateParam,
} from '../lib/url-filters'
import { defaultAlertWindow } from '../lib/alert-review-queue'
import {
  aggregateTeamTrend,
  aggregateManagerRollups,
  splitAgentCohorts,
  type AgentRollup,
  type ManagerRollup,
} from '../lib/team-queries'
import {
  useUserScope,
  useTeamRollup,
  usePitchRiskCounts,
  useAlertBreakdown,
  useTeamCoachingThemes,
  useCohortCoachingThemes,
  useAgentManagerMappingAt,
  useManagerNames,
} from '../hooks/use-queries'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { RefreshingHint } from '../components/ui/refreshing-hint'
import { TeamHeaderStats } from '../components/team/TeamHeaderStats'
import { TeamLeaderboard } from '../components/team/TeamLeaderboard'
import { TeamTrendSection } from '../components/team/TeamTrendSection'
import { TeamCoachingThemes } from '../components/team/TeamCoachingThemes'
import { TeamCohortComparison } from '../components/team/TeamCohortComparison'
import { ErrorState } from '@/components/states/ErrorState'
import {
  TeamBreakdownByManager,
  type ManagerSortKey,
} from '../components/team/TeamBreakdownByManager'

const MANAGER_SORT_KEYS: readonly ManagerSortKey[] = [
  'call_count',
  'reviewable_call_count',
  'qa_count',
  'compliance_pass_rate',
  'escalation_rate',
  'csat_high_rate',
  'unreviewed_alerts_count',
  'total_alerts_count',
  'confirmed_issue_count',
  'reviewed_alerts_count',
  'false_positive_count',
  'agent_count',
]
import { AlertHeatmap } from '../components/alerts/AlertHeatmap'

type QuickFilter = 'all' | 'attention' | 'top' | 'alerts'

const WIDE_RANGE_DAYS = 60

function emptyAlertOnlyRollup(
  agentEmail: string,
  agentFullName: string,
): AgentRollup {
  return {
    agent_email: agentEmail,
    agent_full_name: agentFullName,
    call_count: 0,
    reviewable_call_count: 0,
    qa_count: 0,
    avg_talk_time: 0,
    compliance_pass_rate: 0,
    csat_high_rate: 0,
    escalation_rate: 0,
    total_alerts_count: 0,
    open_alerts_count: 0,
    unreviewed_alerts_count: 0,
    reviewed_alerts_count: 0,
    confirmed_issue_count: 0,
    false_positive_count: 0,
    system_closed_count: 0,
    pitch_call_count: 0,
    rushed_pitch_count: 0,
    trend_points: [],
    needs_attention: false,
  }
}

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
  // Every primary workload surface starts on the same 30-day ET window.
  const [defaultDates] = useState(() => defaultAlertWindow(new Date()))
  const [startDate, setStartDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('start'), defaultDates.start),
  )
  const [endDate, setEndDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('end'), defaultDates.end, true),
  )

  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => {
    const q = searchParams.get('qf')
    return q === 'attention' || q === 'top' || q === 'alerts' || q === 'all'
      ? q
      : 'all'
  })
  // Persist only identity. The current date-aware rollups own the roster.
  const [selectedManagerEmail, setSelectedManagerEmail] = useState<string | null>(
    () => searchParams.get('mgr'),
  )

  const [breakdownSortKey, setBreakdownSortKey] = useState<ManagerSortKey>(() => {
    const raw = searchParams.get('sort')
    if (raw === 'call_count') return 'reviewable_call_count'
    return (MANAGER_SORT_KEYS as readonly string[]).includes(raw ?? '')
      ? (raw as ManagerSortKey)
      : 'confirmed_issue_count'
  })
  const [breakdownSortDesc, setBreakdownSortDesc] = useState<boolean>(
    () => searchParams.get('dir') !== 'asc',
  )

  const { data: scope, isError: scopeError, refetch: refetchScope } = useUserScope(user?.email)

  const {
    data: rollupData,
    isPending: rollupPending,
    isFetching: rollupFetching,
    isError: rollupError,
    refetch: refetchRollup,
  } = useTeamRollup(scope, startDate, endDate)
  const rollup = useMemo(() => rollupData ?? [], [rollupData])
  const rollupLoading = rollupPending && !rollupData

  const {
    data: breakdownData,
    isPending: breakdownPending,
    isFetching: breakdownFetching,
    isError: breakdownError,
    refetch: refetchBreakdown,
  } = useAlertBreakdown(scope, startDate, endDate)
  const breakdown = useMemo(() => breakdownData ?? [], [breakdownData])
  const breakdownLoading = breakdownPending && !breakdownData
  const loading = rollupLoading || breakdownLoading

  const { data: pitchRiskData } = usePitchRiskCounts(scope, startDate, endDate)
  const pitchRisk = useMemo(
    () => pitchRiskData ?? new Map(),
    [pitchRiskData],
  )

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

  const rollupWithVisibleAlertCounts = useMemo(() => {
    const countsByAgent = new Map<
      string,
      { name: string; total: number; unreviewed: number; reviewed: number; real: number; falsePositive: number; systemClosed: number }
    >()
    for (const cell of breakdown) {
      const current = countsByAgent.get(cell.agent_email) ?? {
        name: cell.agent_full_name?.trim() || cell.agent_email,
        total: 0,
        unreviewed: 0,
        reviewed: 0,
        real: 0,
        falsePositive: 0,
        systemClosed: 0,
      }
      current.total += cell.total
      current.unreviewed += cell.unreviewed
      current.reviewed += cell.reviewed
      current.real += cell.real
      current.falsePositive += cell.false_positives
      current.systemClosed += cell.system_closed
      countsByAgent.set(cell.agent_email, current)
    }

    const rollupByAgent = new Map(rollup.map(agent => [agent.agent_email, agent]))
    const visibleAgentEmails = new Set([...rollupByAgent.keys(), ...countsByAgent.keys()])
    return Array.from(visibleAgentEmails).map(agentEmail => {
      const counts = countsByAgent.get(agentEmail)
      const agent = rollupByAgent.get(agentEmail) ??
        emptyAlertOnlyRollup(agentEmail, counts?.name ?? agentEmail)
      const total = counts?.total ?? 0
      const unreviewed = counts?.unreviewed ?? 0
      const reviewed = counts?.reviewed ?? 0
      const real = counts?.real ?? 0
      const falsePositive = counts?.falsePositive ?? 0
      const systemClosed = counts?.systemClosed ?? 0
      const pitch = pitchRisk.get(agentEmail)
      return {
        ...agent,
        total_alerts_count: total,
        open_alerts_count: total,
        unreviewed_alerts_count: unreviewed,
        reviewed_alerts_count: reviewed,
        confirmed_issue_count: real,
        false_positive_count: falsePositive,
        system_closed_count: systemClosed,
        pitch_call_count: pitch?.pitch_call_count ?? 0,
        rushed_pitch_count: pitch?.rushed_pitch_count ?? 0,
        needs_attention: unreviewed > 0 ||
          (agent.qa_count > 0 && (agent.compliance_pass_rate < 80 ||
            agent.escalation_rate >= 10 || agent.csat_high_rate < 50)),
      }
    })
  }, [rollup, breakdown, pitchRisk])

  const managerRollups = useMemo(() => {
    if (!scope?.isGodMode) return []
    return aggregateManagerRollups(rollupWithVisibleAlertCounts, managerMapping, managerNames)
  }, [scope, rollupWithVisibleAlertCounts, managerMapping, managerNames])

  // Shared director links must not override an ordinary manager's own scope.
  const activeManagerEmail = scope?.isGodMode ? selectedManagerEmail : null
  const selectedManager = useMemo(
    () => managerRollups.find(manager => manager.manager_email === activeManagerEmail) ?? null,
    [managerRollups, activeManagerEmail],
  )

  // Write filter state back to URL so the current view is shareable.
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    if (search.trim()) params.set('search', search.trim())
    if (quickFilter !== 'all') params.set('qf', quickFilter)
    if (activeManagerEmail) params.set('mgr', activeManagerEmail)
    if (breakdownSortKey !== 'confirmed_issue_count') params.set('sort', breakdownSortKey)
    if (!breakdownSortDesc) params.set('dir', 'asc')
    setSearchParams(params, { replace: true })
  }, [
    startDate,
    endDate,
    search,
    quickFilter,
    activeManagerEmail,
    breakdownSortKey,
    breakdownSortDesc,
    setSearchParams,
  ])

  // selectedManager scopes everything on the page (header stats, trends,
  // heatmap, themes, leaderboard). search + quickFilter further narrow only
  // the leaderboard — they're inspection tools, not data filters.
  const scopedRollup = useMemo(() => {
    if (!activeManagerEmail) return rollupWithVisibleAlertCounts
    const agentSet = new Set(selectedManager?.agent_emails ?? [])
    return rollupWithVisibleAlertCounts.filter(r => agentSet.has(r.agent_email))
  }, [rollupWithVisibleAlertCounts, selectedManager, activeManagerEmail])

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
        .filter(r => r.qa_count > 0)
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
        reviewableCallCount: 0,
        qaCount: 0,
        avgCompliance: 0,
        avgEscalation: 0,
        openAlerts: 0,
        topAgent: null as AgentRollup | null,
      }
    }
    const callCount = scopedRollup.reduce((s, r) => s + r.call_count, 0)
    const reviewableCallCount = scopedRollup.reduce((s, r) => s + r.reviewable_call_count, 0)
    const qaCount = scopedRollup.reduce((s, r) => s + r.qa_count, 0)
    const withCalls = scopedRollup.filter(r => r.qa_count > 0)
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
      reviewableCallCount,
      qaCount,
      avgCompliance: Math.round(avgCompliance),
      avgEscalation: Math.round(avgEscalation),
      openAlerts,
      topAgent,
    }
  }, [scopedRollup])

  const teamTrend = useMemo(() => aggregateTeamTrend(scopedRollup), [scopedRollup])

  // Heatmap cells filtered to scoped agents — avoids a second round-trip.
  const scopedBreakdown = useMemo(() => {
    if (!activeManagerEmail) return breakdown
    const agentSet = new Set(selectedManager?.agent_emails ?? [])
    return breakdown.filter(c => agentSet.has(c.agent_email))
  }, [breakdown, selectedManager, activeManagerEmail])

  // Coaching themes refetch when selectedManager changes — themes are
  // pre-aggregated server-side, so we re-run with a synthesized scope.
  const themesScope = useMemo(() => {
    if (!scope) return null
    return activeManagerEmail
      ? {
          email: scope.email,
          isGodMode: false,
          managedAgents: selectedManager?.agent_emails ?? [],
        }
      : scope
  }, [scope, selectedManager, activeManagerEmail])
  const {
    data: teamThemesData,
    isPending: themesPending,
    isFetching: themesFetching,
    isError: themesError,
    refetch: refetchThemes,
  } = useTeamCoachingThemes(themesScope, startDate, endDate)
  const teamThemes = teamThemesData ?? null
  const themesLoading = themesPending && !teamThemesData

  // Top vs bottom cohorts split by compliance (PSAI-177). Derived from the
  // already-scoped rollup so the comparison respects selectedManager + scope
  // without any extra row-cap risk. null when the team is too small to split.
  const cohorts = useMemo(() => splitAgentCohorts(scopedRollup), [scopedRollup])
  const topCohortEmails = useMemo(
    () => (cohorts ? cohorts.top.map(a => a.agent_email) : []),
    [cohorts],
  )
  const bottomCohortEmails = useMemo(
    () => (cohorts ? cohorts.bottom.map(a => a.agent_email) : []),
    [cohorts],
  )
  const {
    data: cohortThemesData,
    isPending: cohortPending,
    isFetching: cohortFetching,
  } = useCohortCoachingThemes(
    topCohortEmails,
    bottomCohortEmails,
    startDate,
    endDate,
  )
  const cohortThemes = cohortThemesData ?? null
  const cohortLoading = !!cohorts && cohortPending && !cohortThemesData

  // Background refetch (filter change with cached data) — distinct from the
  // initial-load `loading` skeleton path. WideRangeLoadingHint already covers
  // cold loads on wide ranges, so this only fires for warm refreshes.
  const refreshing =
    (rollupFetching || breakdownFetching || themesFetching || cohortFetching) &&
    !loading &&
    !breakdownLoading &&
    !themesLoading &&
    !cohortLoading

  const leaderboardRef = useRef<HTMLDivElement>(null)

  const focusAttentionList = () => {
    setQuickFilter('attention')
    setSearch('')
    requestAnimationFrame(() => {
      leaderboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const goToAgent = (agent: AgentRollup) => {
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    navigate(
      `/dashboard/team/${encodeURIComponent(agent.agent_email)}?${params.toString()}`,
    )
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
          onRangeChange={(start, end) => {
            setStartDate(start)
            setEndDate(end)
          }}
        />
        <div className="flex items-center gap-2">
          <RefreshingHint active={refreshing} />
          <WideRangeLoadingHint
            loading={loading}
            startDate={startDate}
            endDate={endDate}
          />
        </div>
      </div>

      {scopeError ? (
        <ErrorState
          title="Couldn't load your access"
          message="We couldn't determine which agents you manage. Retry to reload."
          onRetry={() => refetchScope()}
        />
      ) : (rollupError || breakdownError) && !loading && !noAgents ? (
        <ErrorState
          title="Couldn't load team metrics"
          message="We couldn't load a complete internal team workload, so no partial zero counts are shown. Retry to reload."
          onRetry={() => { refetchRollup(); refetchBreakdown() }}
        />
      ) : (
        <>
      {scope?.isGodMode && (
        <TeamBreakdownByManager
          rows={managerRollups}
          loading={loading}
          selectedManager={selectedManager?.manager_email ?? null}
          onSelect={mgr => {
            setSelectedManagerEmail(mgr?.manager_email ?? null)
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

      {activeManagerEmail && !loading && !selectedManager && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4" role="status">
          <p>The selected manager has no team in this date range.</p>
          <button
            type="button"
            className="min-h-[44px] rounded-lg px-3 text-pennie-blue-deeper underline focus-visible:outline focus-visible:outline-2"
            onClick={() => setSelectedManagerEmail(null)}
          >
            Clear manager filter
          </button>
        </div>
      )}

      <div className="space-y-3">
          <div className="flex flex-col">
            <label htmlFor="agent-search" className="pennie-label mb-2 sr-only sm:not-sr-only">
              Search
            </label>
            <input
              id="agent-search"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name or email"
              className="min-h-[44px] px-4 py-2 rounded-full bg-pennie-white border border-border text-base sm:text-sm text-pennie-graphite placeholder:text-pennie-graphite/40 focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper transition-colors w-full sm:w-64"
            />
          </div>

      <div className="flex gap-2 overflow-x-auto py-1 sm:flex-wrap" role="group" aria-label="Quick filters">
        {(
          [
            { value: 'all', label: 'All agents' },
            { value: 'attention', label: 'AI concerns or pending review' },
            { value: 'top', label: 'Top AI scores' },
            { value: 'alerts', label: 'Has open alerts' },
          ] as { value: QuickFilter; label: string }[]
        ).map(f => (
          <button
            key={f.value}
            type="button"
            aria-pressed={quickFilter === f.value}
            onClick={() => setQuickFilter(f.value)}
            onFocus={event => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
            className={`pennie-focus-ring-inset min-h-[44px] shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold border transition-colors duration-150 ${
              quickFilter === f.value
                ? 'bg-pennie-navy text-pennie-white border-pennie-navy'
                : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
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
            onSelect={goToAgent}
            onSelectAlerts={(agent, view, outcome) => {
              const params = new URLSearchParams({ start: formatDateParam(startDate), end: formatDateParam(endDate), agent: agent.agent_email, status: view })
              if (outcome) params.set('outcome', outcome)
              navigate(`/dashboard/alerts?${params}`)
            }}
          />
        )}
      </div>
          <details className="space-y-6"><summary className="pennie-focus-ring min-h-[44px] cursor-pointer text-sm font-semibold text-pennie-blue-deeper">AI trends and call metrics</summary>
          <TeamHeaderStats
            metrics={teamMetrics}
            loading={loading}
            onComplianceClick={focusAttentionList}
            onEscalationClick={focusAttentionList}
            onAlertsClick={goToAlerts}
          />
          <TeamTrendSection points={teamTrend} loading={loading} />
          </details>
        </>
      )}

      {!noAgents && <details open={themesError || breakdownError} className="space-y-6"><summary className="pennie-focus-ring min-h-[44px] cursor-pointer text-sm font-semibold text-pennie-blue-deeper">Alert types and AI coaching themes</summary>
      {!noAgents && breakdownError && !breakdownLoading ? (
        <ErrorState compact message="Couldn't load the alert heatmap." onRetry={() => refetchBreakdown()} />
      ) : !noAgents ? (
        <AlertHeatmap
          cells={scopedBreakdown}
          rollups={scopedRollup}
          loading={breakdownLoading}
          startDate={startDate}
          endDate={endDate}
        />
      ) : null}

      {!noAgents && themesError && !themesLoading ? (
        <ErrorState compact message="Couldn't load coaching themes." onRetry={() => refetchThemes()} />
      ) : !noAgents ? (
        <TeamCoachingThemes
          themes={teamThemes}
          loading={themesLoading}
          totalAgents={teamMetrics.agentCount}
        />
      ) : null}

      {!noAgents && cohorts ? (
        <TeamCohortComparison
          comparison={cohortThemes}
          topAgents={cohorts.top}
          bottomAgents={cohorts.bottom}
          cohortSize={cohorts.cohortSize}
          loading={cohortLoading}
          onSelectAgent={goToAgent}
        />
      ) : null}
      </details>}
    </div>
  )
}
