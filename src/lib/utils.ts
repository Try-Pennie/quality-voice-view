import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { BUSINESS_TIMEZONE } from "./time-zone";

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

// Format date/time in Eastern time so every viewer sees the same wall-clock
// stamp regardless of where they're sitting. Pair with an "(ET)" column
// header / label where the timezone isn't otherwise obvious.
export function formatDateTime(dateString: string | Date | null): string {
  if (!dateString) return 'N/A'
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString
  return date.toLocaleString('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Pennie pill classes for legacy CallDetailPage callers. Prefer
// pillClasses(accentForScore(...)) from lib/violation-styles for new code.
export function getScoreBadgeColor(score: string | null): string {
  switch (score?.toLowerCase()) {
    case 'excellent':
    case 'pass':
    case 'high':
      return 'pennie-pill bg-pennie-green-light text-pennie-green-dark'
    case 'good':
    case 'medium':
      return 'pennie-pill bg-pennie-blue-light text-pennie-blue-dark'
    case 'needs_improvement':
    case 'fair':
    case 'low':
      return 'pennie-pill bg-pennie-yellow-light text-pennie-yellow-dark'
    case 'poor':
    case 'fail':
      return 'pennie-pill bg-pennie-peach-light text-pennie-peach-dark'
    default:
      return 'pennie-pill bg-pennie-beige text-pennie-navy'
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
