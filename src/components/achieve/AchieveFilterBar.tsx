import { SlidersHorizontal, X } from 'lucide-react'
import {
  EMPTY_ACHIEVE_FILTERS,
  type AchieveAgentRating,
  type AchieveAnalyticsFilters,
} from '@/lib/achieve-analytics'

const RATINGS: ReadonlyArray<AchieveAgentRating> = ['Good', 'Fair', 'Poor', 'Other']

function isFiltered(filters: AchieveAnalyticsFilters): boolean {
  return filters.accent || filters.backgroundNoise || filters.connectionIssue || filters.rating !== null
}

/** Feedback-backed filters for overview aggregates and normal call queues. */
export function AchieveFilterBar({
  filters,
  onChange,
}: {
  filters: AchieveAnalyticsFilters
  onChange: (filters: AchieveAnalyticsFilters) => void
}) {
  const active = isFiltered(filters)
  const toggleFlag = (key: 'accent' | 'backgroundNoise' | 'connectionIssue') => {
    onChange({ ...filters, [key]: !filters[key] })
  }

  return (
    <section aria-labelledby="achieve-filter-heading" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
            <h2 id="achieve-filter-heading" className="text-sm font-semibold text-slate-950">Filter matched feedback</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Applies to Overview, Needs review, and All calls. Backfill audit and unmatched submissions stay unchanged.
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <FilterToggle label="Accent" pressed={filters.accent} onClick={() => toggleFlag('accent')} />
          <FilterToggle label="Background noise" pressed={filters.backgroundNoise} onClick={() => toggleFlag('backgroundNoise')} />
          <FilterToggle label="Connection issue" pressed={filters.connectionIssue} onClick={() => toggleFlag('connectionIssue')} />
          <div className="col-span-2 grid grid-cols-4 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:col-span-1">
            {RATINGS.map(rating => (
              <button
                key={rating}
                type="button"
                aria-pressed={filters.rating === rating}
                onClick={() => onChange({ ...filters, rating: filters.rating === rating ? null : rating })}
                className={`min-h-8 whitespace-nowrap rounded-md px-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                  filters.rating === rating
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-950'
                }`}
              >
                {rating}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange(EMPTY_ACHIEVE_FILTERS)}
            disabled={!active}
            className="col-span-2 inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold text-blue-700 outline-none transition-colors hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent sm:col-span-1"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
          </button>
        </div>
      </div>
    </section>
  )
}

function FilterToggle({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-10 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
        pressed
          ? 'border-blue-700 bg-blue-50 text-blue-800'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )
}
