import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function CustomerExperienceScorecard({ data }: { data: any }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const aspects = [
    { label: 'Professional Tone', value: data.professional_tone, examples: data.professional_tone_examples },
    { label: 'Clear Communication', value: data.clear_communication, examples: data.clear_communication_examples },
    { label: 'Active Listening', value: data.active_listening, examples: data.active_listening_examples },
    { label: 'Patience & Empathy', value: data.patience_empathy, examples: data.patience_empathy_examples },
    { label: 'Customer Focused', value: data.customer_focused, examples: data.customer_focused_examples },
  ]

  const getIcon = (value: string) => {
    if (value === 'excellent') return '🌟'
    if (value === 'good') return '✅'
    if (value === 'fair' || value === 'needs_improvement') return '⚠️'
    if (value === 'poor') return '❌'
    return '⚪'
  }

  return (
    <div className="bg-card rounded-lg shadow border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <h2 className="text-lg font-semibold text-foreground">😊 Customer Experience Scorecard</h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
          data.overall_customer_experience === 'excellent' ? 'bg-green-100 text-green-800' :
          data.overall_customer_experience === 'good' ? 'bg-blue-100 text-blue-800' :
          data.overall_customer_experience === 'fair' ? 'bg-yellow-100 text-yellow-800' :
          'bg-red-100 text-red-800'
        }`}>
          {data.overall_customer_experience?.toUpperCase()}
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 pb-6 space-y-4">
          <div className="space-y-4">
            {aspects.map((aspect, i) => (
              <div key={i} className="border-b border-border pb-3 last:border-0">
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-xl">{getIcon(aspect.value)}</span>
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{aspect.label}</div>
                    <div className="text-sm text-muted-foreground capitalize">{aspect.value || 'N/A'}</div>
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
            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <div className="font-semibold text-blue-900 mb-2">Additional Notes:</div>
              <p className="text-sm text-blue-800">{data.customer_experience_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
