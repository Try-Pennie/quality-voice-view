import type { DispositionAuditRow } from '../lib/disposition-audit-queries'

type AgentStatRow = Pick<
  DispositionAuditRow,
  'agent_email' | 'current_disposition' | 'suggested_disposition' | 'is_reviewed' | 'accurate'
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
  readonly topMismatch: DispositionMismatchPattern | null
}

type MutableAgentStat = {
  agentEmail: string | null
  potentialIssues: number
  toReview: number
  confirmedIssues: number
  falseAlarms: number
  mismatches: Map<string, DispositionMismatchPattern>
}

const UNKNOWN_AGENT_KEY = '\u0000unknown-agent'
const UNKNOWN_DISPOSITION = 'Unknown disposition'

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
      mismatches: new Map<string, DispositionMismatchPattern>(),
    }

    if (!row.is_reviewed) stat.toReview += 1
    if (row.accurate === false) {
      stat.falseAlarms += 1
    } else {
      stat.potentialIssues += 1
      if (row.accurate === true) stat.confirmedIssues += 1

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
