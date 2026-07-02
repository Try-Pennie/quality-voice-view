import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, ExternalLink, HelpCircle, RefreshCcw, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ACHIEVE_ELEMENTS, ACHIEVE_TERMS, deriveChecklist } from '@/lib/achieve-checklist'
import { fetchAchieveAlerts, fetchAchieveAllCalls, submitAchieveReviewFeedback } from '@/lib/achieve-queries'
import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '@/types/database'
import { formatDateTime } from '@/lib/utils'
import { ErrorState } from '@/components/states/ErrorState'
import { PageHero, SupportingStat } from '@/components/PageHero'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const SESSION_KEY = 'achieve_portal_unlocked'
const configuredPassword = import.meta.env.VITE_ACHIEVE_PORTAL_PASSWORD as string | undefined

type AchieveRow = AlertWithFeedback & {
  original_transcript?: string | null
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
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === 'true')

  if (!unlocked) {
    return <AchievePasswordGate onUnlock={() => setUnlocked(true)} />
  }

  return <AchieveReviewQueue />
}

function AchievePasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const isConfigured = !!configuredPassword

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!isConfigured) {
      setError('Portal access is not available yet. Contact your administrator.')
      return
    }
    if (password !== configuredPassword) {
      setError('Incorrect password.')
      return
    }
    sessionStorage.setItem(SESSION_KEY, 'true')
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
            disabled={!isConfigured}
          >
            Continue
          </button>
        </form>
        {!isConfigured && (
          <p className="mt-4 text-xs leading-5 text-slate-400">
            Admin setup: set <code className="font-mono">VITE_ACHIEVE_PORTAL_PASSWORD</code> to enable access.
          </p>
        )}
      </section>
    </main>
  )
}

function AchieveReviewQueue() {
  const [activeTab, setActiveTab] = useState<'alerts' | 'all-calls'>('alerts')
  const alertsQuery = useQuery({
    queryKey: ['achieve-alerts'],
    queryFn: () => fetchAchieveAlerts(),
    staleTime: 60_000,
  })
  const allCallsQuery = useQuery({
    queryKey: ['achieve-all-calls'],
    queryFn: () => fetchAchieveAllCalls(),
    staleTime: 60_000,
  })

  const alerts = useMemo(() => alertsQuery.data ?? [], [alertsQuery.data])
  const allCalls = useMemo(() => allCallsQuery.data ?? [], [allCallsQuery.data])
  const allStats = useMemo(() => summarize(allCalls), [allCalls])
  const isFetching = alertsQuery.isFetching || allCallsQuery.isFetching

  const refresh = () => {
    void alertsQuery.refetch()
    void allCallsQuery.refetch()
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
            stats={
              <>
                <SupportingStat label="Scored calls" value={allStats.total} />
                <SupportingStat label="Failed checks" value={allStats.flagged} />
                <SupportingStat label="Pass rate" value={allStats.total === 0 ? '—' : `${Math.round(((allStats.total - allStats.flagged) / allStats.total) * 100)}%`} />
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

        <Tabs value={activeTab} onValueChange={value => setActiveTab(value as 'alerts' | 'all-calls')}>
          <TabsList className="bg-white shadow-sm">
            <TabsTrigger value="alerts">Needs review ({alerts.length})</TabsTrigger>
            <TabsTrigger value="all-calls">All calls ({allCalls.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="alerts" className="mt-4">
            <AchieveRowsState
              rows={alerts}
              mode="review"
              isError={alertsQuery.isError}
              isPending={alertsQuery.isPending}
              emptyMessage="No failed Achieve checks need human review. Passed calls are available under All calls."
              onRetry={() => alertsQuery.refetch()}
            />
          </TabsContent>
          <TabsContent value="all-calls" className="mt-4">
            <AchieveRowsState
              rows={allCalls}
              mode="history"
              isError={allCallsQuery.isError}
              isPending={allCallsQuery.isPending}
              emptyMessage="No scored Achieve calls yet."
              onRetry={() => allCallsQuery.refetch()}
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
    return <ErrorState title="Could not load Achieve QA rows" message="Retry after confirming Supabase/RLS access for this scaffold." onRetry={onRetry} />
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
  const missing = Array.isArray(adherence.missing_elements) ? adherence.missing_elements : []
  const gapLabel = missing.length === 0 ? 'No gaps noted' : `${missing.length} gap${missing.length === 1 ? '' : 's'} noted`

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.85fr)_minmax(0,0.75fr)_2rem] md:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-sm font-semibold leading-5 text-slate-950">{row.call_id || '—'}</span>
            <ResultPill alert={row} />
            {mode === 'review' && <AlertStatusPill reviewed={row.is_reviewed} />}
          </div>
          <div className="text-xs leading-5 text-slate-500">
            {formatDateTime(row.alert_created_at)} · {achieveNumberLabel(row)}
          </div>
        </div>
        <div className="text-sm text-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Confidence</div>
          <div>{confidenceSummary(confidence)}</div>
        </div>
        <div className="text-sm text-slate-700">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Result</div>
          <div className="flex flex-wrap gap-2">
            <span>{adherence.overall_script_adherence ?? 'Unknown'}</span>
            <span className={row.has_violation ? 'font-semibold text-red-700' : 'text-slate-500'}>{gapLabel}</span>
          </div>
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
  const adherence = result.script_adherence ?? {}
  const quotes = Array.isArray(adherence.key_evidence_quotes) ? adherence.key_evidence_quotes.slice(0, 5) : []
  const confidence = result.assessment_confidence ?? {}
  const confidencePct = typeof confidence.score === 'number' ? `${Math.round(confidence.score * 100)}%` : null
  const hasConfidence = !!(confidence.level || confidencePct || confidence.rationale)
  const transcript = trimmedTranscript(alert)
  const checklist = deriveChecklist(adherence)
  const verdict = alert.has_violation
    ? `Flagged — ${checklist.total - checklist.coveredCount} of ${checklist.total} required script elements were missing.`
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
        {alert.call_summary && <p className="mt-3 text-sm leading-6 text-slate-700">{alert.call_summary}</p>}
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
        <ul className="space-y-2">
          {checklist.rows.map(row => (
            <li key={row.key} className="flex items-center gap-2 text-sm">
              {row.isCovered ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <X className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              )}
              <span className={row.isCovered ? 'text-slate-800' : 'font-medium text-slate-900'}>{row.label}</span>
              <Hint title={row.label} body={row.definition} />
              {!row.isCovered && <span className="ml-auto text-xs font-semibold text-red-700">missing</span>}
            </li>
          ))}
        </ul>
      </DrawerSection>

      <DrawerSection title="QA result" description="What the checker found and why it scored the call this way.">
        <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
          <Row
            label="Overall"
            value={adherence.overall_script_adherence ?? '—'}
            hint={{ title: ACHIEVE_TERMS.script_adherence.label, body: ACHIEVE_TERMS.script_adherence.definition }}
          />
          <Row label="Why" value={adherence.violation_reason ?? '—'} />
        </dl>
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
          </dl>
        </DrawerSection>
      )}

      <DrawerSection title="Trimmed transcript" description="Raw transcript from the graded Achieve/FDR segment.">
        {transcript ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs leading-5 text-slate-800">
            {transcript}
          </pre>
        ) : (
          <p className="text-sm text-slate-500">No trimmed transcript is available for this row yet.</p>
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
      module_name: alert.module_name,
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
  const transcript = alert.original_transcript?.trim()
  if (!transcript) return ''
  const startLine = alert.result_json?.transcript_segment?.start_line
  const lines = transcript.split(/\r?\n/)
  if (typeof startLine !== 'number' || startLine <= 1) return transcript
  const from = Math.max(0, startLine - 1)
  return lines.slice(from).join('\n').trim() || transcript
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
  return {
    total: alerts.length,
    flagged: alerts.filter(alert => alert.has_violation).length,
    reviewed: alerts.filter(alert => alert.is_reviewed).length,
  }
}


function achieveNumberLabel(row: Pick<AchieveRow, 'contact_phone'>) {
  return row.contact_phone ? `Achieve number ${row.contact_phone}` : 'Achieve number unavailable'
}
