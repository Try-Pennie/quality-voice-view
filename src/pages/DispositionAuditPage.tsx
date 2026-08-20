import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { useUserScope, useDispositionAudit } from '../hooks/use-queries'
import {
  fetchDispositionAuditOne,
  CATEGORY_LABELS,
  type AuditCategory,
  type AuditFilters,
  type DispositionAuditRow,
} from '../lib/disposition-audit-queries'
import { DispositionAuditDrawer } from '../components/alerts/DispositionAuditDrawer'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { parseDateParam, formatDateParam } from '../lib/url-filters'
import { ymdInBusinessTZ } from '../lib/time-zone'
import { formatDateTime, formatDuration, formatPhoneNumber } from '../lib/utils'
import { PageHero } from '../components/PageHero'
import { ErrorState } from '@/components/states/ErrorState'
import { EmptyState } from '@/components/states/EmptyState'
import { RefreshingHint } from '@/components/ui/refreshing-hint'
import {
  aggregateDispositionAuditByAgent,
  dispositionTimingFlag,
  type DispositionAuditAgentStat,
  type DispositionTimingFlag,
} from './disposition-audit-agent-stats'
import { paginate, type PageSlice } from './disposition-audit-pagination'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'

// 'phantom_conversation' is held (see migration 20260702160000): its correct
// disposition is AI/dialer-only, so there's no human-applicable target to suggest
// yet. Re-add it here when the CRM gains a human no-contact/voicemail disposition.
const TABS: (AuditCategory | 'all')[] = ['all', 'ended_live_lead']
const AGENT_PAGE_SIZE = 10
const ALERT_PAGE_SIZES = [25, 50] as const

type StatusView = 'all' | 'new' | 'reviewed'
type PriorityView = 'all' | 'early' | 'severe'
type AlertPageSize = typeof ALERT_PAGE_SIZES[number]

function todayStart() {
  const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
  const local = new Date(y, m - 1, d); local.setHours(0, 0, 0, 0); return local
}
function todayEnd() {
  const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
  const local = new Date(y, m - 1, d); local.setHours(23, 59, 59, 999); return local
}

function formatAuditTalkTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds === 0) return '0:00'
  return formatDuration(Math.round(seconds))
}

export default function DispositionAuditPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: scope, isError: scopeError, refetch: refetchScope } = useUserScope(user?.email)

  const [startDate, setStartDate] = useState<Date>(() => parseDateParam(searchParams.get('start'), todayStart()))
  const [endDate, setEndDate] = useState<Date>(() => parseDateParam(searchParams.get('end'), todayEnd(), true))
  const [tab, setTab] = useState<AuditCategory | 'all'>(() => {
    const t = searchParams.get('tab')
    return t === 'ended_live_lead' ? t : 'all'
  })
  const [statusView, setStatusView] = useState<StatusView>('new')
  const [priorityView, setPriorityView] = useState<PriorityView>('all')
  const [agentPage, setAgentPage] = useState(1)
  const [alertPage, setAlertPage] = useState(1)
  const [alertPageSize, setAlertPageSize] = useState<AlertPageSize>(25)
  const [drawerRow, setDrawerRow] = useState<DispositionAuditRow | null>(null)

  const filters = useMemo<AuditFilters>(
    () => ({ startDate, endDate, category: tab === 'all' ? undefined : tab }),
    [startDate, endDate, tab],
  )
  const { data, isPending, isFetching, isError, refetch } = useDispositionAudit(filters, scope)
  const allRows = useMemo(() => data ?? [], [data])
  const loading = isPending && !data

  // Sync filter state to the URL (shareable view).
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    if (tab !== 'all') params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }, [startDate, endDate, tab, setSearchParams])

  const statusRows = useMemo(() => {
    if (statusView === 'new') return allRows.filter(r => !r.is_reviewed)
    if (statusView === 'reviewed') return allRows.filter(r => r.is_reviewed)
    return allRows
  }, [allRows, statusView])

  const priorityCounts = useMemo(() => {
    let early = 0
    let severe = 0
    for (const row of statusRows) {
      const flag = dispositionTimingFlag(row.current_disposition, row.talk_time)
      if (flag !== null) early += 1
      if (flag === 'severe') severe += 1
    }
    return { early, severe }
  }, [statusRows])

  const rows = useMemo(() => {
    if (priorityView === 'all') return statusRows
    return statusRows.filter(row => {
      const flag = dispositionTimingFlag(row.current_disposition, row.talk_time)
      return priorityView === 'early' ? flag !== null : flag === 'severe'
    })
  }, [priorityView, statusRows])
  const agentStats = useMemo(() => aggregateDispositionAuditByAgent(rows), [rows])

  const agentPagination = useMemo(
    () => paginate(agentStats, agentPage, AGENT_PAGE_SIZE),
    [agentPage, agentStats],
  )
  const alertPagination = useMemo(
    () => paginate(rows, alertPage, alertPageSize),
    [alertPage, alertPageSize, rows],
  )

  useEffect(() => {
    if (agentPage !== agentPagination.page) setAgentPage(agentPagination.page)
  }, [agentPage, agentPagination.page])
  useEffect(() => {
    if (alertPage !== alertPagination.page) setAlertPage(alertPagination.page)
  }, [alertPage, alertPagination.page])

  const changeAgentPage = useCallback((page: number) => {
    setAgentPage(page)
    document.getElementById('agent-disposition-summary-heading')?.scrollIntoView({ block: 'start' })
  }, [])
  const changeAlertPage = useCallback((page: number) => {
    setAlertPage(page)
    document.getElementById('disposition-review-queue-heading')?.scrollIntoView({ block: 'start' })
  }, [])

  const openDrawer = useCallback((row: DispositionAuditRow) => {
    setDrawerRow(row)
    if (!row.result_json) {
      fetchDispositionAuditOne(row.call_id).then(full => {
        if (!full) return
        setDrawerRow(curr => (curr && curr.call_id === full.call_id ? { ...curr, ...full } : curr))
      }).catch(err => console.error('Failed to enrich audit row:', err))
    }
  }, [])

  const advance = useCallback((delta: 1 | -1) => {
    if (!drawerRow) return
    const idx = alertPagination.items.findIndex(r => r.call_id === drawerRow.call_id)
    const next = alertPagination.items[idx + delta]
    if (next) openDrawer(next)
  }, [alertPagination.items, drawerRow, openDrawer])

  const onSubmitted = useCallback((updated: Partial<DispositionAuditRow>) => {
    if (!drawerRow) return
    const merged = { ...drawerRow, ...updated, is_reviewed: true } as DispositionAuditRow
    queryClient.setQueriesData<DispositionAuditRow[]>({ queryKey: ['dispositionAudit'] }, old =>
      old?.map(r => (r.call_id === merged.call_id ? merged : r)) ?? old,
    )
    setDrawerRow(merged)
  }, [drawerRow, queryClient])

  if (scopeError) {
    return <ErrorState title="Couldn't load your access" message="Retry to reload." onRetry={() => refetchScope()} />
  }
  if (!scope) {
    return <div className="flex items-center justify-center h-96"><p className="text-base text-muted-foreground">Loading…</p></div>
  }
  if (!scope.isGodMode && scope.managedAgents.length === 0) {
    return (
      <section className="pennie-card max-w-2xl mx-auto text-center">
        <div className="pennie-icon-chip mx-auto mb-5 bg-pennie-beige"><Inbox className="w-6 h-6 text-pennie-navy" /></div>
        <h1 className="text-2xl font-semibold text-pennie-navy mb-2">No agents assigned to you</h1>
        <p className="text-pennie-graphite/80">This audit is scoped to the agents you manage.</p>
      </section>
    )
  }

  const idx = drawerRow ? alertPagination.items.findIndex(r => r.call_id === drawerRow.call_id) : -1

  const headlineLabel =
    statusView === 'new' ? 'to review' : statusView === 'reviewed' ? 'reviewed' : 'in window'

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <PageHero
        label="Disposition audit"
        display
        headline={<>{rows.length.toLocaleString()} <span className="text-pennie-graphite/70 font-normal text-[0.6em] align-baseline">{headlineLabel}</span></>}
        description="Calls where an agent's disposition may have hurt the customer's journey — reviewed by the model against the transcript."
      />

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Audit category">
        {TABS.map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setAgentPage(1); setAlertPage(1) }}
            className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
              tab === t ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
            }`}>
            {t === 'all' ? 'All' : CATEGORY_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <section className="pennie-card-tight flex flex-wrap gap-3 sm:gap-5 items-end">
        <DateRangePicker startDate={startDate} endDate={endDate} onRangeChange={(s, e) => { setStartDate(s); setEndDate(e); setAgentPage(1); setAlertPage(1) }} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pennie-label">Status</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Filter by status">
            {(['new', 'reviewed', 'all'] as const).map(s => (
              <button key={s} type="button" role="radio" aria-checked={statusView === s} onClick={() => { setStatusView(s); setAgentPage(1); setAlertPage(1) }}
                className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                  statusView === s ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
                }`}>
                {s === 'new' ? 'New' : s === 'reviewed' ? 'Reviewed' : 'All'}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pennie-label">Priority</legend>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter by early 1.5 priority">
            {(['all', 'early', 'severe'] as const).map(priority => (
              <button key={priority} type="button" role="radio" aria-checked={priorityView === priority} onClick={() => { setPriorityView(priority); setAgentPage(1); setAlertPage(1) }}
                className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                  priorityView === priority ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
                }`}>
                {priority === 'all' ? 'All' : priority === 'early' ? `Early 1.5s (${priorityCounts.early})` : `Under 2m (${priorityCounts.severe})`}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="basis-full text-xs leading-5 text-pennie-graphite/70">
          <strong className="text-pennie-navy">Early 1.5:</strong> Not Interested selected before 10 minutes. Calls under 2 minutes receive the highest-priority flag. These are review signals, not confirmed issues.
        </p>
      </section>

      {!isError && agentStats.length > 0 && (
        <AgentDispositionSummary
          pagination={agentPagination}
          refreshing={isFetching}
          onPageChange={changeAgentPage}
        />
      )}

      {/* Table */}
      <section aria-labelledby="disposition-review-queue-heading" className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <h2 id="disposition-review-queue-heading" className="text-xl font-semibold text-pennie-navy">Disposition review queue</h2>
            <p className="mt-1 text-sm text-pennie-graphite/70">Newest matching alerts first.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-pennie-graphite">
            Alerts per page
            <select
              value={alertPageSize}
              onChange={event => { setAlertPageSize(Number(event.target.value) === 50 ? 50 : 25); setAlertPage(1) }}
              className="min-h-[40px] rounded-full border border-border bg-pennie-white px-3 text-sm font-semibold text-pennie-navy focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40"
            >
              {ALERT_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">Loading…</div>
        ) : isError ? (
          <ErrorState title="Couldn't load the audit" message="Retry to reload." onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={statusView === 'new' ? 'Nothing to review.' : 'No calls match.'} message="Try widening the date range or switching tabs." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-pennie-beige/60">
                <tr>
                  <Th>Time (ET)</Th><Th>Agent</Th><Th>Contact</Th><Th>Talk time</Th><Th>Agent set</Th><Th>Model suggests</Th><Th>Conf</Th><Th>Status</Th>
                  <th aria-hidden="true" className="w-10" />
                </tr>
              </thead>
              <tbody>
                {alertPagination.items.map((r, i) => {
                  const timingFlag = dispositionTimingFlag(r.current_disposition, r.talk_time)
                  return (
                    <tr key={r.call_id} role="button" tabIndex={0}
                      className={`pennie-focus-ring-inset group cursor-pointer transition-colors ${
                        timingFlag === 'severe' ? 'bg-red-50/70 hover:bg-red-100/70'
                          : timingFlag === 'early' ? 'bg-pennie-peach-light/20 hover:bg-pennie-peach-light/35'
                          : 'hover:bg-pennie-blue-light/40'
                      } ${i !== 0 ? 'border-t border-border/60' : ''}`}
                      onClick={() => openDrawer(r)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r) } }}>
                    <Td><span className="text-sm text-muted-foreground tabular-nums">{formatDateTime(r.alert_created_at)}</span></Td>
                    <Td><span className="text-sm font-semibold text-pennie-navy">{r.agent_email || '—'}</span></Td>
                    <Td>
                      <div className="text-sm text-pennie-graphite font-medium">{r.contact_name || '—'}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatPhoneNumber(r.contact_phone)}</div>
                    </Td>
                    <Td>
                      <span className="block text-sm font-semibold text-pennie-navy tabular-nums">{formatAuditTalkTime(r.talk_time)}</span>
                      <DispositionTimingBadge flag={timingFlag} />
                    </Td>
                    <Td><span className="text-sm text-pennie-graphite">{r.current_disposition || '—'}</span></Td>
                    <Td><span className="text-sm font-semibold text-pennie-navy">{r.suggested_disposition || '—'}</span></Td>
                    <Td><span className="text-sm tabular-nums text-pennie-graphite/70">{r.model_confidence != null ? `${Math.round(r.model_confidence * 100)}%` : '—'}</span></Td>
                    <Td>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        !r.is_reviewed ? 'bg-pennie-blue-light text-pennie-blue-deeper'
                          : r.accurate === false ? 'bg-pennie-peach-light text-pennie-peach-deeper'
                          : 'bg-pennie-green-light text-pennie-green-dark'
                      }`}>
                        {!r.is_reviewed ? 'New' : r.accurate === false ? 'False alarm' : 'Reviewed'}
                      </span>
                    </Td>
                    <td className="pl-2 pr-5 py-3 w-10 text-right">
                      <ChevronRight aria-hidden="true" className="inline-block w-4 h-4 text-pennie-graphite/35 group-hover:text-pennie-blue-deeper group-hover:translate-x-0.5 transition-all" />
                    </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={alertPagination.page}
            pageCount={alertPagination.pageCount}
            start={alertPagination.start}
            end={alertPagination.end}
            total={alertPagination.total}
            itemLabel="alert"
            ariaLabel="Disposition alert pages"
            onPageChange={changeAlertPage}
          />
          </>
        )}
      </section>

      <DispositionAuditDrawer
        row={drawerRow}
        currentUserEmail={user?.email}
        onClose={() => setDrawerRow(null)}
        onSubmitted={onSubmitted}
        onAdvance={advance}
        hasNext={idx > -1 && idx < alertPagination.items.length - 1}
        hasPrev={idx > 0}
      />
    </div>
  )
}

function AgentDispositionSummary({ pagination, refreshing, onPageChange }: {
  pagination: PageSlice<DispositionAuditAgentStat>
  refreshing: boolean
  onPageChange: (page: number) => void
}) {
  const stats = pagination.items
  return (
    <section
      aria-labelledby="agent-disposition-summary-heading"
      aria-busy={refreshing}
      className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden"
    >
      <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 id="agent-disposition-summary-heading" className="text-xl font-semibold text-pennie-navy">
            Audit findings by agent
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-pennie-graphite/70">
            Agents are ranked by potential issues and shown 10 at a time. Date range, category, status, and priority apply to both tables; reviewed false alarms are excluded from potential issues, early 1.5 counts, recurring patterns, and median talk time.
          </p>
        </div>
        <RefreshingHint active={refreshing} />
      </div>

      <div className="hidden lg:block">
        <table className="w-full table-fixed">
          <caption className="sr-only">Disposition audit findings grouped by agent</caption>
          <thead className="bg-pennie-beige/60">
            <tr>
              <AgentSummaryTh className="w-[18%]">Agent</AgentSummaryTh>
              <AgentSummaryTh className="w-[10%] text-center">Potential issues</AgentSummaryTh>
              <AgentSummaryTh className="w-[8%] text-center">To review</AgentSummaryTh>
              <AgentSummaryTh className="w-[8%] text-center">Confirmed</AgentSummaryTh>
              <AgentSummaryTh className="w-[8%] text-center">False alarms</AgentSummaryTh>
              <AgentSummaryTh className="w-[9%] text-center">Median talk</AgentSummaryTh>
              <AgentSummaryTh className="w-[12%] text-center">Early 1.5s</AgentSummaryTh>
              <AgentSummaryTh className="w-[27%]">Most common mismatch</AgentSummaryTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {stats.map(stat => (
              <tr key={stat.agentEmail ?? 'unknown-agent'}>
                <th scope="row" className="px-6 py-4 text-left align-top [overflow-wrap:anywhere] text-sm font-semibold text-pennie-navy">
                  {stat.agentEmail ?? 'Unknown agent'}
                </th>
                <AgentSummaryCount value={stat.potentialIssues} />
                <AgentSummaryCount value={stat.toReview} />
                <AgentSummaryCount value={stat.confirmedIssues} />
                <AgentSummaryCount value={stat.falseAlarms} />
                <AgentSummaryDuration seconds={stat.medianTalkTimeSeconds} />
                <AgentSummaryPriority total={stat.earlyOnePointFiveCalls} severe={stat.severeOnePointFiveCalls} />
                <td className="px-6 py-4 align-top">
                  <MismatchPattern stat={stat} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border/60 lg:hidden">
        {stats.map(stat => (
          <li key={stat.agentEmail ?? 'unknown-agent'} className="px-5 py-5 sm:px-6">
            <p className="[overflow-wrap:anywhere] text-sm font-semibold text-pennie-navy">
              {stat.agentEmail ?? 'Unknown agent'}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
              <AgentSummaryMetric label="Potential issues" value={stat.potentialIssues} />
              <AgentSummaryMetric label="To review" value={stat.toReview} />
              <AgentSummaryMetric label="Confirmed" value={stat.confirmedIssues} />
              <AgentSummaryMetric label="False alarms" value={stat.falseAlarms} />
              <div>
                <dt className="pennie-label">Median talk time</dt>
                <dd className="mt-1 text-xl font-semibold text-pennie-navy tabular-nums">
                  {formatAuditTalkTime(stat.medianTalkTimeSeconds)}
                </dd>
              </div>
              <div>
                <dt className="pennie-label">Early 1.5s</dt>
                <dd className="mt-1 text-xl font-semibold text-pennie-navy tabular-nums">
                  {stat.earlyOnePointFiveCalls.toLocaleString()}
                </dd>
                {stat.severeOnePointFiveCalls > 0 && (
                  <p className="mt-0.5 text-xs font-semibold text-red-700 tabular-nums">
                    {stat.severeOnePointFiveCalls.toLocaleString()} under 2m
                  </p>
                )}
              </div>
            </dl>
            <div className="mt-4 border-t border-border/60 pt-4">
              <p className="pennie-label">Most common mismatch</p>
              <div className="mt-1"><MismatchPattern stat={stat} /></div>
            </div>
          </li>
        ))}
      </ul>

      <PaginationControls
        page={pagination.page}
        pageCount={pagination.pageCount}
        start={pagination.start}
        end={pagination.end}
        total={pagination.total}
        itemLabel="agent"
        ariaLabel="Agent summary pages"
        onPageChange={onPageChange}
      />
    </section>
  )
}

function PaginationControls({ page, pageCount, start, end, total, itemLabel, ariaLabel, onPageChange }: {
  page: number
  pageCount: number
  start: number
  end: number
  total: number
  itemLabel: string
  ariaLabel: string
  onPageChange: (page: number) => void
}) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="text-sm text-pennie-graphite/70 tabular-nums">
        Showing <span className="font-semibold text-pennie-navy">{start.toLocaleString()}–{end.toLocaleString()}</span> of {total.toLocaleString()} {itemLabel}{total === 1 ? '' : 's'}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="pennie-focus-ring inline-flex min-h-[40px] items-center gap-1 rounded-full border border-border px-3 text-sm font-semibold text-pennie-graphite transition-colors hover:bg-pennie-beige disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Previous
          </button>
          <span className="min-w-20 text-center text-sm font-semibold text-pennie-navy tabular-nums">Page {page} of {pageCount}</span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page === pageCount}
            className="pennie-focus-ring inline-flex min-h-[40px] items-center gap-1 rounded-full border border-border px-3 text-sm font-semibold text-pennie-graphite transition-colors hover:bg-pennie-beige disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
    </nav>
  )
}

function DispositionTimingBadge({ flag }: { flag: DispositionTimingFlag }) {
  if (flag === null) return null

  const severe = flag === 'severe'
  return (
    <span
      className={`mt-1 inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        severe ? 'bg-red-100 text-red-800' : 'bg-pennie-peach-light text-pennie-peach-deeper'
      }`}
    >
      {severe ? 'Severe · 1.5 under 2m' : 'Early · 1.5 under 10m'}
    </span>
  )
}

function MismatchPattern({ stat }: { stat: DispositionAuditAgentStat }) {
  const pattern = stat.topMismatch
  if (!pattern) return <span className="text-sm text-muted-foreground">—</span>

  return (
    <div className="min-w-0 text-sm leading-5">
      <span className="block [overflow-wrap:anywhere] text-pennie-graphite">
        <span className="sr-only">Agent selected: </span>{pattern.currentDisposition}
      </span>
      <span className="block [overflow-wrap:anywhere] font-semibold text-pennie-navy">
        <span className="sr-only">Model suggested: </span><span aria-hidden="true">→ </span>{pattern.suggestedDisposition}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
        {pattern.count.toLocaleString()} {pattern.count === 1 ? 'call' : 'calls'}
      </span>
    </div>
  )
}

function AgentSummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="pennie-label">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-pennie-navy tabular-nums">{value.toLocaleString()}</dd>
    </div>
  )
}

function AgentSummaryTh({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th scope="col" className={`px-6 py-3 text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em] ${className}`}>{children}</th>
}

function AgentSummaryCount({ value }: { value: number }) {
  return <td className="px-3 py-4 text-center align-top text-sm font-semibold text-pennie-navy tabular-nums">{value.toLocaleString()}</td>
}

function AgentSummaryDuration({ seconds }: { seconds: number | null }) {
  return <td className="px-3 py-4 text-center align-top text-sm font-semibold text-pennie-navy tabular-nums">{formatAuditTalkTime(seconds)}</td>
}

function AgentSummaryPriority({ total, severe }: { total: number; severe: number }) {
  return (
    <td className="px-3 py-4 text-center align-top tabular-nums">
      <span className="block text-sm font-semibold text-pennie-navy">{total.toLocaleString()}</span>
      {severe > 0 && (
        <span className="mt-0.5 block text-xs font-semibold text-red-700">{severe.toLocaleString()} under 2m</span>
      )}
    </td>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 sm:px-6 py-3 text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em]">{children}</th>
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 sm:px-6 py-3 sm:py-4 align-top">{children}</td>
}
