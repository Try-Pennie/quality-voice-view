import type { CoachingTheme, CoachingThemes } from '../../lib/coaching-aggregation'

export function CoachingThemesPanel({
  themes,
  loading,
}: {
  themes: CoachingThemes | null
  loading: boolean
}) {
  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6">
      <header className="mb-5 flex items-baseline justify-between">
        <div>
          <p className="pennie-label">Coaching themes</p>
          <p className="text-xs text-pennie-graphite/60 mt-1">
            Frequency-ranked across this window's QA reviews
          </p>
        </div>
      </header>
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[0, 1].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded-full bg-pennie-beige/80 animate-pulse" />
              <div className="h-3 w-full rounded-full bg-pennie-beige/60 animate-pulse" />
              <div className="h-3 w-3/4 rounded-full bg-pennie-beige/60 animate-pulse" />
              <div className="h-3 w-1/2 rounded-full bg-pennie-beige/60 animate-pulse" />
            </div>
          ))}
        </div>
      ) : !themes ||
        (!themes.strengths.length &&
          !themes.improvements.length &&
          !themes.coachingPoints.length) ? (
        <div className="py-8 text-center text-sm text-pennie-graphite/50">
          No coaching recommendations in this window.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <ThemeColumn
            heading="Strengths"
            tone="green"
            items={themes.strengths}
          />
          <ThemeColumn
            heading="Areas for improvement"
            tone="peach"
            items={themes.improvements}
          />
          {themes.coachingPoints.length > 0 && (
            <ThemeColumn
              heading="Specific coaching points"
              tone="blue"
              items={themes.coachingPoints}
            />
          )}
          {themes.trainingRecs.length > 0 && (
            <ThemeColumn
              heading="Training recommendations"
              tone="yellow"
              items={themes.trainingRecs}
            />
          )}
        </div>
      )}
    </section>
  )
}

function ThemeColumn({
  heading,
  items,
  tone,
}: {
  heading: string
  items: CoachingTheme[]
  tone: 'green' | 'peach' | 'blue' | 'yellow'
}) {
  if (items.length === 0) return null
  const dotByTone: Record<string, string> = {
    green: 'bg-pennie-green-dark',
    peach: 'bg-pennie-peach-dark',
    blue: 'bg-pennie-blue-dark',
    yellow: 'bg-pennie-yellow-dark',
  }
  return (
    <div>
      <h3 className="pennie-label mb-3 flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotByTone[tone]}`}
          aria-hidden="true"
        />
        {heading}
      </h3>
      <ul className="space-y-2.5">
        {items.map((theme, i) => (
          <li
            key={i}
            className="flex items-start justify-between gap-3 text-sm text-pennie-graphite leading-snug"
          >
            <span className="flex-1">{theme.theme}</span>
            <span className="shrink-0 inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full bg-pennie-beige text-xs font-semibold text-pennie-navy tabular-nums">
              {theme.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
