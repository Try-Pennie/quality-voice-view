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
}: {
  metrics: TeamMetrics
  loading: boolean
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
        />
        <SupportingStat
          label="Escalation"
          value={loading ? '—' : `${metrics.avgEscalation}%`}
        />
        <SupportingStat
          label="Open alerts"
          value={loading ? '—' : metrics.openAlerts.toLocaleString()}
        />
      </dl>
    </header>
  )
}

function SupportingStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="pennie-label">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-pennie-navy tabular-nums">
        {value}
      </dd>
    </div>
  )
}
