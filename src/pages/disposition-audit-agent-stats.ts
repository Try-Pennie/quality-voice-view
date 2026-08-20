import type { DispositionAuditRow } from '../lib/disposition-audit-queries'

type AgentStatRow = Pick<
  DispositionAuditRow,
  'agent_email' | 'current_disposition' | 'suggested_disposition' | 'talk_time' | 'is_reviewed' | 'accurate'
>

export type DispositionMismatchPattern = {
  readonly currentDisposition: string
  readonly suggestedDisposition: string
  readonly count: number
}

export type DispositionAuditAgentStat = {
  readonly agentEmail: string | null
  readonly potentialIssues: number
  readonly toReview: number
  readonly confirmedIssues: number
  readonly falseAlarms: number
  readonly earlyOnePointFiveCalls: number
  readonly severeOnePointFiveCalls: number
  readonly medianTalkTimeSeconds: number | null
  readonly topMismatch: DispositionMismatchPattern | null
}

/** Review-priority tier for a 1.5 disposition made before ten minutes. */
export type DispositionTimingFlag = 'early' | 'severe' | null

type MutableAgentStat = {
  agentEmail: string | null
  potentialIssues: number
  toReview: number
  confirmedIssues: number
  falseAlarms: number
  earlyOnePointFiveCalls: number
  severeOnePointFiveCalls: number
  talkTimes: number[]
  mismatches: Map<string, DispositionMismatchPattern>
}

const UNKNOWN_AGENT_KEY = '\u0000unknown-agent'
const UNKNOWN_DISPOSITION = 'Unknown disposition'
const EARLY_ONE_POINT_FIVE_SECONDS = 10 * 60
const SEVERE_ONE_POINT_FIVE_SECONDS = 2 * 60

/** Classifies short 1.5 calls without treating the signal as a confirmed issue. */
export function dispositionTimingFlag(
  currentDisposition: string | null,
  talkTimeSeconds: number | null,
): DispositionTimingFlag {
  if (!currentDisposition?.trim().startsWith('1.5 -')) return null
  if (talkTimeSeconds === null || !Number.isFinite(talkTimeSeconds) || talkTimeSeconds < 0) return null
  if (talkTimeSeconds < SEVERE_ONE_POINT_FIVE_SECONDS) return 'severe'
  if (talkTimeSeconds < EARLY_ONE_POINT_FIVE_SECONDS) return 'early'
  return null
}

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Summarizes the page's already-scoped audit findings by agent.
 * Manager-confirmed false alarms remain visible but do not count as potential issues.
 */
export function aggregateDispositionAuditByAgent(
  rows: ReadonlyArray<AgentStatRow>,
): DispositionAuditAgentStat[] {
  const byAgent = new Map<string, MutableAgentStat>()

  for (const row of rows) {
    const agentEmail = row.agent_email?.trim() || null
    const agentKey = agentEmail?.toLowerCase() ?? UNKNOWN_AGENT_KEY
    const stat = byAgent.get(agentKey) ?? {
      agentEmail,
      potentialIssues: 0,
      toReview: 0,
      confirmedIssues: 0,
      falseAlarms: 0,
      earlyOnePointFiveCalls: 0,
      severeOnePointFiveCalls: 0,
      talkTimes: [],
      mismatches: new Map<string, DispositionMismatchPattern>(),
    }

    if (!row.is_reviewed) stat.toReview += 1
    if (row.accurate === false) {
      stat.falseAlarms += 1
    } else {
      stat.potentialIssues += 1
      if (row.accurate === true) stat.confirmedIssues += 1
      if (row.talk_time !== null && Number.isFinite(row.talk_time) && row.talk_time >= 0) {
        stat.talkTimes.push(row.talk_time)
      }

      const timingFlag = dispositionTimingFlag(row.current_disposition, row.talk_time)
      if (timingFlag !== null) stat.earlyOnePointFiveCalls += 1
      if (timingFlag === 'severe') stat.severeOnePointFiveCalls += 1

      const currentDisposition = row.current_disposition?.trim() || UNKNOWN_DISPOSITION
      const suggestedDisposition = row.suggested_disposition?.trim() || UNKNOWN_DISPOSITION
      const mismatchKey = `${currentDisposition}\u0000${suggestedDisposition}`
      const mismatch = stat.mismatches.get(mismatchKey)
      stat.mismatches.set(mismatchKey, {
        currentDisposition,
        suggestedDisposition,
        count: (mismatch?.count ?? 0) + 1,
      })
    }

    byAgent.set(agentKey, stat)
  }

  return Array.from(byAgent.values(), stat => ({
    agentEmail: stat.agentEmail,
    potentialIssues: stat.potentialIssues,
    toReview: stat.toReview,
    confirmedIssues: stat.confirmedIssues,
    falseAlarms: stat.falseAlarms,
    earlyOnePointFiveCalls: stat.earlyOnePointFiveCalls,
    severeOnePointFiveCalls: stat.severeOnePointFiveCalls,
    medianTalkTimeSeconds: median(stat.talkTimes),
    topMismatch: Array.from(stat.mismatches.values()).sort(
      (a, b) =>
        b.count - a.count ||
        a.currentDisposition.localeCompare(b.currentDisposition) ||
        a.suggestedDisposition.localeCompare(b.suggestedDisposition),
    )[0] ?? null,
  })).sort(
    (a, b) =>
      b.potentialIssues - a.potentialIssues ||
      b.toReview - a.toReview ||
      b.confirmedIssues - a.confirmedIssues ||
      (a.agentEmail ?? '').localeCompare(b.agentEmail ?? ''),
  )
}
