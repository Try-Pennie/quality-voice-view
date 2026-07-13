import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, ExternalLink, HelpCircle, RefreshCcw, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ACHIEVE_ELEMENTS, ACHIEVE_SECTION_ORDER, ACHIEVE_TERMS, adherenceLabel, deriveChecklist, humanizeElementKeys, type ChecklistRow } from '@/lib/achieve-checklist'
import { ACHIEVE_PASSWORD_SESSION_KEY, fetchAchievePortalData, submitAchieveReviewFeedback, verifyAchievePortalPassword, type AchievePortalRow } from '@/lib/achieve-queries'
import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '@/types/database'
import { formatDateTime } from '@/lib/utils'
import { ErrorState } from '@/components/states/ErrorState'
import { PageHero, SupportingStat } from '@/components/PageHero'
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
    return <AchievePasswordGate onUnlock={() => setUnlocked(true)} />
  }

  return <AchieveReviewQueue />
}

function AchievePasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password || checking) return
    setChecking(true)
    setError('')
    // The server validates the password; sessionStorage only caches it so each
    // subsequent data request can send it along without re-prompting.
    const result = await verifyAchievePortalPassword(password)
    setChecking(false)
    if (!result.ok) {
      setError(result.error ?? 'Could not verify the password.')
      return
    }
    sessionStorage.setItem(ACHIEVE_PASSWORD_SESSION_KEY, password)
    onUnlock()
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Achieve / FDR</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Achieve QA review</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Review welcome-call QA results and transcript evidence. Enter the portal password to continue.
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
  const [activeTab, setActiveTab] = useState<'alerts' | 'all-calls'>('alerts')
  const [elementFilter, setElementFilter] = useState<string | null>(null)
  const portalQuery = useQuery({
    queryKey: ['achieve-portal-data'],
    queryFn: fetchAchievePortalData,
    staleTime: 60_000,
  })

  const alerts = useMemo(() => portalQuery.data?.alerts ?? [], [portalQuery.data])
  const allCalls = useMemo(() => portalQuery.data?.allCalls ?? [], [portalQuery.data])
  const allStats = useMemo(() => summarize(allCalls), [allCalls])
  const isFetching = portalQuery.isFetching

  // Which script elements are most often missed across failed checks, so a
  // reviewer can see the top failure modes and click one to filter the queues.
  const elementTally = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>()
    for (const row of allCalls) {
      if (!row.has_violation) continue
      for (const el of missingElementsForRow(row)) {
        const existing = counts.get(el.key)
        if (existing) existing.count += 1
        else counts.set(el.key, { key: el.key, label: el.label, count: 1 })
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count)
  }, [allCalls])

  const filteredAlerts = useMemo(
    () => (elementFilter ? alerts.filter(row => missingElementsForRow(row).some(el => el.key === elementFilter)) : alerts),
    [alerts, elementFilter],
  )
  const filteredAllCalls = useMemo(
    () => (elementFilter ? allCalls.filter(row => missingElementsForRow(row).some(el => el.key === elementFilter)) : allCalls),
    [allCalls, elementFilter],
  )

  const refresh = () => {
    void portalQuery.refetch()
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-6 sm:space-y-8">
        <div className="flex items-start justify-between gap-4">
          <PageHero
            label="Achieve / FDR"
            headline="Welcome-call QA review"
            description={
              <>
                Failed checks appear in <strong>Needs review</strong>. Passed calls are kept in <strong>All calls</strong> for audit/history.
              </>
            }
            statsCols={allStats.notGraded > 0 ? 'grid-cols-2 sm:grid-cols-4' : undefined}
            stats={
              <>
                <SupportingStat label="Scored calls" value={allStats.total} />
                <SupportingStat label="Failed checks" value={allStats.flagged} />
                <SupportingStat label="Pass rate" value={allStats.total === 0 ? '—' : `${Math.round(((allStats.total - allStats.flagged) / allStats.total) * 100)}%`} />
                {allStats.notGraded > 0 && <SupportingStat label="Not graded" value={allStats.notGraded} />}
              </>
            }
          />
          <button
            type="button"
            onClick={refresh}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <RefreshCcw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {elementTally.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">What's failing</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Script elements missed across failed checks. Select one to filter the lists below.
                </p>
              </div>
              {elementFilter && (
                <button
                  type="button"
                  onClick={() => setElementFilter(null)}
                  className="shrink-0 text-sm font-semibold text-blue-700 hover:text-blue-800"
                >
                  Clear filter
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {elementTally.map(el => {
                const active = elementFilter === el.key
                return (
                  <button
                    key={el.key}
                    type="button"
                    onClick={() => setElementFilter(active ? null : el.key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${active ? 'bg-slate-900 text-white' : 'bg-red-50 text-red-800 hover:bg-red-100'}`}
                  >
                    {el.label} · {el.count}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <Tabs value={activeTab} onValueChange={value => setActiveTab(value as 'alerts' | 'all-calls')}>
          <TabsList className="bg-white shadow-sm">
            <TabsTrigger value="alerts">Needs review ({filteredAlerts.length})</TabsTrigger>
            <TabsTrigger value="all-calls">All calls ({filteredAllCalls.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="alerts" className="mt-4">
            <AchieveRowsState
              rows={filteredAlerts}
              mode="review"
              isError={portalQuery.isError}
              isPending={portalQuery.isPending}
              emptyMessage={elementFilter
                ? 'No calls in this tab are missing the selected element.'
                : 'No failed Achieve checks need human review. Passed calls are available under All calls.'}
              onRetry={refresh}
            />
          </TabsContent>
          <TabsContent value="all-calls" className="mt-4">
            <AchieveRowsState
              rows={filteredAllCalls}
              mode="history"
              isError={portalQuery.isError}
              isPending={portalQuery.isPending}
              emptyMessage={elementFilter
                ? 'No calls in this tab are missing the selected element.'
                : 'No scored Achieve calls yet.'}
              onRetry={refresh}
            />
          </TabsContent>
        </Tabs>
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
  mode: 'review' | 'history'
  isError: boolean
  isPending: boolean
  emptyMessage: string
  onRetry: () => void
}) {
  const [selected, setSelected] = useState<AchieveRow | null>(null)

  useEffect(() => {
    if (selected && !rows.some(row => rowKey(row) === rowKey(selected))) {
      setSelected(null)
    }
  }, [rows, selected])

  if (isError) {
    return <ErrorState title="Could not load Achieve QA rows" message="Retry after confirming the Achieve portal service is reachable." onRetry={onRetry} />
  }
  if (isPending) {
    return <AchieveRowsSkeleton />
  }
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 shadow-sm">{emptyMessage}</div>
  }

  const title = mode === 'review' ? 'Needs review' : 'All scored calls'
  const description = mode === 'review'
    ? 'Only failed checks appear here. Open a row to review the reason and supporting evidence.'
    : 'Passed and failed calls are listed for audit/history. Passed calls do not require human review.'

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map(row => (
            <AchieveQueueRow
              key={rowKey(row)}
              row={row}
              mode={mode}
              onSelect={() => setSelected(row)}
            />
          ))}
        </div>
      </section>

      <Sheet open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-slate-50 p-0 sm:max-w-2xl lg:max-w-3xl">
          {selected && (
            <>
              <SheetHeader className="space-y-1 border-b border-slate-200 bg-white px-6 py-5 text-left">
                <SheetTitle className="text-base font-semibold leading-6 text-slate-950">
                  {selected.contact_name || 'Unknown contact'}
                </SheetTitle>
                <p className="text-sm text-slate-600">
                  {selected.contact_phone || 'No phone on file'} · {formatDateTime(selected.alert_created_at)}
                </p>
                <p className="break-all font-mono text-xs text-slate-400">Call ID {selected.call_id || '—'}</p>
              </SheetHeader>
              <div className="p-6">
                <AchieveAlertDetails alert={selected} mode={mode} onFeedbackSubmitted={onRetry} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function AchieveQueueRow({ row, mode, onSelect }: { row: AchieveRow; mode: 'review' | 'history'; onSelect: () => void }) {
  const result = row.result_json ?? {}
  const adherence = result.script_adherence ?? {}
  const confidence = result.assessment_confidence ?? {}
  const missingEls = missingElementsForRow(row)
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
          </div>
          <div className="text-xs leading-5 text-slate-500">
            {row.contact_phone || 'No phone on file'} · {formatDateTime(row.alert_created_at)}
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
  mode: 'review' | 'history'
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
        <DrawerSection title="Reviewer feedback" description="Capture whether the QA result is useful/correct and what should happen next.">
          <AchieveFeedbackForm alert={alert} onSubmitted={onFeedbackSubmitted} />
        </DrawerSection>
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
        <DrawerSection title="Reviewer feedback" description="Capture whether the QA result is useful/correct and what should happen next.">
          <AchieveFeedbackForm alert={alert} onSubmitted={onFeedbackSubmitted} />
        </DrawerSection>
      </article>
    )
  }

  const adherence = result.script_adherence ?? {}
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
  const verdict = alert.has_violation
    ? missingCount > 0
      ? `Flagged — ${missingCount} of ${checklist.total} required script elements were missing.`
      : 'Flagged by the QA checker.'
    : 'Passed — all required script elements were covered.'

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
        {alert.has_violation && adherence.violation_reason && (
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

      <DrawerSection title="Reviewer feedback" description="Capture whether the QA result is useful/correct and what should happen next.">
        <AchieveFeedbackForm alert={alert} onSubmitted={onFeedbackSubmitted} />
      </DrawerSection>
    </article>
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

function summarize(alerts: AlertWithFeedback[]) {
  // Ungraded rows (grading_skipped) and pre-hardening fallback rows
  // (used_full_transcript_fallback, badged "Not graded / details withheld" elsewhere
  // on this page) carry no trustworthy pass/fail verdict — counting them would
  // inflate "Scored calls" and the pass rate shown to the partner.
  const scored = alerts.filter(
    alert =>
      !alert.result_json?.grading_skipped &&
      alert.result_json?.transcript_segment?.used_full_transcript_fallback !== true,
  )
  return {
    total: scored.length,
    flagged: scored.filter(alert => alert.has_violation).length,
    reviewed: scored.filter(alert => alert.is_reviewed).length,
    notGraded: alerts.length - scored.length,
  }
}
