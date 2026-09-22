import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { calculateMetrics } from '../lib/queries'
import {
  useCallsPage,
  useCallsSummary,
  usePrefetchNextCallsPage,
  useUniqueAgents,
} from '../hooks/use-queries'
import { fetchCallsExport, readCallsThresholds, type CallListRow, type CallsFilters, type CallsSort } from '../lib/calls-queries'
import {
  formatDateParam,
  parseDateParam,
  parseListParam,
} from '../lib/url-filters'
import { defaultAlertWindow } from '../lib/alert-review-queue'
import { callsScrollFor, rememberCallsScroll } from '../lib/calls-scroll-state'
import {
  agentDisplayName,
  formatDuration,
  formatPhoneNumber,
  formatDateTime,
} from '../lib/utils'
import { accentForScore, accentForBand, pillClasses } from '../lib/violation-styles'
import { pitchCallRisk, BAND_LABEL } from '../lib/pitch-call-risk'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { AgentFilter } from '../components/dashboard/AgentFilter'
import { DispositionFilter, prettify as prettifyDisposition } from '../components/dashboard/DispositionFilter'
import { RefreshingHint } from '../components/ui/refreshing-hint'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet'
import { ThresholdSettingsSheet } from '../components/settings/ThresholdSettings'
import type { ThresholdSettings } from '../types/settings'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Download,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Settings,
} from 'lucide-react'
import { SortableTh } from '@/components/ui/sortable-th'
import { HelpHint } from '../components/ui/help-hint'
import { PageHero, SupportingStat } from '../components/PageHero'
import { ErrorState } from '@/components/states/ErrorState'

type QuickFilter = CallsFilters['quickFilter']
type CallSortKey = CallsSort['key']

const QUICK_FILTERS: ReadonlyArray<{ value: QuickFilter; label: string }> = [
  { value: 'all', label: 'All calls' },
  { value: 'escalations', label: 'Manager escalations' },
  { value: 'compliance', label: 'Compliance failures' },
  { value: 'threshold', label: 'Below threshold' },
  { value: 'rushed', label: 'Pitch calls under 30 min' },
]

const MAX_CALLS_PAGE = Math.floor(2_147_483_647 / 25) + 1

const CALL_SORT_KEYS: readonly CallSortKey[] = [
  'time',
  'agent',
  'talk',
  'score',
  'compliance',
  'csat',
]

function parsePageParam(raw: string | null): number {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return 1
  const page = Number(raw)
  return Number.isSafeInteger(page) && page <= MAX_CALLS_PAGE ? page : 1
}

function parseSortParams(rawKey: string | null, rawDirection: string | null): CallsSort {
  const key = CALL_SORT_KEYS.find(candidate => candidate === rawKey)
  if (!key) return { key: 'time', desc: true }
  if (rawDirection === 'asc') return { key, desc: false }
  if (rawDirection === 'desc') return { key, desc: true }
  return { key, desc: key !== 'agent' }
}

// Condensed pagination: always show first/last, a window around the current
// page, and ellipses for the gaps.
function paginationItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const wanted = new Set([1, 2, current - 1, current, current + 1, total - 1, total])
  const pages = Array.from(wanted)
    .filter(p => p >= 1 && p <= total)
    .sort((a, b) => a - b)
  const items: (number | '…')[] = []
  let prev = 0
  for (const p of pages) {
    if (prev && p - prev > 1) items.push('…')
    items.push(p)
    prev = p
  }
  return items
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  // Calls shares the Review workspace's 30-day ET default.
  const [defaultDates] = useState(() => defaultAlertWindow(new Date()))
  const [startDate, setStartDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('start'), defaultDates.start),
  )
  const [endDate, setEndDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('end'), defaultDates.end, true),
  )

  const [selectedAgents, setSelectedAgents] = useState<string[]>(() =>
    parseListParam(searchParams.get('agents')),
  )
  const agentsQuery = useUniqueAgents()
  const availableAgents = agentsQuery.data ?? []
  const [selectedDispositions, setSelectedDispositions] = useState<string[]>(
    () => parseListParam(searchParams.get('dispo')),
  )
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => {
    const q = searchParams.get('qf')
    return q === 'escalations' ||
      q === 'compliance' ||
      q === 'threshold' ||
      q === 'rushed' ||
      q === 'all'
      ? q
      : 'all'
  })

  const [showSettings, setShowSettings] = useState(false)
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [thresholds, setThresholds] = useState<ThresholdSettings>(() =>
    readCallsThresholds(localStorage.getItem('thresholdSettings')),
  )

  const [sortKey, setSortKey] = useState<CallSortKey>(() =>
    parseSortParams(searchParams.get('sort'), searchParams.get('dir')).key,
  )
  const [sortDesc, setSortDesc] = useState(() =>
    parseSortParams(searchParams.get('sort'), searchParams.get('dir')).desc,
  )
  const [currentPage, setCurrentPage] = useState(() =>
    parsePageParam(searchParams.get('page')),
  )
  const toggleSort = (key: CallSortKey) => {
    setCurrentPage(1)
    setSortDesc(sortKey === key ? !sortDesc : key !== 'agent')
    setSortKey(key)
  }
  const changeDateRange = (start: Date, end: Date) => {
    setCurrentPage(1)
    setStartDate(start)
    setEndDate(end)
  }
  const changeAgents = (agents: string[]) => {
    setCurrentPage(1)
    setSelectedAgents(agents)
  }
  const changeDispositions = (dispositions: string[]) => {
    setCurrentPage(1)
    setSelectedDispositions(dispositions)
  }
  const changeQuickFilter = (value: QuickFilter) => {
    setCurrentPage(1)
    setQuickFilter(value)
  }

  const filters: CallsFilters = { startDate, endDate, agents: selectedAgents, dispositions: selectedDispositions,
    quickFilter, thresholds }
  const sort: CallsSort = { key: sortKey, desc: sortDesc }
  const pageQuery = useCallsPage(filters, sort, currentPage)
  const summaryQuery = useCallsSummary(filters)
  const prefetchNextPage = usePrefetchNextCallsPage(
    filters,
    sort,
    currentPage,
    pageQuery.data?.has_more === true && !pageQuery.isFetching,
  )
  const { isPending: loading, isError, refetch } = pageQuery
  const refreshing = pageQuery.isFetching && !loading
  const paginatedCalls = pageQuery.data?.rows ?? []
  const summary = summaryQuery.data
  const resultsSectionRef = useRef<HTMLElement>(null)
  const resultsBodyRef = useRef<HTMLDivElement>(null)
  const lastResultsGeometry = useRef<{
    viewportWidth: number
    bodyHeight: number
    sectionHeight: number
  } | null>(null)
  const restoredHistoryKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!pageQuery.data || pageQuery.data.rows.length === 0) return
    if (restoredHistoryKey.current === location.key) return
    const scrollY = callsScrollFor(location.key)
    if (scrollY === undefined) return
    restoredHistoryKey.current = location.key
    window.scrollTo(0, scrollY)
  }, [location.key, pageQuery.data])
  useLayoutEffect(() => {
    if (
      loading ||
      isError ||
      !pageQuery.data ||
      !resultsBodyRef.current ||
      !resultsSectionRef.current
    ) return
    const bodyHeight = resultsBodyRef.current.getBoundingClientRect().height
    const sectionHeight = resultsSectionRef.current.getBoundingClientRect().height
    if (bodyHeight > 0 && sectionHeight > 0) {
      lastResultsGeometry.current = {
        viewportWidth: window.innerWidth,
        bodyHeight,
        sectionHeight,
      }
    }
  }, [loading, isError, pageQuery.data])
  const previousResultsGeometry = lastResultsGeometry.current
  const sameResultsViewport =
    previousResultsGeometry?.viewportWidth === window.innerWidth
  const pendingResultsBodyMinHeight = loading
    ? sameResultsViewport
      ? previousResultsGeometry?.bodyHeight
      : '50vh'
    : undefined
  const pendingResultsSectionMinHeight =
    loading && sameResultsViewport
      ? previousResultsGeometry?.sectionHeight
      : undefined
  const availableDispositions = summary?.dispositions ?? []
  const isFiltered = selectedDispositions.length > 0 || quickFilter !== 'all'
  const activeFilterCount =
    (selectedAgents.length > 0 ? 1 : 0) +
    (selectedDispositions.length > 0 ? 1 : 0) +
    (quickFilter !== 'all' ? 1 : 0)
  const startIndex = (currentPage - 1) * 25
  const totalPages = summary ? Math.ceil(summary.total_calls / 25) : 0
  const unavailableStat = summaryQuery.isError ? 'Unavailable' : '…'
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportController = useRef<AbortController | null>(null)
  useEffect(() => () => exportController.current?.abort(), [])

  const callsSearchParams = new URLSearchParams()
  callsSearchParams.set('start', formatDateParam(startDate))
  callsSearchParams.set('end', formatDateParam(endDate))
  if (selectedAgents.length) callsSearchParams.set('agents', selectedAgents.join(','))
  if (selectedDispositions.length)
    callsSearchParams.set('dispo', selectedDispositions.join(','))
  if (quickFilter !== 'all') callsSearchParams.set('qf', quickFilter)
  if (currentPage !== 1) callsSearchParams.set('page', String(currentPage))
  if (sortKey !== 'time' || !sortDesc) {
    callsSearchParams.set('sort', sortKey)
    callsSearchParams.set('dir', sortDesc ? 'desc' : 'asc')
  }
  const serializedCallsSearch = callsSearchParams.toString()

  // Keep one replaceable Calls history entry while making the complete view
  // shareable and available to detail-page Back navigation.
  useEffect(() => {
    if (serializedCallsSearch !== searchParams.toString()) {
      setSearchParams(new URLSearchParams(serializedCallsSearch), { replace: true })
    }
  }, [serializedCallsSearch, searchParams, setSearchParams])

  const callPath = (callId: string) =>
    `/dashboard/calls/${callId}?${serializedCallsSearch}`
  const openCall = (callId: string) => {
    rememberCallsScroll(location.key, window.scrollY)
    navigate(callPath(callId))
  }

  const handleSaveThresholds = (newThresholds: ThresholdSettings) => {
    localStorage.setItem('thresholdSettings', JSON.stringify(newThresholds))
    setCurrentPage(1)
    setThresholds(newThresholds)
  }

  const handleExportPDF = async () => {
    if (exportController.current) return
    setExporting(true)
    setExportError(null)
    const controller = new AbortController()
    exportController.current = controller
    try {
      const result = await fetchCallsExport(filters, sort, { signal: controller.signal })
      if (result.ok === false) {
        if (result.error._tag !== 'Cancelled') setExportError(result.error.message)
        return
      }
      const { exportDashboardToPDF } = await import('../lib/pdf-export')
      if (controller.signal.aborted) return
      // Export KPIs describe the rows actually exported, not a stale summary request.
      const metrics = calculateMetrics(result.value)
      await exportDashboardToPDF(
        result.value,
        {
          totalCalls: metrics.totalCalls,
          requiresAttention: metrics.callsRequiringAttention,
          avgTalkTime: metrics.avgTalkTime,
          avgHandleTime: metrics.avgHandleTime,
          complianceRate: metrics.compliancePassRate,
          custSatRate: metrics.highSatRate,
        },
        { start: startDate, end: endDate },
        selectedAgents,
      )
    } catch {
      if (!controller.signal.aborted) setExportError('Could not generate the PDF. Please try again.')
    } finally {
      if (exportController.current === controller) exportController.current = null
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <PageHero
        label="Calls"
        statsCols="grid-cols-2 sm:grid-cols-4"
        headline={
          <>
            <span className="tabular-nums">
              {summary ? summary.total_calls.toLocaleString() : unavailableStat}
            </span>{' '}
            <span className="text-pennie-graphite/70 font-medium">
              {isFiltered && summary
                ? `of ${summary.window_calls.toLocaleString()} in window`
                : summary?.total_calls === 1
                  ? 'call in window'
                  : 'calls in window'}
            </span>
          </>
        }
        description={
          <>
            <span className="tabular-nums">
              {summary ? summary.calls_requiring_attention.toLocaleString() : unavailableStat}
            </span>{' '}
            need attention.{' '}
            {quickFilter !== 'threshold' && (
              <button
                type="button"
                onClick={() => changeQuickFilter('threshold')}
                className="text-pennie-blue-deeper font-semibold hover:underline underline-offset-4"
              >
                Show me →
              </button>
            )}
          </>
        }
        stats={
          <>
            <SupportingStat
              label="Avg talk"
              value={summary ? formatDuration(summary.avg_talk_time) : unavailableStat}
              helpId="metric.avg_talk"
            />
            <SupportingStat
              label="Avg handle"
              value={summary ? formatDuration(summary.avg_handle_time) : unavailableStat}
              helpId="metric.avg_handle"
            />
            <SupportingStat
              label="Compliance"
              value={summary ? `${summary.compliance_pass_rate}%` : unavailableStat}
              helpId="metric.compliance_rate"
            />
            <SupportingStat
              label="High CSAT"
              value={summary ? `${summary.high_sat_rate}%` : unavailableStat}
              helpId="metric.high_csat"
            />
          </>
        }
      />

      <div className="min-h-5">
        {summaryQuery.isPending && (
          <p role="status" className="text-sm text-muted-foreground">Loading summary…</p>
        )}
      </div>
      {summaryQuery.isError && <ErrorState title="Couldn't load call summary" message="Call rows are independent of totals. Retry to load counts and disposition options." onRetry={() => summaryQuery.refetch()} />}
      {agentsQuery.isError && <ErrorState title="Couldn't load agent options" message="Retry to reload the agent filter." onRetry={() => agentsQuery.refetch()} />}
      {exportError && <ErrorState title="Couldn't export calls" message={exportError} onRetry={handleExportPDF} />}

      {/* Calls toolbar: mobile keeps the date primary and moves advanced
          filters/actions into compact installed primitives. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex w-full min-w-0 flex-wrap items-end gap-2 lg:w-auto lg:flex-nowrap lg:gap-5">
          <div className="min-w-[16rem] flex-1 [&_button]:w-full lg:flex-none lg:[&_button]:w-auto">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onRangeChange={changeDateRange}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowMobileFilters(true)}
            className="pennie-focus-ring inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-pennie-white px-3 text-sm font-semibold text-pennie-navy lg:hidden"
          >
            <ListFilter className="size-4" aria-hidden="true" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="pennie-focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-pennie-white text-pennie-navy lg:hidden"
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 rounded-2xl p-2 lg:hidden">
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="pennie-focus-ring flex min-h-[40px] w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-pennie-beige"
              >
                <Settings className="size-4" aria-hidden="true" />
                Thresholds
              </button>
              <button
                type="button"
                onClick={handleExportPDF}
                disabled={exporting || loading || isError}
                className="pennie-focus-ring flex min-h-[40px] w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-pennie-beige disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                {exporting ? 'Preparing PDF…' : 'Export PDF'}
              </button>
            </PopoverContent>
          </Popover>
          <div className="hidden items-end gap-5 lg:flex">
            <AgentFilter
              availableAgents={availableAgents}
              selectedAgents={selectedAgents}
              onSelectionChange={changeAgents}
            />
            <DispositionFilter
              available={availableDispositions}
              selected={selectedDispositions}
              onSelectionChange={changeDispositions}
            />
            <div className="flex h-10 items-end">
              <RefreshingHint active={refreshing} />
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-pennie-graphite transition-colors hover:bg-pennie-beige"
          >
            <Settings className="size-4" aria-hidden="true" />
            Thresholds
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={exporting || loading || isError}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-pennie-navy px-4 py-2 text-sm font-semibold text-pennie-white transition-colors hover:bg-pennie-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            {exporting ? 'Preparing PDF…' : 'Export PDF'}
          </button>
        </div>
      </div>

      <div className="hidden flex-wrap gap-2 lg:flex" role="group" aria-label="Quick filters">
        {QUICK_FILTERS.map(filter => (
          <QuickFilterButton
            key={filter.value}
            filter={filter}
            active={quickFilter === filter.value}
            onClick={() => changeQuickFilter(filter.value)}
          />
        ))}
      </div>

      <Sheet open={showMobileFilters} onOpenChange={setShowMobileFilters}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl bg-pennie-white p-0 lg:hidden">
          <SheetHeader className="border-b border-border px-5 py-4 text-left">
            <SheetTitle className="text-pennie-navy">Filters</SheetTitle>
          </SheetHeader>
          <div className="space-y-5 px-5 py-5">
            <AgentFilter
              availableAgents={availableAgents}
              selectedAgents={selectedAgents}
              onSelectionChange={changeAgents}
            />
            <DispositionFilter
              available={availableDispositions}
              selected={selectedDispositions}
              onSelectionChange={changeDispositions}
            />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
              {QUICK_FILTERS.map(filter => (
                <QuickFilterButton
                  key={filter.value}
                  filter={filter}
                  active={quickFilter === filter.value}
                  onClick={() => changeQuickFilter(filter.value)}
                />
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Calls list — desktop renders the wide table, mobile renders a stacked
          card list with the most-scannable fields. Both views drive the same
          navigation handler so keyboard / click semantics match. */}
      <section
        ref={resultsSectionRef}
        aria-label="Calls results"
        aria-busy={loading}
        style={{ minHeight: pendingResultsSectionMinHeight }}
        className="min-w-0 max-w-full bg-pennie-white rounded-3xl shadow-resting overflow-hidden"
      >
        <div ref={resultsBodyRef} style={{ minHeight: pendingResultsBodyMinHeight }}>
        {/* Mobile card list */}
        <ul className="lg:hidden divide-y divide-border/60">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <li key={`sk-mob-${i}`} className="px-4 py-4">
                  <span
                    className="block h-3 rounded-full bg-pennie-beige animate-pulse"
                    style={{ width: `${45 + (i % 5) * 8}%` }}
                  />
                  <span
                    className="mt-2 block h-2.5 rounded-full bg-pennie-beige animate-pulse"
                    style={{ width: `${30 + (i % 4) * 10}%` }}
                  />
                </li>
              ))
            : paginatedCalls.map(call => {
                const isEscalation = call.qa?.manager_escalation
                const isComplianceFail =
                  call.qa?.compliance_rating === 'fail'
                const stripeBg = isEscalation
                  ? 'bg-pennie-peach-dark'
                  : isComplianceFail
                    ? 'bg-pennie-yellow-dark'
                    : 'bg-transparent'
                const goToCall = () => openCall(call.call_id)
                return (
                  <li key={`mob-${call.id}`}>
                    <button
                      type="button"
                      onClick={goToCall}
                      className="pennie-focus-ring-inset relative w-full text-left px-4 py-4 flex gap-3 items-start hover:bg-pennie-beige/40 active:bg-pennie-beige/60 transition-colors"
                    >
                      <span
                        className={`mt-1 w-1 self-stretch rounded-full ${stripeBg}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-semibold text-pennie-navy truncate">
                            {agentDisplayName(call.agent_full_name, call.agent_email)}
                          </p>
                          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatDateTime(call.started_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {formatPhoneNumber(call.contact_phone)} ·{' '}
                          {formatDuration(call.talk_time)}
                          <RiskBandPill call={call} />
                        </p>
                        {call.disposition && (
                          <p className="mt-1 text-xs text-pennie-graphite/70 truncate">
                            <DispositionCell value={call.disposition} />
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <ScorePill score={call.qa?.overall_score} />
                          <ScorePill score={call.qa?.compliance_rating} />
                          <ScorePill
                            score={call.qa?.customer_satisfaction_likely}
                          />
                        </div>
                      </div>
                      <ChevronRight
                        aria-hidden="true"
                        className="self-center w-4 h-4 text-pennie-graphite/40 flex-none"
                      />
                      <span className="sr-only">View call details</span>
                    </button>
                  </li>
                )
              })}
        </ul>

        {/* Desktop / tablet table */}
        <div className="hidden w-full max-w-full lg:block overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-pennie-beige/60">
              <tr>
                <th
                  className="px-4 py-3 first:pl-5 text-left"
                  aria-sort={
                    sortKey === 'time'
                      ? sortDesc
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  <span className="inline-flex items-center">
                    <SortLabel
                      label="Date / time (ET)"
                      active={sortKey === 'time'}
                      desc={sortDesc}
                      onClick={() => toggleSort('time')}
                    />
                    <HelpHint id="column.severity" className="ml-1" />
                  </span>
                </th>
                <SortableTh
                  label="Agent"
                  active={sortKey === 'agent'}
                  desc={sortDesc}
                  onClick={() => toggleSort('agent')}
                  className="px-4 py-3"
                />
                <Th>Contact</Th>
                <SortableTh
                  label="Talk time"
                  active={sortKey === 'talk'}
                  desc={sortDesc}
                  onClick={() => toggleSort('talk')}
                  className="px-4 py-3"
                />
                <Th>
                  Disposition
                  <HelpHint id="column.disposition" className="ml-1" />
                </Th>
                <th
                  className="px-4 py-3 text-left"
                  aria-sort={
                    sortKey === 'score'
                      ? sortDesc
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  <span className="inline-flex items-center">
                    <SortLabel
                      label="Score"
                      active={sortKey === 'score'}
                      desc={sortDesc}
                      onClick={() => toggleSort('score')}
                    />
                    <HelpHint id="column.score" className="ml-1" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 text-left"
                  aria-sort={
                    sortKey === 'compliance'
                      ? sortDesc
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  <span className="inline-flex items-center">
                    <SortLabel
                      label="Compliance"
                      active={sortKey === 'compliance'}
                      desc={sortDesc}
                      onClick={() => toggleSort('compliance')}
                    />
                    <HelpHint id="column.compliance" className="ml-1" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 text-left"
                  aria-sort={
                    sortKey === 'csat'
                      ? sortDesc
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  <span className="inline-flex items-center">
                    <SortLabel
                      label="Cust sat"
                      active={sortKey === 'csat'}
                      desc={sortDesc}
                      onClick={() => toggleSort('csat')}
                    />
                    <HelpHint id="column.csat" className="ml-1" />
                  </span>
                </th>
                <th aria-hidden="true" className="w-10" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr
                      key={`sk-${i}`}
                      className={i !== 0 ? 'border-t border-border/60' : ''}
                    >
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j} className="px-4 py-4 align-top">
                          <span
                            className="block h-3 rounded-full bg-pennie-beige animate-pulse"
                            style={{ width: `${45 + ((i * 8 + j) % 6) * 8}%` }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                : paginatedCalls.map((call, i) => {
                const isEscalation = call.qa?.manager_escalation
                const isComplianceFail = call.qa?.compliance_rating === 'fail'
                // Severity stripe lives on the first td as a left border so the
                // browser doesn't synthesize an anonymous cell from a tr ::before.
                const stripeBorder = isEscalation
                  ? 'border-pennie-peach-dark'
                  : isComplianceFail
                    ? 'border-pennie-yellow-dark'
                    : 'border-transparent'
                const goToCall = () => openCall(call.call_id)
                return (
                  <tr
                    key={call.id}
                    role="link"
                    tabIndex={0}
                    onClick={goToCall}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        goToCall()
                      }
                    }}
                    className={`pennie-focus-ring-inset group cursor-pointer transition-colors duration-150 hover:bg-pennie-beige/40 ${
                      i !== 0 ? 'border-t border-border/60' : ''
                    }`}
                  >
                    <td className={`pl-5 pr-4 py-4 whitespace-nowrap text-sm text-muted-foreground tabular-nums border-l-4 ${stripeBorder}`}>
                      {isEscalation ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-pennie-peach-dark mr-2 align-middle" aria-label="escalation" />
                      ) : isComplianceFail ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-pennie-yellow-dark mr-2 align-middle" aria-label="compliance fail" />
                      ) : null}
                      {formatDateTime(call.started_at)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-pennie-navy">
                      {agentDisplayName(call.agent_full_name, call.agent_email)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                      {formatPhoneNumber(call.contact_phone)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-pennie-graphite tabular-nums">
                      {formatDuration(call.talk_time)}
                      <RiskBandPill call={call} />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      {call.disposition ? (
                        <DispositionCell value={call.disposition} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <ScorePill score={call.qa?.overall_score} />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <ScorePill score={call.qa?.compliance_rating} />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <ScorePill score={call.qa?.customer_satisfaction_likely} />
                    </td>
                    <td className="pl-2 pr-5 py-4 w-10 text-right">
                      <ChevronRight
                        aria-hidden="true"
                        className="inline-block w-4 h-4 text-pennie-graphite/35 transition-all duration-150 group-hover:text-pennie-blue-deeper group-hover:translate-x-0.5"
                      />
                      <span className="sr-only">View call details</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>

        {/* Pagination remains present while rows change so pending data is
            never presented as a genuine zero-result page. */}
        <div className="flex min-h-[68px] flex-col items-stretch justify-between gap-3 border-t border-border bg-pennie-beige/40 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-6 sm:py-4">
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">Loading calls…</p>
          ) : isError ? (
            <p className="text-sm text-muted-foreground">Calls unavailable</p>
          ) : (
            <p className="text-sm text-muted-foreground tabular-nums">
              Showing {paginatedCalls.length === 0 ? 0 : startIndex + 1}–
              {paginatedCalls.length === 0 ? 0 : startIndex + paginatedCalls.length}
              {summary ? ` of ${summary.total_calls}` : ' · total pending'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={loading || isError || currentPage === 1}
              className="min-h-[36px] px-4 py-1.5 rounded-full bg-pennie-white border border-border text-sm font-semibold text-pennie-graphite disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pennie-beige transition-colors"
            >
              Previous
            </button>
            <div className="hidden gap-1 sm:flex">
              {loading
                ? Array.from({ length: 3 }, (_, index) => (
                    <span
                      key={`page-sk-${index}`}
                      className="min-h-[36px] min-w-[36px] rounded-full bg-pennie-white/70"
                      aria-hidden="true"
                    />
                  ))
                : paginationItems(currentPage, totalPages).map((item, i) =>
                    item === '…' ? (
                      <span
                        key={`gap-${i}`}
                        className="px-1.5 text-muted-foreground self-center"
                        aria-hidden="true"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        aria-current={currentPage === item ? 'page' : undefined}
                        onClick={() => setCurrentPage(item)}
                        className={`min-h-[36px] min-w-[36px] px-3 rounded-full text-sm font-semibold transition-colors tabular-nums ${
                          currentPage === item
                            ? 'bg-pennie-navy text-pennie-white'
                            : 'bg-pennie-white border border-border text-pennie-graphite hover:bg-pennie-beige'
                        }`}
                      >
                        {item}
                      </button>
                    ),
                  )}
            </div>
            <button
              type="button"
              onPointerEnter={prefetchNextPage}
              onFocus={prefetchNextPage}
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={
                loading ||
                isError ||
                currentPage >= MAX_CALLS_PAGE ||
                !pageQuery.data?.has_more
              }
              className="min-h-[36px] px-4 py-1.5 rounded-full bg-pennie-white border border-border text-sm font-semibold text-pennie-graphite disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pennie-beige transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {!loading && isError && (
        <ErrorState
          title="Couldn't load calls"
          message="We hit an error fetching the call list. Retry to reload."
          onRetry={() => refetch()}
        />
      )}

      {!loading && !isError && paginatedCalls.length === 0 && (
        <div className="text-center py-12 bg-pennie-white rounded-3xl shadow-resting">
          <p className="text-pennie-graphite font-medium">
            No calls match your filters.
          </p>
          <button
            type="button"
            onClick={() => {
              setCurrentPage(1)
              setQuickFilter('all')
              setSelectedAgents([])
              setSelectedDispositions([])
            }}
            className="mt-3 text-sm font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
          >
            Clear filters
          </button>
        </div>
      )}

      <ThresholdSettingsSheet
        isOpen={showSettings}
        thresholds={thresholds}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveThresholds}
      />
    </div>
  )
}

function QuickFilterButton({
  filter,
  active,
  onClick,
}: {
  filter: { value: QuickFilter; label: string }
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[40px] rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'border-pennie-navy bg-pennie-navy text-pennie-white'
          : 'border-border bg-pennie-white text-pennie-graphite hover:bg-pennie-beige'
      }`}
    >
      {filter.label}
    </button>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em] px-4 py-3 first:pl-5">
      {children}
    </th>
  )
}

// Sort trigger sized to sit inline next to a HelpHint inside a th that also
// carries aria-sort (SortableTh owns both when there's no hint).
function SortLabel({
  label,
  active,
  desc,
  onClick,
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
}) {
  const Icon = active ? (desc ? ArrowDown : ArrowUp) : ArrowUpDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pennie-focus-ring inline-flex items-center gap-1 rounded-full text-[11px] font-bold uppercase tracking-[0.06em] transition-colors ${
        active ? 'text-pennie-navy' : 'text-pennie-graphite/70 hover:text-pennie-navy'
      }`}
    >
      {label}
      <Icon className={`w-3 h-3 ${active ? '' : 'opacity-50'}`} aria-hidden="true" />
    </button>
  )
}

// Compact talk-time risk band for pitch calls only (PSAI-178). Non-pitch calls
// and pitch calls with no talk time render nothing, keeping the list quiet.
function RiskBandPill({ call }: { call: CallListRow }) {
  const { isPitch, band } = pitchCallRisk(call)
  if (!isPitch || band === 'unknown') return null
  return (
    <span
      className={`${pillClasses(accentForBand(band))} ml-2 align-middle`}
      title={`Pitch call · ${BAND_LABEL[band]} talk-time band`}
    >
      {BAND_LABEL[band]}
    </span>
  )
}

function ScorePill({ score }: { score: string | null | undefined }) {
  return (
    <span className={pillClasses(accentForScore(score))}>{score || 'N/A'}</span>
  )
}

function DispositionCell({ value }: { value: string }) {
  const dashIdx = value.indexOf(' - ')
  const hasCode = dashIdx >= 0
  const code = hasCode ? value.slice(0, dashIdx) : ''
  const rest = hasCode ? value.slice(dashIdx + 3) : value
  const label = prettifyDisposition(rest).replace(/\s*>\s*/g, ' → ')
  return (
    <div className="leading-tight">
      {hasCode && (
        <div className="text-[11px] font-semibold tracking-wide text-pennie-graphite/50 tabular-nums">
          {code}
        </div>
      )}
      <div className="mt-0.5 text-pennie-graphite font-medium">{label}</div>
    </div>
  )
}
