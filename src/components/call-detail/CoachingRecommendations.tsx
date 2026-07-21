import { useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Target,
} from 'lucide-react'

export function CoachingRecommendations({ data }: { data: any }) {
  const [isExpanded, setIsExpanded] = useState(true)

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
            <Lightbulb className="w-5 h-5 text-pennie-yellow-dark" aria-hidden="true" />
            Coaching recommendations
          </h2>
        </div>
      </button>

      {isExpanded && (
        <div className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-4">
          {data.strengths?.length > 0 && (
            <div>
              <p className="font-semibold text-pennie-green-dark mb-2 flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Strengths
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-pennie-graphite bg-pennie-green-light/60 border border-pennie-green-light rounded-2xl p-4">
                {data.strengths.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {data.areas_for_improvement?.length > 0 && (
            <div>
              <p className="font-semibold text-pennie-yellow-dark mb-2 flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Areas for improvement
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-pennie-graphite bg-pennie-yellow-light/60 border border-pennie-yellow-main/40 rounded-2xl p-4">
                {data.areas_for_improvement.map((a: string, i: number) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {data.specific_coaching_points?.length > 0 && (
            <div>
              <p className="font-semibold text-pennie-blue-deeper mb-2 flex items-center gap-2 text-sm">
                <Target className="w-4 h-4" aria-hidden="true" /> Specific coaching points
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-pennie-graphite bg-pennie-blue-light/40 border border-pennie-blue-light rounded-2xl p-4">
                {data.specific_coaching_points.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {data.training_recommendations?.length > 0 && (
            <div>
              <p className="font-semibold text-pennie-indigo-dark mb-2 flex items-center gap-2 text-sm">
                <BookOpen className="w-4 h-4" aria-hidden="true" /> Training recommendations
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-pennie-graphite bg-pennie-beige/70 border border-border rounded-2xl p-4">
                {data.training_recommendations.map((t: string, i: number) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
