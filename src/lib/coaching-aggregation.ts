import type { QAJson } from '../types/database'

export type CoachingTheme = {
  theme: string
  count: number
}

export type CoachingThemes = {
  strengths: CoachingTheme[]
  improvements: CoachingTheme[]
  coachingPoints: CoachingTheme[]
  trainingRecs: CoachingTheme[]
}

const STOPWORD_PREFIXES = [
  'the agent ',
  'agent ',
  'they ',
  'rep ',
  'representative ',
  'consultant ',
]

const FILLERS = new Set([
  'a',
  'an',
  'the',
  'is',
  'was',
  'were',
  'be',
  'been',
  'and',
  'or',
  'but',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'that',
  'this',
  'these',
  'those',
  'their',
  'them',
  'his',
  'her',
  'its',
])

function normalize(raw: string): string {
  let s = raw.trim().toLowerCase()
  for (const prefix of STOPWORD_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length)
      break
    }
  }
  s = s.replace(/[.,;:!?"']/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

function bucketKey(normalized: string): string {
  const words = normalized.split(' ').filter(w => w && !FILLERS.has(w))
  return words.slice(0, 6).join(' ')
}

function rank(items: string[], topN = 5): CoachingTheme[] {
  const groups = new Map<string, { count: number; canonical: string }>()
  for (const raw of items) {
    if (!raw || !raw.trim()) continue
    const normalized = normalize(raw)
    if (!normalized) continue
    const key = bucketKey(normalized)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      // Keep the longest canonical phrasing — usually most descriptive
      if (raw.length > existing.canonical.length) existing.canonical = raw.trim()
    } else {
      groups.set(key, { count: 1, canonical: raw.trim() })
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)
    .map(g => ({ theme: g.canonical, count: g.count }))
}

export function aggregateCoachingThemes(qaJsonList: QAJson[]): CoachingThemes {
  const strengths: string[] = []
  const improvements: string[] = []
  const coachingPoints: string[] = []
  const trainingRecs: string[] = []

  for (const qa of qaJsonList) {
    const cr = qa?.coaching_recommendations
    if (!cr) continue
    if (Array.isArray(cr.strengths)) strengths.push(...cr.strengths)
    if (Array.isArray(cr.areas_for_improvement))
      improvements.push(...cr.areas_for_improvement)
    if (Array.isArray(cr.specific_coaching_points))
      coachingPoints.push(...cr.specific_coaching_points)
    if (Array.isArray(cr.training_recommendations))
      trainingRecs.push(...cr.training_recommendations)
  }

  return {
    strengths: rank(strengths),
    improvements: rank(improvements),
    coachingPoints: rank(coachingPoints),
    trainingRecs: rank(trainingRecs),
  }
}
