import type {
  TeamCoachingTheme,
  TeamCoachingThemes as TeamCoachingThemesType,
} from '../../lib/coaching-aggregation'

export function TeamCoachingThemes({
  themes,
  loading,
  totalAgents,
}: {
  themes: TeamCoachingThemesType | null
  loading: boolean
  totalAgents: number
}) {
  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6">
      <header className="mb-5 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="pennie-label">Team coaching themes</p>
          <p className="text-xs text-pennie-graphite/60 mt-1">
            Ranked by how many agents share each theme — broad themes signal
            training or product investment, narrow themes signal 1:1 coaching
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
          !themes.coachingPoints.length &&
          !themes.trainingRecs.length) ? (
        <div className="py-8 text-center text-sm text-pennie-graphite/50">
          No coaching recommendations across the team in this window.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <ThemeColumn
            heading="Strengths"
            tone="green"
            items={themes.strengths}
            totalAgents={totalAgents}
          />
          <ThemeColumn
            heading="Areas for improvement"
            tone="peach"
            items={themes.improvements}
            totalAgents={totalAgents}
          />
          {themes.coachingPoints.length > 0 && (
            <ThemeColumn
              heading="Specific coaching points"
              tone="blue"
              items={themes.coachingPoints}
              totalAgents={totalAgents}
            />
          )}
          {themes.trainingRecs.length > 0 && (
            <ThemeColumn
              heading="Training recommendations"
              tone="yellow"
              items={themes.trainingRecs}
              totalAgents={totalAgents}
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
  totalAgents,
}: {
  heading: string
  items: TeamCoachingTheme[]
  tone: 'green' | 'peach' | 'blue' | 'yellow'
  totalAgents: number
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
      <ul className="space-y-3">
        {items.map((theme, i) => (
          <li
            key={i}
            className="flex items-start justify-between gap-3 text-sm text-pennie-graphite leading-snug"
          >
            <span className="flex-1">{theme.theme}</span>
            <span className="shrink-0 flex flex-col items-end gap-1">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pennie-navy text-xs font-semibold text-pennie-white tabular-nums"
                title="Number of agents sharing this theme"
              >
                {theme.agent_count}
                {totalAgents > 0 && (
                  <span className="text-pennie-white/70 font-normal">
                    /{totalAgents}
                  </span>
                )}
                <span className="sr-only">agents</span>
              </span>
              <span
                className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full bg-pennie-beige text-[11px] font-semibold text-pennie-navy tabular-nums"
                title="Total mentions across the team"
              >
                {theme.count}
                <span className="sr-only">mentions</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
