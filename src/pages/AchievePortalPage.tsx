/* Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: existing slate external portal · designed-as-app · contrast: pass · responsive: pass */
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, ExternalLink, HelpCircle, RefreshCcw, X } from 'lucide-react'
import { AchieveFeedbackOverview } from '@/components/achieve/AchieveFeedbackOverview'
import { AchieveFilterBar } from '@/components/achieve/AchieveFilterBar'
import { AchieveOverview } from '@/components/achieve/AchieveOverview'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ACHIEVE_ELEMENTS, ACHIEVE_SECTION_ORDER, ACHIEVE_TERMS, adherenceLabel, deriveChecklist, humanizeElementKeys, type ChecklistRow } from '@/lib/achieve-checklist'
import {
  EMPTY_ACHIEVE_FILTERS,
  buildAchieveTrends,
  filterAchieveRows,
  summarizeAchieveAnalytics,
  worstAchieveAgentRating,
  type AchieveAnalyticsFilters,
} from '@/lib/achieve-analytics'
import {
  ACHIEVE_FEEDBACK_QUERY_KEY,
  ACHIEVE_LIST_QUERY_KEY,
  ACHIEVE_PASSWORD_SESSION_KEY,
  AchievePortalRequestError,
  fetchAchieveAuditData,
  fetchAchieveFeedbackDashboard,
  fetchAchieveFeedbackExceptions,
  fetchAchievePortalData,
  fetchAchievePortalDetail,
  submitAchieveReviewFeedback,
  unlockAchievePortal,
  type AchieveAgentFeedback,
  type AchievePortalRow,
} from '@/lib/achieve-queries'
import { humanizeTransferReason, parseTransferExperience, transferExperienceSummary, type TransferExperience } from '@/lib/achieve-transfer-experience'
import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '@/types/database'
import { formatDateTime } from '@/lib/utils'
import { ErrorState } from '@/components/states/ErrorState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type AchieveRow = AchievePortalRow

// Missing (uncovered) script elements for a row, derived the same way the
// detail checklist is. Returns [] for ungraded/withheld rows so no adherence
// detail leaks for them anywhere this is used.
function missingElementsForRow(row: AchieveRow): { key: string; label: string }[] {
  const result = row.result_json ?? {}
  if (result.grading_skipped || result.transcript_segment?.used_full_transcript_fallback === true) return []
  const checklist = deriveChecklist(result.script_adherence ?? {}, result.script_version)
  return checklist.rows.filter(r => !r.isCovered).map(r => ({ key: r.key, label: r.label }))
}

// First sentence of a reason string, for the compact queue-row failure line.
function firstSentence(text: string): string {
  const trimmed = text.trim()
  const idx = trimmed.indexOf('. ')
  return idx === -1 ? trimmed : trimmed.slice(0, idx + 1)
}

// Tone for the Pennie-agent call-quality rating (Good/Fair/Poor free text).
function agentQualityTone(quality: string | null): string {
  const q = (quality ?? '').toLowerCase()
  if (q === 'good') return 'bg-emerald-100 text-emerald-800'
  if (q === 'poor') return 'bg-red-100 text-red-800'
  if (q === 'fair') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-700'
}

function callMatchReasonLabel(reason: AchieveAgentFeedback['call_match_reason']): string | null {
  switch (reason) {
    case 'legacy_module_match':
      return 'Matched by the legacy Achieve QA module association.'
    case 'invalid_phone':
      return 'Phone number could not be normalized.'
    case 'submitter_missing':
      return 'Submitter name was not recorded.'
    case 'submitter_not_found':
      return 'Submitter name did not resolve to the agent directory.'
    case 'submitter_ambiguous':
      return 'Submitter name resolves to multiple Pennie agents.'
    case 'no_call_in_window':
      return 'No matching agent call was found in the submission window.'
    case 'call_ambiguous':
      return 'Multiple calls matched; no call was selected.'
    case 'matched_phone_time_submitter':
      return 'Matched by phone, submission time, and Pennie agent.'
    case 'matched_unique_qa_phone_time':
      return 'Inferred from the only exact Achieve QA candidate in the same-agent phone/time window.'
    case 'matched_transcript_agent_name':
      return 'Inferred from the full Achieve agent name in one candidate transcript.'
    case 'matched_unique_phone_time_no_submitter':
      return 'Inferred from the only global phone/time candidate when the submitter could not be resolved.'
    default:
      return null
  }
}

function callMatchMethodLabel(method: AchieveAgentFeedback['call_match_method']): string | null {
  switch (method) {
    case 'legacy_module_association':
      return 'Legacy exact module association'
    case 'phone_time_submitter':
      return 'Phone + time + Pennie agent'
    case 'unique_qa_phone_time':
      return 'Unique exact Achieve QA candidate'
    case 'transcript_agent_name_phone_time':
      return 'Full Achieve agent name in transcript'
    case 'unique_phone_time_no_submitter':
      return 'Unique global phone + time candidate'
    default:
      return null
  }
}

const ACTION_OPTIONS: { value: AlertActionTaken; label: string }[] = [
  { value: 'no_action_needed', label: 'No action needed' },
  { value: 'coached', label: 'Coached agent' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'follow_up_later', label: 'Follow up later' },
]

const INACCURACY_OPTIONS: { value: AlertInaccuracyReason; label: string }[] = [
  { value: 'evidence_misquoted', label: 'Evidence is wrong or missing context' },
  { value: 'wrong_context', label: 'Wrong call/context' },
  { value: 'covered_not_verbatim', label: 'Covered, but not verbatim' },
  { value: 'addressed_off_call', label: 'Addressed elsewhere' },
  { value: 'policy_does_not_apply', label: 'Rule does not apply' },
  { value: 'call_dropped_incomplete', label: 'Call dropped/incomplete' },
  { value: 'other', label: 'Other' },
]

export default function AchievePortalPage() {
  const [unlocked, setUnlocked] = useState(() => !!sessionStorage.getItem(ACHIEVE_PASSWORD_SESSION_KEY))

  if (!unlocked) {
    return <AchievePasswordGate onUnlock={password => {
      sessionStorage.setItem(ACHIEVE_PASSWORD_SESSION_KEY, password)
      setUnlocked(true)
    }} />
  }

  return <AchieveReviewQueue />
}

function AchievePasswordGate({ onUnlock }: { onUnlock: (password: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password || checking) return
    setChecking(true)
    setError('')
    try {
      await unlockAchievePortal(password)
      onUnlock(password)
    } catch (cause: unknown) {
      if (cause instanceof AchievePortalRequestError && cause.code === 'invalid_password') {
        setError('Incorrect password.')
      } else if (cause instanceof AchievePortalRequestError && cause.code === 'not_configured') {
        setError('Portal access is not available yet. Contact your administrator.')
      } else {
        setError('The portal service could not load the call list. Try again.')
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Achieve / FDR</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Achieve welcome-call review</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Review Pennie-agent feedback, representative patterns, and welcome-call QA evidence. Enter the portal password to continue.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="achieve-password">
              Portal password
            </label>
            <input
              id="achieve-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  )
}

function AchieveReviewQueue() {
  const [activeView, setActiveView] = useState<'agent-feedback' | 'qa-matching'>('agent-feedback')
  const [activeTab, setActiveTab] = useState<'overview' | 'alerts' | 'all-calls' | 'backfill-audit'>('overview')
  const [elementFilter, setElementFilter] = useState<string | null>(null)
  const [feedbackFilters, setFeedbackFilters] = useState<AchieveAnalyticsFilters>(EMPTY_ACHIEVE_FILTERS)
  const [feedbackExceptionsRequested, setFeedbackExceptionsRequested] = useState(false)
  const portalQuery = useQuery({
    queryKey: ACHIEVE_LIST_QUERY_KEY,
    queryFn: fetchAchievePortalData,
    enabled: activeView === 'qa-matching',
    staleTime: 60_000,
  })
  const feedbackDashboardQuery = useQuery({
    queryKey: ACHIEVE_FEEDBACK_QUERY_KEY,
    queryFn: fetchAchieveFeedbackDashboard,
    staleTime: 60_000,
  })
  const auditQuery = useQuery({
    queryKey: ['achieve-portal-audit'],
    queryFn: fetchAchieveAuditData,
    enabled: activeTab === 'backfill-audit',
    staleTime: 60_000,
  })
  const feedbackExceptionsQuery = useQuery({
    queryKey: ['achieve-portal-feedback-exceptions'],
    queryFn: fetchAchieveFeedbackExceptions,
    enabled: feedbackExceptionsRequested,
    staleTime: 60_000,
  })

  const alerts = useMemo(() => portalQuery.data?.alerts ?? [], [portalQuery.data])
  const allCalls = useMemo(() => portalQuery.data?.allCalls ?? [], [portalQuery.data])
  const backfillAudit = useMemo(() => auditQuery.data?.rows ?? [], [auditQuery.data])
  const trueQaAbsentAgentFeedback = useMemo(() => feedbackExceptionsQuery.data?.trueQaAbsentAgentFeedback ?? [], [feedbackExceptionsQuery.data])
  const unresolvedAgentFeedback = useMemo(() => feedbackExceptionsQuery.data?.unresolvedAgentFeedback ?? [], [feedbackExceptionsQuery.data])
  const needsReview = useMemo(() => alerts.filter(row => !row.is_reviewed), [alerts])
  const feedbackFilteredAllCalls = useMemo(
    () => filterAchieveRows(allCalls, feedbackFilters),
    [allCalls, feedbackFilters],
  )
  const feedbackFilteredAlerts = useMemo(
    () => filterAchieveRows(needsReview, feedbackFilters),
    [needsReview, feedbackFilters],
  )
  const analytics = useMemo(
    () => summarizeAchieveAnalytics(feedbackFilteredAllCalls),
    [feedbackFilteredAllCalls],
  )
  const trends = useMemo(
    () => buildAchieveTrends(feedbackFilteredAllCalls),
    [feedbackFilteredAllCalls],
  )
  const filteredAlerts = useMemo(
    () => elementFilter
      ? feedbackFilteredAlerts.filter(row => missingElementsForRow(row).some(element => element.key === elementFilter))
      : feedbackFilteredAlerts,
    [elementFilter, feedbackFilteredAlerts],
  )
  const filteredAllCalls = useMemo(
    () => elementFilter
      ? feedbackFilteredAllCalls.filter(row => missingElementsForRow(row).some(element => element.key === elementFilter))
      : feedbackFilteredAllCalls,
    [elementFilter, feedbackFilteredAllCalls],
  )
  const isFetching = activeView === 'agent-feedback'
    ? feedbackDashboardQuery.isFetching
    : portalQuery.isFetching
  const isFeedbackFiltered = feedbackFilters.accent
    || feedbackFilters.backgroundNoise
    || feedbackFilters.connectionIssue
    || feedbackFilters.rating !== null

  const refresh = () => {
    if (activeView === 'agent-feedback') {
      void feedbackDashboardQuery.refetch()
      return
    }
    void portalQuery.refetch()
  }

  return (
    <main className="min-h-screen overflow-x-clip bg-slate-50 px-3 py-5 text-slate-950 sm:px-6 sm:py-8">
      <div className="mx-auto min-w-0 max-w-[1600px] space-y-5 sm:space-y-6">
        <header className="grid min-w-0 gap-5 border-b border-slate-200 pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Achieve / FDR</p>
            <h1 className="mt-2 min-w-0 [overflow-wrap:anywhere] text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              {activeView === 'agent-feedback' ? 'WC Agent Summary' : 'Welcome-call QA & matching'}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {activeView === 'agent-feedback'
                ? 'Separate Form observations and AI QA, with exact Achieve representative attribution and call-level alignment.'
                : 'Operational Eavesly AI QA, call review, matching exceptions, and historical backfill evidence.'}
            </p>
          </div>
          <div className="flex items-center justify-end gap-3">
            {activeView === 'qa-matching' && (
              <p className="text-xs leading-5 text-slate-500">
                {`${analytics.loadedCalls} loaded ${analytics.loadedCalls === 1 ? 'call' : 'calls'}${
                  isFeedbackFiltered ? ' after filtering' : ''
                }${!isFeedbackFiltered && portalQuery.data ? ` of ${portalQuery.data.coverage.total} total` : ''}${
                  portalQuery.data?.coverage.capReached ? ` · capped at ${portalQuery.data.coverage.cap}` : ''
                }`}
              </p>
            )}
            <button
              type="button"
              onClick={refresh}
              className="inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <RefreshCcw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </header>

        <nav aria-label="Achieve portal views" className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:inline-grid sm:w-auto">
          <button
            type="button"
            aria-pressed={activeView === 'agent-feedback'}
            onClick={() => setActiveView('agent-feedback')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
              activeView === 'agent-feedback' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
            }`}
          >
            WC Agent Summary
          </button>
          <button
            type="button"
            aria-pressed={activeView === 'qa-matching'}
            onClick={() => setActiveView('qa-matching')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
              activeView === 'qa-matching' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
            }`}
          >
            QA &amp; Matching
          </button>
        </nav>

        {activeView === 'agent-feedback' ? (
          feedbackDashboardQuery.isError ? (
            <ErrorState
              title="Could not load Pennie agent feedback"
              message="The complete Form aggregate or representative rollup could not be loaded. Retry without relying on the capped QA call list."
              onRetry={() => { void feedbackDashboardQuery.refetch() }}
            />
          ) : feedbackDashboardQuery.isPending ? (
            <AchieveRowsSkeleton />
          ) : (
            <AchieveFeedbackOverview
              dashboard={feedbackDashboardQuery.data}
              onOpenQaMatching={() => setActiveView('qa-matching')}
            />
          )
        ) : (
          <>
        <AchieveFilterBar filters={feedbackFilters} onChange={setFeedbackFilters} />

        <Tabs
          value={activeTab}
          onValueChange={value => setActiveTab(value as 'overview' | 'alerts' | 'all-calls' | 'backfill-audit')}
          className="min-w-0"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-white p-1 shadow-sm sm:inline-grid sm:w-auto sm:grid-cols-4">
            <TabsTrigger className="min-h-9 whitespace-nowrap px-2 text-xs sm:px-3 sm:text-sm" value="overview">Overview</TabsTrigger>
            <TabsTrigger className="min-h-9 whitespace-nowrap px-2 text-xs sm:px-3 sm:text-sm" value="alerts">Needs review ({filteredAlerts.length})</TabsTrigger>
            <TabsTrigger className="min-h-9 whitespace-nowrap px-2 text-xs sm:px-3 sm:text-sm" value="all-calls">All calls ({filteredAllCalls.length})</TabsTrigger>
            <TabsTrigger className="min-h-9 whitespace-nowrap px-2 text-xs sm:px-3 sm:text-sm" value="backfill-audit">Backfill audit{auditQuery.data ? ` (${backfillAudit.length} of ${auditQuery.data.coverage.total})` : ''}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            {portalQuery.isError ? (
              <ErrorState title="Could not load Achieve overview" message="Retry after confirming the Achieve portal service is reachable." onRetry={refresh} />
            ) : portalQuery.isPending ? (
              <AchieveRowsSkeleton />
            ) : (
              <AchieveOverview
                summary={analytics}
                trends={trends}
                selectedElement={elementFilter}
                onSelectElement={setElementFilter}
              />
            )}
          </TabsContent>

          <TabsContent value="alerts" className="mt-4">
            <AchieveRowsState
              rows={filteredAlerts}
              mode="review"
              isError={portalQuery.isError}
              isPending={portalQuery.isPending}
              emptyMessage={elementFilter || isFeedbackFiltered
                ? 'No currently available recent calls in this tab match the active filters.'
                : 'No unreviewed failed checks appear among the recent calls currently available.'}
              onRetry={refresh}
            />
          </TabsContent>
          <TabsContent value="all-calls" className="mt-4">
            <AchieveRowsState
              rows={filteredAllCalls}
              mode="history"
              isError={portalQuery.isError}
              isPending={portalQuery.isPending}
              emptyMessage={elementFilter || isFeedbackFiltered
                ? 'No currently available recent calls in this tab match the active filters.'
                : 'No calls appear in the currently loaded window.'}
              onRetry={refresh}
            />
          </TabsContent>
          <TabsContent value="backfill-audit" className="mt-4">
            <AchieveRowsState
              rows={backfillAudit}
              mode="audit"
              isError={auditQuery.isError}
              isPending={auditQuery.isPending || auditQuery.isFetching}
              emptyMessage="No audit-only rows appear in the loaded audit view."
              onRetry={() => { void auditQuery.refetch() }}
            />
          </TabsContent>
        </Tabs>

        {elementFilter && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <p className="min-w-0">Normal call lists are constrained to the selected missed script element.</p>
            <button type="button" onClick={() => setElementFilter(null)} className="shrink-0 whitespace-nowrap font-semibold text-blue-800 hover:text-blue-950">
              Clear element
            </button>
          </div>
        )}

        {!feedbackExceptionsRequested && (
          <button
            type="button"
            onClick={() => setFeedbackExceptionsRequested(true)}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-100"
          >
            Load feedback match audit
          </button>
        )}
        {feedbackExceptionsRequested && feedbackExceptionsQuery.isPending && <AchieveRowsSkeleton />}
        {feedbackExceptionsQuery.isError && (
          <ErrorState title="Could not load feedback exceptions" message="Retry to load the capped read-only exception lists." onRetry={() => { void feedbackExceptionsQuery.refetch() }} />
        )}
        {feedbackExceptionsQuery.data && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Feedback association audit</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Exact totals. Inferred associations are placed with matched QA but retain method, confidence, and evidence.
              Audit-only feedback stays read-only in Backfill audit and is excluded from ordinary metrics.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-5">
              {[
                ['Deterministic matched', feedbackExceptionsQuery.data.totals.deterministicMatched],
                ['Inferred matched', feedbackExceptionsQuery.data.totals.inferredMatched],
                ['Audit QA available', feedbackExceptionsQuery.data.totals.auditQaAvailable],
                ['True QA absent', feedbackExceptionsQuery.data.totals.trueQaAbsent],
                ['Unresolved', feedbackExceptionsQuery.data.totals.unresolved],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-950">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {trueQaAbsentAgentFeedback.length > 0 && (
          <details className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-slate-950">
              Call associated · Achieve QA truly absent ({trueQaAbsentAgentFeedback.length} loaded of {feedbackExceptionsQuery.data?.trueQaAbsentCoverage.total ?? trueQaAbsentAgentFeedback.length})
            </summary>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              An exact call association exists, but neither ordinary nor audit-only Achieve QA exists for that call.
              These submissions stay visible without entering QA metrics or Needs review.
            </p>
            {feedbackExceptionsQuery.data?.trueQaAbsentCoverage.capReached && (
              <p className="mt-1 text-xs font-semibold text-amber-800">List capped at {feedbackExceptionsQuery.data.limitPerList}; the exact total is shown above.</p>
            )}
            <div className="mt-4 space-y-3">
              {trueQaAbsentAgentFeedback.map(item => (
                <AgentFeedbackCard key={item.id} item={item} showPhone />
              ))}
            </div>
          </details>
        )}

        {unresolvedAgentFeedback.length > 0 && (
          <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-slate-950">
              Unresolved feedback ({unresolvedAgentFeedback.length} loaded of {feedbackExceptionsQuery.data?.unresolvedCoverage.total ?? unresolvedAgentFeedback.length})
            </summary>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Form submissions that could not be associated strongly enough with an Eavesly call. Invalid-phone
              submissions are never resolved through broad agent/time scans.
            </p>
            {feedbackExceptionsQuery.data?.unresolvedCoverage.capReached && (
              <p className="mt-1 text-xs font-semibold text-slate-700">List capped at {feedbackExceptionsQuery.data.limitPerList}; the exact total is shown above.</p>
            )}
            <div className="mt-4 space-y-3">
              {unresolvedAgentFeedback.map(item => (
                <AgentFeedbackCard key={item.id} item={item} showPhone />
              ))}
            </div>
          </details>
        )}
          </>
        )}
      </div>
    </main>
  )
}

function AchieveRowsState({
  rows,
  mode,
  isError,
  isPending,
  emptyMessage,
  onRetry,
}: {
  rows: AchieveRow[]
  mode: 'review' | 'history' | 'audit'
  isError: boolean
  isPending: boolean
  emptyMessage: string
  onRetry: () => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<AchieveRow | null>(null)
  const [visibleCount, setVisibleCount] = useState(50)
  const detailQuery = useQuery({
    queryKey: ['achieve-portal-detail', selected?.module_result_id],
    queryFn: () => fetchAchievePortalDetail(selected?.module_result_id ?? 0),
    enabled: selected !== null,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (selected && !rows.some(row => rowKey(row) === rowKey(selected))) {
      setSelected(null)
    }
  }, [rows, selected])

  useEffect(() => {
    setVisibleCount(50)
  }, [rows, mode])

  const refreshAfterFeedback = () => {
    void queryClient.invalidateQueries({ queryKey: ACHIEVE_LIST_QUERY_KEY })
    if (selected) {
      void queryClient.invalidateQueries({ queryKey: ['achieve-portal-detail', selected.module_result_id] })
    }
  }

  if (isError) {
    return <ErrorState title="Could not load Achieve QA rows" message="Retry after confirming the Achieve portal service is reachable." onRetry={onRetry} />
  }
  if (isPending) {
    return <AchieveRowsSkeleton />
  }
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 shadow-sm">{emptyMessage}</div>
  }

  const title = mode === 'review'
    ? 'Needs review'
    : mode === 'audit'
      ? 'Backfill audit'
      : 'Loaded calls'
  const description = mode === 'review'
    ? 'Only failed checks appear here. Open a row to review the reason and supporting evidence.'
    : mode === 'audit'
      ? 'Historical audit-only backfills are read-only, isolated here, and never affect normal metrics or review queues.'
      : 'Passed, failed, and not-graded calls from the loaded window. Passed calls do not require human review.'

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.slice(0, visibleCount).map(row => (
            <AchieveQueueRow
              key={rowKey(row)}
              row={row}
              mode={mode}
              onSelect={() => setSelected(row)}
            />
          ))}
        </div>
        {visibleCount < rows.length && (
          <div className="border-t border-slate-200 p-4 text-center">
            <button
              type="button"
              onClick={() => setVisibleCount(count => Math.min(count + 50, rows.length))}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              Load 50 more ({rows.length - visibleCount} loaded rows remaining)
            </button>
          </div>
        )}
      </section>

      <Sheet open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-slate-50 p-0 sm:max-w-2xl lg:max-w-3xl">
          {selected && (
            <>
              <SheetHeader className="space-y-1 border-b border-slate-200 bg-white px-6 py-5 text-left">
                <SheetTitle className="text-base font-semibold leading-6 text-slate-950">
                  {detailQuery.data?.contact_name || selected.contact_name || 'Unknown contact'}
                </SheetTitle>
                <p className="text-sm text-slate-600">
                  {detailQuery.data?.contact_phone || selected.contact_phone || 'No phone on file'} · {formatDateTime(selected.alert_created_at)}
                </p>
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">Achieve report agent: </span>
                  {detailQuery.data?.achieve_agent_name ?? selected.achieve_agent_name ?? 'Not matched'}
                  {(detailQuery.data?.achieve_agent_email ?? selected.achieve_agent_email) && (
                    <span className="text-slate-500"> · {detailQuery.data?.achieve_agent_email ?? selected.achieve_agent_email}</span>
                  )}
                </p>
                <p className="break-all font-mono text-xs text-slate-400">Call ID {selected.call_id || '—'}</p>
              </SheetHeader>
              <div className="p-6">
                {detailQuery.isPending || detailQuery.isFetching ? (
                  <AchieveRowsSkeleton />
                ) : detailQuery.isError || !detailQuery.data ? (
                  <ErrorState
                    title="Could not load call details"
                    message="The call list is still available. Retry this drawer without reloading the page."
                    onRetry={() => { void detailQuery.refetch() }}
                  />
                ) : (
                  <AchieveAlertDetails alert={detailQuery.data} mode={mode} onFeedbackSubmitted={refreshAfterFeedback} />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function AchieveQueueRow({ row, mode, onSelect }: { row: AchieveRow; mode: 'review' | 'history' | 'audit'; onSelect: () => void }) {
  const result = row.result_json ?? {}
  const adherence = result.script_adherence ?? {}
  const confidence = result.assessment_confidence ?? {}
  const missingEls = missingElementsForRow(row)
  const transferExperience = parseTransferExperience(result.transfer_experience)
  const hasPoorTransfer = transferExperience?.poorTransfer === true
  // Skipped rows have no segment; pre-hardening fallback rows were graded on the
  // full transcript and may reference non-Achieve content. Neither should show an
  // adherence/gap verdict to the partner.
  const skipped = !!result.grading_skipped
  const fallbackWithheld = result.transcript_segment?.used_full_transcript_fallback === true

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.85fr)_minmax(0,0.75fr)_2rem] md:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold leading-5 text-slate-950">{row.contact_name || 'Unknown contact'}</span>
            <ResultPill alert={row} />
            {mode === 'review' && <AlertStatusPill reviewed={row.is_reviewed} />}
            <AgentFeedbackPill feedback={row.agent_feedback} />
          </div>
          <div className="text-xs leading-5 text-slate-500">
            {row.contact_phone || 'No phone on file'} · {formatDateTime(row.alert_created_at)}
          </div>
          <div className={`text-xs font-semibold leading-5 ${row.achieve_agent_name ? 'text-blue-700' : 'text-slate-400'}`}>
            Achieve report agent: {row.achieve_agent_name ?? 'Not matched'}
          </div>
          <div className="break-all font-mono text-[11px] leading-4 text-slate-400">Call ID {row.call_id || '—'}</div>
        </div>
        <div className="text-sm text-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Confidence</div>
          <div>{confidenceSummary(confidence)}</div>
        </div>
        <div className="text-sm text-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Result</div>
          {skipped ? (
            <div className="text-slate-500">Not graded — no welcome-call segment</div>
          ) : fallbackWithheld ? (
            <div className="text-slate-500">Not graded — details withheld</div>
          ) : hasPoorTransfer && transferExperience ? (
            <div className="space-y-1.5">
              <span>{adherence.overall_script_adherence ?? 'Unknown'}</span>
              {adherence.violation === true && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">Script issue</span>
                  {missingEls.slice(0, 2).map(el => (
                    <span key={el.key} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">{el.label}</span>
                  ))}
                  {missingEls.length > 2 && <span className="text-[11px] font-semibold text-red-700">+{missingEls.length - 2} more</span>}
                </div>
              )}
              {adherence.violation === true && missingEls.length === 0 && typeof adherence.violation_reason === 'string' && (
                <div className="line-clamp-1 text-xs text-red-700">
                  Script: {firstSentence(humanizeElementKeys(adherence.violation_reason, result.script_version))}
                </div>
              )}
              <div className="flex flex-wrap items-start gap-1.5">
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Poor transfer</span>
                <span className="line-clamp-2 text-xs text-amber-900">{transferExperienceSummary(transferExperience)}</span>
              </div>
            </div>
          ) : !row.has_violation ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>{adherence.overall_script_adherence ?? 'Unknown'}</span>
              <span className="text-slate-500">No gaps noted</span>
            </div>
          ) : missingEls.length > 0 ? (
            <div className="space-y-1">
              <span>{adherence.overall_script_adherence ?? 'Unknown'}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {missingEls.slice(0, 2).map(el => (
                  <span key={el.key} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">{el.label}</span>
                ))}
                {missingEls.length > 2 && <span className="text-[11px] font-semibold text-red-700">+{missingEls.length - 2} more</span>}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <span>{adherence.overall_script_adherence ?? 'Unknown'}</span>
              {adherence.violation_reason && (
                <div className="line-clamp-1 text-xs text-red-700">
                  {firstSentence(humanizeElementKeys(adherence.violation_reason, result.script_version))}
                </div>
              )}
            </div>
          )}
        </div>
        <ChevronRight className="hidden h-4 w-4 justify-self-end text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-700 md:block" />
      </div>
    </button>
  )
}

function AchieveRowsSkeleton() {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    </section>
  )
}

function ResultPill({ alert }: { alert: AlertWithFeedback }) {
  // Ungraded rows (no segment) and pre-hardening fallback rows (graded on the full
  // transcript, may reference non-Achieve content) have no trustworthy pass/fail
  // verdict — show a neutral badge instead of the misleading emerald "Pass" chip
  // (has_violation is false on skipped rows).
  if (alert.result_json?.grading_skipped || alert.result_json?.transcript_segment?.used_full_transcript_fallback === true) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Not graded</span>
  }
  const classes = alert.has_violation ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
  const label = alert.has_violation ? 'Failed check' : 'Pass'

  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>{label}</span>
}

// Small badge shown when one or more Pennie agents submitted form feedback
// about the welcome-call rep on this call.
function AgentFeedbackPill({ feedback }: { feedback?: AchieveAgentFeedback[] }) {
  if (!feedback || feedback.length === 0) return null
  const quality = worstAchieveAgentRating(feedback)
  const hasInferred = feedback.some(item => item.call_match_provenance === 'inferred')
  const hasAudit = feedback.some(item => item.qa_match_status === 'qa_audit')
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${agentQualityTone(quality)}`}>
      Pennie agent: {quality ?? 'feedback'}{feedback.length > 1 ? ` ×${feedback.length}` : ''}
      {hasInferred ? ' · inferred match' : ''}{hasAudit ? ' · audit only' : ''}
    </span>
  )
}

function AlertStatusPill({ reviewed }: { reviewed: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${reviewed ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>
      {reviewed ? 'Reviewed' : 'Needs review'}
    </span>
  )
}

function confidenceSummary(confidence: { level?: string; score?: number }) {
  const pct = typeof confidence.score === 'number' ? `${Math.round(confidence.score * 100)}%` : null
  if (confidence.level && pct) return `${confidence.level} · ${pct}`
  return confidence.level ?? pct ?? '—'
}

function rowKey(row: AlertWithFeedback) {
  return `${row.module_result_id}:${row.call_id}:${row.module_name}`
}

// Group the checklist rows under their script section so Achieve managers read
// the call against their own script structure (Introduction → Three keys to
// success → Dashboard & tools → Closing). Known sections come first in that
// canonical order; any others (e.g. v0's "Program") follow in first-appearance
// order. Empty sections are skipped.
function groupChecklistBySection(rows: ChecklistRow[]): { section: string; rows: ChecklistRow[] }[] {
  const bySection = new Map<string, ChecklistRow[]>()
  for (const row of rows) {
    const bucket = bySection.get(row.section)
    if (bucket) bucket.push(row)
    else bySection.set(row.section, [row])
  }
  const ordered = [
    ...ACHIEVE_SECTION_ORDER.filter(section => bySection.has(section)),
    ...Array.from(bySection.keys()).filter(section => !ACHIEVE_SECTION_ORDER.includes(section)),
  ]
  return ordered.map(section => ({ section, rows: bySection.get(section)! }))
}

function achieveSkipReasonDetail(reason: unknown): string {
  switch (reason) {
    case 'transfer_leg_too_short':
      return 'The handoff was attempted, but the advocate never joined.'
    case 'no_live_welcome_agent':
      return 'The transfer contained automated audio, but no live welcome-call representative joined.'
    case 'non_welcome_transfer':
      return 'The transfer reached a servicing or customer-service interaction, not a welcome call.'
    case 'welcome_call_not_started':
      return 'A welcome-call representative joined, but the client-facing welcome call did not begin.'
    case 'unbounded_label_less':
      return 'A live welcome call was detected, but its transcript boundary was not reliable enough to share or grade.'
    case 'no_transfer_leg':
      return 'The call did not reach the welcome-call handoff.'
    default:
      return 'No gradeable live welcome-call interaction was found.'
  }
}

function AchieveAlertDetails({
  alert,
  mode,
  onFeedbackSubmitted,
}: {
  alert: AchieveRow
  mode: 'review' | 'history' | 'audit'
  onFeedbackSubmitted: () => void
}) {
  const result = alert.result_json ?? {}

  // Skipped rows carry no script_adherence and must never render as a pass/fail
  // verdict or checklist — short-circuit before any of that logic runs. Keep the
  // reviewer feedback form so these rows can still be marked reviewed and leave
  // the Needs-review queue.
  if (result.grading_skipped) {
    return (
      <article className="space-y-5">
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Not graded — {achieveSkipReasonDetail(result.skip_reason)}
        </p>
        <AgentFeedbackSection feedback={alert.agent_feedback} />
        {mode !== 'audit' && (
          <DrawerSection title="Reviewer feedback" description="Capture whether the QA result is useful/correct and what should happen next.">
            <AchieveFeedbackForm alert={alert} onSubmitted={onFeedbackSubmitted} />
          </DrawerSection>
        )}
      </article>
    )
  }

  // Pre-hardening rows were graded on the FULL transcript (used_full_transcript_fallback),
  // so their free-text fields (quotes, violation reason, notes, summary) can reference
  // Pennie-internal content. Withhold all of it before any of that logic runs, but keep
  // the reviewer feedback form so these rows can still be marked reviewed.
  if (result.transcript_segment?.used_full_transcript_fallback === true) {
    return (
      <article className="space-y-5">
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Details withheld — this call was graded on an unreliable transcript segment
          before segmentation hardening, and its details may reference non-Achieve content.
        </p>
        <AgentFeedbackSection feedback={alert.agent_feedback} />
        {mode !== 'audit' && (
          <DrawerSection title="Reviewer feedback" description="Capture whether the QA result is useful/correct and what should happen next.">
            <AchieveFeedbackForm alert={alert} onSubmitted={onFeedbackSubmitted} />
          </DrawerSection>
        )}
      </article>
    )
  }

  const adherence = result.script_adherence ?? {}
  const transferExperience = parseTransferExperience(result.transfer_experience)
  const hasPoorTransfer = transferExperience?.poorTransfer === true
  const scriptViolation = adherence.violation === true
  const quotes = Array.isArray(adherence.key_evidence_quotes) ? adherence.key_evidence_quotes.slice(0, 5) : []
  const confidence = result.assessment_confidence ?? {}
  const confidencePct = typeof confidence.score === 'number' ? `${Math.round(confidence.score * 100)}%` : null
  const limitations = Array.isArray(confidence.limitations)
    ? confidence.limitations.filter((l): l is string => typeof l === 'string')
    : []
  const hasConfidence = !!(confidence.level || confidencePct || confidence.rationale || limitations.length)
  const transcript = trimmedTranscript(alert)
  const checklist = deriveChecklist(adherence, result.script_version)
  const checklistSections = groupChecklistBySection(checklist.rows)
  const missingCount = checklist.total - checklist.coveredCount
  let verdict: string
  if (hasPoorTransfer && scriptViolation) {
    verdict = missingCount > 0
      ? `Flagged — ${missingCount} of ${checklist.total} required script elements were missing, and the handoff/transfer experience failed.`
      : 'Flagged — both the required script check and the handoff/transfer experience failed.'
  } else if (hasPoorTransfer) {
    verdict = missingCount === 0
      ? 'Flagged — the required script was completed, but the handoff/transfer experience failed.'
      : 'Flagged — the handoff/transfer experience failed; the script check itself was not marked as failed.'
  } else {
    verdict = alert.has_violation
      ? missingCount > 0
        ? `Flagged — ${missingCount} of ${checklist.total} required script elements were missing.`
        : 'Flagged by the QA checker.'
      : 'Passed — all required script elements were covered.'
  }

  return (
    <article className="space-y-5">
      <DrawerSection title="Call summary">
        <div className="flex flex-wrap items-center gap-2">
          <ResultPill alert={alert} />
          {mode === 'review' && (
            <span className="inline-flex items-center gap-1">
              <AlertStatusPill reviewed={alert.is_reviewed} />
              <Hint title={ACHIEVE_TERMS.needs_review.label} body={ACHIEVE_TERMS.needs_review.definition} />
            </span>
          )}
          {confidence.level && (
            <span className="inline-flex items-center gap-1">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${confidenceTone(confidence.level)}`}>
                Confidence {confidence.level}{confidencePct ? ` · ${confidencePct}` : ''}
              </span>
              <Hint title={ACHIEVE_TERMS.confidence.label} body={ACHIEVE_TERMS.confidence.definition} />
            </span>
          )}
        </div>
        <p className={`mt-3 text-sm font-semibold ${alert.has_violation ? 'text-red-700' : 'text-emerald-700'}`}>
          {verdict}
        </p>
        {alert.has_violation && adherence.violation_reason && (!hasPoorTransfer || scriptViolation) && (
          <p className="mt-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm leading-6 text-red-900">
            {humanizeElementKeys(adherence.violation_reason, result.script_version)}
          </p>
        )}
        {alert.call_summary && <p className="mt-3 text-sm leading-6 text-slate-700">{alert.call_summary}</p>}
        <p className="mt-3 text-sm text-slate-700">
          <span className="text-slate-500">Overall: </span>
          {adherenceLabel(adherence.overall_script_adherence)}
          <span className="ml-1 inline-flex align-middle">
            <Hint title={ACHIEVE_TERMS.script_adherence.label} body={ACHIEVE_TERMS.script_adherence.definition} />
          </span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {alert.recording_link && <ExternalLinkButton href={alert.recording_link} label="Recording" />}
        </div>
      </DrawerSection>

      {hasPoorTransfer && transferExperience && (
        <TransferExperienceSection transfer={transferExperience} />
      )}

      <AgentFeedbackSection feedback={alert.agent_feedback} />

      <DrawerSection
        title="What happened on this call"
        description="Each required welcome-call element and whether the agent covered it."
      >
        <div className="mb-3 text-xs font-semibold text-slate-500">
          {checklist.coveredCount} / {checklist.total} covered
        </div>
        {missingCount > 0 && (
          <div className="mb-3 text-sm font-medium text-red-700">
            Missing: {checklist.rows.filter(r => !r.isCovered).map(r => r.label).join(', ')}
          </div>
        )}
        <div className="space-y-4">
          {checklistSections.map(section => (
            <div key={section.section}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {section.section}
              </h4>
              <ul className="space-y-2">
                {section.rows.map(row => (
                  <li key={row.key} className="flex items-center gap-2 text-sm">
                    {row.isCovered ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                    )}
                    <span className={row.isCovered ? 'text-slate-800' : 'font-medium text-slate-900'}>{row.label}</span>
                    <span className="sr-only">{row.isCovered ? 'covered' : 'missing'}</span>
                    <Hint title={row.label} body={row.definition} />
                    {!row.isCovered && <span className="ml-auto text-xs font-semibold text-red-700">missing</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection
        title="Supporting quotes"
        description="Evidence snippets used by the checker."
        hint={{ title: ACHIEVE_TERMS.supporting_quotes.label, body: ACHIEVE_TERMS.supporting_quotes.definition }}
      >
        {quotes.length ? (
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {quotes.map((quote, index) => <li key={index}>{quote}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No supporting quotes captured yet.</p>
        )}
      </DrawerSection>

      {hasConfidence && (
        <DrawerSection
          title="Scoring confidence"
          hint={{ title: ACHIEVE_TERMS.confidence.label, body: ACHIEVE_TERMS.confidence.definition }}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
            <Row label="Level" value={confidence.level ?? '—'} />
            <Row label="Score" value={confidencePct ?? '—'} />
            <Row label="Rationale" value={confidence.rationale ?? '—'} />
            {limitations.length > 0 && <Row label="Limitations" value={limitations.join('; ')} />}
          </dl>
        </DrawerSection>
      )}

      <DrawerSection title="Trimmed transcript" description="Raw transcript from the graded Achieve/FDR segment.">
        {transcript ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs leading-5 text-slate-800">
            {transcript}
          </pre>
        ) : (
          <p className="text-sm text-slate-500">Transcript withheld — no reliable Achieve/FDR segment boundary for this call.</p>
        )}
      </DrawerSection>

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-950">Key terms</summary>
        <dl className="mt-4 space-y-3 text-sm">
          {[...ACHIEVE_ELEMENTS, ...Object.values(ACHIEVE_TERMS)].map(term => (
            <div key={term.label}>
              <dt className="font-medium text-slate-900">{term.label}</dt>
              <dd className="text-slate-600">{term.definition}</dd>
            </div>
          ))}
        </dl>
      </details>

      {mode !== 'audit' && (
        <DrawerSection title="Reviewer feedback" description="Capture whether the QA result is useful/correct and what should happen next.">
          <AchieveFeedbackForm alert={alert} onSubmitted={onFeedbackSubmitted} />
        </DrawerSection>
      )}
    </article>
  )
}

// What the Pennie agent said about the Achieve welcome-call rep on this call.
// Rendered only when at least one form submission matched the call.
function AgentFeedbackSection({ feedback }: { feedback?: AchieveAgentFeedback[] }) {
  if (!feedback || feedback.length === 0) return null
  return (
    <DrawerSection
      title="Pennie agent feedback"
      description="Submitted by the Pennie agent who transferred the client and observed the welcome call. Not all calls receive a submission."
    >
      <div className="space-y-3">
        {feedback.map(item => (
          <AgentFeedbackCard key={item.id} item={item} />
        ))}
      </div>
    </DrawerSection>
  )
}

function AgentFeedbackCard({ item, showPhone = false }: { item: AchieveAgentFeedback; showPhone?: boolean }) {
  const matchReason = callMatchReasonLabel(item.call_match_reason)
  const matchMethod = callMatchMethodLabel(item.call_match_method)
  const evidence = item.call_match_evidence ?? null
  const flags = [
    item.accent === true ? 'Accent' : null,
    item.background_noise === true ? 'Background noise' : null,
    item.connection_issues === true ? 'Connection issues' : null,
  ].filter((f): f is string => f !== null)

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {item.qa_match_status === 'qa_absent' && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
            Call associated · QA truly absent
          </span>
        )}
        {item.qa_match_status === 'qa_audit' && (
          <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-900">
            Audit-only QA · read-only
          </span>
        )}
        {item.call_match_provenance && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.call_match_provenance === 'inferred' ? 'bg-blue-100 text-blue-900' : 'bg-slate-200 text-slate-800'}`}>
            {item.call_match_provenance === 'inferred' ? 'Inferred match' : 'Deterministic match'}
            {item.call_match_confidence === 'high' ? ' · high confidence' : ''}
          </span>
        )}
        {item.call_quality && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${agentQualityTone(item.call_quality)}`}>
            {item.call_quality}
          </span>
        )}
        {flags.map(flag => (
          <span key={flag} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">{flag}</span>
        ))}
        {item.achieve_agent_name && (
          <span className="text-xs text-slate-600">Rep entered on form: <span className="font-semibold text-slate-800">{item.achieve_agent_name}</span></span>
        )}
      </div>
      {showPhone && item.lead_phone_raw && (
        <p className="mt-2 font-mono text-xs text-slate-500">Client phone (as entered): {item.lead_phone_raw}</p>
      )}
      {(matchMethod || matchReason) && (
        <div className="mt-2 text-xs leading-5 text-slate-600">
          {matchMethod && <p><span className="font-semibold text-slate-700">Match method:</span> {matchMethod}</p>}
          {matchReason && <p>{matchReason}</p>}
        </div>
      )}
      {evidence && Object.keys(evidence).length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">Association evidence</summary>
          <dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(10rem,auto)_1fr]">
            {Object.entries(evidence).map(([key, value]) => (
              <div key={key} className="contents">
                <dt>{key.replace(/_/g, ' ')}</dt>
                <dd className="font-mono text-slate-700">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {item.notes && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.notes}</p>}
      <p className="mt-2 text-xs text-slate-500">
        {item.submitted_by ? `Submitted by ${item.submitted_by}` : 'Submitter not recorded'} · {formatDateTime(item.submitted_at)}
      </p>
    </div>
  )
}

function TransferExperienceSection({ transfer }: { transfer: TransferExperience }) {
  const reasons = transfer.reasons.length > 0
    ? transfer.reasons.map(humanizeTransferReason)
    : [transferExperienceSummary(transfer)]
  const evidence = transfer.evidence.slice(0, 4)

  return (
    <DrawerSection
      title="Transfer experience"
      description="Handoff quality is evaluated separately from completion of the required welcome-call script."
    >
      <div className="space-y-5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why it failed</h4>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-700">
            {reasons.map((reason, index) => <li key={`${reason}:${index}`}>{reason}</li>)}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live-agent attempts</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Agent names are transcribed from audio (ASR), so spelling may be approximate.
          </p>
          {transfer.agentAttempts.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {transfer.agentAttempts.map((attempt, index) => (
                <li key={`${attempt.line}:${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">
                    {attempt.nameAsr ? `Name heard as “${attempt.nameAsr}”` : 'Agent name not captured'}
                  </p>
                  <blockquote className="mt-1 text-sm leading-6 text-slate-600">“{attempt.quote}”</blockquote>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No live-agent attempt names were captured.</p>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Partner-leg evidence</h4>
          {evidence.length > 0 ? (
            <>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                {evidence.map((item, index) => <li key={`${item.line}:${index}`}>“{item.quote}”</li>)}
              </ul>
              {transfer.evidence.length > evidence.length && (
                <p className="mt-2 text-xs text-slate-500">
                  {transfer.evidence.length - evidence.length} additional evidence {transfer.evidence.length - evidence.length === 1 ? 'quote' : 'quotes'} not shown.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No transfer evidence quotes were captured.</p>
          )}
        </div>
      </div>
    </DrawerSection>
  )
}

function Hint({ title, body }: { title: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What does "${title}" mean?`}
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center align-middle text-slate-400 transition-colors hover:text-blue-700"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm leading-snug" onClick={e => e.stopPropagation()}>
        <p className="mb-1 font-semibold text-slate-900">{title}</p>
        <p className="text-slate-600">{body}</p>
      </PopoverContent>
    </Popover>
  )
}

function DrawerSection({
  title,
  description,
  hint,
  children,
}: {
  title: string
  description?: string
  hint?: { title: string; body: string }
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          {hint && <Hint title={hint.title} body={hint.body} />}
        </div>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function AchieveFeedbackForm({ alert, onSubmitted }: { alert: AchieveRow; onSubmitted: () => void }) {
  const [reviewerEmail, setReviewerEmail] = useState(alert.feedback_by ?? '')
  const [accurate, setAccurate] = useState<boolean | null>(alert.accurate)
  const [action, setAction] = useState<AlertActionTaken | ''>(alert.action_taken ?? '')
  const [reason, setReason] = useState<AlertInaccuracyReason | ''>(alert.inaccuracy_reason ?? '')
  const [comment, setComment] = useState(alert.feedback_comment ?? '')
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setReviewerEmail(alert.feedback_by ?? '')
    setAccurate(alert.accurate)
    setAction(alert.action_taken ?? '')
    setReason(alert.inaccuracy_reason ?? '')
    setComment(alert.feedback_comment ?? '')
    setStatus(null)
  }, [alert.call_id, alert.module_name, alert.feedback_by, alert.accurate, alert.action_taken, alert.inaccuracy_reason, alert.feedback_comment])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const email = reviewerEmail.trim()
    if (!email) {
      setStatus('Add your reviewer email before saving feedback.')
      return
    }
    if (accurate === null) {
      setStatus('Choose whether the QA result looks correct.')
      return
    }
    setSubmitting(true)
    setStatus(null)
    const res = await submitAchieveReviewFeedback({
      call_id: alert.call_id,
      reviewer_email: email,
      accurate,
      action_taken: accurate ? (action || 'no_action_needed') : null,
      inaccuracy_reason: accurate ? null : (reason || 'other'),
      comment,
    })
    setSubmitting(false)
    if (!res.ok) {
      setStatus(`Could not save feedback: ${res.error}`)
      return
    }
    setStatus('Feedback saved.')
    onSubmitted()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {alert.reviewed_at && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Last feedback: {alert.accurate === false ? 'Needs correction' : 'Looks correct'} by {alert.feedback_by ?? 'unknown'} on {formatDateTime(alert.reviewed_at)}.
        </div>
      )}

      <label className="block text-sm font-medium text-slate-700">
        Reviewer email
        <input
          type="email"
          value={reviewerEmail}
          onChange={event => setReviewerEmail(event.target.value)}
          placeholder="name@example.com"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">QA result</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`rounded-xl border p-3 text-sm ${accurate === true ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
            <input className="mr-2" type="radio" checked={accurate === true} onChange={() => setAccurate(true)} />
            Looks correct/useful
          </label>
          <label className={`rounded-xl border p-3 text-sm ${accurate === false ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <input className="mr-2" type="radio" checked={accurate === false} onChange={() => setAccurate(false)} />
            Needs correction
          </label>
        </div>
      </fieldset>

      {accurate === true && (
        <label className="block text-sm font-medium text-slate-700">
          Action taken
          <select value={action} onChange={event => setAction(event.target.value as AlertActionTaken)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Choose an action…</option>
            {ACTION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}

      {accurate === false && (
        <label className="block text-sm font-medium text-slate-700">
          Correction reason
          <select value={reason} onChange={event => setReason(event.target.value as AlertInaccuracyReason)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Choose a reason…</option>
            {INACCURACY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}

      <label className="block text-sm font-medium text-slate-700">
        Notes
        <textarea
          value={comment}
          onChange={event => setComment(event.target.value)}
          rows={4}
          placeholder="Add context for Pennie/Eavesly QA or the reviewer team…"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={submitting} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">
          {submitting ? 'Saving…' : 'Save feedback'}
        </button>
        {status && <p className="text-sm text-slate-600">{status}</p>}
      </div>
    </form>
  )
}

function trimmedTranscript(alert: AchieveRow) {
  // The achieve-portal edge function trims the transcript to the graded
  // segment server-side (and withholds it when the boundary is unreliable) —
  // the browser never receives the full transcript. Keep the client-side guard
  // anyway so a withheld/skipped row can never render transcript text.
  const result = alert.result_json ?? {}
  const seg = result.transcript_segment
  if (!seg || seg.used_full_transcript_fallback || result.grading_skipped || seg.segment_found === false) return ''
  return alert.trimmed_transcript?.trim() ?? ''
}

function confidenceTone(level: string) {
  const l = level.toLowerCase()
  if (l === 'high') return 'bg-emerald-100 text-emerald-800'
  if (l === 'low') return 'bg-red-100 text-red-800'
  return 'bg-amber-100 text-amber-800'
}

function Row({ label, value, hint }: { label: string; value: string; hint?: { title: string; body: string } }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-slate-500">
        {label}
        {hint && <Hint title={hint.title} body={hint.body} />}
      </dt>
      <dd className="min-w-0 break-words text-slate-800">{value}</dd>
    </>
  )
}

function ExternalLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  )
}
