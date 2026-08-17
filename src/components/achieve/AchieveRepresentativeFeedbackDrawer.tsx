import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronRight } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type {
  AchieveRepresentativeFeedback,
  AchieveRepresentativeFeedbackDetail,
  AchieveRepresentativeFeedbackRating,
  AchieveRepresentativeQaSummary,
} from '@/lib/achieve-feedback-overview'
import {
  ACHIEVE_REPRESENTATIVE_FEEDBACK_QUERY_KEY,
  fetchAchievePortalDetail,
  fetchAchieveRepresentativeFeedback,
} from '@/lib/achieve-queries'

const submittedDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
})

const ratingContent: Readonly<Record<AchieveRepresentativeFeedbackRating, { label: string; className: string }>> = {
  good: { label: 'Good', className: 'bg-emerald-100 text-emerald-900' },
  fair: { label: 'Fair', className: 'bg-amber-100 text-amber-900' },
  poor: { label: 'Poor', className: 'bg-red-100 text-red-800' },
  other: { label: 'Other', className: 'bg-slate-100 text-slate-700' },
}

function FeedbackCard({ detail }: { detail: AchieveRepresentativeFeedbackDetail }) {
  const rating = ratingContent[detail.rating]
  const flags = [
    detail.flags.backgroundNoise ? 'Background noise' : null,
    detail.flags.accent ? 'Accent / communication' : null,
    detail.flags.connectionIssues ? 'Connection issue' : null,
  ].filter((flag): flag is string => flag !== null)
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{submittedDate.format(new Date(detail.submittedAt))} UTC</p>
          <p className="mt-1 text-xs text-slate-500">Submitted by {detail.submittedBy ?? 'Pennie agent not recorded'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${rating.className}`}>{rating.label}</span>
      </div>
      {flags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Reported conditions">
          {flags.map(flag => <span key={flag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{flag}</span>)}
        </div>
      )}
      <p className={`mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 [overflow-wrap:anywhere] text-sm leading-6 ${detail.notes ? 'text-slate-800' : 'italic text-slate-500'}`}>
        {detail.notes ?? 'No written note was provided.'}
      </p>
    </article>
  )
}

function QaSummaryButton({ summary, selected, onSelect }: {
  summary: AchieveRepresentativeQaSummary
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
    >
      <span>
        <span className="block text-sm font-semibold text-slate-950">{submittedDate.format(new Date(summary.gradedAt))} UTC</span>
        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${summary.outcome === 'pass' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-800'}`}>
          {summary.outcome === 'pass' ? 'Pass' : 'Flagged'}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  )
}

function DetailError({ retry }: { retry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-white p-4">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div>
          <p className="font-semibold text-slate-950">Could not load details</p>
          <button type="button" onClick={retry} className="mt-3 min-h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-blue-500">Retry</button>
        </div>
      </div>
    </div>
  )
}

function QaEvidence({ detail }: { detail: Awaited<ReturnType<typeof fetchAchievePortalDetail>> }) {
  const result = detail.result_json ?? {}
  const adherence = result.script_adherence ?? {}
  const confidence = result.assessment_confidence ?? {}
  const quotes = Array.isArray(adherence.key_evidence_quotes)
    ? adherence.key_evidence_quotes.filter((quote: unknown): quote is string => typeof quote === 'string')
    : []
  return (
    <article className="space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-950">Sanitized AI evidence</h4>
          <p className="mt-1 text-xs text-slate-500">Only the existing approved portal projection is shown.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${detail.has_violation ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-900'}`}>
          {detail.has_violation ? 'Flagged' : 'Pass'}
        </span>
      </div>
      {detail.call_summary && <p className="text-sm leading-6 text-slate-700">{detail.call_summary}</p>}
      {typeof adherence.violation_reason === 'string' && adherence.violation_reason && (
        <div><h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</h5><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{adherence.violation_reason}</p></div>
      )}
      {quotes.length > 0 && (
        <div><h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence quotes</h5><ul className="mt-2 space-y-2">{quotes.map((quote, index) => <li key={`${index}-${quote}`} className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">“{quote}”</li>)}</ul></div>
      )}
      {typeof confidence.rationale === 'string' && confidence.rationale && (
        <div><h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assessment rationale</h5><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{confidence.rationale}</p></div>
      )}
      <div>
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trimmed Achieve transcript</h5>
        {detail.trimmed_transcript ? (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 font-sans text-xs leading-5 text-slate-100 [overflow-wrap:anywhere]">{detail.trimmed_transcript}</pre>
        ) : <p className="mt-2 text-sm italic text-slate-500">No safely trimmed transcript is available.</p>}
      </div>
    </article>
  )
}

function DetailSkeleton() {
  return <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" aria-label="Loading representative detail" />
}

/** Lazily load Form notes, AI summaries, then selected sanitized AI evidence. */
export function AchieveRepresentativeFeedbackDrawer({ representative, onClose }: {
  representative: AchieveRepresentativeFeedback | null
  onClose: () => void
}) {
  const [selectedQa, setSelectedQa] = useState<AchieveRepresentativeQaSummary | null>(null)
  useEffect(() => setSelectedQa(null), [representative?.agentEmail])

  const detailQuery = useQuery({
    queryKey: [...ACHIEVE_REPRESENTATIVE_FEEDBACK_QUERY_KEY, representative?.agentEmail],
    queryFn: () => fetchAchieveRepresentativeFeedback(representative?.agentEmail ?? ''),
    enabled: representative !== null,
    staleTime: 60_000,
  })
  const qaDetailQuery = useQuery({
    queryKey: ['achieve-portal-detail', selectedQa?.moduleResultId],
    queryFn: () => fetchAchievePortalDetail(selectedQa?.moduleResultId ?? 0),
    enabled: selectedQa !== null,
    staleTime: 60_000,
  })

  return (
    <Sheet open={representative !== null} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-slate-50 p-0 sm:max-w-xl lg:max-w-3xl">
        {representative && (
          <>
            <SheetHeader className="border-b border-slate-200 bg-white px-5 py-5 text-left sm:px-6">
              <SheetTitle className="[overflow-wrap:anywhere] text-xl text-slate-950">WC Agent Summary for {representative.agentName}</SheetTitle>
              <SheetDescription className="text-left">
                <span className="block [overflow-wrap:anywhere] text-sm text-slate-500">{representative.agentEmail}</span>
                <span className="block pt-2 text-xs leading-5 text-slate-500">Exact Achieve-provided attribution. Phone and internal call identifiers are excluded.</span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-8 p-4 sm:p-6">
              {detailQuery.isPending ? <DetailSkeleton /> : detailQuery.isError ? (
                <DetailError retry={() => { void detailQuery.refetch() }} />
              ) : (
                <>
                  <section aria-labelledby="form-feedback-heading">
                    <h3 id="form-feedback-heading" className="text-base font-semibold text-slate-950">Form feedback · {detailQuery.data.coverage.total}</h3>
                    {detailQuery.data.coverage.capReached && <p className="mt-2 text-xs font-semibold text-amber-800">Showing {detailQuery.data.coverage.loaded} of {detailQuery.data.coverage.total} submissions.</p>}
                    {detailQuery.data.rows.length === 0 ? <p className="mt-3 rounded-xl bg-white p-4 text-sm text-slate-600">No Form submissions for this representative.</p> : <div className="mt-3 space-y-3">{detailQuery.data.rows.map(detail => <FeedbackCard key={detail.id} detail={detail} />)}</div>}
                  </section>

                  <section aria-labelledby="ai-calls-heading">
                    <h3 id="ai-calls-heading" className="text-base font-semibold text-slate-950">AI calls · {detailQuery.data.qaCoverage.total}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Select a call to load sanitized evidence and its trimmed Achieve transcript.</p>
                    {detailQuery.data.qaCoverage.capReached && <p className="mt-2 text-xs font-semibold text-amber-800">Showing {detailQuery.data.qaCoverage.loaded} of {detailQuery.data.qaCoverage.total} calls.</p>}
                    {detailQuery.data.qaRows.length === 0 ? <p className="mt-3 rounded-xl bg-white p-4 text-sm text-slate-600">No exactly attributed ordinary AI calls for this representative.</p> : (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {detailQuery.data.qaRows.map(summary => <QaSummaryButton key={summary.moduleResultId} summary={summary} selected={selectedQa?.moduleResultId === summary.moduleResultId} onSelect={() => setSelectedQa(summary)} />)}
                      </div>
                    )}
                    <div className="mt-4">
                      {selectedQa && (qaDetailQuery.isPending ? <DetailSkeleton /> : qaDetailQuery.isError ? <DetailError retry={() => { void qaDetailQuery.refetch() }} /> : <QaEvidence detail={qaDetailQuery.data} />)}
                    </div>
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
