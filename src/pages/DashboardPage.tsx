import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchDashboardData, fetchUniqueAgents, calculateMetrics } from '../lib/queries'
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
import { ThresholdSettingsSheet } from '../components/settings/ThresholdSettings'
import { ThresholdSettings, DEFAULT_THRESHOLDS } from '../types/settings'
import { Settings, Download, Loader2 } from 'lucide-react'

type QuickFilter = 'all' | 'escalations' | 'compliance' | 'threshold'

export default function DashboardPage() {
  const navigate = useNavigate()

  const [startDate, setStartDate] = useState<Date>(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    date.setHours(0, 0, 0, 0)
    return date
  })
  const [endDate, setEndDate] = useState<Date>(() => {
    const date = new Date()
    date.setHours(23, 59, 59, 999)
    return date
  })

  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [availableAgents, setAvailableAgents] = useState<any[]>([])
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')

  const [calls, setCalls] = useState<CallWithQA[]>([])
  const [loading, setLoading] = useState(true)

  const [showSettings, setShowSettings] = useState(false)
  const [, setThresholds] = useState<ThresholdSettings>(DEFAULT_THRESHOLDS)

  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 25

  useEffect(() => {
    fetchUniqueAgents().then(setAvailableAgents)
    const saved = localStorage.getItem('thresholdSettings')
    if (saved) {
      try {
        setThresholds(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse threshold settings', e)
      }
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchDashboardData(startDate, endDate, selectedAgents).then(data => {
      setCalls(data)
      setLoading(false)
    })
  }, [startDate, endDate, selectedAgents])

  const filteredCalls = useMemo(() => {
    if (quickFilter === 'escalations') return calls.filter(c => c.qa?.manager_escalation === true)
    if (quickFilter === 'compliance') return calls.filter(c => c.qa?.compliance_rating === 'fail')
    if (quickFilter === 'threshold') return calls.filter(c => requiresAttention(c.qa))
    return calls
  }, [calls, quickFilter])

  useEffect(() => {
    setCurrentPage(1)
  }, [quickFilter, calls])

  const metrics = calculateMetrics(calls)

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
    <div className="space-y-8 animate-pennie-rise">
      {/* Headline + supporting stats (asymmetric) */}
      <header className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
        <div className="lg:col-span-7">
          <p className="pennie-label mb-2">Calls</p>
          <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-pennie-navy">
            {metrics.totalCalls.toLocaleString()}{' '}
            <span className="text-pennie-graphite/70 font-normal text-[0.6em] align-baseline">
              {metrics.totalCalls === 1 ? 'call in window' : 'calls in window'}
            </span>
          </h1>
          <p className="mt-3 text-pennie-graphite/70">
            {metrics.callsRequiringAttention.toLocaleString()} need attention.{' '}
            <button
              type="button"
              onClick={() => setQuickFilter('threshold')}
              className="text-pennie-blue-dark font-semibold hover:underline underline-offset-4"
            >
              Show me →
            </button>
          </p>
        </div>
        <dl className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SupportingStat label="Avg talk" value={formatDuration(metrics.avgTalkTime)} />
          <SupportingStat label="Avg handle" value={formatDuration(metrics.avgHandleTime)} />
          <SupportingStat
            label="Compliance"
            value={`${metrics.compliancePassRate}%`}
          />
          <SupportingStat label="High CSAT" value={`${metrics.highSatRate}%`} />
        </dl>
      </header>

      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-5 items-end">
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

      {/* Calls table */}
      <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-pennie-beige/60">
              <tr>
                <Th srOnly>Severity</Th>
                <Th>Date / time</Th>
                <Th>Agent</Th>
                <Th>Contact</Th>
                <Th>Talk time</Th>
                <Th>Score</Th>
                <Th>Compliance</Th>
                <Th>Cust sat</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr
                      key={`sk-${i}`}
                      className={i !== 0 ? 'border-t border-border/60' : ''}
                    >
                      <td className="px-3 py-4" aria-hidden="true">
                        <span className="block w-2 h-2 rounded-full bg-pennie-beige animate-pulse" />
                      </td>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-6 py-4 align-top">
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
                // Severity stripe communicates priority without emoji + heavy red bg.
                const stripe = isEscalation
                  ? 'before:bg-pennie-peach-dark'
                  : isComplianceFail
                    ? 'before:bg-pennie-yellow-dark'
                    : 'before:bg-transparent'
                return (
                  <tr
                    key={call.id}
                    className={`relative transition-colors duration-150 hover:bg-pennie-beige/40 ${
                      i !== 0 ? 'border-t border-border/60' : ''
                    } before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${stripe}`}
                  >
                    <td className="px-3 py-4 whitespace-nowrap text-center" aria-hidden="true">
                      {isEscalation ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-pennie-peach-dark" />
                      ) : isComplianceFail ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-pennie-yellow-dark" />
                      ) : null}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                      {formatDateTime(call.started_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-pennie-navy">
                      {call.agent_full_name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                      {formatPhoneNumber(call.contact_phone)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-pennie-graphite tabular-nums">
                      {formatDuration(call.talk_time)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <ScorePill score={call.qa?.overall_score} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <ScorePill score={call.qa?.compliance_rating} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <ScorePill score={call.qa?.customer_satisfaction_likely} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => navigate(`/dashboard/calls/${call.call_id}`)}
                        className="text-pennie-blue-dark font-semibold text-sm hover:underline underline-offset-4"
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && (
        <div className="bg-pennie-beige/40 px-6 py-4 flex items-center justify-between border-t border-border">
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
            }}
            className="mt-3 text-sm font-semibold text-pennie-blue-dark hover:underline underline-offset-4"
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

function SupportingStat({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div>
      <dt className="pennie-label">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
        {value}
      </dd>
    </div>
  )
}

function Th({
  children,
  srOnly,
}: {
  children: React.ReactNode
  srOnly?: boolean
}) {
  return (
    <th
      className={`text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em] ${
        srOnly ? 'sr-only' : 'px-6 py-3'
      }`}
    >
      {children}
    </th>
  )
}

function ScorePill({ score }: { score: string | null | undefined }) {
  return (
    <span className={pillClasses(accentForScore(score))}>{score || 'N/A'}</span>
  )
}
