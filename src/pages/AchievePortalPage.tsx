import { FormEvent, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Lock, RefreshCcw, ShieldAlert } from 'lucide-react'
import { fetchAchieveAlerts } from '@/lib/achieve-queries'
import type { AlertWithFeedback } from '@/types/database'
import { formatDateTime } from '@/lib/utils'
import { ErrorState } from '@/components/states/ErrorState'

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
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['achieve-alerts'],
    queryFn: () => fetchAchieveAlerts(),
    staleTime: 60_000,
  })
  const alerts = useMemo(() => data ?? [], [data])
  const stats = useMemo(() => summarize(alerts), [alerts])

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Achieve / FDR</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome-call QA review</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Partner-scoped scaffold for reviewing <code>achieve_welcome_call_qa</code> results. Upstream owns selecting the correct calls; this page only reads Achieve module rows.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              <RefreshCcw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Rows" value={stats.total} />
            <Stat label="Flagged" value={stats.flagged} tone="red" />
            <Stat label="Reviewed" value={stats.reviewed} tone="green" />
          </div>
        </header>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 flex-none" />
            <p>
              Pennie manager-facing dashboards hide Achieve alerts unless the user is super-admin/god-mode. This portal is separate from the Pennie manager dashboard.
            </p>
          </div>
        </div>

        {isError ? (
          <ErrorState title="Could not load Achieve QA rows" message="Retry after confirming Supabase/RLS access for this scaffold." onRetry={() => refetch()} />
        ) : isPending ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading Achieve QA rows…</div>
        ) : alerts.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">No Achieve QA rows yet.</div>
        ) : (
          <div className="grid gap-4">
            {alerts.map(alert => <AchieveAlertCard key={`${alert.call_id}:${alert.module_name}`} alert={alert} />)}
          </div>
        )}
      </div>
    </main>
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

function AchieveAlertCard({ alert }: { alert: AlertWithFeedback }) {
  const result = alert.result_json ?? {}
  const adherence = result.script_adherence ?? {}
  const quotes = Array.isArray(adherence.key_evidence_quotes) ? adherence.key_evidence_quotes.slice(0, 3) : []
  const missing = Array.isArray(adherence.missing_elements) ? adherence.missing_elements : []

  const confidence = result.assessment_confidence ?? {}
  const limitations = Array.isArray(confidence.limitations) ? confidence.limitations : []
  const confidencePct = typeof confidence.score === 'number' ? `${Math.round(confidence.score * 100)}%` : null
  const hasConfidence = !!(confidence.level || confidencePct || confidence.rationale || limitations.length)

  const segment = result.transcript_segment

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${alert.has_violation ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {alert.has_violation ? 'Flagged' : 'Passed'}
            </span>
            {alert.is_reviewed && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Reviewed</span>}
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

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl bg-slate-50 p-4">
          <h3 className="text-sm font-semibold">Script adherence</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Overall" value={adherence.overall_script_adherence ?? '—'} />
            <Row label="Violation reason" value={adherence.violation_reason ?? '—'} />
            <Row label="Missing" value={missing.length ? missing.join(', ') : 'None listed'} />
          </dl>
        </section>
        <section className="rounded-xl bg-slate-50 p-4">
          <h3 className="text-sm font-semibold">Evidence</h3>
          {quotes.length ? (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
              {quotes.map((quote, index) => <li key={index}>{quote}</li>)}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No evidence quotes captured yet.</p>
          )}
        </section>
      </div>

      {(hasConfidence || segment) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {hasConfidence && (
            <section className="rounded-xl bg-slate-50 p-4">
              <h3 className="text-sm font-semibold">Assessment confidence</h3>
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
          {segment && (
            <section className="rounded-xl bg-slate-50 p-4">
              <h3 className="text-sm font-semibold">Transcript segment</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Type" value={segment.segment_type ?? '—'} />
                <Row label="Start" value={startLabel(segment)} />
                <Row label="Marker" value={segment.marker ?? '—'} />
                <Row
                  label="Confidence"
                  value={segmentConfidenceLabel(segment)}
                />
              </dl>
              {segment.used_full_transcript_fallback && (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Segmentation failed — scored against the full transcript (fallback).
                </p>
              )}
            </section>
          )}
        </div>
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

// ponytail: support both start_line and start for older local demo bundles.
function startLabel(segment: { start_line?: number; start?: number }) {
  const start = segment.start_line ?? segment.start
  return typeof start === 'number' ? `Line ${start}` : '—'
}

function segmentConfidenceLabel(segment: { segmentation_confidence?: string; segmentation_score?: number; confidence?: number | string }) {
  if (segment.segmentation_confidence) {
    const score = typeof segment.segmentation_score === 'number' ? ` · ${Math.round(segment.segmentation_score * 100)}%` : ''
    return `${segment.segmentation_confidence}${score}`
  }
  if (typeof segment.confidence === 'number') return `${Math.round(segment.confidence * 100)}%`
  return segment.confidence ?? '—'
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
