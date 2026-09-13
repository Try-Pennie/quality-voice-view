import { useState, useEffect, useMemo, useCallback, useId, useRef, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import {
  decideInternalAlertFeedback,
  fetchAlertOne,
  setAlertAck,
  VIOLATION_TYPE_LABELS,
  MODULE_LABELS,
  type AlertBreakdownCell,
  type AlertFilters,
} from '../lib/alert-queries'
import type { AgentRollup } from '../lib/team-queries'
import { paginate } from './disposition-audit-pagination'
import {
  ALERT_QUEUE_VIEWS, parseAlertQueueView, isClosedForReviewer, defaultAlertWindow,
  isHumanReviewed, isReviewOverdue, isSystemClosed, needsCoachingFollowUp,
  matchesAlertQueueView, reviewAgeLabel, summarizeReviewWorkload,
} from '../lib/alert-review-queue'
import { AlertHeatmap } from '../components/alerts/AlertHeatmap'
import {
  useUserScope,
  useAlerts,
  useManagerNames,
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
import { filterAlertWorkloadRows, isSuppressedAlertModule, type AlertWorkload } from '../lib/suppressed-alerts'
import { mergeAlertDetailsWithoutReviewRegression } from '../lib/internal-alert-review'
import { managerOwnershipKey, NEEDS_MANAGER_ASSIGNMENT } from '../lib/manager-ownership'
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
import { ErrorState } from '@/components/states/ErrorState'
import { EmptyState } from '@/components/states/EmptyState'
import { ManagerWorkloadSummary } from '../components/alerts/ManagerWorkloadSummary'

const MODULE_OPTIONS = [
  { value: 'full_qa', label: MODULE_LABELS.full_qa },
  { value: 'budget_inputs', label: MODULE_LABELS.budget_inputs },
  { value: 'warm_transfer', label: MODULE_LABELS.warm_transfer },
  { value: 'litigation_check', label: MODULE_LABELS.litigation_check },
  { value: 'program_expectations', label: MODULE_LABELS.program_expectations },
  { value: 'gota_check', label: MODULE_LABELS.gota_check },
]

type SortKey = 'time' | 'agent' | 'violation' | 'status'
const QUEUE_PAGE_SIZE = 50

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

  // Thirty Eastern calendar days, including today. URL is the source of truth
  // so reload, browser Back, and shared drawer links restore the exact queue.
  const [defaultDates] = useState(() => defaultAlertWindow(new Date()))
  const startDate = useMemo(() => parseDateParam(searchParams.get('start'), defaultDates.start), [searchParams, defaultDates])
  const endDate = useMemo(() => parseDateParam(searchParams.get('end'), defaultDates.end, true), [searchParams, defaultDates])
  const workload: AlertWorkload = scope?.isGodMode && searchParams.get('workload') === 'partner_qa' ? 'partner_qa' : 'internal'
  const statusView = !searchParams.has('status') && workload === 'partner_qa'
    ? 'awaiting_manager'
    : parseAlertQueueView(searchParams.get('status'), !!scope?.isGodMode)
  const moduleFilter = useMemo(() => searchParams.get('module')?.split(',').filter(Boolean) ?? [], [searchParams])
  const search = searchParams.get('search') ?? ''
  const rawManagerFilter = searchParams.get('manager')
  const managerFilter = rawManagerFilter ? managerOwnershipKey(rawManagerFilter) : null
  const outcomeFilter = searchParams.get('outcome') === 'real' || searchParams.get('outcome') === 'false_alarm'
    ? searchParams.get('outcome')
    : 'all'
  const queueParams = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    return params
  }, [searchParams, startDate, endDate])
  useEffect(() => {
    if (!searchParams.has('start') || !searchParams.has('end') || (scope && !scope.isGodMode && searchParams.has('workload'))) {
      const canonical = new URLSearchParams(queueParams)
      if (scope && !scope.isGodMode) canonical.delete('workload')
      setSearchParams(canonical, { replace: true })
    }
  }, [queueParams, scope, searchParams, setSearchParams])
  const changeFilters = useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(queueParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    setSearchParams(params, { replace: true })
  }, [queueParams, setSearchParams])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const [teamWorkloadOpen, setTeamWorkloadOpen] = useState(false)

  // Column sorting for the queue table. Time descending is the default —
  // newest alerts first, matching the fetch order.
  const rawSort = searchParams.get('sort')
  const sortKey: SortKey = rawSort === 'agent' || rawSort === 'violation' || rawSort === 'status' ? rawSort : 'time'
  const sortDesc = searchParams.get('direction') === 'asc' ? false : searchParams.get('direction') === 'desc' ? true : statusView !== 'awaiting_manager' && statusView !== 'coaching_due'

  // Bulk approve (god-mode): row selection over already-manager-reviewed
  // alerts that still need this user's ✓.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)

  // Roving row focus for J/K keyboard navigation on the list itself.
  const [focusIndex, setFocusIndex] = useState(-1)
  const [requestedPage, setRequestedPage] = useState(1)
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())

  // Only date + module hit the server; status, accuracy, and search are
  // applied client-side against the in-memory result set.
  const serverFilters = useMemo<AlertFilters>(
    () => ({
      startDate,
      endDate,
      modules: moduleFilter.length ? moduleFilter : undefined,
      status: 'all',
      workload,
    }),
    [startDate, endDate, moduleFilter, workload],
  )

  const {
    data: allAlertsData,
    isPending: alertsPending,
    isFetching: alertsFetching,
    isError: alertsError,
    refetch: refetchAlerts,
  } = useAlerts(serverFilters, scope)
  const allAlerts = useMemo(
    () => filterAlertWorkloadRows(allAlertsData, scope, workload),
    [allAlertsData, scope, workload],
  )
  const loading = alertsPending && !allAlertsData

  const { data: rollupsData } = useTeamRollup(scope, startDate, endDate)
  const rollups = useMemo(() => rollupsData ?? [], [rollupsData])
  const managerEmails = useMemo(() => Array.from(new Set(allAlerts.flatMap(alert => {
    const manager = managerOwnershipKey(alert.assigned_manager_email)
    return manager === NEEDS_MANAGER_ASSIGNMENT ? [] : [manager]
  }))), [allAlerts])
  const { data: managerNamesData } = useManagerNames(scope?.isGodMode && workload === 'internal' ? managerEmails : [])
  const managerNames = useMemo(() => managerNamesData ?? new Map<string, string>(), [managerNamesData])

  const refreshing = alertsFetching && !loading

  // For god-mode reviewers (Kris) the alert isn't "closed" until *they* sign
  // off — either by being the structured reviewer (`feedback_by`) or by
  // having acked the manager's review. Non-god-mode managers fall back to
  // the simpler `is_reviewed` semantic so their queue behaviour is unchanged.
  const closedForMe = useCallback(
    (a: AlertWithFeedback) => isClosedForReviewer(a, user?.email, workload),
    [user?.email, workload],
  )

  const alerts = useMemo(() => {
    let rows = allAlerts.filter(a => matchesAlertQueueView(a, statusView, !!scope?.isGodMode, user?.email, now, workload))
    if (managerFilter) {
      rows = rows.filter(a => managerOwnershipKey(a.assigned_manager_email) === managerFilter)
    }
    if (outcomeFilter === 'real') rows = rows.filter(a => isHumanReviewed(a) && a.accurate === true)
    if (outcomeFilter === 'false_alarm') rows = rows.filter(a => isHumanReviewed(a) && a.accurate === false)

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
      if (isSystemClosed(a)) return 4
      if (!isHumanReviewed(a)) return 0
      if (a.current_decision === 'changes_requested') return 1
      if (scope?.isGodMode && !closedForMe(a)) return 2
      if (a.accurate === false) return 4
      return 3
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
  }, [allAlerts, statusView, managerFilter, outcomeFilter, search, scope?.isGodMode, closedForMe, sortKey, sortDesc, user?.email, now, workload])

  const queuePage = paginate(alerts, requestedPage, QUEUE_PAGE_SIZE)
  const queueFilterKey = queueParams.toString()
  useEffect(() => {
    setRequestedPage(1)
    setFocusIndex(-1)
  }, [queueFilterKey])

  const toggleSort = useCallback((key: SortKey) => {
    changeFilters({ sort: key, direction: (key === sortKey ? !sortDesc : key === 'time') ? 'desc' : 'asc' })
  }, [changeFilters, sortKey, sortDesc])

  // Route owns the drawer. Ignore stale fetches after J/K, Back, or closing.
  useEffect(() => {
    if (!routeCallId || !routeModuleName || !scope) {
      setDrawerAlert(null)
      return
    }
    if (isSuppressedAlertModule(routeModuleName, scope, workload)) {
      setDrawerAlert(null)
      navigate(`/dashboard/alerts?${queueParams}`, { replace: true })
      return
    }
    let cancelled = false
    const inList = allAlerts.find(a => a.call_id === routeCallId && a.module_name === routeModuleName)
    setDrawerAlert(current => {
      if (current?.call_id === routeCallId && current.module_name === routeModuleName) return inList ? { ...current, ...inList } : current
      return inList ?? null
    })
    fetchAlertOne(routeCallId, routeModuleName, scope, workload)
      .then(full => {
        if (cancelled) return
        if (full) setDrawerAlert(current => {
          if (!current || current.call_id !== full.call_id || current.module_name !== full.module_name) return full
          return mergeAlertDetailsWithoutReviewRegression(current, full)
        })
        else toast.error('This alert is unavailable.')
      })
      .catch(() => { if (!cancelled) toast.error('Could not load alert details. Close and reopen to retry.') })
    return () => { cancelled = true }
  }, [routeCallId, routeModuleName, allAlerts, navigate, scope, workload, queueParams])

  const openDrawer = useCallback(
    (alert: AlertWithFeedback) => {
      // Instant: render with the slim list row…
      setDrawerAlert(alert)
      // Preserve any returnTo so j/k navigation between alerts doesn't strip
      // the originating-page context.
      const state = location.state as { returnTo?: string } | null
      navigate(`/dashboard/alerts/${encodeURIComponent(alert.call_id)}/${encodeURIComponent(alert.module_name)}?${queueParams}`, {
        replace: false,
        state: state?.returnTo ? { returnTo: state.returnTo } : undefined,
      })
      // The route effect enriches this slim row without racing another request.
    },
    [navigate, location.state, queueParams],
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
    navigate(`/dashboard/alerts?${queueParams}`, { replace: true })
  }, [navigate, routeCallId, location.state, queueParams])

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

  const activeDrawer = useRef(drawerAlert)
  activeDrawer.current = drawerAlert

  const onFeedbackSubmitted = useCallback(
    (updated: Partial<AlertWithFeedback>) => {
      if (!drawerAlert) return
      const merged: AlertWithFeedback = {
        ...drawerAlert,
        ...updated,
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
      // A late response may update its cache, but must never navigate a different alert.
      if (activeDrawer.current?.call_id !== merged.call_id || activeDrawer.current.module_name !== merged.module_name) return
      const stillInView = (a: AlertWithFeedback) =>
        matchesAlertQueueView(a, statusView, !!scope?.isGodMode, user?.email, now, workload)
      if (stillInView(drawerAlert) && !stillInView(merged)) {
        // Walk the *visible* queue (sorted + searched) so auto-advance moves
        // in the same order the manager sees in the table — continuing from
        // the current position, then wrapping to earlier skipped alerts.
        const idx = alerts.findIndex(
          a =>
            a.call_id === merged.call_id && a.module_name === merged.module_name,
        )
        const isRemaining = (a: AlertWithFeedback) =>
          stillInView(a) &&
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
      user?.email,
      now,
      workload,
    ],
  )

  // ---- Bulk approve (god-mode second-layer review) ----
  const isAckable = useCallback(
    (a: AlertWithFeedback) => !!scope?.isGodMode && isHumanReviewed(a) &&
      (workload === 'internal'
        ? !!a.review_revision && a.current_decision === null
        : !closedForMe(a)),
    [scope?.isGodMode, workload, closedForMe],
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
  }, [startDate, endDate, statusView, moduleFilter, search, managerFilter, outcomeFilter, workload])

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
    const approve = async (alert: AlertWithFeedback) => {
      if (workload === 'internal') {
        if (!alert.review_revision) return { ok: false as const, decisionId: null, decidedAt: null }
        const result = await decideInternalAlertFeedback({
          callId: alert.call_id,
          moduleName: alert.module_name,
          expectedRevision: alert.review_revision,
          decision: 'approved',
          instructions: null,
        })
        return result.ok
          ? { ok: true as const, decisionId: result.value.decisionId, decidedAt: result.value.decidedAt }
          : { ok: false as const, decisionId: null, decidedAt: null }
      }
      const result = await setAlertAck({
        call_id: alert.call_id,
        module_name: alert.module_name,
        acker_email: email,
        acked: true,
      }, scope, workload)
      return { ok: result.ok, decisionId: null, decidedAt: null }
    }
    const results: PromiseSettledResult<Awaited<ReturnType<typeof approve>>>[] = []
    for (let offset = 0; offset < selectedTargets.length; offset += 10) {
      results.push(...await Promise.allSettled(selectedTargets.slice(offset, offset + 10).map(approve)))
    }
    const approved = new Map<string, { readonly decisionId: number | null; readonly decidedAt: string | null }>()
    let failed = 0
    results.forEach((result, index) => {
      const target = selectedTargets[index]
      if (target && result.status === 'fulfilled' && result.value.ok) {
        approved.set(alertKey(target), result.value)
      } else failed++
    })
    if (approved.size > 0) {
      queryClient.setQueriesData<AlertWithFeedback[]>(
        { queryKey: ['alerts'] },
        old => old?.map(alert => {
          const result = approved.get(alertKey(alert))
          if (!result) return alert
          return workload === 'internal'
            ? {
                ...alert,
                current_decision_id: result.decisionId,
                current_decision: 'approved' as const,
                current_decision_by: email,
                current_decided_at: result.decidedAt,
                current_decision_source: 'typed' as const,
              }
            : { ...alert, acker_emails: Array.from(new Set([...(alert.acker_emails ?? []), email])) }
        }) ?? old,
      )
      queryClient.invalidateQueries({ queryKey: ['alertBreakdown'] })
    }
    setBulkPending(false)
    setSelected(new Set())
    if (failed === 0) toast.success(`Approved ${approved.size} review${approved.size === 1 ? '' : 's'}`)
    else toast.error(`Approved ${approved.size}, ${failed} failed — select the rest and try again.`)
  }, [user?.email, selectedTargets, queryClient, scope, workload])

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
          if (prev === -1) return queuePage.start - 1
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
  }, [drawerAlert, alerts, focusIndex, openDrawer, queuePage.start])

  // Keep the focused row visible and clamp when the list shrinks.
  useEffect(() => {
    setFocusIndex(prev => (prev >= alerts.length ? alerts.length - 1 : prev))
  }, [alerts.length])
  useEffect(() => {
    if (focusIndex < 0) return
    setRequestedPage(Math.floor(focusIndex / QUEUE_PAGE_SIZE) + 1)
    rowRefs.current.get(focusIndex)?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex, queuePage.page])

  const stats = useMemo(() => {
    const counts = summarizeReviewWorkload(allAlerts)
    const fpRate = counts.reviewed > 0 ? Math.round((counts.falseAlarm / counts.reviewed) * 100) : null
    const flaggedAgents = new Set(allAlerts.map(a => a.agent_email)).size
    return { ...counts, fpRate, flaggedAgents }
  }, [allAlerts])

  // Derive the matrix from the same complete, filtered inbox rows so every
  // displayed count opens exactly the rows it summarizes.
  const heatmapCells = useMemo<AlertBreakdownCell[]>(() => {
    const byKey = new Map<string, AlertBreakdownCell>()
    for (const alert of alerts) {
      if (!alert.agent_email || !alert.module_name) continue
      const key = `${alert.module_name}::${alert.agent_email}`
      const cell = byKey.get(key) ?? {
        module: alert.module_name,
        agent_email: alert.agent_email,
        agent_full_name: null,
        total: 0,
        unreviewed: 0,
        false_positives: 0,
        reviewed: 0,
        real: 0,
        system_closed: 0,
      }
      cell.total += 1
      if (isSystemClosed(alert)) cell.system_closed += 1
      else if (isHumanReviewed(alert)) {
        cell.reviewed += 1
        if (alert.accurate === false) cell.false_positives += 1
        else cell.real += 1
      } else cell.unreviewed += 1
      byKey.set(key, cell)
    }
    return Array.from(byKey.values())
  }, [alerts])

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
    changeFilters({ module: (moduleFilter.includes(m) ? moduleFilter.filter(x => x !== m) : [...moduleFilter, m]).join(',') })
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

  const headlineLabel =
    statusView === 'awaiting_manager'
      ? scope.isGodMode ? 'awaiting manager review' : 'ready for first review'
      : statusView === 'awaiting_approval'
        ? 'awaiting director approval'
        : statusView === 'changes_requested'
          ? 'corrections requested'
          : statusView === 'coaching_due'
            ? 'coaching due'
            : statusView === 'reviewed'
              ? 'manager reviewed'
              : 'received in period'
  const queueOptions = Object.entries(ALERT_QUEUE_VIEWS)
    .filter(([view]) => scope.isGodMode || view !== 'awaiting_approval')
    .map(([view, label]) => ({
      value: view,
      label: view === 'awaiting_manager'
        ? scope.isGodMode ? 'Awaiting manager review' : 'First reviews'
        : view === 'awaiting_approval'
          ? 'Awaiting director approval'
          : view === 'changes_requested'
            ? 'Corrections requested'
            : view === 'reviewed'
              ? 'Manager reviewed'
              : view === 'all'
                ? 'All received'
                : label,
    }))
  const activeManagerLabel = managerFilter === NEEDS_MANAGER_ASSIGNMENT
    ? 'Needs manager assignment'
    : managerFilter
      ? managerNames.get(managerFilter) ?? managerFilter.split('@')[0]
      : null

  return (
    <div className="space-y-4 sm:space-y-5 animate-pennie-rise">
      <section className="bg-pennie-white rounded-3xl shadow-resting p-4 sm:p-6 space-y-4" aria-labelledby="review-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="pennie-label">
              {workload === 'partner_qa' ? 'Partner QA · Admin only' : 'Review workspace'}
            </p>
            <h1 id="review-heading" className="mt-1 text-2xl sm:text-3xl font-semibold text-pennie-navy">Review</h1>
            <p className="mt-1 text-sm text-pennie-graphite/70 tabular-nums" aria-live="polite">
              {loading || alertsError ? 'Queue unavailable' : `${alerts.length.toLocaleString()} ${headlineLabel}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => queuePage.items[0] && openDrawer(queuePage.items[0])}
            disabled={loading || alertsError || queuePage.items.length === 0}
            className="pennie-focus-ring min-h-[44px] px-5 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Review next
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[auto_minmax(16rem,18rem)_minmax(14rem,1fr)] lg:items-end">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onRangeChange={(start, end) => {
              changeFilters({ start: formatDateParam(start), end: formatDateParam(end) })
            }}
          />
          <label className="flex flex-col gap-1.5">
            <span className="pennie-label inline-flex items-center gap-1">
              Queue
              <HelpHint id="filter.alerts.status" />
            </span>
            <select
              aria-label="Queue"
              value={statusView}
              onChange={event => changeFilters({ status: event.target.value, sort: null, direction: null })}
              className="pennie-focus-ring h-10 w-full rounded-full border border-border bg-pennie-white px-4 text-sm font-semibold text-pennie-navy"
            >
              {queueOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1.5 min-w-0">
            <label htmlFor={searchInputId} className="pennie-label">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                id={searchInputId}
                type="search"
                value={search}
                onChange={event => changeFilters({ search: event.target.value })}
                placeholder="Call ID, phone, lead, or agent…"
                className="w-full min-h-[44px] sm:min-h-[40px] pl-9 pr-3 py-2 rounded-full border border-border bg-pennie-white text-base sm:text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper"
              />
            </div>
          </div>
        </div>

        {(activeManagerLabel || outcomeFilter !== 'all' || moduleFilter.length > 0) && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            <span className="pennie-label">Active</span>
            {activeManagerLabel && (
              <button type="button" onClick={() => changeFilters({ manager: null })} className="pennie-focus-ring min-h-[36px] px-3 rounded-full bg-pennie-blue-light text-xs font-semibold text-pennie-blue-deeper hover:underline">
                Manager: {activeManagerLabel} ×
              </button>
            )}
            {outcomeFilter !== 'all' && (
              <button type="button" onClick={() => changeFilters({ outcome: null })} className="pennie-focus-ring min-h-[36px] px-3 rounded-full bg-pennie-blue-light text-xs font-semibold text-pennie-blue-deeper hover:underline">
                Outcome: {outcomeFilter === 'real' ? 'Real issue' : 'False alarm'} ×
              </button>
            )}
            {moduleFilter.map(module => (
              <button key={module} type="button" onClick={() => toggleModule(module)} className="pennie-focus-ring min-h-[36px] px-3 rounded-full bg-pennie-blue-light text-xs font-semibold text-pennie-blue-deeper hover:underline">
                {MODULE_OPTIONS.find(option => option.value === module)?.label ?? module} ×
              </button>
            ))}
          </div>
        )}

        <details className="group border-t border-border pt-3">
          <summary className="pennie-focus-ring min-h-[40px] cursor-pointer list-none inline-flex items-center gap-2 rounded-full px-3 -ml-3 text-sm font-semibold text-pennie-blue-deeper">
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            More filters
          </summary>
          <div className="mt-3 space-y-4">
            {scope.isGodMode && (
              <fieldset>
                <legend className="pennie-label mb-2">Workload</legend>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Select workload">
                  <button type="button" aria-pressed={workload === 'internal'} onClick={() => changeFilters({ workload: null, status: 'awaiting_approval', manager: null, outcome: null, module: null })} className={`min-h-[40px] px-4 rounded-full text-sm font-semibold border ${workload === 'internal' ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite'}`}>Pennie</button>
                  <button type="button" aria-pressed={workload === 'partner_qa'} onClick={() => changeFilters({ workload: 'partner_qa', status: 'awaiting_manager', manager: null, outcome: null, module: null })} className={`min-h-[40px] px-4 rounded-full text-sm font-semibold border ${workload === 'partner_qa' ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite'}`}>Partner QA</button>
                </div>
              </fieldset>
            )}
            {workload === 'internal' && (
              <fieldset>
                <legend className="pennie-label mb-2 inline-flex items-center gap-1">
                  Alert type
                  <HelpHint id="filter.alerts.module" />
                </legend>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by alert type">
                  {MODULE_OPTIONS.map(module => {
                    const active = moduleFilter.includes(module.value)
                    return (
                      <button
                        key={module.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleModule(module.value)}
                        className={`min-h-[40px] px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider border transition-all duration-200 ${active ? 'bg-pennie-blue-dark text-pennie-white border-pennie-blue-dark' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-blue-light hover:border-pennie-blue-light'}`}
                      >
                        {module.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}
            <p className="text-xs text-pennie-graphite/70">
              Counts cover the selected ET period. Received includes manager-reviewed, awaiting-manager, and administrative system-closed alerts. Corrections and coaching remain separate work.
            </p>
          </div>
        </details>
        <div className="flex justify-end"><RefreshingHint active={refreshing} /></div>
      </section>

      {scope.isGodMode && workload === 'internal' && !alertsError && (
        <details
          open={teamWorkloadOpen}
          onToggle={event => setTeamWorkloadOpen(event.currentTarget.open)}
          className="group bg-pennie-white rounded-3xl shadow-resting"
        >
          <summary className="pennie-focus-ring-inset min-h-[52px] cursor-pointer list-none flex items-center justify-between gap-3 px-4 sm:px-6 rounded-3xl text-sm font-semibold text-pennie-navy">
            <span>Team workload</span>
            <span className="inline-flex items-center gap-2 text-xs text-pennie-graphite/60">
              {loading ? 'Loading…' : `${stats.received.toLocaleString()} received in period`}
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </span>
          </summary>
          <div className="px-3 pb-4 sm:px-4 sm:pb-5 space-y-4">
            <ManagerWorkloadSummary
              alerts={allAlerts}
              managerNames={managerNames}
              selectedManager={managerFilter}
              loading={loading}
              onSelect={({ managerEmail, view, outcome }) => {
                setTeamWorkloadOpen(false)
                changeFilters({
                  manager: managerEmail,
                  status: view,
                  outcome: outcome === 'all' ? null : outcome,
                  search: null,
                  sort: null,
                  direction: null,
                })
              }}
            />
            {statusView === 'awaiting_manager' && !managerFilter && outcomeFilter === 'all' && !search.trim() && (
              <AlertHeatmap cells={heatmapCells} rollups={heatmapRollups} loading={loading} startDate={startDate} endDate={endDate} compact />
            )}
          </div>
        </details>
      )}

      <p className="text-sm text-pennie-graphite/80 px-2" role="status">
        {loading || alertsFetching ? 'Loading queue…' : alertsError ? 'Queue unavailable.' : `${alerts.length.toLocaleString()} alerts in this queue`} · {formatDateParam(startDate)} – {formatDateParam(endDate)} (ET) · Counts only cover this window.
      </p>

      {/* Table */}
      <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
        {loading ? (
          <SkeletonAlertsTable />
        ) : alertsError ? (
          <ErrorState
            title="Couldn't load alerts"
            message="We couldn't load the complete queue. Retry, or narrow the date range. Your filters are preserved."
            onRetry={() => refetchAlerts()}
          />
        ) : alerts.length === 0 ? (
          <EmptyState
            title={
              search.trim()
                ? 'No matches in this window.'
                : statusView === 'awaiting_manager'
                  ? 'No alerts awaiting a manager in this window.'
                  : statusView === 'awaiting_approval'
                    ? 'No manager decisions await approval in this window.'
                    : statusView === 'changes_requested'
                      ? 'No reviews need corrections in this window.'
                      : statusView === 'coaching_due'
                      ? 'No coaching is due in this window.'
                      : 'No alerts match.'
            }
            message={
              search.trim()
                ? `Search only covers ${startDate.toLocaleDateString()} – ${endDate.toLocaleDateString()} — widen the date range to look further back.`
                : statusView === 'awaiting_manager'
                  ? 'New internal alerts will land here. Use the date picker to check older work.'
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
          {queuePage.pageCount > 1 && <nav aria-label="Alert queue pages" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border text-sm">
            <span>Showing {queuePage.start}–{queuePage.end} of {queuePage.total.toLocaleString()} alerts</span>
            <div className="flex gap-2">
              <button type="button" disabled={queuePage.page === 1} onClick={() => { setFocusIndex(-1); setRequestedPage(queuePage.page - 1) }} className="pennie-focus-ring min-h-[40px] px-3 rounded-full border border-border disabled:opacity-40">Previous page</button>
              <button type="button" disabled={queuePage.page === queuePage.pageCount} onClick={() => { setFocusIndex(-1); setRequestedPage(queuePage.page + 1) }} className="pennie-focus-ring min-h-[40px] px-3 rounded-full border border-border disabled:opacity-40">Next page</button>
            </div>
          </nav>}
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
                {queuePage.items.map((a, i) => (
                  <tr
                    key={`${a.call_id}__${a.module_name}`}
                    ref={el => {
                      const index = queuePage.start - 1 + i
                      if (el) rowRefs.current.set(index, el)
                      else rowRefs.current.delete(index)
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Review ${VIOLATION_TYPE_LABELS[a.violation_type] ?? a.violation_type} alert for ${a.contact_name ?? 'unknown contact'}`}
                    className={`pennie-focus-ring-inset group cursor-pointer transition-colors duration-150 hover:bg-pennie-blue-light/40 ${
                      i !== 0 ? 'border-t border-border/60' : ''
                    } ${queuePage.start - 1 + i === focusIndex ? 'bg-pennie-blue-light/40' : ''}`}
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
                      {!isHumanReviewed(a) && !isSystemClosed(a) && <span className={`block mt-1 text-xs font-semibold ${isReviewOverdue(a, now) ? 'text-pennie-peach-deeper' : 'text-muted-foreground'}`}>
                        {isReviewOverdue(a, now) ? 'Overdue · ' : ''}{reviewAgeLabel(a.alert_created_at, now)}
                      </span>}
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
                          awaitingApproval={
                            !!scope?.isGodMode && isHumanReviewed(a) && a.current_decision !== 'changes_requested' && !closedForMe(a)
                          }
                        />
                        {isHumanReviewed(a) && a.feedback_by && <span className="text-xs text-pennie-graphite/60">Decision by {a.feedback_by}</span>}
                        {needsCoachingFollowUp(a) && <span className="text-xs font-semibold text-pennie-blue-deeper">Coaching due</span>}
                        <ActivityBadges alert={a} showLegacyAcks={workload === 'partner_qa'} />
                      </div>
                    </Td>
                    <td className="pl-2 pr-5 py-3 sm:py-4 w-10 align-middle text-right">
                      <ChevronRight
                        aria-hidden="true"
                        className="inline-block w-4 h-4 text-pennie-graphite/35 transition-all duration-150 group-hover:text-pennie-blue-deeper group-hover:translate-x-0.5"
                      />
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
        scope={scope}
        workload={workload}
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

function ActivityBadges({ alert, showLegacyAcks }: { alert: AlertWithFeedback; showLegacyAcks: boolean }) {
  const messageCount = alert.message_count ?? 0
  const ackCount = showLegacyAcks ? alert.acker_emails?.length ?? 0 : 0
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
  awaitingApproval = false,
}: {
  alert: AlertWithFeedback
  awaitingApproval?: boolean
}) {
  if (isSystemClosed(alert)) {
    return <span className={pillClasses(accentForReviewStatus('reviewed_neutral'))}>System closed</span>
  }
  if (!isHumanReviewed(alert)) {
    return <span className={pillClasses(accentForReviewStatus('new'))}>Awaiting manager</span>
  }
  if (alert.current_decision === 'changes_requested') {
    return <span className={pillClasses(accentForReviewStatus('new'))}>Changes requested</span>
  }
  if (alert.current_decision === 'approved') {
    return <span className={pillClasses(accentForReviewStatus('accurate'))}>Approved</span>
  }
  if (awaitingApproval) {
    return <span className={pillClasses(accentForReviewStatus('new'))}>Awaiting director approval</span>
  }
  if (alert.accurate === true) {
    return (
      <span className={pillClasses(accentForReviewStatus('accurate'))}>
        Real issue
      </span>
    )
  }
  return (
    <span className={pillClasses(accentForReviewStatus('false_positive'))}>
      False alarm
    </span>
  )
}
