import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ExternalLink, Lock, RefreshCcw, ShieldAlert } from 'lucide-react'
import { fetchAchieveAlerts, fetchAchieveAllCalls } from '@/lib/achieve-queries'
import type { AlertWithFeedback } from '@/types/database'
import { formatDateTime } from '@/lib/utils'
import { ErrorState } from '@/components/states/ErrorState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const SESSION_KEY = 'achieve_portal_unlocked'
const configuredPassword = import.meta.env.VITE_ACHIEVE_PORTAL_PASSWORD as string | undefined

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
      setError('Portal password is not configured. Set VITE_ACHIEVE_PORTAL_PASSWORD for this scaffold.')
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
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Achieve QA review</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Password-gated scaffold for Achieve/FDR welcome-call QA review. This route intentionally does not use Pennie Google OAuth.
        </p>
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
          Temporary gate: this Vite client-side password is for internal/demo validation only. External production access needs a server/API boundary before data access.
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-200" htmlFor="achieve-password">
            Portal password
          </label>
          <input
            id="achieve-password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-blue-500/40 focus:ring-2"
            autoComplete="current-password"
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!isConfigured}
          >
            Enter portal
          </button>
        </form>
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
  const activeRows = activeTab === 'alerts' ? alerts : allCalls
  const stats = useMemo(() => summarize(activeRows), [activeRows])
  const isFetching = alertsQuery.isFetching || allCallsQuery.isFetching

  const refresh = () => {
    void alertsQuery.refetch()
    void allCallsQuery.refetch()
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Achieve / FDR</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome-call QA review</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Review Achieve welcome calls. <strong>Alerts</strong> need a closer look; <strong>All calls</strong> shows every scored call.
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              <RefreshCcw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat label={activeTab === 'alerts' ? 'Alerts' : 'Calls'} value={stats.total} />
            <Stat label="Needs review" value={stats.flagged} tone="red" />
            <Stat label="Reviewed" value={stats.reviewed} tone="green" />
          </div>
        </header>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-none" />
            <p>These results are scoped to Achieve welcome-call QA and are separate from Pennie’s internal manager dashboards.</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={value => setActiveTab(value as 'alerts' | 'all-calls')}>
          <TabsList className="bg-white shadow-sm">
            <TabsTrigger value="alerts">Alerts ({alerts.length})</TabsTrigger>
            <TabsTrigger value="all-calls">All calls ({allCalls.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="alerts" className="mt-4">
            <AchieveRowsState
              rows={alerts}
              isError={alertsQuery.isError}
              isPending={alertsQuery.isPending}
              emptyMessage="No flagged Achieve alerts yet. Passed/non-alert calls are available under All calls."
              onRetry={() => alertsQuery.refetch()}
            />
          </TabsContent>
          <TabsContent value="all-calls" className="mt-4">
            <AchieveRowsState
              rows={allCalls}
              isError={allCallsQuery.isError}
              isPending={allCallsQuery.isPending}
              emptyMessage="No Achieve QA calls yet."
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
  isError,
  isPending,
  emptyMessage,
  onRetry,
}: {
  rows: AlertWithFeedback[]
  isError: boolean
  isPending: boolean
  emptyMessage: string
  onRetry: () => void
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedKey(null)
      return
    }
    if (!selectedKey || !rows.some(row => rowKey(row) === selectedKey)) {
      setSelectedKey(rowKey(rows[0]))
    }
  }, [rows, selectedKey])

  const selected = rows.find(row => rowKey(row) === selectedKey) ?? rows[0]

  if (isError) {
    return <ErrorState title="Could not load Achieve QA rows" message="Retry after confirming Supabase/RLS access for this scaffold." onRetry={onRetry} />
  }
  if (isPending) {
    return <AchieveRowsSkeleton />
  }
  if (rows.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">{emptyMessage}</div>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
      <section className="self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-950">Review queue</h2>
          <p className="mt-1 text-xs text-slate-500">Select a call to see what was covered, the supporting quotes, and scoring confidence.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map(row => (
            <AchieveQueueRow
              key={rowKey(row)}
              row={row}
              selected={rowKey(row) === rowKey(selected)}
              onSelect={() => setSelectedKey(rowKey(row))}
            />
          ))}
        </div>
      </section>

      {selected && (
        <div className="lg:sticky lg:top-6 self-start">
          <AchieveAlertDetails alert={selected} />
        </div>
      )}
    </div>
  )
}

function AchieveQueueRow({ row, selected, onSelect }: { row: AlertWithFeedback; selected: boolean; onSelect: () => void }) {
  const result = row.result_json ?? {}
  const adherence = result.script_adherence ?? {}
  const confidence = result.assessment_confidence ?? {}
  const missing = Array.isArray(adherence.missing_elements) ? adherence.missing_elements : []
  const gapLabel = missing.length === 0 ? 'No gaps' : `${missing.length} gap${missing.length === 1 ? '' : 's'}`

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-950">{redactId(row.call_id)}</span>
            <ResultPill alert={row} />
            <ReviewPill reviewed={row.is_reviewed} />
          </div>
          <div className="text-xs leading-5 text-slate-500">
            {formatDateTime(row.alert_created_at)} · Agent {redactEmail(row.agent_email)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>{confidenceSummary(confidence)}</span>
            <span aria-hidden="true">•</span>
            <span>{adherence.overall_script_adherence ?? 'Unknown adherence'}</span>
            <span aria-hidden="true">•</span>
            <span className={missing.length ? 'font-semibold text-amber-800' : 'text-slate-500'}>{gapLabel}</span>
          </div>
        </div>
        <ChevronRight className={`mt-1 h-4 w-4 flex-none text-slate-400 transition-transform ${selected ? 'translate-x-0.5 text-blue-700' : ''}`} />
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

function Stat({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'red' | 'green' }) {
  const color = tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-950'
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}

function ResultPill({ alert }: { alert: AlertWithFeedback }) {
  const result = alert.result_json ?? {}
  const adherence = result.script_adherence ?? {}
  const missing = Array.isArray(adherence.missing_elements) ? adherence.missing_elements : []
  const isPassWithGaps = !alert.has_violation && missing.length > 0
  const classes = alert.has_violation
    ? 'bg-red-100 text-red-800'
    : isPassWithGaps
      ? 'bg-amber-100 text-amber-800'
      : 'bg-emerald-100 text-emerald-800'
  const label = alert.has_violation ? 'Violation' : isPassWithGaps ? 'Pass with gaps' : 'Pass'

  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes}`}>{label}</span>
}

function ReviewPill({ reviewed }: { reviewed: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${reviewed ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'}`}>
      {reviewed ? 'Reviewed' : 'Unreviewed'}
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

function AchieveAlertDetails({ alert }: { alert: AlertWithFeedback }) {
  const result = alert.result_json ?? {}
  const adherence = result.script_adherence ?? {}
  const quotes = Array.isArray(adherence.key_evidence_quotes) ? adherence.key_evidence_quotes.slice(0, 3) : []
  const missing = Array.isArray(adherence.missing_elements) ? adherence.missing_elements : []

  const confidence = result.assessment_confidence ?? {}
  const limitations = Array.isArray(confidence.limitations) ? confidence.limitations : []
  const confidencePct = typeof confidence.score === 'number' ? `${Math.round(confidence.score * 100)}%` : null
  const hasConfidence = !!(confidence.level || confidencePct || confidence.rationale || limitations.length)

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ResultPill alert={alert} />
            <ReviewPill reviewed={alert.is_reviewed} />
            {confidence.level && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${confidenceTone(confidence.level)}`}>
                Confidence {confidence.level}{confidencePct ? ` · ${confidencePct}` : ''}
              </span>
            )}
          </div>
          <h2 className="mt-3 text-lg font-semibold">Call {redactId(alert.call_id)}</h2>
          <p className="mt-1 text-sm text-slate-600">{formatDateTime(alert.alert_created_at)} · Agent {redactEmail(alert.agent_email)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {alert.recording_link && <ExternalLinkButton href={alert.recording_link} label="Recording" />}
        </div>
      </div>

      {alert.call_summary && <p className="mt-4 text-sm leading-6 text-slate-700">{alert.call_summary}</p>}

      <div className="mt-4 grid gap-4">
        <section className="rounded-xl bg-slate-50 p-4">
          <h3 className="text-sm font-semibold">What was covered</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Overall" value={adherence.overall_script_adherence ?? '—'} />
            <Row label="Why" value={adherence.violation_reason ?? '—'} />
            <Row label="Gaps" value={missing.length ? missing.join(', ') : 'None listed'} />
          </dl>
        </section>
        <section className="rounded-xl bg-slate-50 p-4">
          <h3 className="text-sm font-semibold">Supporting quotes</h3>
          {quotes.length ? (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
              {quotes.map((quote, index) => <li key={index}>{quote}</li>)}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No supporting quotes captured yet.</p>
          )}
        </section>
      </div>

      {hasConfidence && (
        <section className="mt-4 rounded-xl bg-slate-50 p-4">
          <h3 className="text-sm font-semibold">Scoring confidence</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Level" value={confidence.level ?? '—'} />
            <Row label="Score" value={confidencePct ?? '—'} />
            <Row label="Rationale" value={confidence.rationale ?? '—'} />
          </dl>
          {limitations.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Limitations</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {limitations.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </>
          )}
        </section>
      )}
    </article>
  )
}

function confidenceTone(level: string) {
  const l = level.toLowerCase()
  if (l === 'high') return 'bg-emerald-100 text-emerald-800'
  if (l === 'low') return 'bg-red-100 text-red-800'
  return 'bg-amber-100 text-amber-800'
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 flex-none text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
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

function redactId(id: string) {
  if (!id) return '—'
  if (id.length <= 10) return id
  return `${id.slice(0, 4)}…${id.slice(-4)}`
}

function redactEmail(email: string | null) {
  if (!email) return '—'
  const [local, domain] = email.split('@')
  return `${local.slice(0, 2)}…@${domain ?? 'unknown'}`
}
