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

export type TeamCoachingTheme = CoachingTheme & {
  agent_count: number
}

export type TeamCoachingThemes = {
  strengths: TeamCoachingTheme[]
  improvements: TeamCoachingTheme[]
  coachingPoints: TeamCoachingTheme[]
  trainingRecs: TeamCoachingTheme[]
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

// Team-level rank: also tracks how many distinct agents contributed each theme.
// Primary sort is agent_count (training-investment signal), then count.
function rankTeam(
  items: { agent_email: string; raw: string }[],
  topN = 5,
): TeamCoachingTheme[] {
  const groups = new Map<
    string,
    { count: number; canonical: string; agents: Set<string> }
  >()
  for (const { agent_email, raw } of items) {
    if (!raw || !raw.trim()) continue
    const normalized = normalize(raw)
    if (!normalized) continue
    const key = bucketKey(normalized)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.agents.add(agent_email)
      if (raw.length > existing.canonical.length) existing.canonical = raw.trim()
    } else {
      groups.set(key, {
        count: 1,
        canonical: raw.trim(),
        agents: new Set([agent_email]),
      })
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => {
      const agentDiff = b.agents.size - a.agents.size
      if (agentDiff !== 0) return agentDiff
      return b.count - a.count
    })
    .slice(0, topN)
    .map(g => ({
      theme: g.canonical,
      count: g.count,
      agent_count: g.agents.size,
    }))
}

export function aggregateTeamCoachingThemes(
  byAgent: { agent_email: string; qaJson: QAJson[] }[],
): TeamCoachingThemes {
  const strengths: { agent_email: string; raw: string }[] = []
  const improvements: { agent_email: string; raw: string }[] = []
  const coachingPoints: { agent_email: string; raw: string }[] = []
  const trainingRecs: { agent_email: string; raw: string }[] = []

  for (const { agent_email, qaJson } of byAgent) {
    for (const qa of qaJson) {
      const cr = qa?.coaching_recommendations
      if (!cr) continue
      if (Array.isArray(cr.strengths))
        for (const r of cr.strengths) strengths.push({ agent_email, raw: r })
      if (Array.isArray(cr.areas_for_improvement))
        for (const r of cr.areas_for_improvement)
          improvements.push({ agent_email, raw: r })
      if (Array.isArray(cr.specific_coaching_points))
        for (const r of cr.specific_coaching_points)
          coachingPoints.push({ agent_email, raw: r })
      if (Array.isArray(cr.training_recommendations))
        for (const r of cr.training_recommendations)
          trainingRecs.push({ agent_email, raw: r })
    }
  }

  return {
    strengths: rankTeam(strengths),
    improvements: rankTeam(improvements),
    coachingPoints: rankTeam(coachingPoints),
    trainingRecs: rankTeam(trainingRecs),
  }
}
