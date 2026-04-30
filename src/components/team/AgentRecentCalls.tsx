import type { CallWithQA } from '../../types/database'
import { formatDateTime, formatDuration } from '../../lib/utils'
import { accentForScore, pillClasses } from '../../lib/violation-styles'

export function AgentRecentCalls({
  calls,
  loading,
  onSelect,
}: {
  calls: CallWithQA[]
  loading: boolean
  onSelect: (callId: string) => void
}) {
  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6 flex flex-col">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="pennie-label">Recent calls</p>
          <p className="text-xs text-pennie-graphite/60 mt-1">
            {loading
              ? 'Loading…'
              : `${calls.length} most recent ${calls.length === 1 ? 'call' : 'calls'}`}
          </p>
        </div>
      </header>
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="h-12 rounded-2xl bg-pennie-beige/60 animate-pulse"
            />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="py-8 text-center text-sm text-pennie-graphite/50">
          No calls in this window.
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {calls.map(call => {
            const isEscalation = call.qa?.manager_escalation
            const isComplianceFail = call.qa?.compliance_rating === 'fail'
            const stripe = isEscalation
              ? 'bg-pennie-peach-dark'
              : isComplianceFail
                ? 'bg-pennie-yellow-dark'
                : 'bg-transparent'
            return (
              <li key={call.id}>
                <button
                  type="button"
                  onClick={() => onSelect(call.call_id)}
                  className="w-full text-left flex items-center gap-3 py-3 px-1 hover:bg-pennie-beige/40 transition-colors rounded-lg"
                >
                  <span
                    className={`w-1 self-stretch rounded-full ${stripe}`}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0 grid grid-cols-3 gap-3 items-center">
                    <div>
                      <p className="text-sm text-pennie-graphite tabular-nums">
                        {formatDateTime(call.started_at)}
                      </p>
                      <p className="text-xs text-pennie-graphite/60 tabular-nums">
                        {formatDuration(call.talk_time)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={pillClasses(accentForScore(call.qa?.overall_score))}>
                        {call.qa?.overall_score || 'N/A'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      <span className={pillClasses(accentForScore(call.qa?.compliance_rating))}>
                        {call.qa?.compliance_rating || 'N/A'}
                      </span>
                    </div>
                  </div>
                  <span
                    className="text-pennie-blue-deeper text-sm font-semibold shrink-0"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
