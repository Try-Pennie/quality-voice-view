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
import { formatDateTime, formatPhoneNumber } from '../lib/utils'
import { PageHero } from '../components/PageHero'
import { ErrorState } from '@/components/states/ErrorState'
import { EmptyState } from '@/components/states/EmptyState'
import { ChevronRight, Inbox } from 'lucide-react'

const TABS: (AuditCategory | 'all')[] = ['all', 'ended_live_lead', 'phantom_conversation']
type StatusView = 'all' | 'new' | 'reviewed'

function todayStart() {
  const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
  const local = new Date(y, m - 1, d); local.setHours(0, 0, 0, 0); return local
}
function todayEnd() {
  const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
  const local = new Date(y, m - 1, d); local.setHours(23, 59, 59, 999); return local
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
    return t === 'ended_live_lead' || t === 'phantom_conversation' ? t : 'all'
  })
  const [statusView, setStatusView] = useState<StatusView>('new')
  const [drawerRow, setDrawerRow] = useState<DispositionAuditRow | null>(null)

  const filters = useMemo<AuditFilters>(
    () => ({ startDate, endDate, category: tab === 'all' ? undefined : tab }),
    [startDate, endDate, tab],
  )
  const { data, isPending, isError, refetch } = useDispositionAudit(filters, scope)
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

  const rows = useMemo(() => {
    if (statusView === 'new') return allRows.filter(r => !r.is_reviewed)
    if (statusView === 'reviewed') return allRows.filter(r => r.is_reviewed)
    return allRows
  }, [allRows, statusView])

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
    const idx = rows.findIndex(r => r.call_id === drawerRow.call_id)
    const next = rows[idx + delta]
    if (next) openDrawer(next)
  }, [rows, drawerRow, openDrawer])

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

  const idx = drawerRow ? rows.findIndex(r => r.call_id === drawerRow.call_id) : -1

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
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
              tab === t ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
            }`}>
            {t === 'all' ? 'All' : CATEGORY_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <section className="pennie-card-tight flex flex-wrap gap-3 sm:gap-5 items-end">
        <DateRangePicker startDate={startDate} endDate={endDate} onRangeChange={(s, e) => { setStartDate(s); setEndDate(e) }} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pennie-label">Status</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Filter by status">
            {(['new', 'reviewed', 'all'] as const).map(s => (
              <button key={s} type="button" role="radio" aria-checked={statusView === s} onClick={() => setStatusView(s)}
                className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                  statusView === s ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
                }`}>
                {s === 'new' ? 'New' : s === 'reviewed' ? 'Reviewed' : 'All'}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      {/* Table */}
      <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">Loading…</div>
        ) : isError ? (
          <ErrorState title="Couldn't load the audit" message="Retry to reload." onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={statusView === 'new' ? 'Nothing to review.' : 'No calls match.'} message="Try widening the date range or switching tabs." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-pennie-beige/60">
                <tr>
                  <Th>Time (ET)</Th><Th>Agent</Th><Th>Contact</Th><Th>Agent set</Th><Th>Model suggests</Th><Th>Conf</Th><Th>Status</Th>
                  <th aria-hidden="true" className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.call_id} role="button" tabIndex={0}
                    className={`pennie-focus-ring-inset group cursor-pointer transition-colors hover:bg-pennie-blue-light/40 ${i !== 0 ? 'border-t border-border/60' : ''}`}
                    onClick={() => openDrawer(r)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r) } }}>
                    <Td><span className="text-sm text-muted-foreground tabular-nums">{formatDateTime(r.alert_created_at)}</span></Td>
                    <Td><span className="text-sm font-semibold text-pennie-navy">{r.agent_email || '—'}</span></Td>
                    <Td>
                      <div className="text-sm text-pennie-graphite font-medium">{r.contact_name || '—'}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatPhoneNumber(r.contact_phone)}</div>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DispositionAuditDrawer
        row={drawerRow}
        currentUserEmail={user?.email}
        onClose={() => setDrawerRow(null)}
        onSubmitted={onSubmitted}
        onAdvance={advance}
        hasNext={idx > -1 && idx < rows.length - 1}
        hasPrev={idx > 0}
      />
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 sm:px-6 py-3 text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em]">{children}</th>
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 sm:px-6 py-3 sm:py-4 align-top">{children}</td>
}
