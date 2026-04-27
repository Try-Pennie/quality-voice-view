import { useState, useEffect, useMemo, useCallback } from 'react'
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
import { formatDateTime, formatPhoneNumber } from '../lib/utils'
import type { AlertWithFeedback } from '../types/database'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { AlertReviewDrawer } from '../components/alerts/AlertReviewDrawer'
import { CheckCircle2, AlertTriangle, ListFilter, Inbox, Search } from 'lucide-react'

const MODULE_OPTIONS = [
  { value: 'full_qa', label: MODULE_LABELS.full_qa },
  { value: 'budget_inputs', label: MODULE_LABELS.budget_inputs },
  { value: 'warm_transfer', label: MODULE_LABELS.warm_transfer },
  { value: 'litigation_check', label: MODULE_LABELS.litigation_check },
  { value: 'program_expectations', label: MODULE_LABELS.program_expectations },
]

export default function AlertsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { callId: routeCallId, moduleName: routeModuleName } = useParams()

  const [scope, setScope] = useState<UserScope | null>(null)
  const [alerts, setAlerts] = useState<AlertWithFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerAlert, setDrawerAlert] = useState<AlertWithFeedback | null>(null)

  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date()
    d.setHours(23, 59, 59, 999)
    return d
  })
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'reviewed'>('new')
  const [moduleFilter, setModuleFilter] = useState<string[]>([])
  const [search, setSearch] = useState('')

  // Load scope once we have a user.
  useEffect(() => {
    if (!user?.email) return
    fetchUserScope(user.email).then(setScope)
  }, [user?.email])

  const filters = useMemo<AlertFilters>(
    () => ({
      startDate,
      endDate,
      modules: moduleFilter.length ? moduleFilter : undefined,
      status: statusFilter,
      search: search.trim() || undefined,
    }),
    [startDate, endDate, moduleFilter, statusFilter, search],
  )

  // Reload alerts when scope or filters change.
  useEffect(() => {
    if (!scope) return
    setLoading(true)
    fetchAlerts(filters, scope).then(rows => {
      setAlerts(rows)
      setLoading(false)
    })
  }, [scope, filters])

  // Deep-link: open drawer if URL has /:callId/:moduleName.
  useEffect(() => {
    if (!routeCallId || !routeModuleName) return
    const inList = alerts.find(
      a => a.call_id === routeCallId && a.module_name === routeModuleName,
    )
    if (inList) {
      setDrawerAlert(inList)
      return
    }
    // Not in current view — fetch directly.
    fetchAlertOne(routeCallId, routeModuleName).then(a => {
      if (a) setDrawerAlert(a)
    })
  }, [routeCallId, routeModuleName, alerts])

  const openDrawer = useCallback(
    (alert: AlertWithFeedback) => {
      setDrawerAlert(alert)
      navigate(`/dashboard/alerts/${alert.call_id}/${alert.module_name}`, {
        replace: false,
      })
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

  // After feedback is submitted, optimistically update local state and advance.
  const onFeedbackSubmitted = useCallback(
    (updated: Partial<AlertWithFeedback>) => {
      if (!drawerAlert) return
      const merged: AlertWithFeedback = {
        ...drawerAlert,
        ...updated,
        is_reviewed: true,
      }
      setAlerts(prev =>
        prev.map(a =>
          a.call_id === merged.call_id && a.module_name === merged.module_name
            ? merged
            : a,
        ),
      )
      // If the inbox is filtered to "new", the just-reviewed item disappears —
      // advance to the next remaining unreviewed one if any, else close.
      if (statusFilter === 'new') {
        const remaining = alerts.filter(
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
    [alerts, drawerAlert, openDrawer, closeDrawer, statusFilter],
  )

  const stats = useMemo(() => {
    const total = alerts.length
    const reviewed = alerts.filter(a => a.is_reviewed).length
    const accurate = alerts.filter(a => a.accurate === true).length
    const inaccurate = alerts.filter(a => a.accurate === false).length
    const fpRate =
      reviewed > 0 ? Math.round((inaccurate / reviewed) * 100) : null
    const flaggedAgents = new Set(alerts.map(a => a.agent_email)).size
    return { total, reviewed, accurate, inaccurate, fpRate, flaggedAgents }
  }, [alerts])

  const toggleModule = (m: string) => {
    setModuleFilter(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m],
    )
  }

  if (!scope) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg text-muted-foreground">Loading…</div>
      </div>
    )
  }

  if (!scope.isGodMode && scope.managedAgents.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 text-center">
        <Inbox className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-foreground">
          No agents assigned to you
        </h2>
        <p className="text-muted-foreground mt-2">
          Alerts are scoped to the agents you manage. If this looks wrong, ping
          ops to update <code>agent_manager_mapping</code> for{' '}
          <span className="font-mono">{user?.email}</span>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI
          label="In view"
          value={stats.total}
          icon={<Inbox className="w-5 h-5" />}
        />
        <KPI
          label="Reviewed"
          value={`${stats.reviewed} / ${stats.total}`}
          icon={<CheckCircle2 className="w-5 h-5" />}
        />
        <KPI
          label="False-positive rate"
          value={stats.fpRate === null ? '—' : `${stats.fpRate}%`}
          icon={<AlertTriangle className="w-5 h-5" />}
          hint={
            stats.reviewed > 0
              ? `${stats.inaccurate} inaccurate of ${stats.reviewed} reviewed`
              : 'No feedback yet'
          }
        />
        <KPI
          label="Agents flagged"
          value={stats.flaggedAgents}
          icon={<ListFilter className="w-5 h-5" />}
        />
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg border border-border p-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Status
            </label>
            <div className="flex gap-1">
              {(['new', 'reviewed', 'all'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                    statusFilter === s
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border hover:bg-accent'
                  }`}
                >
                  {s === 'new' ? 'New' : s === 'reviewed' ? 'Reviewed' : 'All'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">
              Search (call id, phone, sfdc, agent)
            </label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {MODULE_OPTIONS.map(m => {
            const active = moduleFilter.includes(m.value)
            return (
              <button
                key={m.value}
                onClick={() => toggleModule(m.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border hover:bg-accent'
                }`}
              >
                {m.label}
              </button>
            )
          })}
          {moduleFilter.length > 0 && (
            <button
              onClick={() => setModuleFilter([])}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            Loading alerts…
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-foreground font-medium">No alerts match.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try widening the date range or clearing filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted">
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
              <tbody className="bg-card divide-y divide-border">
                {alerts.map(a => (
                  <tr
                    key={`${a.call_id}__${a.module_name}`}
                    className="hover:bg-accent/40 cursor-pointer"
                    onClick={() => openDrawer(a)}
                  >
                    <Td>
                      <span className="text-sm text-muted-foreground">
                        {formatDateTime(a.alert_created_at)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm text-foreground font-medium">
                        {a.agent_email || '—'}
                      </span>
                    </Td>
                    <Td>
                      <div className="text-sm text-foreground">
                        {a.contact_name || '—'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatPhoneNumber(a.contact_phone)}
                      </div>
                    </Td>
                    <Td>
                      <ViolationChip type={a.violation_type} />
                    </Td>
                    <Td>
                      <div className="text-sm text-muted-foreground line-clamp-2 max-w-md">
                        {a.call_summary || '—'}
                      </div>
                    </Td>
                    <Td>
                      <StatusPill alert={a} />
                    </Td>
                    <Td>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          openDrawer(a)
                        }}
                        className="text-primary hover:text-primary/80 font-medium text-sm"
                      >
                        Review →
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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

function KPI({
  label,
  value,
  icon,
  hint,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  hint?: string
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-6 py-4 align-top">{children}</td>
}

function ViolationChip({ type }: { type: string }) {
  const label = VIOLATION_TYPE_LABELS[type] || type
  const color =
    type === 'manager_escalation'
      ? 'bg-red-100 text-red-800'
      : type === 'budget_compliance'
        ? 'bg-orange-100 text-orange-800'
        : type === 'litigation_check'
          ? 'bg-purple-100 text-purple-800'
          : type === 'warm_transfer'
            ? 'bg-blue-100 text-blue-800'
            : type === 'program_expectations'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-gray-100 text-gray-800'
  return (
    <span
      className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${color}`}
    >
      {label}
    </span>
  )
}

function StatusPill({ alert }: { alert: AlertWithFeedback }) {
  if (!alert.is_reviewed) {
    return (
      <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
        New
      </span>
    )
  }
  if (alert.accurate === true) {
    return (
      <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        Accurate
      </span>
    )
  }
  if (alert.accurate === false) {
    return (
      <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
        False positive
      </span>
    )
  }
  return (
    <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
      Reviewed
    </span>
  )
}
