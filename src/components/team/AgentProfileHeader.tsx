import type { AgentProfile } from '../../lib/team-queries'
import { formatDuration } from '../../lib/utils'

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

export function AgentProfileHeader({
  agentEmail,
  profile,
  loading,
  startDate,
  endDate,
}: {
  agentEmail: string
  profile: AgentProfile | null
  loading: boolean
  startDate: Date
  endDate: Date
}) {
  const r = profile?.rollup
  const fullName = profile?.agent_full_name

  return (
    <header className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
      <div className="lg:col-span-7">
        <p className="pennie-label mb-2">Agent · {formatRange(startDate, endDate)}</p>
        <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-pennie-navy">
          {fullName || agentEmail}
        </h1>
        {fullName && (
          <p className="mt-2 text-pennie-graphite/70 text-sm">{agentEmail}</p>
        )}
        <p className="mt-3 text-pennie-graphite/70">
          {loading
            ? 'Loading…'
            : r && r.call_count > 0
              ? `${r.call_count.toLocaleString()} ${
                  r.call_count === 1 ? 'call' : 'calls'
                } in this window. Avg talk ${formatDuration(r.avg_talk_time)}.`
              : 'No calls in this window.'}
        </p>
      </div>
      <dl className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SupportingStat
          label="Compliance"
          value={loading || !r || r.qa_count === 0 ? '—' : `${r.compliance_pass_rate}%`}
          warn={!!r && r.qa_count > 0 && r.compliance_pass_rate < 80}
        />
        <SupportingStat
          label="CSAT high"
          value={loading || !r || r.qa_count === 0 ? '—' : `${r.csat_high_rate}%`}
          warn={!!r && r.qa_count > 0 && r.csat_high_rate < 50}
        />
        <SupportingStat
          label="Escalation"
          value={loading || !r || r.qa_count === 0 ? '—' : `${r.escalation_rate}%`}
          warn={!!r && r.qa_count > 0 && r.escalation_rate >= 10}
        />
        <SupportingStat
          label="Open alerts"
          value={loading || !r ? '—' : r.unreviewed_alerts_count.toString()}
          warn={!!r && r.unreviewed_alerts_count > 0}
        />
      </dl>
    </header>
  )
}

function SupportingStat({
  label,
  value,
  warn,
}: {
  label: string
  value: string
  warn?: boolean
}) {
  return (
    <div>
      <dt className="pennie-label">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          warn ? 'text-pennie-peach-dark' : 'text-pennie-navy'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
