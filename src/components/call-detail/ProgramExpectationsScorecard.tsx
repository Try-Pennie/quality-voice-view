import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  MinusCircle,
  XCircle,
} from 'lucide-react'

// Program phases the agent is expected to walk the customer through, plus the
// required downside disclosures. Each maps to a `<key>_covered` boolean and a
// `<key>_evidence` quote in qa_json.program_expectations_scorecard.
const PHASES = [
  { key: 'phase_stabilization', label: 'Stabilization Phase' },
  { key: 'phase_recovery', label: 'Recovery Phase' },
  { key: 'phase_rebuild', label: 'Rebuild Phase' },
  { key: 'phase_impact', label: 'Credit Impact Phase' },
]

const DISCLOSURES = [
  { key: 'payments_point', label: 'Stopping Payments Explained' },
  { key: 'creditor_calls_point', label: 'Creditor Calls Disclosed' },
  { key: 'legal_action_point', label: 'Legal Action Risk Disclosed' },
]

export function ProgramExpectationsScorecard({ data }: { data: any }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const status = data.section_status as string | undefined

  const renderCoverageIcon = (covered: boolean) => {
    const className = 'w-5 h-5 shrink-0'
    return covered ? (
      <CheckCircle2 className={`${className} text-green-600`} />
    ) : (
      <XCircle className={`${className} text-red-600`} />
    )
  }

  const renderRow = (item: { key: string; label: string }) => {
    const covered = !!data[`${item.key}_covered`]
    const evidence = data[`${item.key}_evidence`] as string | undefined
    return (
      <div key={item.key} className="flex items-start gap-3">
        <span className="mt-0.5">{renderCoverageIcon(covered)}</span>
        <div className="flex-1">
          <div className="font-medium text-foreground">{item.label}</div>
          <div className="text-sm text-muted-foreground">{covered ? 'Covered' : 'Not covered'}</div>
          {evidence && (
            <div className="text-xs text-muted-foreground mt-1 italic">“{evidence}”</div>
          )}
        </div>
      </div>
    )
  }

  const badgeIcon =
    status === 'pass' ? <CheckCircle2 className="w-4 h-4" /> :
    status === 'fail' ? <XCircle className="w-4 h-4" /> :
    <MinusCircle className="w-4 h-4" />

  return (
    <div className="bg-card rounded-lg shadow border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-blue-600" />
            Program Expectations
          </h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 ${
          status === 'pass' ? 'bg-green-100 text-green-800' :
          status === 'fail' ? 'bg-red-100 text-red-800' :
          'bg-muted text-muted-foreground'
        }`}>
          {badgeIcon}
          {status === 'not_applicable' ? 'N/A' : status?.toUpperCase() || 'N/A'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 pb-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Enrollment completed:</span>
            {data.enrollment_completed ? 'Yes' : 'No'}
          </div>
          {data.enrollment_evidence_quote && (
            <div className="text-xs text-muted-foreground italic -mt-2">“{data.enrollment_evidence_quote}”</div>
          )}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Program Phases
            </div>
            <div className="space-y-3">{PHASES.map(renderRow)}</div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Required Disclosures
            </div>
            <div className="space-y-3">{DISCLOSURES.map(renderRow)}</div>
          </div>

          {data.missing_elements?.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
              <div className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Missing Elements:
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm text-yellow-800">
                {data.missing_elements.map((e: string, i: number) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {data.section_summary && (
            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <div className="font-semibold text-blue-900 mb-2">Summary:</div>
              <p className="text-sm text-blue-800">{data.section_summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
