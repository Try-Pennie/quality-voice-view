// Runnable self-check for buildActionQueue. No test runner needed:
//   npx tsx src/lib/insights-action-queue.check.ts
// Exits non-zero on the first failed assertion.
import assert from 'node:assert/strict'
import { buildActionQueue } from './insights-action-queue'
import type { TeamAggregate } from './insights-queries'

function team(over: Partial<TeamAggregate> = {}): TeamAggregate {
  return {
    agentCount: 5,
    callCount: 400,
    qaCount: 80,
    compliancePassRate: 90,
    csatHighRate: 70,
    escalationRate: 5,
    weeks: 1,
    ...over,
  }
}

// Quiet week → exactly one low-priority maintenance action, never empty.
{
  const q = buildActionQueue({
    team: team(),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [],
    topAgents: [],
    modulePressure: [],
  })
  assert.equal(q.length, 1)
  assert.equal(q[0].category, 'maintain')
  assert.equal(q[0].priority, 'low')
}

// Backlog ≥10 is high priority and links to alerts; smaller backlogs are medium.
{
  const high = buildActionQueue({
    team: team(),
    unreviewedAlerts: 12,
    totalAlerts: 20,
    watchlist: [],
    topAgents: [],
    modulePressure: [],
  })
  const review = high.find(a => a.id === 'review-alerts')!
  assert.equal(review.priority, 'high')
  assert.equal(review.link?.to, '/dashboard/alerts')

  const medium = buildActionQueue({
    team: team(),
    unreviewedAlerts: 3,
    totalAlerts: 6,
    watchlist: [],
    topAgents: [],
    modulePressure: [],
  })
  assert.equal(medium.find(a => a.id === 'review-alerts')!.priority, 'medium')
}

// Watchlist is capped at three; a deep-compliance agent is high priority.
{
  const w = (email: string, comp: number, reasons: string[]) => ({
    agent_email: email,
    agent_full_name: null,
    call_count: 30,
    qa_count: 10,
    compliance_pass_rate: comp,
    compliance_delta_pts: null,
    escalation_rate: 0,
    csat_high_rate: 0,
    unreviewed_alerts: 0,
    reasons,
  })
  const q = buildActionQueue({
    team: team(),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [
      w('a@x', 60, ['Compliance below 80%']),
      w('b@x', 85, ['CSAT-high below 50%']),
      w('c@x', 85, ['Escalation rate ≥ 10%']),
      w('d@x', 85, ['Soft CSAT']),
    ],
    topAgents: [],
    modulePressure: [],
  })
  const coach = q.filter(a => a.category === 'coach')
  assert.equal(coach.length, 3) // capped
  assert.equal(q.find(a => a.id === 'coach-a@x')!.priority, 'high')
  assert.equal(q.find(a => a.id === 'coach-b@x')!.priority, 'medium')
}

// Recognize only fires for a genuinely strong top agent (≥85% compliance),
// and does not duplicate an agent already in the coach queue.
{
  const topStrong = {
    agent_email: 't@x',
    agent_full_name: 'Top',
    call_count: 50,
    qa_count: 20,
    compliance_pass_rate: 96,
    csat_high_rate: 88,
  }
  const q1 = buildActionQueue({
    team: team(),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [],
    topAgents: [topStrong],
    modulePressure: [],
  })
  assert.ok(q1.some(a => a.category === 'recognize'))
  const q2 = buildActionQueue({
    team: team(),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [],
    topAgents: [{ ...topStrong, compliance_pass_rate: 70 }],
    modulePressure: [],
  })
  assert.ok(!q2.some(a => a.category === 'recognize'))
  const q3 = buildActionQueue({
    team: team(),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [
      {
        agent_email: 't@x',
        agent_full_name: 'Top',
        call_count: 50,
        qa_count: 20,
        compliance_pass_rate: 96,
        compliance_delta_pts: null,
        escalation_rate: 0,
        csat_high_rate: 88,
        unreviewed_alerts: 1,
        reasons: ['1 unreviewed alert'],
      },
    ],
    topAgents: [topStrong],
    modulePressure: [],
  })
  assert.ok(!q3.some(a => a.category === 'recognize'))
}

// Rising module pressure creates a validate action.
{
  const q = buildActionQueue({
    team: team(),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [],
    topAgents: [],
    modulePressure: [
      {
        module: 'budget_inputs',
        label: 'Budget inputs',
        total: 8,
        unreviewed: 2,
        false_positives: 0,
        baselineWeeklyAvg: 2,
        rising: true,
      },
    ],
  })
  const validate = q.find(a => a.category === 'validate')!
  assert.equal(validate.priority, 'medium')
  assert.equal(validate.link?.to, '/dashboard/alerts')
}

// Low QA coverage is flagged; zero-graded gets its own message.
{
  const low = buildActionQueue({
    team: team({ callCount: 400, qaCount: 5 }),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [],
    topAgents: [],
    modulePressure: [],
  })
  assert.equal(low.find(a => a.id === 'coverage')!.title, 'Low graded-QA coverage')
  const none = buildActionQueue({
    team: team({ callCount: 400, qaCount: 0 }),
    unreviewedAlerts: 0,
    totalAlerts: 0,
    watchlist: [],
    topAgents: [],
    modulePressure: [],
  })
  assert.equal(none.find(a => a.id === 'coverage')!.title, 'No graded QA this week')
}

// Output is sorted high → medium → low.
{
  const q = buildActionQueue({
    team: team(),
    unreviewedAlerts: 12, // high
    totalAlerts: 20,
    watchlist: [],
    topAgents: [
      { agent_email: 't@x', agent_full_name: null, call_count: 50, qa_count: 20, compliance_pass_rate: 96, csat_high_rate: 90 }, // low
    ],
    modulePressure: [],
  })
  const ranks = { high: 0, medium: 1, low: 2 } as const
  for (let i = 1; i < q.length; i++) {
    assert.ok(ranks[q[i - 1].priority] <= ranks[q[i].priority])
  }
}

console.log('insights-action-queue.check: all assertions passed')
