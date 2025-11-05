export interface ThresholdSettings {
  talkTime: {
    min: number // seconds
    max: number // seconds
  }
  handleTime: {
    min: number
    max: number
  }
  complianceRate: {
    min: number // percentage (0-100)
  }
  customerSatisfaction: {
    highThreshold: number // percentage for "high" classification
    lowThreshold: number // percentage for "low" classification
  }
}

export const DEFAULT_THRESHOLDS: ThresholdSettings = {
  talkTime: {
    min: 180, // 3 minutes
    max: 900, // 15 minutes
  },
  handleTime: {
    min: 240, // 4 minutes
    max: 1200, // 20 minutes
  },
  complianceRate: {
    min: 90, // 90%
  },
  customerSatisfaction: {
    highThreshold: 80, // 80% and above = high
    lowThreshold: 60, // below 60% = low
  },
}
