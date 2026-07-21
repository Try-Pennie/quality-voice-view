import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  XCircle,
} from 'lucide-react'
import { getScoreBadgeColor } from '../../lib/utils'

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
      <CheckCircle2 className={`${className} text-pennie-green-dark`} />
    ) : (
      <XCircle className={`${className} text-pennie-peach-deeper`} />
    )
  }

  const renderRow = (item: { key: string; label: string }) => {
    const covered = !!data[`${item.key}_covered`]
    const evidence = data[`${item.key}_evidence`] as string | undefined
    return (
      <div key={item.key} className="flex items-start gap-3">
        <span className="mt-0.5">{renderCoverageIcon(covered)}</span>
        <div className="flex-1">
          <div className="font-medium text-pennie-graphite">{item.label}</div>
          <div className="text-sm text-muted-foreground">
            {covered ? 'Covered' : 'Not covered'}
          </div>
          {evidence && (
            <div className="text-xs text-muted-foreground mt-1 italic">“{evidence}”</div>
          )}
        </div>
      </div>
    )
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
            <ClipboardCheck className="w-5 h-5 text-pennie-blue-deeper" aria-hidden="true" />
            Program expectations
          </h2>
        </div>
        <span className={getScoreBadgeColor(status === 'not_applicable' ? null : status ?? null)}>
          {status === 'not_applicable' ? 'N/A' : status || 'N/A'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-pennie-graphite">Enrollment completed:</span>
            {data.enrollment_completed ? 'Yes' : 'No'}
          </div>
          {data.enrollment_evidence_quote && (
            <div className="text-xs text-muted-foreground italic -mt-2">
              “{data.enrollment_evidence_quote}”
            </div>
          )}

          <div>
            <p className="pennie-label mb-3">Program phases</p>
            <div className="space-y-3">{PHASES.map(renderRow)}</div>
          </div>

          <div>
            <p className="pennie-label mb-3">Required disclosures</p>
            <div className="space-y-3">{DISCLOSURES.map(renderRow)}</div>
          </div>

          {data.missing_elements?.length > 0 && (
            <div className="bg-pennie-yellow-light/60 border border-pennie-yellow-main/50 rounded-2xl p-4">
              <p className="font-semibold text-pennie-yellow-dark mb-2 flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                Missing elements
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-pennie-graphite">
                {data.missing_elements.map((e: string, i: number) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {data.section_summary && (
            <div className="bg-pennie-blue-light/40 border border-pennie-blue-light rounded-2xl p-4">
              <p className="font-semibold text-pennie-blue-deeper mb-2 text-sm">Summary</p>
              <p className="text-sm text-pennie-graphite leading-relaxed">{data.section_summary}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
