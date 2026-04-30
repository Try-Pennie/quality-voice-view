import type { ReactNode } from 'react'
import { HelpHint } from '@/components/ui/help-hint'
import type { HelpId } from '@/lib/help-content'

interface PageHeroProps {
  /** Eyebrow label rendered with the `pennie-label` style. */
  label: string
  /** Main headline content. Number + subhead is the canonical shape. */
  headline: ReactNode
  /** Optional supporting paragraph below the headline. */
  description?: ReactNode
  /** Stat tiles for the right column — typically `<SupportingStat />`s. */
  stats?: ReactNode
  /**
   * Tailwind grid columns for the stats `<dl>`. Defaults to a three-stat
   * layout. Pass `grid-cols-2 sm:grid-cols-4` for four stats, etc.
   */
  statsCols?: string
  /**
   * Bump the headline to the display font. Reserved for "the queue is the
   * product" pages where the headline number IS the work — e.g. the alert
   * review queue. Stat-summary pages should keep the default.
   */
  display?: boolean
}

const DEFAULT_STATS_COLS = 'grid-cols-2 sm:grid-cols-3'

/**
 * Shared page header used by Calls, Alerts, and the agent profile views.
 * Asymmetric 7/5 grid with an eyebrow + headline + optional description on
 * the left and a strip of supporting stats on the right.
 */
export function PageHero({
  label,
  headline,
  description,
  stats,
  statsCols,
  display = false,
}: PageHeroProps) {
  return (
    <header className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
      <div className={stats ? 'lg:col-span-7' : 'lg:col-span-12'}>
        <p className="pennie-label mb-2">{label}</p>
        <h1
          className={
            display
              ? 'font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-pennie-navy'
              : 'text-2xl sm:text-3xl font-semibold tracking-[-0.01em] text-pennie-navy'
          }
        >
          {headline}
        </h1>
        {description && (
          <p className="mt-2 text-pennie-graphite/70 max-w-prose">
            {description}
          </p>
        )}
      </div>
      {stats && (
        <dl
          className={`lg:col-span-5 grid gap-3 ${statsCols ?? DEFAULT_STATS_COLS}`}
        >
          {stats}
        </dl>
      )}
    </header>
  )
}

interface SupportingStatProps {
  label: string
  value: string | number
  /** Optional one-line subline rendered below the value. */
  hint?: string
  /** Optional glossary id; renders a HelpHint next to the label. */
  helpId?: HelpId
}

/**
 * One stat tile in a `PageHero` `stats` strip. Pennie label up top, large
 * tabular-nums value below, optional hint underneath.
 */
export function SupportingStat({
  label,
  value,
  hint,
  helpId,
}: SupportingStatProps) {
  return (
    <div>
      <dt className="pennie-label inline-flex items-center gap-1">
        {label}
        {helpId && <HelpHint id={helpId} />}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
        {value}
      </dd>
      {hint && (
        <dd className="text-[11px] text-muted-foreground mt-0.5">{hint}</dd>
      )}
    </div>
  )
}
