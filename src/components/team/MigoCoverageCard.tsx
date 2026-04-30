import type { MigoCoverage } from '../../lib/migo-queries'
import { HelpHint } from '../ui/help-hint'
import type { HelpId } from '../../lib/help-content'

export function MigoCoverageCard({
  coverage,
  loading,
}: {
  coverage: MigoCoverage | null
  loading: boolean
}) {
  if (loading) {
    return (
      <section className="bg-pennie-white rounded-3xl shadow-resting p-6">
        <Header />
        <div className="h-24 rounded-2xl bg-pennie-beige/60 animate-pulse" />
      </section>
    )
  }

  if (!coverage || !coverage.configured) {
    return null
  }

  const total = coverage.briefed_calls + coverage.unbriefed_calls
  if (total === 0) {
    return null
  }

  const coveragePct = Math.round((coverage.briefed_calls / total) * 100)
  const compLift = diff(
    coverage.briefed_compliance_rate,
    coverage.unbriefed_compliance_rate,
  )
  const escLift = diff(
    coverage.briefed_escalation_rate,
    coverage.unbriefed_escalation_rate,
  )

  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6">
      <Header />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Stat
          label="Briefing coverage"
          value={`${coveragePct}%`}
          hint={`${coverage.briefed_calls.toLocaleString()} of ${total.toLocaleString()} calls had a Migo briefing`}
          helpId="metric.migo_briefing_coverage"
        />
        <Stat
          label="Compliance lift"
          value={
            compLift === null
              ? '—'
              : `${compLift >= 0 ? '+' : ''}${compLift} pts`
          }
          hint={
            compLift === null
              ? 'Insufficient data'
              : `${formatRate(coverage.briefed_compliance_rate)} briefed vs ${formatRate(coverage.unbriefed_compliance_rate)} unbriefed`
          }
          tone={compLift === null ? 'neutral' : compLift > 0 ? 'positive' : compLift < 0 ? 'negative' : 'neutral'}
          helpId="metric.migo_compliance_lift"
        />
        <Stat
          label="Escalation lift"
          value={
            escLift === null
              ? '—'
              : `${escLift >= 0 ? '+' : ''}${escLift} pts`
          }
          hint={
            escLift === null
              ? 'Insufficient data'
              : `${formatRate(coverage.briefed_escalation_rate)} briefed vs ${formatRate(coverage.unbriefed_escalation_rate)} unbriefed`
          }
          // For escalations, lower is better — flip the tone
          tone={escLift === null ? 'neutral' : escLift < 0 ? 'positive' : escLift > 0 ? 'negative' : 'neutral'}
          helpId="metric.migo_escalation_lift"
        />
      </div>
    </section>
  )
}

function Header() {
  return (
    <header className="mb-5">
      <p className="pennie-label">Product signal — Migo briefing efficacy</p>
      <p className="text-xs text-pennie-graphite/60 mt-1">
        Did calls preceded by a Migo pre-call briefing perform better? Use this
        to decide where to invest in agent tooling.
      </p>
    </header>
  )
}

function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  helpId,
}: {
  label: string
  value: string
  hint: string
  tone?: 'neutral' | 'positive' | 'negative'
  helpId?: HelpId
}) {
  const valueClass =
    tone === 'positive'
      ? 'text-pennie-green-dark'
      : tone === 'negative'
        ? 'text-pennie-peach-dark'
        : 'text-pennie-navy'
  return (
    <div>
      <dt className="pennie-label inline-flex items-center gap-1">
        {label}
        {helpId && <HelpHint id={helpId} />}
      </dt>
      <dd className={`mt-1 text-3xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
      <p className="text-xs text-pennie-graphite/60 mt-1">{hint}</p>
    </div>
  )
}

function diff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return a - b
}

function formatRate(v: number | null): string {
  return v === null ? '—' : `${v}%`
}
