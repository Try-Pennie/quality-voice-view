import { useMemo, useState } from 'react'
import { ArrowDown, ChevronRight, Search } from 'lucide-react'
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

const ratingTone: Readonly<Record<'good' | 'fair' | 'poor', string>> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
  fair: 'bg-amber-50 text-amber-800 ring-amber-100',
  poor: 'bg-red-50 text-red-700 ring-red-100',
}

function RatingValue({ value, tone }: { value: number; tone: keyof typeof ratingTone }) {
  return (
    <span className={`inline-flex min-h-8 min-w-9 items-center justify-center rounded-lg px-2 font-semibold tabular-nums ring-1 ring-inset ${ratingTone[tone]}`}>
      {value}
    </span>
  )
}

function ConditionValue({ value }: { value: number }) {
  return (
    <span className={`tabular-nums ${value === 0 ? 'text-slate-500' : 'font-semibold text-slate-700'}`}>
      {value}
    </span>
  )
}

function FairPoorRate({ representative, decorative = false }: {
  representative: AchieveRepresentativeFeedback
  decorative?: boolean
}) {
  const status = achieveRepresentativeReviewStatus(representative)
  const barClass = status === 'needs_review'
    ? 'bg-amber-500'
    : status === 'below_threshold'
      ? 'bg-emerald-500'
      : 'bg-slate-400'
  return (
    <div className="ml-auto w-20">
      <p className="text-right font-semibold tabular-nums text-slate-950">{representative.fairPoorRate.toFixed(1)}%</p>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
        role={decorative ? undefined : 'progressbar'}
        aria-hidden={decorative || undefined}
        aria-label={decorative ? undefined : `${representative.agentName} Fair or Poor rate`}
        aria-valuemin={decorative ? undefined : 0}
        aria-valuemax={decorative ? undefined : 100}
        aria-valuenow={decorative ? undefined : representative.fairPoorRate}
        aria-valuetext={decorative ? undefined : `${representative.fairPoorRate.toFixed(1)}%`}
      >
        <span className={`block h-full rounded-full ${barClass}`} style={{ width: `${Math.min(representative.fairPoorRate, 100)}%` }} />
      </div>
    </div>
  )
}

function MobileRatingBreakdown({ representative }: { representative: AchieveRepresentativeFeedback }) {
  const ratings = [
    { label: 'Good', value: representative.ratings.good, tone: 'good' },
    { label: 'Fair', value: representative.ratings.fair, tone: 'fair' },
    { label: 'Poor', value: representative.ratings.poor, tone: 'poor' },
  ] as const
  return (
    <div className="grid grid-cols-3 gap-2">
      {ratings.map(rating => (
        <div key={rating.label} className={`rounded-xl p-3 ring-1 ring-inset ${ratingTone[rating.tone]}`}>
          <p className="text-xs font-medium">{rating.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{rating.value}</p>
        </div>
      ))}
    </div>
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
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" rowSpan={2} className="w-[26%] px-5 py-3 align-middle">Representative</th>
                  <th scope="col" rowSpan={2} className="w-24 px-3 py-3 text-center align-middle">Total</th>
                  <th scope="colgroup" colSpan={3} className="border-l border-slate-200 px-3 py-2 text-center">Ratings</th>
                  <th scope="col" rowSpan={2} className="w-28 border-l border-slate-200 px-3 py-3 text-right align-middle">
                    <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                      Fair/Poor
                      {minimumSampleOnly && (
                        <ArrowDown className="h-3.5 w-3.5" aria-label="Sorted highest first" />
                      )}
                    </span>
                  </th>
                  <th scope="colgroup" colSpan={3} className="border-l border-slate-200 px-3 py-2 text-center">Reported conditions</th>
                  <th scope="col" rowSpan={2} className="w-28 border-l border-slate-200 px-3 py-3 align-middle">Latest</th>
                  <th scope="col" rowSpan={2} className="w-32 px-5 py-3 align-middle">Review</th>
                </tr>
                <tr className="border-t border-slate-200">
                  <th scope="col" className="border-l border-slate-200 px-2 py-2 text-center text-emerald-800">Good</th>
                  <th scope="col" className="px-2 py-2 text-center text-amber-800">Fair</th>
                  <th scope="col" className="px-2 py-2 text-center text-red-700">Poor</th>
                  <th scope="col" className="border-l border-slate-200 px-2 py-2 text-center">Noise</th>
                  <th scope="col" className="px-2 py-2 text-center">Accent</th>
                  <th scope="col" className="px-2 py-2 text-center">Connection</th>
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
                    <td className="px-3 py-4 text-center">
                      <span className="font-semibold tabular-nums text-slate-950">{representative.totalSubmissions}</span>
                      {representative.ratings.other > 0 && (
                        <span className="mt-0.5 block text-[11px] tabular-nums text-slate-500">+{representative.ratings.other} other</span>
                      )}
                    </td>
                    <td className="border-l border-slate-100 px-2 py-4 text-center"><RatingValue value={representative.ratings.good} tone="good" /></td>
                    <td className="px-2 py-4 text-center"><RatingValue value={representative.ratings.fair} tone="fair" /></td>
                    <td className="px-2 py-4 text-center"><RatingValue value={representative.ratings.poor} tone="poor" /></td>
                    <td className="border-l border-slate-100 px-3 py-4"><FairPoorRate representative={representative} /></td>
                    <td className="border-l border-slate-100 px-2 py-4 text-center"><ConditionValue value={representative.flags.backgroundNoise} /></td>
                    <td className="px-2 py-4 text-center"><ConditionValue value={representative.flags.accent} /></td>
                    <td className="px-2 py-4 text-center"><ConditionValue value={representative.flags.connectionIssues} /></td>
                    <td className="whitespace-nowrap border-l border-slate-100 px-3 py-4 text-slate-600">{utcDate.format(new Date(representative.latestSubmittedAt))}</td>
                    <td className="px-5 py-4"><ReviewStatus representative={representative} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 lg:hidden">
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
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-4 border-y border-slate-100 py-3">
                  <div>
                    <p className="text-xs text-slate-500">Total submissions</p>
                    <p className="mt-0.5 font-semibold tabular-nums text-slate-950">
                      {representative.totalSubmissions}
                      {representative.ratings.other > 0 && (
                        <span className="ml-1 font-normal text-slate-500">· {representative.ratings.other} other</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-right text-xs text-slate-500">Fair/Poor</p>
                    <FairPoorRate representative={representative} decorative />
                  </div>
                </div>
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-slate-500">Ratings</p>
                  <MobileRatingBreakdown representative={representative} />
                </div>
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-slate-500">Reported conditions</p>
                  <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <span>Noise <strong className="font-semibold tabular-nums text-slate-800">{representative.flags.backgroundNoise}</strong></span>
                    <span>Accent <strong className="font-semibold tabular-nums text-slate-800">{representative.flags.accent}</strong></span>
                    <span>Connection <strong className="font-semibold tabular-nums text-slate-800">{representative.flags.connectionIssues}</strong></span>
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
