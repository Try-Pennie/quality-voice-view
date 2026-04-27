import { useState, useEffect, useMemo, useCallback, useId, type KeyboardEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  fetchUserScope,
  fetchAlerts,
  fetchAlertOne,
  VIOLATION_TYPE_LABELS,
  MODULE_LABELS,
  type UserScope,
  type AlertFilters,
} from '../lib/alert-queries'
import {
  accentForReviewStatus,
  accentForViolation,
  pillClasses,
} from '../lib/violation-styles'
import { formatDateTime, formatPhoneNumber } from '../lib/utils'
import type { AlertWithFeedback } from '../types/database'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { AlertReviewDrawer } from '../components/alerts/AlertReviewDrawer'
import { Inbox, Search } from 'lucide-react'

const MODULE_OPTIONS = [
  { value: 'full_qa', label: MODULE_LABELS.full_qa },
  { value: 'budget_inputs', label: MODULE_LABELS.budget_inputs },
  { value: 'warm_transfer', label: MODULE_LABELS.warm_transfer },
  { value: 'litigation_check', label: MODULE_LABELS.litigation_check },
  { value: 'program_expectations', label: MODULE_LABELS.program_expectations },
]

type StatusView = 'all' | 'new' | 'reviewed'

export default function AlertsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { callId: routeCallId, moduleName: routeModuleName } = useParams()
  const searchInputId = useId()

  const [scope, setScope] = useState<UserScope | null>(null)
  const [allAlerts, setAllAlerts] = useState<AlertWithFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerAlert, setDrawerAlert] = useState<AlertWithFeedback | null>(null)

  // Default to today only — 00:00 → 23:59:59.999 in the local timezone.
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date()
    d.setHours(23, 59, 59, 999)
    return d
  })
  const [statusView, setStatusView] = useState<StatusView>('new')
  const [moduleFilter, setModuleFilter] = useState<string[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!user?.email) return
    fetchUserScope(user.email).then(setScope)
  }, [user?.email])

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

  useEffect(() => {
    if (!scope) return
    setLoading(true)
    fetchAlerts(serverFilters, scope).then(rows => {
      setAllAlerts(rows)
      setLoading(false)
    })
  }, [scope, serverFilters])

  const alerts = useMemo(() => {
    let rows = allAlerts
    if (statusView === 'new') rows = rows.filter(a => !a.is_reviewed)
    else if (statusView === 'reviewed') rows = rows.filter(a => a.is_reviewed)

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
    return rows
  }, [allAlerts, statusView, search])

  // Deep-link: open drawer if URL has /:callId/:moduleName.
  useEffect(() => {
    if (!routeCallId || !routeModuleName) return
    const inList = allAlerts.find(
      a => a.call_id === routeCallId && a.module_name === routeModuleName,
    )
    if (inList) {
      setDrawerAlert(inList)
      return
    }
    fetchAlertOne(routeCallId, routeModuleName).then(a => {
      if (a) setDrawerAlert(a)
    })
  }, [routeCallId, routeModuleName, allAlerts])

  const openDrawer = useCallback(
    (alert: AlertWithFeedback) => {
      // Instant: render with the slim list row…
      setDrawerAlert(alert)
      navigate(`/dashboard/alerts/${alert.call_id}/${alert.module_name}`, {
        replace: false,
      })
      // …then enrich with heavy fields (result_json, recording_link, etc.)
      // if they aren't already present. Skip if we already have a result_json.
      if (!alert.result_json) {
        fetchAlertOne(alert.call_id, alert.module_name).then(full => {
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
        })
      }
    },
    [navigate],
  )

  const closeDrawer = useCallback(() => {
    setDrawerAlert(null)
    if (routeCallId) navigate('/dashboard/alerts', { replace: true })
  }, [navigate, routeCallId])

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
      setAllAlerts(prev =>
        prev.map(a =>
          a.call_id === merged.call_id && a.module_name === merged.module_name
            ? merged
            : a,
        ),
      )
      if (statusView === 'new') {
        const remaining = allAlerts.filter(
          a =>
            !a.is_reviewed &&
            !(a.call_id === merged.call_id && a.module_name === merged.module_name),
        )
        if (remaining.length === 0) {
          closeDrawer()
          return
        }
        openDrawer(remaining[0])
      } else {
        setDrawerAlert(merged)
      }
    },
    [allAlerts, drawerAlert, openDrawer, closeDrawer, statusView],
  )

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

  // Decide the headline metric based on status view.
  const headlineNumber =
    statusView === 'new' ? stats.queued : statusView === 'reviewed' ? stats.reviewed : stats.total
  const headlineLabel =
    statusView === 'new'
      ? stats.queued === 1
        ? 'alert to review'
        : 'alerts to review'
      : statusView === 'reviewed'
        ? stats.reviewed === 1
          ? 'reviewed'
          : 'reviewed'
        : 'in window'

  return (
    <div className="space-y-8 animate-pennie-rise">
      {/* Headline + supporting trio (asymmetric, type-driven) */}
      <header className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
        <div className="lg:col-span-7">
          <p className="pennie-label mb-2">Alert review queue</p>
          <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-pennie-navy">
            {headlineNumber.toLocaleString()}{' '}
            <span className="text-pennie-graphite/70 font-normal text-[0.6em] align-baseline">
              {headlineLabel}
            </span>
          </h1>
          <p className="mt-3 text-pennie-graphite/70 max-w-prose">
            {scope.isGodMode
              ? 'God-mode view: every manager’s alerts are visible.'
              : `Alerts for ${scope.managedAgents.length} agent${scope.managedAgents.length === 1 ? '' : 's'} on your team.`}
          </p>
        </div>
        <dl className="lg:col-span-5 grid grid-cols-3 gap-3">
          <SupportingStat
            label="Reviewed"
            value={`${stats.reviewed} / ${stats.total}`}
          />
          <SupportingStat
            label="False-positive rate"
            value={stats.fpRate === null ? '—' : `${stats.fpRate}%`}
            hint={
              stats.reviewed > 0
                ? `${stats.inaccurate} of ${stats.reviewed}`
                : 'No feedback yet'
            }
          />
          <SupportingStat label="Agents flagged" value={stats.flaggedAgents} />
        </dl>
      </header>

      {/* Filters */}
      <section className="pennie-card-tight space-y-4">
        <div className="flex flex-wrap gap-5 items-end">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="pennie-label">Status</legend>
            <div className="flex gap-1" role="radiogroup" aria-label="Filter by status">
              {(['new', 'reviewed', 'all'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={statusView === s}
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
                className="w-full min-h-[40px] pl-9 pr-3 py-2 rounded-full border border-border bg-pennie-white text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pennie-blue-dark/40 focus:border-pennie-blue-dark"
              />
            </div>
          </div>
        </div>

        <div>
          <p className="pennie-label mb-2">Filter by module</p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Filter by module"
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
        ) : alerts.length === 0 ? (
          <div className="p-16 text-center">
            <div className="pennie-icon-chip mx-auto mb-4 bg-pennie-beige">
              <Inbox className="w-6 h-6 text-pennie-navy" />
            </div>
            <p className="text-pennie-navy font-semibold text-lg">
              {statusView === 'new' ? 'Inbox zero — nothing to review.' : 'No alerts match.'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {statusView === 'new'
                ? 'New alerts will land here as Eavesly flags them.'
                : 'Try widening the date range or clearing filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-pennie-beige/60">
                <tr>
                  <Th>Time</Th>
                  <Th>Agent</Th>
                  <Th>Contact</Th>
                  <Th>Violation</Th>
                  <Th>Summary</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr
                    key={`${a.call_id}__${a.module_name}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Review ${VIOLATION_TYPE_LABELS[a.violation_type] ?? a.violation_type} alert for ${a.contact_name ?? 'unknown contact'}`}
                    className={`group cursor-pointer transition-colors duration-150 focus:outline-none focus:bg-pennie-blue-light hover:bg-pennie-blue-light/40 ${
                      i !== 0 ? 'border-t border-border/60' : ''
                    }`}
                    onClick={() => openDrawer(a)}
                    onKeyDown={e => onRowKeyDown(e, a)}
                  >
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
                      <StatusPill alert={a} />
                    </Td>
                    <Td>
                      <span className="text-sm font-semibold text-pennie-blue-dark group-hover:underline underline-offset-4">
                        Review
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AlertReviewDrawer
        alert={drawerAlert}
        currentUserEmail={user?.email}
        onClose={closeDrawer}
        onSubmitted={onFeedbackSubmitted}
        onAdvance={advance}
        hasNext={
          drawerAlert
            ? alerts.findIndex(
                a =>
                  a.call_id === drawerAlert.call_id &&
                  a.module_name === drawerAlert.module_name,
              ) <
              alerts.length - 1
            : false
        }
        hasPrev={
          drawerAlert
            ? alerts.findIndex(
                a =>
                  a.call_id === drawerAlert.call_id &&
                  a.module_name === drawerAlert.module_name,
              ) > 0
            : false
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
            <Th>Time</Th>
            <Th>Agent</Th>
            <Th>Contact</Th>
            <Th>Violation</Th>
            <Th>Summary</Th>
            <Th>Status</Th>
            <Th>Action</Th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr
              key={i}
              className={i !== 0 ? 'border-t border-border/60' : ''}
            >
              {Array.from({ length: 7 }).map((__, j) => (
                <td key={j} className="px-6 py-4 align-top">
                  <span
                    className="block h-3 rounded-full bg-pennie-beige animate-pulse"
                    style={{ width: `${50 + ((i * 7 + j) % 5) * 8}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SupportingStat({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div>
      <dt className="pennie-label">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
        {value}
      </dd>
      {hint && (
        <dd className="text-[11px] text-muted-foreground mt-0.5">{hint}</dd>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-3 text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em]">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-6 py-4 align-top">{children}</td>
}

function ViolationPill({ type }: { type: string }) {
  const label = VIOLATION_TYPE_LABELS[type] || type
  return <span className={pillClasses(accentForViolation(type))}>{label}</span>
}

function StatusPill({ alert }: { alert: AlertWithFeedback }) {
  if (!alert.is_reviewed) {
    return <span className={pillClasses(accentForReviewStatus('new'))}>New</span>
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
        False positive
      </span>
    )
  }
  return (
    <span className={pillClasses(accentForReviewStatus('reviewed_neutral'))}>
      Reviewed
    </span>
  )
}
