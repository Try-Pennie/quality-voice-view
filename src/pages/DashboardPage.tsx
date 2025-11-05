import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchDashboardData, fetchUniqueAgents, calculateMetrics } from '../lib/queries'
import { formatDuration, formatPhoneNumber, formatDateTime, getScoreBadgeColor, requiresAttention } from '../lib/utils'
import type { CallWithQA } from '../types/database'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { AgentFilter } from '../components/dashboard/AgentFilter'
import { MetricCard } from '../components/dashboard/MetricCard'
import { ThresholdSettingsModal } from '../components/settings/ThresholdSettings'
import { ThresholdSettings, DEFAULT_THRESHOLDS } from '../types/settings'
import { exportDashboardToPDF } from '../lib/pdf-export'
import { AlertTriangle, PhoneCall, Clock, CheckCircle, ThumbsUp, Settings, Download } from 'lucide-react'

type QuickFilter = 'all' | 'escalations' | 'compliance' | 'threshold'

export default function DashboardPage() {
  const navigate = useNavigate()

  // Date state (default: last 7 days)
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
  const [filteredCalls, setFilteredCalls] = useState<CallWithQA[]>([])
  const [loading, setLoading] = useState(true)

  // Threshold settings
  const [showSettings, setShowSettings] = useState(false)
  const [thresholds, setThresholds] = useState<ThresholdSettings>(DEFAULT_THRESHOLDS)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 25

  // Load agents and thresholds on mount
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

  // Load calls when filters change
  useEffect(() => {
    setLoading(true)
    fetchDashboardData(startDate, endDate, selectedAgents)
      .then(data => {
        setCalls(data)
        setLoading(false)
      })
  }, [startDate, endDate, selectedAgents])

  // Apply quick filters
  useEffect(() => {
    let filtered = calls

    if (quickFilter === 'escalations') {
      filtered = calls.filter(c => c.qa?.manager_escalation === true)
    } else if (quickFilter === 'compliance') {
      filtered = calls.filter(c => c.qa?.compliance_rating === 'fail')
    } else if (quickFilter === 'threshold') {
      filtered = calls.filter(c => requiresAttention(c.qa))
    }

    setFilteredCalls(filtered)
    setCurrentPage(1)
  }, [calls, quickFilter])

  const metrics = calculateMetrics(calls)

  // Paginated data
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedCalls = filteredCalls.slice(startIndex, endIndex)
  const totalPages = Math.ceil(filteredCalls.length / ITEMS_PER_PAGE)

  const handleSaveThresholds = (newThresholds: ThresholdSettings) => {
    setThresholds(newThresholds)
  }

  const handleExportPDF = async () => {
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
      selectedAgents
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg text-muted-foreground">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => setShowSettings(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-foreground hover:bg-accent rounded-lg transition-colors border border-border"
          title="Threshold Settings"
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>

        <button
          onClick={handleExportPDF}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end">
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

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Total Calls"
          value={metrics.totalCalls.toLocaleString()}
          icon={<PhoneCall className="w-5 h-5" />}
        />

        <MetricCard
          title="Calls Requiring Attention"
          value={metrics.callsRequiringAttention.toLocaleString()}
          icon={<AlertTriangle className="w-5 h-5" />}
          className="bg-red-50 border-2 border-red-300 cursor-pointer hover:bg-red-100"
          onClick={() => setQuickFilter('threshold')}
        />

        <MetricCard
          title="Avg Talk Time"
          value={formatDuration(metrics.avgTalkTime)}
          icon={<Clock className="w-5 h-5" />}
        />

        <MetricCard
          title="Avg Handle Time"
          value={formatDuration(metrics.avgHandleTime)}
          icon={<Clock className="w-5 h-5" />}
        />

        <MetricCard
          title="Compliance Pass Rate"
          value={`${metrics.compliancePassRate}%`}
          icon={<CheckCircle className="w-5 h-5" />}
          className={
            metrics.compliancePassRate >= 95 ? 'bg-green-50' :
            metrics.compliancePassRate >= 90 ? 'bg-yellow-50' :
            'bg-red-50'
          }
        />

        <MetricCard
          title="Customer Sat (High)"
          value={`${metrics.highSatRate}%`}
          icon={<ThumbsUp className="w-5 h-5" />}
          className={
            metrics.highSatRate >= 80 ? 'bg-green-50' :
            metrics.highSatRate >= 60 ? 'bg-yellow-50' :
            'bg-red-50'
          }
        />
      </div>

      {/* Quick Filters */}
      <div className="flex gap-2">
        {(['all', 'escalations', 'compliance', 'threshold'] as QuickFilter[]).map(filter => (
          <button
            key={filter}
            onClick={() => setQuickFilter(filter)}
            className={`px-4 py-2 rounded-lg font-medium ${
              quickFilter === filter
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-card-foreground border border-border hover:bg-accent'
            }`}
          >
            {filter === 'all' && 'All Calls'}
            {filter === 'escalations' && 'Manager Escalations'}
            {filter === 'compliance' && 'Compliance Failures'}
            {filter === 'threshold' && 'Below Threshold'}
          </button>
        ))}
      </div>

      {/* Calls Table */}
      <div className="bg-card rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase">⚠</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date/Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Agent</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Talk Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Compliance</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Cust Sat</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-border">
              {paginatedCalls.map(call => {
                const isEscalation = call.qa?.manager_escalation
                const isComplianceFail = call.qa?.compliance_rating === 'fail'
                const rowClass = isEscalation
                  ? 'bg-red-50 border-l-4 border-red-500'
                  : isComplianceFail
                  ? 'bg-orange-50 border-l-4 border-orange-500'
                  : ''

                return (
                  <tr key={call.id} className={rowClass}>
                    <td className="px-3 py-4 whitespace-nowrap text-center">
                      {(isEscalation || isComplianceFail) && (
                        <span className="text-red-600 text-lg">🚩</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatDateTime(call.started_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {call.agent_full_name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatPhoneNumber(call.contact_phone)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatDuration(call.talk_time)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getScoreBadgeColor(call.qa?.overall_score)}`}>
                        {call.qa?.overall_score || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getScoreBadgeColor(call.qa?.compliance_rating)}`}>
                        {call.qa?.compliance_rating || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getScoreBadgeColor(call.qa?.customer_satisfaction_likely)}`}>
                        {call.qa?.customer_satisfaction_likely || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => navigate(`/dashboard/calls/${call.call_id}`)}
                        className="text-primary hover:text-primary/80 font-medium text-sm"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-muted px-6 py-4 flex items-center justify-between border-t border-border">
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{Math.min(endIndex, filteredCalls.length)} of {filteredCalls.length}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 bg-card border border-border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
            >
              Previous
            </button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const page = i + 1
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1 rounded ${
                      currentPage === page
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card border border-border hover:bg-accent'
                    }`}
                  >
                    {page}
                  </button>
                )
              })}
              {totalPages > 5 && <span className="px-2">...</span>}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 bg-card border border-border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {filteredCalls.length === 0 && (
        <div className="text-center py-12 bg-card rounded-lg">
          <p className="text-muted-foreground">No calls found matching your filters.</p>
          <button
            onClick={() => {
              setQuickFilter('all')
              setSelectedAgents([])
            }}
            className="mt-4 text-primary hover:text-primary/80 font-medium"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Threshold Settings Modal */}
      <ThresholdSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveThresholds}
      />
    </div>
  )
}
