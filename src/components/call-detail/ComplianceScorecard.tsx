import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { getScoreBadgeColor } from '../../lib/utils'

export function ComplianceScorecard({ data }: { data: any }) {
  const [isExpanded, setIsExpanded] = useState(data.overall_compliance_score === 'fail')

  const checks = [
    { label: 'Agent Identification', value: data.agent_identification, timestamp: data.agent_identification_timestamp },
    { label: 'Call Recording Disclosure', value: data.call_recording_disclosure, timestamp: data.call_recording_disclosure_timestamp },
    { label: 'Credit Pull Consent', value: data.credit_pull_consent, timestamp: data.credit_pull_consent_timestamp },
    { label: 'Social Security Verification', value: data.social_security_verification, timestamp: data.social_security_verification_timestamp },
    { label: 'Accurate Representations', value: data.accurate_representations },
    { label: 'No Misleading Claims', value: data.no_misleading_claims },
  ]

  const renderIcon = (value: string) => {
    const className = 'w-5 h-5 shrink-0'
    if (value === 'pass') return <CheckCircle2 className={`${className} text-pennie-green-dark`} />
    if (value === 'fail') return <XCircle className={`${className} text-pennie-peach-deeper`} />
    return <Circle className={`${className} text-pennie-graphite/40`} />
  }

  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="pennie-focus-ring-inset w-full px-6 sm:px-8 py-5 flex items-center justify-between gap-3 text-left hover:bg-pennie-beige/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-pennie-graphite/60" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 text-pennie-graphite/60" aria-hidden="true" />
          )}
          <h2 className="text-lg font-semibold text-pennie-navy flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-pennie-green-dark" aria-hidden="true" />
            Compliance scorecard
          </h2>
        </div>
        <span className={getScoreBadgeColor(data.overall_compliance_score)}>
          {data.overall_compliance_score || 'N/A'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-4">
          {data.requires_manager_review && (
            <div className="bg-pennie-peach-light border border-pennie-peach-main/50 rounded-2xl p-4">
              <p className="font-semibold text-pennie-peach-deeper mb-1 flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                Requires manager review
              </p>
              <p className="text-pennie-graphite text-sm leading-relaxed">
                {data.escalation_reason}
              </p>
            </div>
          )}

          <div className="space-y-3">
            {checks.map((check, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-0.5">{renderIcon(check.value)}</span>
                <div className="flex-1">
                  <div className="font-medium text-pennie-graphite">{check.label}</div>
                  {check.timestamp && (
                    <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                      Timestamp: {check.timestamp}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {data.compliance_violations?.length > 0 && (
            <div className="bg-pennie-peach-light/60 border border-pennie-peach-light rounded-2xl p-4">
              <p className="font-semibold text-pennie-peach-deeper mb-2 text-sm">
                Violations
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-pennie-graphite">
                {data.compliance_violations.map((v: string, i: number) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
