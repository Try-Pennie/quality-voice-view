import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function CoachingRecommendations({ data }: { data: any }) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="bg-card rounded-lg shadow border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <h2 className="text-lg font-semibold text-foreground">💡 Coaching Recommendations</h2>
        </div>
      </button>

      {isExpanded && (
        <div className="px-6 pb-6 space-y-4">
          {data.strengths?.length > 0 && (
            <div>
              <div className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                <span>✅</span> Strengths
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground bg-green-50 border border-green-200 rounded p-4">
                {data.strengths.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {data.areas_for_improvement?.length > 0 && (
            <div>
              <div className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                <span>⚠️</span> Areas for Improvement
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground bg-yellow-50 border border-yellow-200 rounded p-4">
                {data.areas_for_improvement.map((a: string, i: number) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {data.specific_coaching_points?.length > 0 && (
            <div>
              <div className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                <span>🎯</span> Specific Coaching Points
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground bg-blue-50 border border-blue-200 rounded p-4">
                {data.specific_coaching_points.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {data.training_recommendations?.length > 0 && (
            <div>
              <div className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
                <span>📚</span> Training Recommendations
              </div>
              <ul className="list-disc list-inside space-y-1 text-sm text-foreground bg-purple-50 border border-purple-200 rounded p-4">
                {data.training_recommendations.map((t: string, i: number) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
