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
    if (value === 'complete') return <CheckCircle2 className={`${className} text-green-600`} />
    if (value === 'partial') return <AlertTriangle className={`${className} text-yellow-600`} />
    if (value === 'missing') return <XCircle className={`${className} text-red-600`} />
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
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            Sales Process Scorecard
          </h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
          data.overall_process_adherence === 'excellent' ? 'bg-green-100 text-green-800' :
          data.overall_process_adherence === 'good' ? 'bg-blue-100 text-blue-800' :
          data.overall_process_adherence === 'fair' ? 'bg-yellow-100 text-yellow-800' :
          'bg-red-100 text-red-800'
        }`}>
          {data.overall_process_adherence?.toUpperCase()}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 pb-6 space-y-4">
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-0.5">{renderIcon(step.value)}</span>
                <div className="flex-1">
                  <div className="font-medium text-foreground">{step.label}</div>
                  <div className="text-sm text-muted-foreground mt-1 capitalize">{(step.value || 'N/A').replace(/_/g, ' ')}</div>
                  {step.location && (
                    <div className="text-xs text-muted-foreground mt-1">{step.location}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {data.missed_opportunities?.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
              <div className="font-semibold text-yellow-900 mb-2">Missed Opportunities:</div>
              <ul className="list-disc list-inside space-y-1 text-sm text-yellow-800">
                {data.missed_opportunities.map((o: string, i: number) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {data.process_notes && (
            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <div className="font-semibold text-blue-900 mb-2">Process Notes:</div>
              <p className="text-sm text-blue-800">{data.process_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
