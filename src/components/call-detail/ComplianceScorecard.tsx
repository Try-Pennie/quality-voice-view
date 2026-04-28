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
    if (value === 'pass') return <CheckCircle2 className={`${className} text-green-600`} />
    if (value === 'fail') return <XCircle className={`${className} text-red-600`} />
    return <Circle className={`${className} text-muted-foreground`} />
  }

  return (
    <div className="bg-card rounded-lg shadow border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Compliance Scorecard
          </h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
          data.overall_compliance_score === 'pass'
            ? 'bg-green-100 text-green-800'
            : 'bg-red-100 text-red-800'
        }`}>
          {data.overall_compliance_score?.toUpperCase()}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 pb-6 space-y-4">
          {data.requires_manager_review && (
            <div className="bg-red-50 border-2 border-red-300 rounded p-4">
              <div className="font-bold text-red-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> REQUIRES MANAGER REVIEW
              </div>
              <div className="text-red-800 text-sm">{data.escalation_reason}</div>
            </div>
          )}

          <div className="space-y-3">
            {checks.map((check, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-0.5">{renderIcon(check.value)}</span>
                <div className="flex-1">
                  <div className="font-medium text-foreground">{check.label}</div>
                  {check.timestamp && (
                    <div className="text-xs text-muted-foreground mt-1">Timestamp: {check.timestamp}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {data.compliance_violations?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-4">
              <div className="font-semibold text-red-900 mb-2">Violations:</div>
              <ul className="list-disc list-inside space-y-1 text-sm text-red-800">
                {data.compliance_violations.map((v: string, i: number) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
