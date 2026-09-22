import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchFullQaOccurrences, type FullQaFindingCategory } from '../../lib/full-qa-review'
import { formatDateTime } from '../../lib/utils'
import { ErrorState } from '../states/ErrorState'

const CATEGORY_LABELS: Record<FullQaFindingCategory, string> = {
  compliance: 'Compliance', customer_experience: 'Customer experience', sales_process: 'Sales process',
  program_expectations: 'Program expectations', severe_customer_mistreatment: 'Severe customer mistreatment',
}

interface Props {
  readonly agentEmail: string
  readonly startDate: Date
  readonly endDate: Date
  readonly enabled: boolean
}

function timingLabel(value: string) {
  if (value === 'after_recorded_coached_review') return 'After approved coaching linked to this category (review-date proxy)'
  if (value === 'before_or_same_as_recorded_coached_review') return 'Before or same as approved coaching linked to this category (review-date proxy)'
  if (value === 'no_prior_recorded_coaching') return 'No prior approved coaching linked to this category'
  return 'Timing unknown'
}

/** Complete approved/pending/uncertain Full QA finding recurrence for one agent and call window. */
export function AgentFullQaRecurrence({ agentEmail, startDate, endDate, enabled }: Props) {
  const query = useQuery({ queryKey: ['fullQaOccurrences', agentEmail, startDate.getTime(), endDate.getTime()],
    queryFn: () => fetchFullQaOccurrences(agentEmail, startDate, endDate), enabled })
  if (!enabled || query.isPending) return <section className="rounded-3xl bg-pennie-white p-5 shadow-resting"><h2 className="text-lg font-semibold text-pennie-navy">Approved Full QA recurrence</h2><p className="mt-2 text-sm text-muted-foreground">Loading complete occurrence rows…</p></section>
  if (query.isError) return <ErrorState title="Couldn't load Full QA recurrence" message="No sampled fallback is shown because recurrence must remain reconciliable." onRetry={() => query.refetch()} />
  const rows = query.data ?? []
  const confirmed = rows.filter(row => row.occurrenceKind === 'finding' && row.confirmed && row.category)
  const frequencies = Object.entries(CATEGORY_LABELS).map(([category, label]) => ({ category, label, count: confirmed.filter(row => row.category === category).length })).filter(row => row.count > 0)
  const other = rows.filter(row => !row.confirmed || row.occurrenceKind !== 'finding')
  return <section className="rounded-3xl bg-pennie-white p-5 shadow-resting space-y-4" aria-label="Approved Full QA recurrence">
    <div><h2 className="text-lg font-semibold text-pennie-navy">Approved Full QA recurrence</h2><p className="mt-1 text-xs text-pennie-graphite/70">Only explicit findings in the approved current structured revision count. Dismissed escalations may still contain approved real findings. Pending, disputed, uncertain, and legacy rows stay separate.</p><p className="mt-1 text-xs text-pennie-graphite/70">Coaching comparisons use approved reviews with issues linked to the same category. Call-level coaching without linked issues stays on the call review; it does not establish category-specific recurrence.</p></div>
    {frequencies.length ? <div className="flex flex-wrap gap-2">{frequencies.map(row => <span key={row.category} className="rounded-full bg-pennie-blue-light px-3 py-1.5 text-xs font-semibold text-pennie-navy">{row.label}: {row.count}</span>)}</div> : <p className="rounded-2xl bg-pennie-beige/60 p-3 text-sm text-pennie-graphite">No approved structured findings in this call-occurrence window.</p>}
    <div className="space-y-2"><h3 className="text-sm font-semibold text-pennie-navy">Confirmed occurrence rows ({confirmed.length})</h3>{confirmed.map(row => <article key={`${row.callId}-${row.findingId}`} className="rounded-2xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold text-pennie-navy">{row.category ? CATEGORY_LABELS[row.category] : 'Finding'}</p><Link to={`/dashboard/alerts/${encodeURIComponent(row.callId)}/full_qa`} className="text-xs font-semibold text-pennie-blue-deeper hover:underline">Open call review · listed revision {row.feedbackRevision}</Link></div>
      <p className="mt-1 text-pennie-graphite">{row.summary}</p><p className="mt-1 text-xs text-muted-foreground">Call: {row.callStartedAt ? formatDateTime(row.callStartedAt) : 'Missing — occurrence timing unknown'} · Review saved: {formatDateTime(row.reviewSavedAt)}</p>
      <p className="mt-1 text-xs font-semibold text-pennie-blue-deeper">{timingLabel(row.coachingTiming)}</p>
      {row.coachingReviewProxySavedAt && <p className="text-xs text-muted-foreground">Comparison proxy: {formatDateTime(row.coachingReviewProxySavedAt)}</p>}
      {row.actionTaken && <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">Action context</summary><p className="mt-1 text-xs text-pennie-graphite">{row.actionTaken.split('_').join(' ')} — {row.actionDetails}</p></details>}
    </article>)}</div>
    <div className="space-y-2"><h3 className="text-sm font-semibold text-pennie-navy">Not counted ({other.length})</h3>{other.map((row, index) => <article key={`${row.callId}-${row.occurrenceKind}-${row.findingId ?? row.criterionKey ?? index}`} className="rounded-2xl border border-dashed border-border p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{row.occurrenceKind === 'needs_context' ? `Needs context: ${row.criterionKey}` : row.occurrenceKind === 'legacy_unmapped' ? 'Legacy review — no criterion mapping' : row.category ? CATEGORY_LABELS[row.category] : 'Finding'}</p><span className="text-xs font-semibold uppercase text-muted-foreground">{row.status.split('_').join(' ')}</span></div>
      {(row.reason || row.summary) && <p className="mt-1 text-xs text-pennie-graphite">{row.reason ?? row.summary}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{row.callStartedAt ? formatDateTime(row.callStartedAt) : 'Call time missing; timing unknown'} · revision {row.feedbackRevision}</p>
    </article>)}</div>
  </section>
}
