import type { AgentRollup, CohortComparison } from '../../lib/team-queries'
import type { TeamCoachingTheme } from '../../lib/coaching-aggregation'

// Top vs bottom coaching-theme comparison (PSAI-177). Cohorts are split by
// compliance pass rate (see splitAgentCohorts); this panel contrasts what the
// strongest agents consistently do well against where the weakest consistently
// fall short, with each theme showing mention count + distinct-agent coverage
// and a drill-through link to each cohort agent's profile.
export function TeamCohortComparison({
  comparison,
  topAgents,
  bottomAgents,
  cohortSize,
  loading,
  onSelectAgent,
}: {
  comparison: CohortComparison | null
  topAgents: AgentRollup[]
  bottomAgents: AgentRollup[]
  cohortSize: number
  loading: boolean
  onSelectAgent: (agent: AgentRollup) => void
}) {
  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6">
      <header className="mb-5">
        <p className="pennie-label">Top vs. bottom coaching themes</p>
        <p className="text-xs text-pennie-graphite/60 mt-1">
          Comparing the {cohortSize} highest- and {cohortSize} lowest-compliance
          agents in this window — what strong agents consistently do well versus
          where struggling agents consistently fall short. Drill into any agent
          for call-level detail.
        </p>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[0, 1].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-32 rounded-full bg-pennie-beige/80 animate-pulse" />
              <div className="h-3 w-full rounded-full bg-pennie-beige/60 animate-pulse" />
              <div className="h-3 w-3/4 rounded-full bg-pennie-beige/60 animate-pulse" />
              <div className="h-3 w-1/2 rounded-full bg-pennie-beige/60 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <CohortPanel
            heading="Top performers do"
            subheading="Strengths shared across the highest-compliance agents"
            tone="green"
            themes={comparison?.top.strengths ?? []}
            cohortSize={cohortSize}
            agents={topAgents}
            onSelectAgent={onSelectAgent}
            emptyText="No shared strengths surfaced for the top cohort in this window."
          />
          <CohortPanel
            heading="Bottom performers miss"
            subheading="Improvement areas shared across the lowest-compliance agents"
            tone="peach"
            themes={[
              ...(comparison?.bottom.improvements ?? []),
              ...(comparison?.bottom.coachingPoints ?? []),
            ].slice(0, 5)}
            cohortSize={cohortSize}
            agents={bottomAgents}
            onSelectAgent={onSelectAgent}
            emptyText="No shared improvement areas surfaced for the bottom cohort in this window."
          />
        </div>
      )}
    </section>
  )
}

function CohortPanel({
  heading,
  subheading,
  tone,
  themes,
  cohortSize,
  agents,
  onSelectAgent,
  emptyText,
}: {
  heading: string
  subheading: string
  tone: 'green' | 'peach'
  themes: TeamCoachingTheme[]
  cohortSize: number
  agents: AgentRollup[]
  onSelectAgent: (agent: AgentRollup) => void
  emptyText: string
}) {
  const dot = tone === 'green' ? 'bg-pennie-green-dark' : 'bg-pennie-peach-dark'
  return (
    <div>
      <h3 className="pennie-label flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
        {heading}
      </h3>
      <p className="text-xs text-pennie-graphite/55 mt-1 mb-3">{subheading}</p>

      {themes.length === 0 ? (
        <p className="py-4 text-sm text-pennie-graphite/50">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {themes.map((theme, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-3 text-sm text-pennie-graphite leading-snug"
            >
              <span className="flex-1">{theme.theme}</span>
              <span className="shrink-0 flex flex-col items-end gap-1">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pennie-navy text-xs font-semibold text-pennie-white tabular-nums"
                  title="Agents in this cohort sharing the theme"
                >
                  {theme.agent_count}
                  <span className="text-pennie-white/70 font-normal">
                    /{cohortSize}
                  </span>
                  <span className="sr-only">agents</span>
                </span>
                <span
                  className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full bg-pennie-beige text-[11px] font-semibold text-pennie-navy tabular-nums"
                  title="Total mentions across the cohort"
                >
                  {theme.count}
                  <span className="sr-only">mentions</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {agents.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border/60">
          <p className="text-[10px] uppercase tracking-wider text-pennie-graphite/50 font-bold mb-2">
            Representative agents
          </p>
          <div className="flex flex-wrap gap-2">
            {agents.map(agent => (
              <button
                key={agent.agent_email}
                type="button"
                onClick={() => onSelectAgent(agent)}
                className="pennie-focus-ring inline-flex items-center gap-1.5 rounded-full bg-pennie-beige/70 hover:bg-pennie-beige px-3 py-1 text-xs font-semibold text-pennie-navy transition-colors"
                title={`${agent.compliance_pass_rate}% compliance · view ${agent.agent_full_name || agent.agent_email}`}
              >
                {agent.agent_full_name || agent.agent_email}
                <span className="text-pennie-graphite/50 font-normal tabular-nums">
                  {agent.compliance_pass_rate}%
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
