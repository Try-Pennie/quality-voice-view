import { useMemo, useState } from 'react'
import { ChevronRight, Download, Search } from 'lucide-react'
import { AchieveRepresentativeFeedbackDrawer } from '@/components/achieve/AchieveRepresentativeFeedbackDrawer'
import {
  achieveRepresentativeReviewStatus,
  achieveRepresentativesCsv,
  filterAchieveRepresentatives,
  type AchieveRepresentativeCoverage,
  type AchieveRepresentativeFeedback,
  type AchieveRepresentativeReviewStatus,
} from '@/lib/achieve-feedback-overview'

const activityDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
})

const statusContent: Readonly<Record<AchieveRepresentativeReviewStatus, { label: string; className: string }>> = {
  needs_review: { label: 'Form review', className: 'bg-amber-100 text-amber-900' },
  below_threshold: { label: 'Below Form threshold', className: 'bg-emerald-100 text-emerald-900' },
  low_sample: { label: 'Low Form sample', className: 'bg-slate-100 text-slate-700' },
}

function ReviewStatus({ representative }: { representative: AchieveRepresentativeFeedback }) {
  const content = statusContent[achieveRepresentativeReviewStatus(representative)]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${content.className}`}>{content.label}</span>
}

function Count({ value, tone = 'plain' }: { value: number; tone?: 'plain' | 'good' | 'fair' | 'poor' }) {
  const className = {
    plain: 'text-slate-800',
    good: 'bg-emerald-50 text-emerald-800',
    fair: 'bg-amber-50 text-amber-800',
    poor: 'bg-red-50 text-red-700',
  }[tone]
  return <span className={`inline-flex min-h-8 min-w-9 items-center justify-center rounded-lg px-2 font-semibold tabular-nums ${className}`}>{value}</span>
}

function latestActivity(representative: AchieveRepresentativeFeedback): string | null {
  const timestamps = [representative.latestSubmittedAt, representative.ai.latestGradedAt]
    .filter((timestamp): timestamp is string => timestamp !== null)
  if (timestamps.length === 0) return null
  return timestamps.reduce((latest, timestamp) => Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest)
}

function LatestActivity({ representative }: { representative: AchieveRepresentativeFeedback }) {
  const latest = latestActivity(representative)
  if (latest === null) return null
  return <span className="mt-1 block text-[11px] font-normal text-slate-500">Latest {activityDate.format(new Date(latest))} UTC</span>
}

function ReportedConditions({ representative }: { representative: AchieveRepresentativeFeedback }) {
  return (
    <span className="whitespace-nowrap tabular-nums text-slate-600">
      Noise {representative.flags.backgroundNoise} · Accent {representative.flags.accent} · Connection {representative.flags.connectionIssues}
    </span>
  )
}

function FormSummary({ representative }: { representative: AchieveRepresentativeFeedback }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Form</p>
      <p className="mt-2 text-sm text-slate-700">
        <strong className="tabular-nums text-slate-950">{representative.totalSubmissions}</strong> sample ·{' '}
        <strong className="tabular-nums text-slate-950">{representative.fairPoorRate.toFixed(1)}%</strong> Fair/Poor
      </p>
      <p className="mt-1 text-xs tabular-nums text-slate-500">
        {representative.ratings.good} Good · {representative.ratings.fair} Fair · {representative.ratings.poor} Poor
      </p>
      <p className="mt-2 overflow-x-auto text-xs"><ReportedConditions representative={representative} /></p>
    </div>
  )
}

function AiSummary({ representative }: { representative: AchieveRepresentativeFeedback }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">AI QA</p>
      <p className="mt-2 text-sm text-slate-700">
        <strong className="tabular-nums text-slate-950">{representative.ai.total}</strong> sample ·{' '}
        <strong className="tabular-nums text-emerald-800">{representative.ai.pass}</strong> pass ·{' '}
        <strong className="tabular-nums text-red-700">{representative.ai.flagged}</strong> flagged
      </p>
    </div>
  )
}

function downloadRepresentativesCsv(representatives: ReadonlyArray<AchieveRepresentativeFeedback>) {
  const url = URL.createObjectURL(new Blob([achieveRepresentativesCsv(representatives)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `achieve-wc-agent-summary-${new Date().toISOString().slice(0, 10)}.csv`
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function AlignmentSummary({ representative }: { representative: AchieveRepresentativeFeedback }) {
  const { alignment } = representative
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600">
      <p className="font-semibold uppercase tracking-wide text-slate-500">Alignment · {alignment.overlapCalls} overlap</p>
      <p className="mt-2 tabular-nums">
        Both clear {alignment.bothClear} · Both concern {alignment.bothConcern} · Human only {alignment.humanOnly} · AI only {alignment.aiOnly}
      </p>
    </div>
  )
}

/** Searchable union of exact Form and exact ordinary-AI representatives. */
export function AchieveRepresentativeTable({ representatives, coverage }: {
  representatives: ReadonlyArray<AchieveRepresentativeFeedback>
  coverage: AchieveRepresentativeCoverage
}) {
  const [search, setSearch] = useState('')
  const [minimumSampleOnly, setMinimumSampleOnly] = useState(false)
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
              <h2 id="representative-review-heading" className="text-lg font-semibold text-slate-950">WC Agent Summary by representative</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                {needsReview} of {sampleEligible} representatives with 5+ Form submissions meet the 25% Fair/Poor triage threshold. AI samples remain separate and do not change Form-based review status.
              </p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                Alignment overlap means a call has both Form and AI QA. Clear means Form Good or AI Pass; concern means Form Fair/Poor or AI Flagged. Human only and AI only show which source raised the concern.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_auto_auto]">
              <label className="relative min-w-0">
                <span className="sr-only">Search Achieve representatives</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search representative"
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-blue-500"
                />
              </label>
              <button
                type="button"
                aria-pressed={minimumSampleOnly}
                onClick={() => setMinimumSampleOnly(value => !value)}
                className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  minimumSampleOnly ? 'border-blue-700 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Form sample: 5+
              </button>
              <button
                type="button"
                disabled={filtered.length === 0}
                onClick={() => downloadRepresentativesCsv(filtered)}
                aria-label={`Export ${filtered.length} displayed representatives to CSV`}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Export CSV
              </button>
            </div>
          </div>
          {coverage.capReached && <p className="mt-3 text-xs font-semibold text-amber-800">Showing {coverage.loaded} of {coverage.total} representatives.</p>}
        </div>

        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">No representatives match this search and Form sample filter.</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1520px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" rowSpan={2} className="w-[22%] px-5 py-3">Representative</th>
                    <th scope="colgroup" colSpan={6} className="border-l border-slate-200 px-3 py-2 text-center">Form</th>
                    <th scope="colgroup" colSpan={3} className="border-l border-blue-100 bg-blue-50/60 px-3 py-2 text-center text-blue-700">AI QA</th>
                    <th scope="colgroup" colSpan={5} className="border-l border-slate-200 px-3 py-2 text-center">Call alignment</th>
                  </tr>
                  <tr className="border-t border-slate-200">
                    <th scope="col" className="border-l border-slate-200 px-2 py-2 text-center">Sample</th>
                    <th scope="col" className="px-2 py-2 text-center text-emerald-800">Good</th>
                    <th scope="col" className="px-2 py-2 text-center text-amber-800">Fair</th>
                    <th scope="col" className="px-2 py-2 text-center text-red-700">Poor</th>
                    <th scope="col" className="px-2 py-2 text-center">Fair/Poor</th>
                    <th scope="col" className="px-2 py-2 text-center">Reported conditions</th>
                    <th scope="col" className="border-l border-blue-100 bg-blue-50/60 px-2 py-2 text-center">Sample</th>
                    <th scope="col" className="bg-blue-50/60 px-2 py-2 text-center">Pass</th>
                    <th scope="col" className="bg-blue-50/60 px-2 py-2 text-center">Flagged</th>
                    <th scope="col" className="border-l border-slate-200 px-2 py-2 text-center">Overlap</th>
                    <th scope="col" className="px-2 py-2 text-center">Both clear</th>
                    <th scope="col" className="px-2 py-2 text-center">Both concern</th>
                    <th scope="col" className="px-2 py-2 text-center">Human only</th>
                    <th scope="col" className="px-2 py-2 text-center">AI only</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(representative => (
                    <tr key={representative.agentEmail} className="hover:bg-blue-50/30">
                      <th scope="row" className="p-0">
                        <button
                          type="button"
                          onClick={() => setSelectedRepresentative(representative)}
                          aria-label={`View Form feedback and AI calls for ${representative.agentName}`}
                          className="group flex min-h-[5rem] w-full items-center justify-between gap-3 px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                        >
                          <span className="min-w-0">
                            <span className="block [overflow-wrap:anywhere] font-semibold text-slate-950 group-hover:text-blue-800">{representative.agentName}</span>
                            <span className="mt-0.5 block [overflow-wrap:anywhere] text-xs font-normal text-slate-500">{representative.agentEmail}</span>
                            <LatestActivity representative={representative} />
                            <span className="mt-2 block"><ReviewStatus representative={representative} /></span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        </button>
                      </th>
                      <td className="border-l border-slate-100 px-2 py-4 text-center"><Count value={representative.totalSubmissions} /></td>
                      <td className="px-2 py-4 text-center"><Count value={representative.ratings.good} tone="good" /></td>
                      <td className="px-2 py-4 text-center"><Count value={representative.ratings.fair} tone="fair" /></td>
                      <td className="px-2 py-4 text-center"><Count value={representative.ratings.poor} tone="poor" /></td>
                      <td className="px-2 py-4 text-center font-semibold tabular-nums text-slate-950">{representative.fairPoorRate.toFixed(1)}%</td>
                      <td className="px-3 py-4 text-center text-xs"><ReportedConditions representative={representative} /></td>
                      <td className="border-l border-blue-100 bg-blue-50/30 px-2 py-4 text-center"><Count value={representative.ai.total} /></td>
                      <td className="bg-blue-50/30 px-2 py-4 text-center"><Count value={representative.ai.pass} tone="good" /></td>
                      <td className="bg-blue-50/30 px-2 py-4 text-center"><Count value={representative.ai.flagged} tone="poor" /></td>
                      <td className="border-l border-slate-100 px-2 py-4 text-center tabular-nums">{representative.alignment.overlapCalls}</td>
                      <td className="px-2 py-4 text-center tabular-nums">{representative.alignment.bothClear}</td>
                      <td className="px-2 py-4 text-center tabular-nums">{representative.alignment.bothConcern}</td>
                      <td className="px-2 py-4 text-center tabular-nums">{representative.alignment.humanOnly}</td>
                      <td className="px-2 py-4 text-center tabular-nums">{representative.alignment.aiOnly}</td>
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
                  className="block w-full p-5 text-left outline-none hover:bg-blue-50/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block [overflow-wrap:anywhere] font-semibold text-slate-950">{representative.agentName}</span>
                      <span className="block [overflow-wrap:anywhere] text-xs text-slate-500">{representative.agentEmail}</span>
                      <LatestActivity representative={representative} />
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </div>
                  <div className="mt-2"><ReviewStatus representative={representative} /></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2"><FormSummary representative={representative} /><AiSummary representative={representative} /></div>
                  <div className="mt-3"><AlignmentSummary representative={representative} /></div>
                </button>
              ))}
            </div>
          </>
        )}
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Showing {filtered.length} of {coverage.loaded} representatives.</p>
      </section>
      <AchieveRepresentativeFeedbackDrawer representative={selectedRepresentative} onClose={() => setSelectedRepresentative(null)} />
    </>
  )
}
