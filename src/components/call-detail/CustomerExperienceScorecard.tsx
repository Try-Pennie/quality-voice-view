import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Smile,
  Star,
  XCircle,
} from 'lucide-react'
import { getScoreBadgeColor } from '../../lib/utils'

export function CustomerExperienceScorecard({ data }: { data: any }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const aspects = [
    { label: 'Professional Tone', value: data.professional_tone, examples: data.professional_tone_examples },
    { label: 'Clear Communication', value: data.clear_communication, examples: data.clear_communication_examples },
    { label: 'Active Listening', value: data.active_listening, examples: data.active_listening_examples },
    { label: 'Patience & Empathy', value: data.patience_empathy, examples: data.patience_empathy_examples },
    { label: 'Customer Focused', value: data.customer_focused, examples: data.customer_focused_examples },
  ]

  const renderIcon = (value: string) => {
    const className = 'w-5 h-5 shrink-0'
    if (value === 'excellent') return <Star className={`${className} text-pennie-yellow-dark fill-pennie-yellow-main`} />
    if (value === 'good') return <CheckCircle2 className={`${className} text-pennie-green-dark`} />
    if (value === 'fair' || value === 'needs_improvement') return <AlertTriangle className={`${className} text-pennie-yellow-dark`} />
    if (value === 'poor') return <XCircle className={`${className} text-pennie-peach-deeper`} />
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
            <Smile className="w-5 h-5 text-pennie-blue-deeper" aria-hidden="true" />
            Customer experience scorecard
          </h2>
        </div>
        <span className={getScoreBadgeColor(data.overall_customer_experience)}>
          {data.overall_customer_experience || 'N/A'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-4">
          <div className="space-y-4">
            {aspects.map((aspect, i) => (
              <div key={i} className="border-b border-border pb-3 last:border-0">
                <div className="flex items-start gap-3 mb-2">
                  <span className="mt-0.5">{renderIcon(aspect.value)}</span>
                  <div className="flex-1">
                    <div className="font-medium text-pennie-graphite">{aspect.label}</div>
                    <div className="text-sm text-muted-foreground capitalize">
                      {(aspect.value || 'N/A').replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>
                {aspect.examples?.length > 0 && (
                  <div className="ml-8 mt-2">
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Examples:</div>
                    <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                      {aspect.examples.map((ex: string, j: number) => (
                        <li key={j}>{ex}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {data.customer_experience_notes && (
            <div className="bg-pennie-blue-light/40 border border-pennie-blue-light rounded-2xl p-4">
              <p className="font-semibold text-pennie-blue-deeper mb-2 text-sm">
                Additional notes
              </p>
              <p className="text-sm text-pennie-graphite leading-relaxed">
                {data.customer_experience_notes}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
