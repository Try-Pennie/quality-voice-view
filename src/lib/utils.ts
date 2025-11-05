import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format seconds to MM:SS
export function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Format phone number to (555) 123-4567
export function formatPhoneNumber(phone: string | null): string {
  if (!phone) return 'N/A'
  const cleaned = phone.replace(/\D/g, '')
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/)
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`
  return phone
}

// Format date/time
export function formatDateTime(dateString: string | null): string {
  if (!dateString) return 'N/A'
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Get score badge color
export function getScoreBadgeColor(score: string | null): string {
  switch (score?.toLowerCase()) {
    case 'excellent':
    case 'pass':
    case 'high':
      return 'bg-green-100 text-green-800'
    case 'good':
    case 'medium':
      return 'bg-blue-100 text-blue-800'
    case 'needs_improvement':
    case 'fair':
    case 'low':
      return 'bg-yellow-100 text-yellow-800'
    case 'poor':
    case 'fail':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

// Check if call requires attention
export function requiresAttention(qa: any): boolean {
  if (!qa) return false

  // Load thresholds from localStorage
  let thresholds = {
    overallScore: 'needs_improvement',
    compliance: 'fail',
    customerSat: 'low'
  }

  const stored = localStorage.getItem('dashboardThresholds')
  if (stored) {
    try {
      thresholds = JSON.parse(stored)
    } catch (e) {
      console.error('Failed to parse thresholds:', e)
    }
  }

  // Check manager escalation (always requires attention)
  if (qa.manager_escalation === true) return true

  // Check compliance
  if (qa.compliance_rating === thresholds.compliance) return true

  // Check overall score
  const scoreOrder = ['excellent', 'good', 'needs_improvement', 'poor']
  const thresholdIndex = scoreOrder.indexOf(thresholds.overallScore)
  const scoreIndex = scoreOrder.indexOf(qa.overall_score)
  if (scoreIndex >= thresholdIndex && scoreIndex !== -1) return true

  // Check customer satisfaction
  const satOrder = ['high', 'medium', 'low']
  const satThresholdIndex = satOrder.indexOf(thresholds.customerSat)
  const satIndex = satOrder.indexOf(qa.customer_satisfaction_likely)
  if (satIndex >= satThresholdIndex && satIndex !== -1) return true

  return false
}
