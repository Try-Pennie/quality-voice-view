import type { AgentRollup } from '../../lib/team-queries'

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
          <span className="text-pennie-graphite/70 font-normal text-[0.6em] align-baseline">
            {metrics.agentCount === 1 ? 'agent reporting' : 'agents reporting'}
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
        />
        <SupportingStat
          label="Escalation"
          value={loading ? '—' : `${metrics.avgEscalation}%`}
          onClick={onEscalationClick}
          actionLabel="Show agents needing attention"
        />
        <SupportingStat
          label="Open alerts"
          value={loading ? '—' : metrics.openAlerts.toLocaleString()}
          onClick={onAlertsClick}
          actionLabel="Go to alerts inbox"
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
}: {
  label: string
  value: string | number
  onClick?: () => void
  actionLabel?: string
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={actionLabel ? `${label}: ${value}. ${actionLabel}` : undefined}
        className="text-left rounded-2xl -m-2 p-2 transition-colors hover:bg-pennie-beige/60 focus:outline-none focus:ring-2 focus:ring-pennie-blue-dark/40 group"
      >
        <dt className="pennie-label group-hover:text-pennie-navy transition-colors">{label}</dt>
        <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
          {value}
        </dd>
      </button>
    )
  }
  return (
    <div>
      <dt className="pennie-label">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
        {value}
      </dd>
    </div>
  )
}
