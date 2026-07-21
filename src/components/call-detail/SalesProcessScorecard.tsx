import { useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  XCircle,
} from 'lucide-react'
import { getScoreBadgeColor } from '../../lib/utils'

export function SalesProcessScorecard({ data }: { data: any }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const steps = [
    { label: 'Step 1: Agenda Setting', value: data.step1_agenda_setting, location: data.step1_location },
    { label: 'Step 2: Credit Review', value: data.step2_credit_review, location: data.step2_location },
    { label: 'Step 3: Agent Inputs', value: data.step3_agent_inputs, location: data.step3_location },
    { label: 'Step 4: Paydown Projections', value: data.step4_paydown_projections, location: data.step4_location },
    { label: 'Step 5: Offers Review', value: data.step5_offers_review, location: data.step5_location },
    { label: 'Step 6: Debt Resolution', value: data.step6_debt_resolution, location: data.step6_location },
  ]

  // Per-step values use the vocabulary complete | partial | missing | not_applicable
  // (distinct from overall_process_adherence, which is excellent/good/fair/poor).
  const renderIcon = (value: string) => {
    const className = 'w-5 h-5 shrink-0'
    if (value === 'complete') return <CheckCircle2 className={`${className} text-pennie-green-dark`} />
    if (value === 'partial') return <AlertTriangle className={`${className} text-pennie-yellow-dark`} />
    if (value === 'missing') return <XCircle className={`${className} text-pennie-peach-deeper`} />
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
            <BarChart3 className="w-5 h-5 text-pennie-blue-deeper" aria-hidden="true" />
            Sales process scorecard
          </h2>
        </div>
        <span className={getScoreBadgeColor(data.overall_process_adherence)}>
          {data.overall_process_adherence || 'N/A'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-4">
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-0.5">{renderIcon(step.value)}</span>
                <div className="flex-1">
                  <div className="font-medium text-pennie-graphite">{step.label}</div>
                  <div className="text-sm text-muted-foreground mt-1 capitalize">
                    {(step.value || 'N/A').replace(/_/g, ' ')}
                  </div>
                  {step.location && (
                    <div className="text-xs text-muted-foreground mt-1">{step.location}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {data.missed_opportunities?.length > 0 && (
            <div className="bg-pennie-yellow-light/60 border border-pennie-yellow-main/50 rounded-2xl p-4">
              <p className="font-semibold text-pennie-yellow-dark mb-2 text-sm">
                Missed opportunities
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-pennie-graphite">
                {data.missed_opportunities.map((o: string, i: number) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {data.process_notes && (
            <div className="bg-pennie-blue-light/40 border border-pennie-blue-light rounded-2xl p-4">
              <p className="font-semibold text-pennie-blue-deeper mb-2 text-sm">
                Process notes
              </p>
              <p className="text-sm text-pennie-graphite leading-relaxed">{data.process_notes}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
