// Pure, dependency-free generator for the Weekly Manager Action Queue.
//
// Imports only TYPES from insights-queries (erased at runtime), so this module
// pulls in no data/supabase code — it's trivially unit-checkable in node
// (see insights-action-queue.check.ts) and reviewable in isolation.
//
// Privacy: actions are derived solely from the same aggregate-safe metrics as
// the rest of the report — counts and rates the manager is already cleared to
// see. No transcripts, customer PII, recordings, or evidence quotes.
import type {
  TeamAggregate,
  WatchlistEntry,
  TopAgent,
  ModulePressure,
} from './insights-queries'

// A concrete management action, ordered high → low so the queue reads top-down.
export type ManagerAction = {
  id: string // stable React key
  priority: 'high' | 'medium' | 'low'
  category: 'review' | 'coach' | 'recognize' | 'validate' | 'coverage' | 'maintain'
  title: string
  detail: string // why it matters
  action: string // the recommended next step
  link?: { to: string; label: string } // optional in-app target
}

const PRIORITY_RANK: Record<ManagerAction['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

// Below this team-wide graded share (or absolute graded count) the QA rates are
// too thin a sample to coach on with confidence.
const MIN_QA_COVERAGE = 0.05
const MIN_QA_CALLS_TEAM = 10

function agentLink(email: string): ManagerAction['link'] {
  return { to: `/dashboard/team/${encodeURIComponent(email)}`, label: 'Open agent' }
}

const ALERTS_LINK: ManagerAction['link'] = {
  to: '/dashboard/alerts',
  label: 'Open alerts',
}

// Turn the assembled metrics into an ordered, manager-facing action list.
// Pure and deterministic: same inputs → same queue. Caveats about AI/QA signals
// being directional live in the copy so they survive print/PDF.
export function buildActionQueue(input: {
  team: TeamAggregate
  unreviewedAlerts: number
  totalAlerts: number
  watchlist: WatchlistEntry[]
  topAgents: TopAgent[]
  modulePressure: ModulePressure[]
}): ManagerAction[] {
  const { team, unreviewedAlerts, totalAlerts, watchlist, topAgents, modulePressure } = input
  const out: ManagerAction[] = []

  // 1. Clear the alert backlog before coaching, so conversations sit on
  //    confirmed issues rather than raw model flags.
  if (unreviewedAlerts > 0) {
    out.push({
      id: 'review-alerts',
      priority: unreviewedAlerts >= 10 ? 'high' : 'medium',
      category: 'review',
      title: `Clear ${unreviewedAlerts} unreviewed alert${unreviewedAlerts === 1 ? '' : 's'}`,
      detail: `${unreviewedAlerts} of ${totalAlerts} alert${totalAlerts === 1 ? '' : 's'} this week are still unreviewed. Resolving them first keeps coaching grounded in confirmed issues, not unvetted AI flags.`,
      action: 'Work the alert queue before this week’s coaching conversations.',
      link: ALERTS_LINK,
    })
  }

  // 2. Coach the top of the watchlist. Cap at three so the week stays focused.
  const renderedCoachEmails = new Set<string>()
  for (const w of watchlist.slice(0, 3)) {
    renderedCoachEmails.add(w.agent_email)
    const urgent = w.compliance_pass_rate < 75 || w.reasons.length >= 3
    out.push({
      id: `coach-${w.agent_email}`,
      priority: urgent ? 'high' : 'medium',
      category: 'coach',
      title: `Coach ${w.agent_full_name || w.agent_email}`,
      detail: `${w.reasons.join(' · ')}. Based on ${w.qa_count} graded call${w.qa_count === 1 ? '' : 's'} — a directional QA signal, so confirm on a real call first.`,
      action: 'Review one recent flagged call together and agree a single focus for the week.',
      link: agentLink(w.agent_email),
    })
  }

  // 3. Recognize the standout — only when they're genuinely strong, so praise
  //    stays credible.
  const top = topAgents[0]
  if (top && top.compliance_pass_rate >= 85 && !renderedCoachEmails.has(top.agent_email)) {
    out.push({
      id: `recognize-${top.agent_email}`,
      priority: 'low',
      category: 'recognize',
      title: `Recognize ${top.agent_full_name || top.agent_email}`,
      detail: `${top.compliance_pass_rate}% compliance and ${top.csat_high_rate}% high-CSAT across ${top.qa_count} graded calls — top of the team this week.`,
      action: 'Call it out publicly and ask what’s working so the floor can copy it.',
      link: agentLink(top.agent_email),
    })
  }

  // 4. Validate the biggest module spike before treating it as a real trend —
  //    it could be a model shift, not agent behavior.
  const rising = modulePressure.filter(m => m.rising)[0]
  if (rising) {
    out.push({
      id: `validate-${rising.module}`,
      priority: 'medium',
      category: 'validate',
      title: `Validate the ${rising.label} spike`,
      detail: `${rising.total} ${rising.label} alerts this week vs a ${rising.baselineWeeklyAvg}/wk trailing average. AI alerts are directional — this could be a real trend or a model shift.`,
      action: 'Spot-check a few alerts before scheduling a team refresher.',
      link: ALERTS_LINK,
    })
  }

  // 5. Flag thin QA coverage so the manager reads the rates with caution.
  if (team.callCount > 0) {
    const coverage = team.qaCount / team.callCount
    if (team.qaCount === 0) {
      out.push({
        id: 'coverage',
        priority: 'medium',
        category: 'coverage',
        title: 'No graded QA this week',
        detail: `${team.callCount} calls landed but none were graded, so there are no quality signals to coach on yet. Sampling may be low or grading may still be catching up.`,
        action: 'Treat the week as low-confidence and confirm whether QA coverage or grading lag needs attention.',
        link: ALERTS_LINK,
      })
    } else if (coverage < MIN_QA_COVERAGE || team.qaCount < MIN_QA_CALLS_TEAM) {
      out.push({
        id: 'coverage',
        priority: 'medium',
        category: 'coverage',
        title: 'Low graded-QA coverage',
        detail: `Only ${team.qaCount} of ${team.callCount} calls were graded (${Math.floor(coverage * 100)}%). This week’s rates are a thin sample — treat them as low-confidence.`,
        action: 'Read the metrics with caution and confirm whether QA coverage or grading lag needs attention.',
      })
    }
  }

  // 6. Never leave the queue empty. A quiet week still gets a maintenance move.
  if (out.length === 0) {
    out.push({
      id: 'maintain',
      priority: 'low',
      category: 'maintain',
      title: 'Hold the line — steady week',
      detail: 'No alert backlog, coaching flags, module spikes, or coverage gaps this week. Metrics are steady.',
      action: 'Keep reinforcing current habits and pick one strong call to praise.',
    })
  }

  return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
}
