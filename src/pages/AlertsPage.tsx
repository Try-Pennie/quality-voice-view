import { useState, useEffect, useMemo, useCallback, useId, useRef, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import {
  fetchAlertOne,
  setAlertAck,
  VIOLATION_TYPE_LABELS,
  MODULE_LABELS,
  type AlertBreakdownCell,
  type AlertFilters,
} from '../lib/alert-queries'
import type { AgentRollup } from '../lib/team-queries'
import { AlertHeatmap } from '../components/alerts/AlertHeatmap'
import {
  useUserScope,
  useAlerts,
  useAlertBreakdown,
  useTeamRollup,
} from '../hooks/use-queries'
import {
  accentForReviewStatus,
  accentForViolation,
  pillClasses,
} from '../lib/violation-styles'
import { formatDateTime, formatPhoneNumber } from '../lib/utils'
import type { AlertWithFeedback } from '../types/database'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { RefreshingHint } from '../components/ui/refreshing-hint'
import { AlertReviewDrawer } from '../components/alerts/AlertReviewDrawer'
import { formatDateParam, parseDateParam } from '../lib/url-filters'
import { ymdInBusinessTZ } from '../lib/time-zone'
import { filterSuppressedAlertRows, isSuppressedAlertModule } from '../lib/suppressed-alerts'
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Inbox,
  Loader2,
  MessageSquare,
  Search,
} from 'lucide-react'
import { SortableTh } from '@/components/ui/sortable-th'
import { HelpHint } from '../components/ui/help-hint'
import { PageHero, SupportingStat } from '../components/PageHero'
import { ErrorState } from '@/components/states/ErrorState'
import { EmptyState } from '@/components/states/EmptyState'

const MODULE_OPTIONS = [
  { value: 'full_qa', label: MODULE_LABELS.full_qa },
  { value: 'budget_inputs', label: MODULE_LABELS.budget_inputs },
  { value: 'warm_transfer', label: MODULE_LABELS.warm_transfer },
  { value: 'litigation_check', label: MODULE_LABELS.litigation_check },
  { value: 'program_expectations', label: MODULE_LABELS.program_expectations },
  { value: 'gota_check', label: MODULE_LABELS.gota_check },
]

type StatusView = 'all' | 'new' | 'reviewed'

type SortKey = 'time' | 'agent' | 'violation' | 'status'

const alertKey = (a: Pick<AlertWithFeedback, 'call_id' | 'module_name'>) =>
  `${a.call_id}__${a.module_name}`

export default function AlertsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { callId: routeCallId, moduleName: routeModuleName } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchInputId = useId()

  const { data: scope, isError: scopeError, refetch: refetchScope } = useUserScope(user?.email)
  const [drawerAlert, setDrawerAlert] = useState<AlertWithFeedback | null>(null)

  // Default to today only — interpreted as Eastern time so all viewers see
  // the same window regardless of browser timezone.
  const [startDate, setStartDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('start'), (() => {
      const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
      const local = new Date(y, m - 1, d)
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
  // Lazy-init from URL params so heatmap drilldowns land pre-filtered.
  const [statusView, setStatusView] = useState<StatusView>(() => {
    const s = searchParams.get('status')
    return s === 'new' || s === 'reviewed' || s === 'all' ? s : 'new'
  })
  const [moduleFilter, setModuleFilter] = useState<string[]>(() => {
    const m = searchParams.get('module')
    return m ? m.split(',').filter(Boolean) : []
  })
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  // Mobile-only collapse state for the alert-type chip row. Open by default
  // on `sm+` (the disclosure trigger is hidden); state ignored there.
  const [alertTypeOpen, setAlertTypeOpen] = useState(false)

  // Column sorting for the queue table. Time descending is the default —
  // newest alerts first, matching the fetch order.
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortDesc, setSortDesc] = useState(true)

  // Bulk approve (god-mode): row selection over already-manager-reviewed
  // alerts that still need this user's ✓.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)

  // Roving row focus for J/K keyboard navigation on the list itself.
  const [focusIndex, setFocusIndex] = useState(-1)
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())

  // Only date + module hit the server; status, accuracy, and search are
  // applied client-side against the in-memory result set.
  const serverFilters = useMemo<AlertFilters>(
    () => ({
      startDate,
      endDate,
      modules: moduleFilter.length ? moduleFilter : undefined,
      status: 'all',
    }),
    [startDate, endDate, moduleFilter],
  )

  const {
    data: allAlertsData,
    isPending: alertsPending,
    isFetching: alertsFetching,
    isError: alertsError,
    refetch: refetchAlerts,
  } = useAlerts(serverFilters, scope)
  const allAlerts = useMemo(
    () => filterSuppressedAlertRows(allAlertsData, scope),
    [allAlertsData, scope],
  )
  const loading = alertsPending && !allAlertsData

  const {
    data: breakdownData,
    isPending: breakdownPending,
    isFetching: breakdownFetching,
  } = useAlertBreakdown(scope, startDate, endDate)
  const breakdown = useMemo(() => breakdownData ?? [], [breakdownData])
  const breakdownLoading = breakdownPending && !breakdownData

  const { data: rollupsData } = useTeamRollup(scope, startDate, endDate)
  const rollups = useMemo(() => rollupsData ?? [], [rollupsData])

  const refreshing =
    (alertsFetching || breakdownFetching) && !loading && !breakdownLoading

  // Write filter state back to URL so the current view is shareable (and
  // survives reloads). Skipped while a deep-link drawer route is active so
  // we don't overwrite /:callId/:moduleName.
  useEffect(() => {
    if (routeCallId && routeModuleName) return
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    if (statusView !== 'new') params.set('status', statusView)
    if (moduleFilter.length) params.set('module', moduleFilter.join(','))
    if (search.trim()) params.set('search', search.trim())
    setSearchParams(params, { replace: true })
  }, [
    startDate,
    endDate,
    statusView,
    moduleFilter,
    search,
    routeCallId,
    routeModuleName,
    setSearchParams,
  ])

  // For god-mode reviewers (Kris) the alert isn't "closed" until *they* sign
  // off — either by being the structured reviewer (`feedback_by`) or by
  // having acked the manager's review. Non-god-mode managers fall back to
  // the simpler `is_reviewed` semantic so their queue behaviour is unchanged.
  const lowerEmail = user?.email?.toLowerCase() || null
  const closedForMe = useCallback(
    (a: AlertWithFeedback) => {
      if (!a.is_reviewed) return false
      if (!lowerEmail) return true
      if (a.feedback_by?.toLowerCase() === lowerEmail) return true
      return (a.acker_emails ?? []).some(e => e.toLowerCase() === lowerEmail)
    },
    [lowerEmail],
  )

  const alerts = useMemo(() => {
    let rows = allAlerts
    if (statusView === 'new') {
      rows = scope?.isGodMode
        ? rows.filter(a => !closedForMe(a))
        : rows.filter(a => !a.is_reviewed)
    } else if (statusView === 'reviewed') {
      rows = scope?.isGodMode
        ? rows.filter(a => closedForMe(a))
        : rows.filter(a => a.is_reviewed)
    }

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(a => {
        const haystack = [
          a.call_id,
          a.agent_email,
          a.contact_name,
          a.contact_phone,
          a.sfdc_lead_id,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }

    // Sort a copy — this ordering drives the table, J/K navigation, and the
    // drawer's next/prev, so they always agree.
    const statusRank = (a: AlertWithFeedback) => {
      if (!a.is_reviewed) return 0
      if (scope?.isGodMode && !closedForMe(a)) return 1
      if (a.accurate === false) return 3
      return 2
    }
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'time') {
        cmp = (a.alert_created_at || '').localeCompare(b.alert_created_at || '')
      } else if (sortKey === 'agent') {
        cmp = (a.agent_email || '').localeCompare(b.agent_email || '')
      } else if (sortKey === 'violation') {
        cmp = (VIOLATION_TYPE_LABELS[a.violation_type] ?? a.violation_type).localeCompare(
          VIOLATION_TYPE_LABELS[b.violation_type] ?? b.violation_type,
        )
      } else {
        cmp = statusRank(a) - statusRank(b)
      }
      if (cmp === 0) {
        // Stable tiebreak: newest first.
        cmp = (b.alert_created_at || '').localeCompare(a.alert_created_at || '')
        return cmp
      }
      return sortDesc ? -cmp : cmp
    })
    return sorted
  }, [allAlerts, statusView, search, scope?.isGodMode, closedForMe, sortKey, sortDesc])

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDesc(d => !d)
        return prev
      }
      setSortDesc(key === 'time') // time defaults newest-first, text A→Z
      return key
    })
  }, [])

  // Deep-link: open drawer if URL has /:callId/:moduleName.
  useEffect(() => {
    if (!routeCallId || !routeModuleName) return
    if (isSuppressedAlertModule(routeModuleName, scope)) {
      setDrawerAlert(null)
      navigate('/dashboard/alerts', { replace: true })
      return
    }
    const inList = allAlerts.find(
      a => a.call_id === routeCallId && a.module_name === routeModuleName,
    )
    if (inList) {
      setDrawerAlert(inList)
      return
    }
    fetchAlertOne(routeCallId, routeModuleName, scope)
      .then(a => {
        if (a) setDrawerAlert(a)
      })
      .catch(err => console.error('Failed to load alert for deep link:', err))
  }, [routeCallId, routeModuleName, allAlerts, navigate, scope])

  const openDrawer = useCallback(
    (alert: AlertWithFeedback) => {
      // Instant: render with the slim list row…
      setDrawerAlert(alert)
      // Preserve any returnTo so j/k navigation between alerts doesn't strip
      // the originating-page context.
      const state = location.state as { returnTo?: string } | null
      navigate(`/dashboard/alerts/${alert.call_id}/${alert.module_name}`, {
        replace: false,
        state: state?.returnTo ? { returnTo: state.returnTo } : undefined,
      })
      // …then enrich with heavy fields (result_json, recording_link, etc.)
      // if they aren't already present. Skip if we already have a result_json.
      if (!alert.result_json) {
        fetchAlertOne(alert.call_id, alert.module_name, scope).then(full => {
          if (!full) return
          setDrawerAlert(curr => {
            if (!curr) return curr
            if (
              curr.call_id !== full.call_id ||
              curr.module_name !== full.module_name
            ) {
              return curr
            }
            return { ...curr, ...full }
          })
        }).catch(err => console.error('Failed to enrich alert:', err))
      }
    },
    [navigate, location.state, scope],
  )

  const closeDrawer = useCallback(() => {
    setDrawerAlert(null)
    if (!routeCallId) return
    // If we got here from a deep-link with a returnTo (e.g. an agent profile
    // page sent the user into the drawer), bounce back there instead of
    // dropping them on the top-level alerts list.
    const state = location.state as { returnTo?: string } | null
    const returnTo = state?.returnTo
    if (returnTo && returnTo.startsWith('/')) {
      navigate(returnTo, { replace: true })
      return
    }
    navigate('/dashboard/alerts', { replace: true })
  }, [navigate, routeCallId, location.state])

  const advance = useCallback(
    (delta: 1 | -1) => {
      if (!drawerAlert) return
      const idx = alerts.findIndex(
        a =>
          a.call_id === drawerAlert.call_id &&
          a.module_name === drawerAlert.module_name,
      )
      if (idx === -1) return
      const next = alerts[idx + delta]
      if (next) openDrawer(next)
    },
    [alerts, drawerAlert, openDrawer],
  )

  const onFeedbackSubmitted = useCallback(
    (updated: Partial<AlertWithFeedback>) => {
      if (!drawerAlert) return
      const merged: AlertWithFeedback = {
        ...drawerAlert,
        ...updated,
        is_reviewed: true,
      }
      // Optimistically update every cached alerts query (different filter
      // combinations across pages) so the row reflects the new feedback
      // without a round-trip.
      queryClient.setQueriesData<AlertWithFeedback[]>(
        { queryKey: ['alerts'] },
        old =>
          old?.map(a =>
            a.call_id === merged.call_id && a.module_name === merged.module_name
              ? merged
              : a,
          ) ?? old,
      )
      // Heatmap counts (reviewed / unreviewed / false_positives) are derived
      // server-side, so refetch once the row's feedback row is in.
      queryClient.invalidateQueries({ queryKey: ['alertBreakdown'] })
      if (statusView === 'new') {
        const stillOpen = scope?.isGodMode
          ? (a: AlertWithFeedback) => !closedForMe(a)
          : (a: AlertWithFeedback) => !a.is_reviewed
        // Walk the *visible* queue (sorted + searched) so auto-advance moves
        // in the same order the manager sees in the table — continuing from
        // the current position, then wrapping to earlier skipped alerts.
        const idx = alerts.findIndex(
          a =>
            a.call_id === merged.call_id && a.module_name === merged.module_name,
        )
        const isRemaining = (a: AlertWithFeedback) =>
          stillOpen(a) &&
          !(a.call_id === merged.call_id && a.module_name === merged.module_name)
        const remaining = [
          ...alerts.slice(Math.max(idx, 0) + 1).filter(isRemaining),
          ...alerts.slice(0, Math.max(idx, 0)).filter(isRemaining),
        ]
        if (remaining.length === 0) {
          closeDrawer()
          return
        }
        openDrawer(remaining[0])
      } else {
        setDrawerAlert(merged)
      }
    },
    [
      alerts,
      drawerAlert,
      openDrawer,
      closeDrawer,
      statusView,
      queryClient,
      scope?.isGodMode,
      closedForMe,
    ],
  )

  // ---- Bulk approve (god-mode second-layer review) ----
  // Only alerts that already carry a manager's structured review can be
  // bulk-acked; unreviewed alerts must go through the drawer form.
  const isAckable = useCallback(
    (a: AlertWithFeedback) =>
      !!scope?.isGodMode && !!a.is_reviewed && !closedForMe(a),
    [scope?.isGodMode, closedForMe],
  )
  const ackableAlerts = useMemo(() => alerts.filter(isAckable), [alerts, isAckable])
  const showBulkColumn = !!scope?.isGodMode && ackableAlerts.length > 0
  const selectedTargets = useMemo(
    () => ackableAlerts.filter(a => selected.has(alertKey(a))),
    [ackableAlerts, selected],
  )

  // Selection only makes sense within one filtered view — reset when it moves.
  useEffect(() => {
    setSelected(new Set())
  }, [startDate, endDate, statusView, moduleFilter, search])

  const toggleSelected = useCallback((a: AlertWithFeedback) => {
    setSelected(prev => {
      const next = new Set(prev)
      const key = alertKey(a)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelected(prev =>
      prev.size >= ackableAlerts.length && ackableAlerts.length > 0
        ? new Set()
        : new Set(ackableAlerts.map(alertKey)),
    )
  }, [ackableAlerts])

  const handleBulkApprove = useCallback(async () => {
    const email = user?.email
    if (!email || selectedTargets.length === 0) return
    setBulkPending(true)
    const results = await Promise.allSettled(
      selectedTargets.map(a =>
        setAlertAck({
          call_id: a.call_id,
          module_name: a.module_name,
          acker_email: email,
          acked: true,
        }),
      ),
    )
    const okKeys = new Set<string>()
    let failed = 0
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.ok) okKeys.add(alertKey(selectedTargets[i]))
      else failed++
    })
    if (okKeys.size > 0) {
      queryClient.setQueriesData<AlertWithFeedback[]>(
        { queryKey: ['alerts'] },
        old =>
          old?.map(a =>
            okKeys.has(alertKey(a))
              ? {
                  ...a,
                  acker_emails: Array.from(
                    new Set([...(a.acker_emails ?? []), email]),
                  ),
                }
              : a,
          ) ?? old,
      )
      queryClient.invalidateQueries({ queryKey: ['alertBreakdown'] })
    }
    setBulkPending(false)
    setSelected(new Set())
    if (failed === 0) {
      toast.success(
        `Approved ${okKeys.size} review${okKeys.size === 1 ? '' : 's'}`,
      )
    } else {
      toast.error(
        `Approved ${okKeys.size}, ${failed} failed — select the rest and try again.`,
      )
    }
  }, [user?.email, selectedTargets, queryClient])

  // ---- J/K keyboard navigation over the list (drawer closed) ----
  useEffect(() => {
    if (drawerAlert) return
    const handler = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        setFocusIndex(prev => {
          if (alerts.length === 0) return -1
          if (prev === -1) return 0
          return e.key === 'j'
            ? Math.min(prev + 1, alerts.length - 1)
            : Math.max(prev - 1, 0)
        })
      } else if (e.key === 'Enter') {
        // Focused buttons/links keep their native Enter behavior (incl. the
        // row's own Enter handler when it holds DOM focus).
        if (
          t &&
          (t.tagName === 'BUTTON' ||
            t.tagName === 'A' ||
            t.getAttribute('role') === 'button')
        ) {
          return
        }
        const target = alerts[focusIndex]
        if (focusIndex >= 0 && target) {
          e.preventDefault()
          openDrawer(target)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [drawerAlert, alerts, focusIndex, openDrawer])

  // Keep the focused row visible and clamp when the list shrinks.
  useEffect(() => {
    setFocusIndex(prev => (prev >= alerts.length ? alerts.length - 1 : prev))
  }, [alerts.length])
  useEffect(() => {
    if (focusIndex < 0) return
    rowRefs.current.get(focusIndex)?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  const stats = useMemo(() => {
    const total = alerts.length
    const reviewed = alerts.filter(a => a.is_reviewed).length
    const inaccurate = alerts.filter(a => a.accurate === false).length
    const fpRate =
      reviewed > 0 ? Math.round((inaccurate / reviewed) * 100) : null
    const flaggedAgents = new Set(alerts.map(a => a.agent_email)).size
    const queued = alerts.filter(a => !a.is_reviewed).length
    return { total, reviewed, inaccurate, fpRate, flaggedAgents, queued }
  }, [alerts])

  // Heatmap respects status + search (search narrows by agent email/name)
  // but NOT module — module is the column axis. Swap each cell's `total` to
  // match the active status view; AlertHeatmap drives intensity off `total`.
  const heatmapCells = useMemo<AlertBreakdownCell[]>(() => {
    const nameByEmail = new Map<string, string | null>()
    for (const r of rollups) nameByEmail.set(r.agent_email, r.agent_full_name)
    const q = search.trim().toLowerCase()
    return breakdown
      .filter(c => {
        if (!q) return true
        const name = nameByEmail.get(c.agent_email) || ''
        return (
          c.agent_email.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q)
        )
      })
      .map(c => ({
        ...c,
        total:
          statusView === 'new'
            ? c.unreviewed
            : statusView === 'reviewed'
              ? c.reviewed
              : c.total,
      }))
  }, [breakdown, rollups, search, statusView])

  const heatmapRollups = useMemo<AgentRollup[]>(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rollups
    return rollups.filter(
      r =>
        r.agent_email.toLowerCase().includes(q) ||
        (r.agent_full_name || '').toLowerCase().includes(q),
    )
  }, [rollups, search])

  const toggleModule = (m: string) => {
    setModuleFilter(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m],
    )
  }

  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, alert: AlertWithFeedback) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openDrawer(alert)
    }
  }

  if (scopeError) {
    return (
      <div className="animate-pennie-rise">
        <ErrorState
          title="Couldn't load your access"
          message="We couldn't determine which agents you manage. Retry to reload."
          onRetry={() => refetchScope()}
        />
      </div>
    )
  }

  if (!scope) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-base text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!scope.isGodMode && scope.managedAgents.length === 0) {
    return (
      <section className="pennie-card max-w-2xl mx-auto text-center animate-pennie-rise">
        <div className="pennie-icon-chip mx-auto mb-5 bg-pennie-beige">
          <Inbox className="w-6 h-6 text-pennie-navy" />
        </div>
        <h1 className="text-2xl font-semibold text-pennie-navy mb-2">
          No agents assigned to you
        </h1>
        <p className="text-pennie-graphite/80">
          Alerts are scoped to the agents you manage. If this looks wrong,
          ping ops to update <code className="font-mono text-sm bg-pennie-beige px-1.5 py-0.5 rounded-md">agent_manager_mapping</code> for{' '}
          <span className="font-mono text-sm">{user?.email}</span>.
        </p>
      </section>
    )
  }

  // Drawer position within the visible queue — drives prev/next, the
  // "3 of 17" indicator, and hides both when a deep link isn't in the list.
  const drawerIndex = drawerAlert
    ? alerts.findIndex(
        a =>
          a.call_id === drawerAlert.call_id &&
          a.module_name === drawerAlert.module_name,
      )
    : -1

  // Headline reflects the count in the current filtered view. For god-mode
  // this includes manager-reviewed-but-not-acked-by-me alerts under "new".
  const headlineNumber = alerts.length
  const headlineLabel =
    statusView === 'new'
      ? headlineNumber === 1
        ? 'alert to review'
        : 'alerts to review'
      : statusView === 'reviewed'
        ? 'reviewed'
        : 'in window'

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <PageHero
        label="Alert review queue"
        display
        headline={
          <>
            {headlineNumber.toLocaleString()}{' '}
            <span className="text-pennie-graphite/70 font-normal text-[0.6em] align-baseline">
              {headlineLabel}
            </span>
          </>
        }
        description={
          scope.isGodMode
            ? 'God-mode view: every manager’s alerts are visible.'
            : `Alerts for ${scope.managedAgents.length} agent${scope.managedAgents.length === 1 ? '' : 's'} on your team.`
        }
        stats={
          <>
            <SupportingStat
              label="Reviewed"
              value={`${stats.reviewed} / ${stats.total}`}
              helpId="metric.alert_reviewed"
            />
            <SupportingStat
              label="Flagged in error"
              value={stats.fpRate === null ? '—' : `${stats.fpRate}%`}
              hint={
                stats.reviewed > 0
                  ? `${stats.inaccurate} of ${stats.reviewed}`
                  : 'No feedback yet'
              }
              helpId="metric.fp_rate"
            />
            <SupportingStat
              label="Agents flagged"
              value={stats.flaggedAgents}
              helpId="metric.agents_flagged"
            />
          </>
        }
      />

      <div className="space-y-2">
        <AlertHeatmap
          cells={heatmapCells}
          rollups={heatmapRollups}
          loading={breakdownLoading}
          startDate={startDate}
          endDate={endDate}
          compact
        />
        {moduleFilter.length > 0 && (
          <p className="text-xs text-pennie-graphite/60 px-2">
            Heatmap shows all alert types — your filter applies to the list below.
          </p>
        )}
      </div>

      {/* Filters */}
      <section className="pennie-card-tight space-y-4">
        <div className="flex flex-wrap gap-3 sm:gap-5 items-end">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onRangeChange={(start, end) => {
              setStartDate(start)
              setEndDate(end)
            }}
          />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="pennie-label inline-flex items-center gap-1">
              Status
              <HelpHint id="filter.alerts.status" />
            </legend>
            <div className="flex gap-1" role="group" aria-label="Filter by status">
              {(['new', 'reviewed', 'all'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={statusView === s}
                  onClick={() => setStatusView(s)}
                  className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-200 ${
                    statusView === s
                      ? 'bg-pennie-navy text-pennie-white border-pennie-navy'
                      : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
                  }`}
                >
                  {s === 'new' ? 'New' : s === 'reviewed' ? 'Reviewed' : 'All'}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
            <label htmlFor={searchInputId} className="pennie-label">
              Search
            </label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                id={searchInputId}
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Call id, phone, lead, or agent…"
                className="w-full min-h-[44px] sm:min-h-[40px] pl-9 pr-3 py-2 rounded-full border border-border bg-pennie-white text-base sm:text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper"
              />
            </div>
          </div>

          <div className="flex items-end h-10">
            <RefreshingHint active={refreshing} />
          </div>
        </div>

        <div>
          {/* Desktop label — kept inline with the chips on `sm+`. Mobile uses
              the disclosure trigger below as both label and toggle. */}
          <p className="pennie-label mb-2 hidden sm:inline-flex items-center gap-1">
            Filter by alert type
            <HelpHint id="filter.alerts.module" />
          </p>

          {/* Mobile-only disclosure trigger. Collapses the 5 chips on phones
              (where they triple-wrap and dominate the viewport) without
              touching the desktop layout. */}
          <button
            type="button"
            onClick={() => setAlertTypeOpen(o => !o)}
            aria-expanded={alertTypeOpen}
            aria-controls="alert-type-filter-list"
            className="pennie-focus-ring sm:hidden flex items-center justify-between w-full min-h-[44px] px-4 mb-2 rounded-full border border-border bg-pennie-white text-sm font-semibold text-pennie-graphite"
          >
            <span className="inline-flex items-center gap-2">
              Filter by alert type
              {moduleFilter.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-pennie-blue-deeper text-pennie-white text-[11px] font-bold tabular-nums">
                  {moduleFilter.length}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`w-4 h-4 transition-transform ${
                alertTypeOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          <div
            id="alert-type-filter-list"
            className={`${alertTypeOpen ? 'flex' : 'hidden'} sm:flex flex-wrap gap-2`}
            role="group"
            aria-label="Filter by alert type"
          >
            {MODULE_OPTIONS.map(m => {
              const active = moduleFilter.includes(m.value)
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleModule(m.value)}
                  className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider border transition-all duration-200 ${
                    active
                      ? 'bg-pennie-blue-dark text-pennie-white border-pennie-blue-dark'
                      : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-blue-light hover:border-pennie-blue-light'
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
            {moduleFilter.length > 0 && (
              <button
                type="button"
                onClick={() => setModuleFilter([])}
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-pennie-navy underline-offset-4 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
        {loading ? (
          <SkeletonAlertsTable />
        ) : alertsError ? (
          <ErrorState
            title="Couldn't load alerts"
            message="We hit an error fetching this queue. Your place is saved — just retry."
            onRetry={() => refetchAlerts()}
          />
        ) : alerts.length === 0 ? (
          <EmptyState
            title={
              search.trim()
                ? 'No matches in this window.'
                : statusView === 'new'
                  ? 'Inbox zero — nothing to review.'
                  : 'No alerts match.'
            }
            message={
              search.trim()
                ? `Search only covers ${startDate.toLocaleDateString()} – ${endDate.toLocaleDateString()} — widen the date range to look further back.`
                : statusView === 'new'
                  ? 'New alerts will land here as Eavesly flags them.'
                  : 'Try widening the date range or clearing filters.'
            }
          />
        ) : (
          <>
            {showBulkColumn && selectedTargets.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-pennie-green-light/60 border-b border-pennie-green-light">
                <p className="text-sm font-semibold text-pennie-navy tabular-nums">
                  {selectedTargets.length} selected
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    disabled={bulkPending}
                    className="pennie-focus-ring min-h-[36px] px-3 py-1.5 rounded-full text-xs font-semibold text-pennie-graphite hover:text-pennie-navy hover:bg-pennie-white/70 transition-colors disabled:opacity-50"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkApprove}
                    disabled={bulkPending}
                    className="pennie-focus-ring inline-flex items-center gap-1.5 min-h-[36px] px-4 py-1.5 rounded-full bg-pennie-green-dark text-pennie-white text-xs font-semibold hover:bg-pennie-green-dark/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {bulkPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {bulkPending
                      ? 'Approving…'
                      : `Approve ${selectedTargets.length} review${selectedTargets.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-pennie-beige/60">
                <tr>
                  {showBulkColumn && (
                    <th className="pl-4 sm:pl-5 pr-1 py-3 w-10 text-left">
                      <input
                        type="checkbox"
                        checked={
                          ackableAlerts.length > 0 &&
                          selectedTargets.length === ackableAlerts.length
                        }
                        onChange={toggleSelectAll}
                        aria-label="Select all approvable alerts"
                        className="w-4 h-4 rounded border-border text-pennie-blue-deeper focus:ring-pennie-blue-deeper/40 align-middle"
                      />
                    </th>
                  )}
                  <SortableTh
                    label="Time (ET)"
                    active={sortKey === 'time'}
                    desc={sortDesc}
                    onClick={() => toggleSort('time')}
                  />
                  <SortableTh
                    label="Agent"
                    active={sortKey === 'agent'}
                    desc={sortDesc}
                    onClick={() => toggleSort('agent')}
                  />
                  <Th>Contact</Th>
                  <SortableTh
                    label="Violation"
                    active={sortKey === 'violation'}
                    desc={sortDesc}
                    onClick={() => toggleSort('violation')}
                  />
                  <Th>Summary</Th>
                  <SortableTh
                    label="Status"
                    active={sortKey === 'status'}
                    desc={sortDesc}
                    onClick={() => toggleSort('status')}
                  />
                  <th aria-hidden="true" className="w-10" />
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr
                    key={`${a.call_id}__${a.module_name}`}
                    ref={el => {
                      if (el) rowRefs.current.set(i, el)
                      else rowRefs.current.delete(i)
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Review ${VIOLATION_TYPE_LABELS[a.violation_type] ?? a.violation_type} alert for ${a.contact_name ?? 'unknown contact'}`}
                    className={`pennie-focus-ring-inset group cursor-pointer transition-colors duration-150 hover:bg-pennie-blue-light/40 ${
                      i !== 0 ? 'border-t border-border/60' : ''
                    } ${i === focusIndex ? 'bg-pennie-blue-light/40' : ''}`}
                    onClick={() => openDrawer(a)}
                    onKeyDown={e => onRowKeyDown(e, a)}
                  >
                    {showBulkColumn && (
                      <td
                        className="pl-4 sm:pl-5 pr-1 py-3 sm:py-4 align-top w-10"
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                      >
                        {isAckable(a) && (
                          <input
                            type="checkbox"
                            checked={selected.has(alertKey(a))}
                            onChange={() => toggleSelected(a)}
                            aria-label={`Select alert for ${a.agent_email ?? 'unknown agent'}`}
                            className="w-4 h-4 rounded border-border text-pennie-blue-deeper focus:ring-pennie-blue-deeper/40"
                          />
                        )}
                      </td>
                    )}
                    <Td>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatDateTime(a.alert_created_at)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm font-semibold text-pennie-navy">
                        {a.agent_email || '—'}
                      </span>
                    </Td>
                    <Td>
                      <div className="text-sm text-pennie-graphite font-medium">
                        {a.contact_name || '—'}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatPhoneNumber(a.contact_phone)}
                      </div>
                    </Td>
                    <Td>
                      <ViolationPill type={a.violation_type} />
                    </Td>
                    <Td>
                      <p className="text-sm text-pennie-graphite/80 line-clamp-2 max-w-md">
                        {a.call_summary || '—'}
                      </p>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1.5">
                        <StatusPill
                          alert={a}
                          needsMyAck={
                            !!scope?.isGodMode && a.is_reviewed && !closedForMe(a)
                          }
                        />
                        <ActivityBadges alert={a} />
                      </div>
                    </Td>
                    <td className="pl-2 pr-5 py-3 sm:py-4 w-10 align-middle text-right">
                      <ChevronRight
                        aria-hidden="true"
                        className="inline-block w-4 h-4 text-pennie-graphite/35 transition-all duration-150 group-hover:text-pennie-blue-deeper group-hover:translate-x-0.5"
                      />
                      <span className="sr-only">Review alert</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <p className="hidden sm:block text-[11px] text-muted-foreground px-2">
        Keyboard: J/K move through the list · Enter opens · in the drawer Y/N
        sets the verdict, 1–9 picks a reason, ⌘/Ctrl+Enter saves.
      </p>

      <AlertReviewDrawer
        alert={drawerAlert}
        currentUserEmail={user?.email}
        onClose={closeDrawer}
        onSubmitted={onFeedbackSubmitted}
        onAdvance={advance}
        hasNext={drawerIndex >= 0 && drawerIndex < alerts.length - 1}
        hasPrev={drawerIndex > 0}
        queuePosition={
          drawerIndex >= 0
            ? { index: drawerIndex + 1, total: alerts.length }
            : null
        }
      />
    </div>
  )
}

function SkeletonAlertsTable() {
  return (
    <div className="overflow-hidden">
      <table className="min-w-full">
        <thead className="bg-pennie-beige/60">
          <tr>
            <Th>Time (ET)</Th>
            <Th>Agent</Th>
            <Th>Contact</Th>
            <Th>Violation</Th>
            <Th>Summary</Th>
            <Th>Status</Th>
            <th aria-hidden="true" className="w-10" />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr
              key={i}
              className={i !== 0 ? 'border-t border-border/60' : ''}
            >
              {Array.from({ length: 6 }).map((__, j) => (
                <td key={j} className="px-6 py-4 align-top">
                  <span
                    className="block h-3 rounded-full bg-pennie-beige animate-pulse"
                    style={{ width: `${50 + ((i * 7 + j) % 5) * 8}%` }}
                  />
                </td>
              ))}
              <td className="w-10" aria-hidden="true" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 sm:px-6 py-3 text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em]">
      {children}
    </th>
  )
}


function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 sm:px-6 py-3 sm:py-4 align-top">{children}</td>
}

function ViolationPill({ type }: { type: string }) {
  const label = VIOLATION_TYPE_LABELS[type] || type
  return <span className={pillClasses(accentForViolation(type))}>{label}</span>
}

function ActivityBadges({ alert }: { alert: AlertWithFeedback }) {
  const messageCount = alert.message_count ?? 0
  const ackCount = alert.acker_emails?.length ?? 0
  if (messageCount === 0 && ackCount === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      {messageCount > 0 && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pennie-blue-light/60 text-pennie-blue-deeper text-[11px] font-semibold tabular-nums"
          title={`${messageCount} message${messageCount === 1 ? '' : 's'}`}
        >
          <MessageSquare className="w-3 h-3" aria-hidden="true" />
          {messageCount}
        </span>
      )}
      {ackCount > 0 && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pennie-green-light/70 text-pennie-green-dark text-[11px] font-semibold tabular-nums"
          title={`Reviewed by ${alert.acker_emails.join(', ')}`}
        >
          <CheckCheck className="w-3 h-3" aria-hidden="true" />
          {ackCount}
        </span>
      )}
    </div>
  )
}

function StatusPill({
  alert,
  needsMyAck = false,
}: {
  alert: AlertWithFeedback
  needsMyAck?: boolean
}) {
  if (!alert.is_reviewed) {
    return <span className={pillClasses(accentForReviewStatus('new'))}>New</span>
  }
  if (needsMyAck) {
    return (
      <span className={pillClasses(accentForReviewStatus('new'))}>
        Needs your ✓
      </span>
    )
  }
  if (alert.accurate === true) {
    return (
      <span className={pillClasses(accentForReviewStatus('accurate'))}>
        Accurate
      </span>
    )
  }
  if (alert.accurate === false) {
    return (
      <span className={pillClasses(accentForReviewStatus('false_positive'))}>
        Not accurate
      </span>
    )
  }
  return (
    <span className={pillClasses(accentForReviewStatus('reviewed_neutral'))}>
      Reviewed
    </span>
  )
}
