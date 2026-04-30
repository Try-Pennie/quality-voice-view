import { Link } from 'react-router-dom'
import {
  MODULE_LABELS,
  VIOLATION_TYPE_LABELS,
  extractEvidence,
  extractReason,
} from '../../lib/alert-queries'
import { accentForViolation, pillClasses } from '../../lib/violation-styles'
import { formatDateTime } from '../../lib/utils'
import type { AlertWithFeedback } from '../../types/database'

export function CallAlertsSection({
  alerts,
  loading,
}: {
  alerts: AlertWithFeedback[]
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="bg-card rounded-lg shadow p-6 border border-border">
        <h2 className="text-lg font-semibold text-foreground mb-4">Alerts</h2>
        <div className="h-20 rounded bg-muted animate-pulse" />
      </div>
    )
  }
  if (alerts.length === 0) {
    return (
      <div className="bg-card rounded-lg shadow p-6 border border-border">
        <h2 className="text-lg font-semibold text-foreground mb-2">Alerts</h2>
        <p className="text-sm text-muted-foreground">
          No alerts fired for this call.
        </p>
      </div>
    )
  }
  const violations = alerts.filter(a => a.has_violation)
  const passes = alerts.filter(a => !a.has_violation)

  return (
    <div className="bg-card rounded-lg shadow p-6 border border-border">
      <header className="mb-4 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Alerts</h2>
          <p className="text-sm text-muted-foreground">
            {violations.length} violation{violations.length === 1 ? '' : 's'},{' '}
            {passes.length} check{passes.length === 1 ? '' : 's'} passed
          </p>
        </div>
      </header>

      {violations.length > 0 && (
        <ul className="space-y-3">
          {violations.map(a => (
            <AlertCard key={`${a.call_id}-${a.module_name}`} alert={a} />
          ))}
        </ul>
      )}

      {passes.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Show {passes.length} check{passes.length === 1 ? '' : 's'} that
            passed
          </summary>
          <ul className="mt-3 space-y-2">
            {passes.map(a => (
              <li
                key={`${a.call_id}-${a.module_name}`}
                className="flex items-center justify-between gap-3 text-sm rounded-md bg-muted/40 px-3 py-2"
              >
                <span className="font-medium text-foreground">
                  {MODULE_LABELS[a.module_name] ?? a.module_name}
                </span>
                <span className="text-xs text-muted-foreground">No violation</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function AlertCard({ alert }: { alert: AlertWithFeedback }) {
  const evidence = extractEvidence(alert.violation_type, alert.result_json)
  const reason = extractReason(alert.violation_type, alert.result_json)
  const moduleLabel = MODULE_LABELS[alert.module_name] ?? alert.module_name
  const violationLabel =
    VIOLATION_TYPE_LABELS[alert.violation_type] ?? alert.violation_type

  return (
    <li className="rounded-lg border border-border bg-pennie-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={pillClasses(accentForViolation(alert.violation_type))}>
          {violationLabel}
        </span>
        <span className="text-sm font-semibold text-foreground">
          {moduleLabel}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatDateTime(alert.alert_created_at)}
        </span>
      </div>

      {reason && (
        <div className="text-sm text-foreground">
          <span className="font-semibold">Reason: </span>
          {reason}
        </div>
      )}
      {evidence && (
        <div className="text-sm text-muted-foreground italic border-l-2 border-pennie-peach-dark/40 pl-3">
          “{evidence}”
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/60 text-xs text-muted-foreground">
        {alert.is_reviewed ? (
          <>
            <span className="font-semibold text-foreground">Reviewed</span>
            {alert.accurate === false ? (
              <span className="text-pennie-peach-deeper font-semibold">
                Marked not accurate
              </span>
            ) : alert.accurate === true ? (
              <span className="text-pennie-green-dark font-semibold">
                Marked accurate
              </span>
            ) : null}
            {alert.feedback_comment && (
              <span className="text-foreground">“{alert.feedback_comment}”</span>
            )}
          </>
        ) : (
          <span className="text-pennie-peach-deeper font-semibold">
            Not yet reviewed
          </span>
        )}
        <Link
          to={`/dashboard/alerts/${encodeURIComponent(alert.call_id)}/${encodeURIComponent(alert.module_name)}`}
          className="ml-auto text-pennie-blue-deeper font-semibold hover:underline"
        >
          Review in alerts inbox →
        </Link>
      </div>
    </li>
  )
}
