/** Persisted thresholds used by the Calls “Below threshold” server filter. */
export interface ThresholdSettings {
  overallScore: 'excellent' | 'good' | 'needs_improvement' | 'poor'
  compliance: 'pass' | 'fail'
  customerSat: 'high' | 'medium' | 'low'
}

export const DEFAULT_THRESHOLDS: ThresholdSettings = {
  overallScore: 'needs_improvement',
  compliance: 'fail',
  customerSat: 'low',
}
