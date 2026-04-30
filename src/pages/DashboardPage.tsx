import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { calculateMetrics } from '../lib/queries'
import { useDashboardData, useUniqueAgents } from '../hooks/use-queries'
import {
  formatDateParam,
  parseDateParam,
  parseListParam,
} from '../lib/url-filters'
import { ymdInBusinessTZ } from '../lib/time-zone'
import {
  formatDuration,
  formatPhoneNumber,
  formatDateTime,
  requiresAttention,
} from '../lib/utils'
import { accentForScore, pillClasses } from '../lib/violation-styles'
import type { CallWithQA } from '../types/database'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { AgentFilter } from '../components/dashboard/AgentFilter'
import { DispositionFilter, prettify as prettifyDisposition } from '../components/dashboard/DispositionFilter'
import { ThresholdSettingsSheet } from '../components/settings/ThresholdSettings'
import { ThresholdSettings, DEFAULT_THRESHOLDS } from '../types/settings'
import { Settings, Download, Loader2, ChevronRight } from 'lucide-react'
import { HelpHint } from '../components/ui/help-hint'
import { PageHero, SupportingStat } from '../components/PageHero'

type QuickFilter = 'all' | 'escalations' | 'compliance' | 'threshold'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Filter state lazy-inits from URL so /dashboard?start=…&qf=… is a
  // shareable view. A useEffect below writes it back on every change.
  // Defaults scoped to Eastern time — see TeamPage for the picker convention.
  const [startDate, setStartDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('start'), (() => {
      const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
      const local = new Date(y, m - 1, d)
      local.setDate(local.getDate() - 6)
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

  const [selectedAgents, setSelectedAgents] = useState<string[]>(() =>
    parseListParam(searchParams.get('agents')),
  )
  const { data: availableAgentsData } = useUniqueAgents()
  const availableAgents = availableAgentsData ?? []
  const [selectedDispositions, setSelectedDispositions] = useState<string[]>(
    () => parseListParam(searchParams.get('dispo')),
  )
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => {
    const q = searchParams.get('qf')
    return q === 'escalations' ||
      q === 'compliance' ||
      q === 'threshold' ||
      q === 'all'
      ? q
      : 'all'
  })

  const { data: callsData, isPending } = useDashboardData(
    startDate,
    endDate,
    selectedAgents,
  )
  const calls = useMemo(() => callsData ?? [], [callsData])
  const loading = isPending && !callsData

  const [showSettings, setShowSettings] = useState(false)
  const [, setThresholds] = useState<ThresholdSettings>(DEFAULT_THRESHOLDS)

  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 25

  useEffect(() => {
    const saved = localStorage.getItem('thresholdSettings')
    if (saved) {
      try {
        setThresholds(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse threshold settings', e)
      }
    }
  }, [])

  // Write filter state back to URL so the current view is shareable.
  // `replace: true` keeps each filter tweak from polluting back-button history.
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    if (selectedAgents.length) params.set('agents', selectedAgents.join(','))
    if (selectedDispositions.length)
      params.set('dispo', selectedDispositions.join(','))
    if (quickFilter !== 'all') params.set('qf', quickFilter)
    setSearchParams(params, { replace: true })
  }, [
    startDate,
    endDate,
    selectedAgents,
    selectedDispositions,
    quickFilter,
    setSearchParams,
  ])

  const availableDispositions = useMemo(() => {
    const set = new Set<string>()
    for (const c of calls) {
      if (c.disposition) set.add(c.disposition)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [calls])

  const filteredCalls = useMemo(() => {
    let rows = calls
    if (selectedDispositions.length > 0) {
      const set = new Set(selectedDispositions)
      rows = rows.filter(c => c.disposition && set.has(c.disposition))
    }
    if (quickFilter === 'escalations')
      return rows.filter(c => c.qa?.manager_escalation === true)
    if (quickFilter === 'compliance')
      return rows.filter(c => c.qa?.compliance_rating === 'fail')
    if (quickFilter === 'threshold') return rows.filter(c => requiresAttention(c.qa))
    return rows
  }, [calls, quickFilter, selectedDispositions])

  useEffect(() => {
    setCurrentPage(1)
  }, [quickFilter, calls])

  // Headline + supporting stats track filteredCalls so disposition + quick
  // filter are reflected. windowMetrics keeps the unfiltered total for the
  // "of N in window" subline.
  const metrics = useMemo(() => calculateMetrics(filteredCalls), [filteredCalls])
  const windowMetrics = useMemo(() => calculateMetrics(calls), [calls])
  const isFiltered =
    selectedDispositions.length > 0 || quickFilter !== 'all'

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedCalls = filteredCalls.slice(startIndex, endIndex)
  const totalPages = Math.ceil(filteredCalls.length / ITEMS_PER_PAGE)

  const [exporting, setExporting] = useState(false)

  const handleSaveThresholds = (newThresholds: ThresholdSettings) => {
    setThresholds(newThresholds)
  }

  const handleExportPDF = async () => {
    setExporting(true)
    try {
      // Lazy-load jspdf + html2canvas only when the user actually exports —
      // keeps ~400KB out of the main bundle.
      const { exportDashboardToPDF } = await import('../lib/pdf-export')
      await exportDashboardToPDF(
        filteredCalls,
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
    } finally {
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
              {metrics.totalCalls.toLocaleString()}
            </span>{' '}
            <span className="text-pennie-graphite/70 font-medium">
              {isFiltered
                ? `of ${windowMetrics.totalCalls.toLocaleString()} in window`
                : metrics.totalCalls === 1
                  ? 'call in window'
                  : 'calls in window'}
            </span>
          </>
        }
        description={
          <>
            <span className="tabular-nums">
              {metrics.callsRequiringAttention.toLocaleString()}
            </span>{' '}
            need attention.{' '}
            {quickFilter !== 'threshold' && (
              <button
                type="button"
                onClick={() => setQuickFilter('threshold')}
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
              value={formatDuration(metrics.avgTalkTime)}
              helpId="metric.avg_talk"
            />
            <SupportingStat
              label="Avg handle"
              value={formatDuration(metrics.avgHandleTime)}
              helpId="metric.avg_handle"
            />
            <SupportingStat
              label="Compliance"
              value={`${metrics.compliancePassRate}%`}
              helpId="metric.compliance_rate"
            />
            <SupportingStat
              label="High CSAT"
              value={`${metrics.highSatRate}%`}
              helpId="metric.high_csat"
            />
          </>
        }
      />

      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3 sm:gap-5 items-end">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <AgentFilter
            availableAgents={availableAgents}
            selectedAgents={selectedAgents}
            onSelectionChange={setSelectedAgents}
          />
          <DispositionFilter
            available={availableDispositions}
            selected={selectedDispositions}
            onSelectionChange={setSelectedDispositions}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige border border-border transition-colors"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
            Thresholds
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold hover:bg-pennie-navy/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4" aria-hidden="true" />
            )}
            {exporting ? 'Preparing PDF…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* Quick filters */}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Quick filters"
      >
        {(
          [
            { value: 'all', label: 'All calls' },
            { value: 'escalations', label: 'Manager escalations' },
            { value: 'compliance', label: 'Compliance failures' },
            { value: 'threshold', label: 'Below threshold' },
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

      {/* Calls list — desktop renders the wide table, mobile renders a stacked
          card list with the most-scannable fields. Both views drive the same
          navigation handler so keyboard / click semantics match. */}
      <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
        {/* Mobile card list */}
        <ul className="md:hidden divide-y divide-border/60">
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
                const goToCall = () =>
                  navigate(`/dashboard/calls/${call.call_id}`)
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
                            {call.agent_full_name || 'Unknown'}
                          </p>
                          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatDateTime(call.started_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {formatPhoneNumber(call.contact_phone)} ·{' '}
                          {formatDuration(call.talk_time)}
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
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-pennie-beige/60">
              <tr>
                <Th>
                  Date / time (ET)
                  <HelpHint id="column.severity" className="ml-1" />
                </Th>
                <Th>Agent</Th>
                <Th>Contact</Th>
                <Th>Talk time</Th>
                <Th>
                  Disposition
                  <HelpHint id="column.disposition" className="ml-1" />
                </Th>
                <Th>
                  Score
                  <HelpHint id="column.score" className="ml-1" />
                </Th>
                <Th>
                  Compliance
                  <HelpHint id="column.compliance" className="ml-1" />
                </Th>
                <Th>
                  Cust sat
                  <HelpHint id="column.csat" className="ml-1" />
                </Th>
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
                const goToCall = () => navigate(`/dashboard/calls/${call.call_id}`)
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
                      {call.agent_full_name || 'Unknown'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                      {formatPhoneNumber(call.contact_phone)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-pennie-graphite tabular-nums">
                      {formatDuration(call.talk_time)}
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

        {/* Pagination */}
        {!loading && (
        <div className="bg-pennie-beige/40 px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-3 border-t border-border">
          <p className="text-sm text-muted-foreground tabular-nums">
            Showing {filteredCalls.length === 0 ? 0 : startIndex + 1}–
            {Math.min(endIndex, filteredCalls.length)} of {filteredCalls.length}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="min-h-[36px] px-4 py-1.5 rounded-full bg-pennie-white border border-border text-sm font-semibold text-pennie-graphite disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pennie-beige transition-colors"
            >
              Previous
            </button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const page = i + 1
                return (
                  <button
                    key={page}
                    type="button"
                    aria-current={currentPage === page ? 'page' : undefined}
                    onClick={() => setCurrentPage(page)}
                    className={`min-h-[36px] min-w-[36px] px-3 rounded-full text-sm font-semibold transition-colors ${
                      currentPage === page
                        ? 'bg-pennie-navy text-pennie-white'
                        : 'bg-pennie-white border border-border text-pennie-graphite hover:bg-pennie-beige'
                    }`}
                  >
                    {page}
                  </button>
                )
              })}
              {totalPages > 5 && (
                <span className="px-2 text-muted-foreground self-center">…</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="min-h-[36px] px-4 py-1.5 rounded-full bg-pennie-white border border-border text-sm font-semibold text-pennie-graphite disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pennie-beige transition-colors"
            >
              Next
            </button>
          </div>
        </div>
        )}
      </section>

      {!loading && filteredCalls.length === 0 && (
        <div className="text-center py-12 bg-pennie-white rounded-3xl shadow-resting">
          <p className="text-pennie-graphite font-medium">
            No calls match your filters.
          </p>
          <button
            type="button"
            onClick={() => {
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
        onClose={() => setShowSettings(false)}
        onSave={handleSaveThresholds}
      />
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em] px-4 py-3 first:pl-5">
      {children}
    </th>
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
