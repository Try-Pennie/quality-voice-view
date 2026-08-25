/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
/* Hallmark · component: outcome evidence table · desktop table / mobile list · slop: pass */
import { useState } from 'react'
import {
  achieveOutcomePeriod,
  achieveOutcomeSignal,
  type AchieveFirstPayOutcomes as FirstPayOutcomes,
  type AchieveOutcomePeriodKey,
} from '@/lib/achieve-management'

const controls: ReadonlyArray<{ readonly key: AchieveOutcomePeriodKey; readonly label: string }> = [
  { key: 'all_time', label: 'All time' },
  { key: 'mature_4_weeks', label: '4 weeks' },
  { key: 'mature_6_weeks', label: '6 weeks' },
]

function signalClass(signal: string): string {
  if (signal === 'Extreme') return 'bg-red-100 text-red-800'
  if (signal === 'Flag') return 'bg-orange-100 text-orange-800'
  if (signal === 'Watch') return 'bg-amber-100 text-amber-800'
  if (signal === 'Below roster') return 'bg-blue-50 text-blue-700'
  return 'bg-slate-100 text-slate-600'
}

/** Mature Achieve first-pay screening with controls local to this section. */
export function AchieveFirstPayOutcomes({ outcomes }: { readonly outcomes: FirstPayOutcomes }) {
  const [periodKey, setPeriodKey] = useState<AchieveOutcomePeriodKey>('mature_6_weeks')
  const period = achieveOutcomePeriod(outcomes, periodKey)
  const agents = [...period.agents].sort((left, right) => (
    Number(right.sampleQualified) - Number(left.sampleQualified)
    || (right.z ?? Number.NEGATIVE_INFINITY) - (left.z ?? Number.NEGATIVE_INFINITY)
    || right.n - left.n
    || left.agentEmail.localeCompare(right.agentEmail)
  ))

  return (
    <section aria-labelledby="first-pay-outcomes-heading" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="max-w-3xl">
          <h2 id="first-pay-outcomes-heading" className="text-lg font-semibold text-slate-950">Mature first-pay screening</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Original scheduled first drafts through {outcomes.maturityCutoff}. Compared with the leave-one-agent-out roster rate in the same active cohort weeks. Screening signal only—not causal proof.
          </p>
          <p className="mt-1 text-xs text-slate-400">Source as of {outcomes.sourceAsOf} · refreshed {new Date(outcomes.refreshedAt).toLocaleString()}</p>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="First-pay outcome period">
          {controls.map(control => (
            <button
              key={control.key}
              type="button"
              aria-pressed={periodKey === control.key}
              onClick={() => setPeriodKey(control.key)}
              className={`min-h-10 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                periodKey === control.key ? 'bg-slate-950 text-white shadow-sm active:bg-slate-800' : 'text-slate-600 hover:bg-white hover:text-slate-950 active:bg-slate-200'
              }`}
            >
              {control.label}
            </button>
          ))}
        </div>
      </div>

      {agents.length === 0 ? (
        <p className="p-6 text-sm text-slate-600">No mature Achieve enrollment outcomes are available for this period.</p>
      ) : (
        <>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Representative</th>
                <th className="px-3 py-3 text-center font-semibold">Signal</th>
                <th className="px-3 py-3 text-right font-semibold">Mature n</th>
                <th className="px-3 py-3 text-right font-semibold">No deposit</th>
                <th className="px-3 py-3 text-right font-semibold">Roster expected</th>
                <th className="px-3 py-3 text-right font-semibold">Delta</th>
                <th className="px-3 py-3 text-right font-semibold">Z</th>
                <th className="px-3 py-3 text-right font-semibold">Rescinded</th>
                <th className="px-5 py-3 text-right font-semibold">Never paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agents.map(agent => {
                const signal = achieveOutcomeSignal(agent)
                return (
                  <tr key={agent.agentEmail} className="text-slate-700">
                    <td className="px-5 py-4"><span className="font-semibold text-slate-950">{agent.agentName}</span><br /><span className="text-xs text-slate-500">{agent.agentEmail}</span></td>
                    <td className="px-3 py-4 text-center"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${signalClass(signal)}`}>{agent.rank === null ? signal : `#${agent.rank} ${signal}`}</span></td>
                    <td className="px-3 py-4 text-right tabular-nums">{agent.n}</td>
                    <td className="px-3 py-4 text-right tabular-nums"><strong>{agent.failures}</strong><br /><span className="text-xs text-slate-500">{agent.failureRate.toFixed(1)}%</span></td>
                    <td className="px-3 py-4 text-right tabular-nums">{agent.expectedFailures === null ? '—' : agent.expectedFailures.toFixed(1)}<br /><span className="text-xs text-slate-500">{agent.expectedRate === null ? '—' : `${agent.expectedRate.toFixed(1)}%`}</span></td>
                    <td className="px-3 py-4 text-right tabular-nums">{agent.deltaPp === null ? '—' : `${agent.deltaPp > 0 ? '+' : ''}${agent.deltaPp.toFixed(1)} pp`}</td>
                    <td className="px-3 py-4 text-right font-semibold tabular-nums">{agent.z === null ? '—' : agent.z.toFixed(2)}</td>
                    <td className="px-3 py-4 text-right tabular-nums">{agent.rescinded}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{agent.neverPaid}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-slate-100 md:hidden">
          {agents.map(agent => {
            const signal = achieveOutcomeSignal(agent)
            return (
              <article key={agent.agentEmail} className="min-w-0 p-5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-950">{agent.agentName}</h3>
                    <p className="break-all text-xs text-slate-500">{agent.agentEmail}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${signalClass(signal)}`}>
                    {agent.rank === null ? signal : `#${agent.rank} ${signal}`}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">No deposit</dt>
                    <dd className="font-semibold tabular-nums text-slate-950">{agent.failures} <span className="font-normal text-slate-500">({agent.failureRate.toFixed(1)}%)</span></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Mature enrollments</dt>
                    <dd className="font-semibold tabular-nums text-slate-950">{agent.n}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Roster expected</dt>
                    <dd className="font-semibold tabular-nums text-slate-950">{agent.expectedFailures === null ? '—' : `${agent.expectedFailures.toFixed(1)} (${agent.expectedRate?.toFixed(1)}%)`}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Delta · Z</dt>
                    <dd className="font-semibold tabular-nums text-slate-950">{agent.deltaPp === null ? '—' : `${agent.deltaPp > 0 ? '+' : ''}${agent.deltaPp.toFixed(1)} pp`} · {agent.z === null ? '—' : agent.z.toFixed(2)}</dd>
                  </div>
                </dl>
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600">Rescinded {agent.rescinded} · Never paid {agent.neverPaid}</p>
              </article>
            )
          })}
        </div>
        </>
      )}
      <p className="border-t border-slate-100 px-5 py-4 text-xs leading-5 text-slate-500 sm:px-6">
        Watch z≥1.5 · Flag z≥2 · Extreme z≥3. Low sample means the roster expectation has fewer than five expected failures or successes. Review repeated weekly signals before coaching.
      </p>
    </section>
  )
}
