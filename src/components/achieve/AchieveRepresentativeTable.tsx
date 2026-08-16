import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { AchieveRepresentativeFeedbackDrawer } from '@/components/achieve/AchieveRepresentativeFeedbackDrawer'
import {
  achieveRepresentativeReviewStatus,
  filterAchieveRepresentatives,
  type AchieveRepresentativeCoverage,
  type AchieveRepresentativeFeedback,
  type AchieveRepresentativeReviewStatus,
} from '@/lib/achieve-feedback-overview'

const utcDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const statusContent: Readonly<Record<AchieveRepresentativeReviewStatus, { label: string; className: string }>> = {
  needs_review: { label: 'Needs review', className: 'bg-amber-100 text-amber-900' },
  below_threshold: { label: 'Below threshold', className: 'bg-emerald-100 text-emerald-900' },
  low_sample: { label: 'Low sample', className: 'bg-slate-100 text-slate-700' },
}

function ReviewStatus({ representative }: { representative: AchieveRepresentativeFeedback }) {
  const content = statusContent[achieveRepresentativeReviewStatus(representative)]
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${content.className}`}>
      {content.label}
    </span>
  )
}

function RatingCounts({ representative }: { representative: AchieveRepresentativeFeedback }) {
  return (
    <span className="whitespace-nowrap tabular-nums text-slate-600">
      <span className="text-emerald-800">{representative.ratings.good} G</span>
      {' · '}
      <span className="text-amber-800">{representative.ratings.fair} F</span>
      {' · '}
      <span className="text-red-700">{representative.ratings.poor} P</span>
    </span>
  )
}

/** Searchable, sample-aware exact Achieve-representative feedback rollup. */
export function AchieveRepresentativeTable({ representatives, coverage }: {
  representatives: ReadonlyArray<AchieveRepresentativeFeedback>
  coverage: AchieveRepresentativeCoverage
}) {
  const [search, setSearch] = useState('')
  const [minimumSampleOnly, setMinimumSampleOnly] = useState(true)
  const [selectedRepresentative, setSelectedRepresentative] = useState<AchieveRepresentativeFeedback | null>(null)
  const filtered = useMemo(
    () => filterAchieveRepresentatives(representatives, search, minimumSampleOnly),
    [representatives, search, minimumSampleOnly],
  )
  const sampleEligible = representatives.filter(representative => representative.totalSubmissions >= 5).length
  const needsReview = representatives.filter(
    representative => achieveRepresentativeReviewStatus(representative) === 'needs_review',
  ).length

  return (
    <>
      <section aria-labelledby="representative-review-heading" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 id="representative-review-heading" className="text-lg font-semibold text-slate-950">Feedback by Achieve representative</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              {needsReview} of {sampleEligible} representatives with 5+ submissions meet the proposed 25% Fair/Poor review threshold. Select one to review their submissions. This is a triage aid, not an employment recommendation.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_auto] lg:w-auto">
            <label className="relative min-w-0">
              <span className="sr-only">Search Achieve representatives</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search representative"
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
              />
            </label>
            <button
              type="button"
              aria-pressed={minimumSampleOnly}
              onClick={() => setMinimumSampleOnly(value => !value)}
              className={`min-h-11 whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                minimumSampleOnly
                  ? 'border-blue-700 bg-blue-50 text-blue-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Minimum sample: 5+
            </button>
          </div>
        </div>
        {coverage.capReached && (
          <p className="mt-3 text-xs font-semibold text-amber-800">
            Showing {coverage.loaded} of {coverage.total} representatives. Narrow the server query before drawing complete ranking conclusions.
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="p-6 text-sm leading-6 text-slate-600">
          No representatives match this search and sample filter. Clear the search or include low-sample representatives.
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Representative</th>
                  <th scope="col" className="px-3 py-3 text-right">Submissions</th>
                  <th scope="col" className="px-3 py-3">Good · Fair · Poor</th>
                  <th scope="col" className="px-3 py-3 text-right">Fair/Poor</th>
                  <th scope="col" className="px-3 py-3 text-right">Noise</th>
                  <th scope="col" className="px-3 py-3 text-right">Accent</th>
                  <th scope="col" className="px-3 py-3 text-right">Connection</th>
                  <th scope="col" className="px-3 py-3">Latest</th>
                  <th scope="col" className="px-5 py-3">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(representative => (
                  <tr
                    key={representative.agentEmail}
                    onClick={() => setSelectedRepresentative(representative)}
                    className="cursor-pointer align-middle transition-colors hover:bg-blue-50/40"
                  >
                    <th scope="row" className="p-0 font-semibold text-slate-950">
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation()
                          setSelectedRepresentative(representative)
                        }}
                        aria-label={`View individual feedback for ${representative.agentName}`}
                        className="group flex min-h-[4.75rem] w-full items-center justify-between gap-3 px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                      >
                        <span className="min-w-0">
                          <span className="block [overflow-wrap:anywhere] group-hover:text-blue-800">{representative.agentName}</span>
                          <span className="mt-0.5 block [overflow-wrap:anywhere] text-xs font-normal text-slate-500">{representative.agentEmail}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-700" aria-hidden="true" />
                      </button>
                    </th>
                    <td className="px-3 py-4 text-right font-semibold tabular-nums text-slate-950">{representative.totalSubmissions}</td>
                    <td className="px-3 py-4"><RatingCounts representative={representative} /></td>
                    <td className="px-3 py-4 text-right font-semibold tabular-nums text-slate-950">{representative.fairPoorRate.toFixed(1)}%</td>
                    <td className="px-3 py-4 text-right tabular-nums text-slate-700">{representative.flags.backgroundNoise}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-slate-700">{representative.flags.accent}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-slate-700">{representative.flags.connectionIssues}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-slate-600">{utcDate.format(new Date(representative.latestSubmittedAt))}</td>
                    <td className="px-5 py-4"><ReviewStatus representative={representative} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 md:hidden">
            {filtered.map(representative => (
              <button
                key={representative.agentEmail}
                type="button"
                onClick={() => setSelectedRepresentative(representative)}
                aria-label={`View individual feedback for ${representative.agentName}`}
                className="block w-full p-5 text-left outline-none transition-colors hover:bg-blue-50/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block [overflow-wrap:anywhere] text-base font-semibold text-slate-950">{representative.agentName}</span>
                    <p className="mt-0.5 [overflow-wrap:anywhere] text-xs text-slate-500">{representative.agentEmail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ReviewStatus representative={representative} />
                    <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Submissions</p>
                    <p className="mt-0.5 font-semibold tabular-nums text-slate-950">{representative.totalSubmissions}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Fair/Poor</p>
                    <p className="mt-0.5 font-semibold tabular-nums text-slate-950">{representative.fairPoorRate.toFixed(1)}%</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-slate-500">Rating mix</p>
                    <p className="mt-0.5"><RatingCounts representative={representative} /></p>
                  </div>
                  <div className="col-span-2 text-xs text-slate-600">
                    Noise {representative.flags.backgroundNoise} · Accent {representative.flags.accent} · Connection {representative.flags.connectionIssues}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
        <p className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">
          Showing {filtered.length} of {coverage.loaded} representatives.
        </p>
      </section>
      <AchieveRepresentativeFeedbackDrawer
        representative={selectedRepresentative}
        onClose={() => setSelectedRepresentative(null)}
      />
    </>
  )
}
