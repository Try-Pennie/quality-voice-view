import { useQuery } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type {
  AchieveRepresentativeFeedback,
  AchieveRepresentativeFeedbackDetail,
  AchieveRepresentativeFeedbackRating,
} from '@/lib/achieve-feedback-overview'
import {
  ACHIEVE_REPRESENTATIVE_FEEDBACK_QUERY_KEY,
  fetchAchieveRepresentativeFeedback,
} from '@/lib/achieve-queries'

const submittedDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const ratingContent: Readonly<Record<AchieveRepresentativeFeedbackRating, {
  label: string
  className: string
}>> = {
  good: { label: 'Good', className: 'bg-emerald-100 text-emerald-900' },
  fair: { label: 'Fair', className: 'bg-amber-100 text-amber-900' },
  poor: { label: 'Poor', className: 'bg-red-100 text-red-800' },
  other: { label: 'Other', className: 'bg-slate-100 text-slate-700' },
}

function FeedbackFlags({ detail }: { detail: AchieveRepresentativeFeedbackDetail }) {
  const flags = [
    detail.flags.backgroundNoise ? 'Background noise' : null,
    detail.flags.accent ? 'Accent / communication' : null,
    detail.flags.connectionIssues ? 'Connection issue' : null,
  ].filter((flag): flag is string => flag !== null)

  if (flags.length === 0) return null

  return (
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Reported conditions">
      {flags.map(flag => (
        <span key={flag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {flag}
        </span>
      ))}
    </div>
  )
}

function FeedbackCard({ detail }: { detail: AchieveRepresentativeFeedbackDetail }) {
  const rating = ratingContent[detail.rating]
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">
            {submittedDate.format(new Date(detail.submittedAt))} UTC
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Submitted by {detail.submittedBy ?? 'Pennie agent not recorded'}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${rating.className}`}>
          {rating.label}
        </span>
      </div>
      <FeedbackFlags detail={detail} />
      <p className={`mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 [overflow-wrap:anywhere] text-sm leading-6 ${
        detail.notes ? 'text-slate-800' : 'italic text-slate-500'
      }`}>
        {detail.notes ?? 'No written note was provided.'}
      </p>
    </article>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading representative feedback">
      {[0, 1, 2].map(item => (
        <div key={item} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      ))}
    </div>
  )
}

/** Lazily loaded individual Pennie feedback for one exact Achieve representative. */
export function AchieveRepresentativeFeedbackDrawer({ representative, onClose }: {
  representative: AchieveRepresentativeFeedback | null
  onClose: () => void
}) {
  const detailQuery = useQuery({
    queryKey: [...ACHIEVE_REPRESENTATIVE_FEEDBACK_QUERY_KEY, representative?.agentEmail],
    queryFn: () => fetchAchieveRepresentativeFeedback(representative?.agentEmail ?? ''),
    enabled: representative !== null,
    staleTime: 60_000,
  })

  return (
    <Sheet open={representative !== null} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-slate-50 p-0 sm:max-w-xl lg:max-w-2xl">
        {representative && (
          <>
            <SheetHeader className="border-b border-slate-200 bg-white px-5 py-5 text-left sm:px-6">
              <SheetTitle className="[overflow-wrap:anywhere] text-xl text-slate-950">
                Feedback for {representative.agentName}
              </SheetTitle>
              <SheetDescription className="text-left">
                <span className="block [overflow-wrap:anywhere] text-sm text-slate-500">{representative.agentEmail}</span>
                <span className="block pt-2 text-xs leading-5 text-slate-500">
                  Exact daily-report attribution. Phone and internal call identifiers are excluded.
                </span>
              </SheetDescription>
            </SheetHeader>

            <div className="p-4 sm:p-6">
              {detailQuery.isPending ? (
                <DetailSkeleton />
              ) : detailQuery.isError ? (
                <div className="rounded-2xl border border-red-200 bg-white p-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
                    <div>
                      <h3 className="font-semibold text-slate-950">Could not load detailed feedback</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">Retry the secure representative detail request.</p>
                      <button
                        type="button"
                        onClick={() => { void detailQuery.refetch() }}
                        className="mt-4 min-h-10 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                </div>
              ) : detailQuery.data.rows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600">
                  No exactly attributed submissions are currently available for this representative. Refresh the overview if the aggregate recently changed.
                </div>
              ) : (
                <>
                  <p className="mb-4 text-sm font-semibold text-slate-950">
                    {detailQuery.data.coverage.total} {detailQuery.data.coverage.total === 1 ? 'submission' : 'submissions'}
                  </p>
                  {detailQuery.data.coverage.capReached && (
                    <p className="mb-4 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
                      Showing {detailQuery.data.coverage.loaded} of {detailQuery.data.coverage.total} submissions.
                    </p>
                  )}
                  <div className="space-y-3">
                    {detailQuery.data.rows.map(detail => <FeedbackCard key={detail.id} detail={detail} />)}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
