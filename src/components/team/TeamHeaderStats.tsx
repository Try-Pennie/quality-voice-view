import type { AgentRollup } from '../../lib/team-queries'
import { HelpHint } from '../ui/help-hint'
import type { HelpId } from '../../lib/help-content'

type TeamMetrics = {
  agentCount: number
  callCount: number
  avgCompliance: number
  avgEscalation: number
  openAlerts: number
  topAgent: AgentRollup | null
}

export function TeamHeaderStats({
  metrics,
  loading,
  onComplianceClick,
  onEscalationClick,
  onAlertsClick,
}: {
  metrics: TeamMetrics
  loading: boolean
  onComplianceClick?: () => void
  onEscalationClick?: () => void
  onAlertsClick?: () => void
}) {
  return (
    <header className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
      <div className="lg:col-span-7">
        <p className="pennie-label mb-2">Team</p>
        <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-pennie-navy">
          {loading ? '—' : metrics.agentCount.toLocaleString()}{' '}
          <span className="text-pennie-graphite/70 font-normal text-[0.6em] align-baseline inline-flex items-baseline gap-1.5">
            {metrics.agentCount === 1 ? 'agent reporting' : 'agents reporting'}
            <HelpHint id="metric.team_agents_reporting" />
          </span>
        </h1>
        <p className="mt-3 text-pennie-graphite/70">
          {loading
            ? 'Loading…'
            : `${metrics.callCount.toLocaleString()} ${
                metrics.callCount === 1 ? 'call' : 'calls'
              } reviewed in window${
                metrics.topAgent
                  ? `. Top performer: ${metrics.topAgent.agent_full_name || metrics.topAgent.agent_email}.`
                  : ''
              }`}
        </p>
      </div>
      <dl className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SupportingStat
          label="Compliance"
          value={loading ? '—' : `${metrics.avgCompliance}%`}
          onClick={onComplianceClick}
          actionLabel="Show agents needing attention"
          helpId="metric.team_compliance"
        />
        <SupportingStat
          label="Escalation"
          value={loading ? '—' : `${metrics.avgEscalation}%`}
          onClick={onEscalationClick}
          actionLabel="Show agents needing attention"
          helpId="metric.team_escalation"
        />
        <SupportingStat
          label="Open alerts"
          value={loading ? '—' : metrics.openAlerts.toLocaleString()}
          onClick={onAlertsClick}
          actionLabel="Go to alerts inbox"
          helpId="metric.team_open_alerts"
        />
      </dl>
    </header>
  )
}

function SupportingStat({
  label,
  value,
  onClick,
  actionLabel,
  helpId,
}: {
  label: string
  value: string | number
  onClick?: () => void
  actionLabel?: string
  helpId?: HelpId
}) {
  if (onClick) {
    // Help icon must be a sibling of the click button — nesting interactive
    // elements is invalid HTML and confuses screen readers.
    return (
      <div className="relative">
        <button
          type="button"
          onClick={onClick}
          aria-label={actionLabel ? `${label}: ${value}. ${actionLabel}` : undefined}
          className="text-left rounded-2xl -m-2 p-2 pr-7 transition-colors hover:bg-pennie-beige/60 focus:outline-none focus:ring-2 focus:ring-pennie-blue-dark/40 group w-full"
        >
          <dt className="pennie-label group-hover:text-pennie-navy transition-colors">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
            {value}
          </dd>
        </button>
        {helpId && (
          <span className="absolute top-0 right-0">
            <HelpHint id={helpId} />
          </span>
        )}
      </div>
    )
  }
  return (
    <div>
      <dt className="pennie-label inline-flex items-center gap-1">
        {label}
        {helpId && <HelpHint id={helpId} />}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
        {value}
      </dd>
    </div>
  )
}
