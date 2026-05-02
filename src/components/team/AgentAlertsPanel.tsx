import { useNavigate, useLocation } from 'react-router-dom'
import type { AlertWithFeedback } from '../../types/database'
import { VIOLATION_TYPE_LABELS } from '../../lib/alert-queries'
import { accentForViolation, pillClasses } from '../../lib/violation-styles'
import { formatDateTime } from '../../lib/utils'

export function AgentAlertsPanel({
  alerts,
  loading,
}: {
  alerts: AlertWithFeedback[]
  loading: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()

  // Show only "real" alerts (has_violation = true) and prioritize unreviewed
  const visible = [...alerts]
    .filter(a => a.has_violation)
    .sort((a, b) => {
      if (a.is_reviewed !== b.is_reviewed) return a.is_reviewed ? 1 : -1
      return (
        new Date(b.alert_created_at).getTime() -
        new Date(a.alert_created_at).getTime()
      )
    })
    .slice(0, 8)

  const unreviewedCount = alerts.filter(a => a.has_violation && !a.is_reviewed).length

  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6 flex flex-col">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="pennie-label">Alerts</p>
          <p className="text-xs text-pennie-graphite/60 mt-1">
            {loading
              ? 'Loading…'
              : `${unreviewedCount} unreviewed of ${visible.length} shown`}
          </p>
        </div>
      </header>
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="h-16 rounded-2xl bg-pennie-beige/60 animate-pulse"
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-pennie-graphite/50">
          No alerts in this window.
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map(alert => {
            const moduleLabel =
              VIOLATION_TYPE_LABELS[alert.violation_type] || alert.violation_type
            return (
              <li key={`${alert.call_id}-${alert.module_name}`}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/dashboard/alerts/${encodeURIComponent(alert.call_id)}/${encodeURIComponent(alert.module_name)}`,
                      {
                        state: {
                          returnTo: `${location.pathname}${location.search}`,
                        },
                      },
                    )
                  }
                  className="w-full text-left flex items-start justify-between gap-4 p-3 rounded-2xl hover:bg-pennie-beige/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={pillClasses(accentForViolation(alert.violation_type))}>
                        {moduleLabel}
                      </span>
                      {!alert.is_reviewed && (
                        <span className="pennie-pill bg-pennie-yellow-light text-pennie-yellow-dark">
                          New
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-pennie-graphite line-clamp-2">
                      {alert.call_summary || 'No summary available.'}
                    </p>
                    <p className="mt-1 text-xs text-pennie-graphite/60 tabular-nums">
                      {formatDateTime(alert.alert_created_at)}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-pennie-blue-deeper text-sm font-semibold"
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
