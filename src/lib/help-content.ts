// Centralized in-product help copy. Every UI tooltip / popover reads from
// this registry so the glossary page stays complete and renames stay
// consistent. To add help for a new feature: add an entry here, then drop
// <HelpHint id="..." /> in the JSX.

export const HELP_CATEGORIES = [
  'Metrics',
  'Filters',
  'Columns',
  'Modules',
  'Violations',
  'Review actions',
  'False-positive reasons',
  'Settings',
] as const

export type HelpCategory = (typeof HELP_CATEGORIES)[number]

export type HelpEntry = {
  category: HelpCategory
  title: string
  body: string
  formula?: string
  example?: string
}

const ENTRIES = {
  // -------- Metrics (Dashboard headline) --------
  'metric.total_calls': {
    category: 'Metrics',
    title: 'Calls in window',
    body:
      'Every call placed by your team in the selected date range. Filters you apply (agents, dispositions, quick filters) narrow this number; the "of N in window" subline shows the unfiltered total.',
  },
  'metric.attention': {
    category: 'Metrics',
    title: 'Need attention',
    body:
      'Calls outside your configured talk-time, handle-time, or compliance thresholds. Tune the thresholds from the Thresholds button on the dashboard.',
  },
  'metric.avg_talk': {
    category: 'Metrics',
    title: 'Average talk time',
    body:
      'Mean time the agent spent actually speaking with the customer (excludes hold and wrap-up). Driven by the calls currently visible after filters.',
  },
  'metric.avg_handle': {
    category: 'Metrics',
    title: 'Average handle time',
    body:
      'Mean total time the agent spent on the call: talk + hold + after-call wrap-up. Compared with average talk, a large gap usually means heavy hold or wrap.',
  },
  'metric.compliance_rate': {
    category: 'Metrics',
    title: 'Compliance pass rate',
    body:
      'Share of calls in view that passed every required compliance check (Reg F, budget disclosures, warm transfer, litigation, program expectations).',
    formula: 'passing calls ÷ scored calls × 100',
  },
  'metric.high_csat': {
    category: 'Metrics',
    title: 'High customer satisfaction',
    body:
      'Share of calls in view where the inferred customer satisfaction is "High". Eavesly infers CSAT from sentiment + outcome — it is not a survey response.',
  },

  // -------- Metrics (Team page) --------
  'metric.team_compliance': {
    category: 'Metrics',
    title: 'Average compliance',
    body:
      'Average pass rate across all agents on the selected team in the date window. Click to jump to agents needing attention.',
  },
  'metric.team_escalation': {
    category: 'Metrics',
    title: 'Average escalation rate',
    body:
      'Share of an agent\'s calls where Eavesly recommended a manager review, averaged across the team. A persistently high rate is a coaching signal.',
  },
  'metric.team_open_alerts': {
    category: 'Metrics',
    title: 'Open alerts',
    body:
      'Alerts on your team that nobody has reviewed yet. Clicking takes you to the Alerts inbox.',
  },

  // -------- Metrics (Agent profile) --------
  'metric.agent_compliance': {
    category: 'Metrics',
    title: 'Agent compliance',
    body:
      'Share of this agent\'s scored calls in the window that passed every required compliance check. Highlighted when below 80%.',
    formula: 'agent passing calls ÷ agent scored calls × 100',
  },
  'metric.agent_csat_high': {
    category: 'Metrics',
    title: 'Agent CSAT high',
    body:
      'Share of this agent\'s scored calls where inferred customer satisfaction is "High". Highlighted when below 50%.',
  },
  'metric.agent_escalation': {
    category: 'Metrics',
    title: 'Agent escalation rate',
    body:
      'Share of this agent\'s scored calls where Eavesly recommended a manager review. Highlighted when at 10% or higher — a coaching signal.',
  },
  'metric.agent_open_alerts': {
    category: 'Metrics',
    title: 'Agent open alerts',
    body:
      'Alerts on this agent that nobody has reviewed yet in the window. Highlighted any time the count is non-zero.',
  },

  // -------- Metrics (Manager breakout table) --------
  'metric.manager_agent_count': {
    category: 'Metrics',
    title: 'Agents on team',
    body:
      'Distinct agents reporting to this manager who placed at least one call in the date window.',
  },
  'metric.manager_call_count': {
    category: 'Metrics',
    title: 'Calls placed',
    body:
      'Total calls placed by this manager\'s agents in the date window, before any quick-filter narrowing.',
  },
  'metric.manager_qa_count': {
    category: 'Metrics',
    title: 'Calls reviewed by Eavesly',
    body:
      'How many of this team\'s calls received a QA scorecard. Calls without a scorecard (e.g. very short, no conversation) are excluded from compliance and CSAT averages.',
  },
  'metric.manager_total_alerts': {
    category: 'Metrics',
    title: 'Total alerts',
    body:
      'Every alert fired on this team in the window — reviewed and unreviewed combined. Compare with "Open alerts" to gauge review backlog.',
  },

  // -------- Metrics (Migo coverage) --------
  'metric.migo_briefing_coverage': {
    category: 'Metrics',
    title: 'Migo briefing coverage',
    body:
      'Share of calls in the window that were preceded by a Migo pre-call briefing. Higher coverage means more of your calls benefit from Migo prep.',
    formula: 'briefed calls ÷ (briefed + unbriefed) × 100',
  },
  'metric.migo_compliance_lift': {
    category: 'Metrics',
    title: 'Compliance lift',
    body:
      'Difference in compliance pass rate between calls that had a Migo briefing and calls that did not. Positive = Migo helps; negative = it hurts (rare, worth investigating).',
    formula: 'briefed compliance % − unbriefed compliance %',
  },
  'metric.migo_escalation_lift': {
    category: 'Metrics',
    title: 'Escalation lift',
    body:
      'Difference in escalation rate between briefed and unbriefed calls. Lower is better — a negative lift means Migo briefings cut down on manager escalations.',
    formula: 'briefed escalation % − unbriefed escalation %',
  },

  // -------- Metrics (Call detail) --------
  'metric.call_talk_time': {
    category: 'Metrics',
    title: 'Talk time',
    body:
      'Time the agent spent actually speaking with the customer on this call (excludes hold and wrap-up).',
  },
  'metric.call_handle_time': {
    category: 'Metrics',
    title: 'Handle time',
    body:
      'Total time the agent spent on this call: talk + hold + after-call wrap-up. A large gap from talk time means heavy hold or wrap.',
  },
  'metric.call_wrapup_time': {
    category: 'Metrics',
    title: 'Wrap-up time',
    body:
      'Time the agent spent on after-call work (notes, dispositioning, system updates) before becoming available again.',
  },
  'metric.call_conversation_happened': {
    category: 'Metrics',
    title: 'Conversation happened',
    body:
      '"Yes" if Eavesly detected a real two-sided exchange. "No" usually means voicemail, hang-up, or the call ended before the customer engaged.',
  },
  'metric.call_overall_score': {
    category: 'Metrics',
    title: 'Overall score',
    body:
      'Eavesly\'s rollup grade for this call: Excellent, Good, Acceptable, or Needs improvement. Combines compliance, sales process, and customer experience scorecards.',
  },
  'metric.call_compliance': {
    category: 'Metrics',
    title: 'Compliance rating',
    body:
      'Pass / fail / N/A for this call. Fail means at least one required check (Reg F, disclosure, warm transfer, litigation) was missed.',
  },
  'metric.call_csat': {
    category: 'Metrics',
    title: 'Customer satisfaction',
    body:
      'High / Medium / Low — inferred for this call from sentiment, customer affirmations, and outcome. Not a survey response.',
  },

  // -------- Metrics (Alerts page) --------
  'metric.alert_reviewed': {
    category: 'Metrics',
    title: 'Reviewed / total',
    body:
      'How many alerts in view have feedback recorded versus how many exist. Reviewing alerts trains the model and gives the team an audit trail.',
  },
  'metric.fp_rate': {
    category: 'Metrics',
    title: 'False-positive rate',
    body:
      'Share of reviewed alerts that managers marked as "Not accurate". A rising rate means the model is over-firing — flag it to the model team.',
    formula: 'inaccurate ÷ reviewed × 100',
  },
  'metric.agents_flagged': {
    category: 'Metrics',
    title: 'Agents flagged',
    body:
      'Distinct agents who triggered at least one alert in the current view. Use the heatmap above to see who is hottest.',
  },

  // -------- Filters (Dashboard) --------
  'filter.dashboard.all': {
    category: 'Filters',
    title: 'All calls',
    body: 'Removes the dashboard quick filter. The agent and disposition filters above still apply.',
  },
  'filter.dashboard.escalations': {
    category: 'Filters',
    title: 'Manager escalations',
    body:
      'Calls where Eavesly\'s call overview marked the conversation as needing a manager review (e.g. agent unsure, customer escalating, compliance edge case).',
  },
  'filter.dashboard.compliance': {
    category: 'Filters',
    title: 'Compliance failures',
    body:
      'Calls where the overall compliance rating is "fail" — at least one required check (Reg F, disclosure, transfer, litigation) was missed.',
  },
  'filter.dashboard.threshold': {
    category: 'Filters',
    title: 'Below threshold',
    body:
      'Calls falling outside the talk-time, handle-time, or compliance bands you set in Threshold settings. Used by the "need attention" headline.',
  },

  // -------- Filters (Team) --------
  'filter.team.all': {
    category: 'Filters',
    title: 'All agents',
    body: 'Show every agent on your team that placed calls in the date window.',
  },
  'filter.team.attention': {
    category: 'Filters',
    title: 'Needs attention',
    body:
      'Agents with at least one of: low compliance, high escalation rate, or unreviewed alerts. The leaderboard surfaces them first.',
  },
  'filter.team.top': {
    category: 'Filters',
    title: 'Top performers',
    body:
      'Agents with the highest compliance pass rate (minimum one call). Useful when looking for examples to share in coaching.',
  },
  'filter.team.alerts': {
    category: 'Filters',
    title: 'Has open alerts',
    body: 'Agents with unreviewed alerts in the date window. Reviewing them is usually the highest-leverage daily task.',
  },

  // -------- Filters (Alerts) --------
  'filter.alerts.status': {
    category: 'Filters',
    title: 'Status filter',
    body:
      '"New" hides alerts you (or a peer manager) have already reviewed. "Reviewed" shows the audit trail. "All" shows both.',
  },
  'filter.alerts.module': {
    category: 'Filters',
    title: 'Module filter',
    body:
      'Each module is one analyzer Eavesly runs against the call. Pick one or more to focus your queue (e.g. show only warm-transfer alerts on a busy day).',
  },

  // -------- Columns (Dashboard table) --------
  'column.score': {
    category: 'Columns',
    title: 'Overall score',
    body:
      'Eavesly\'s rollup grade for the call: Excellent, Good, Acceptable, or Needs improvement. Combines compliance, sales process, and customer experience.',
  },
  'column.compliance': {
    category: 'Columns',
    title: 'Compliance rating',
    body:
      'Pass / fail / N/A. Fail means at least one required check (Reg F, disclosure, warm transfer, litigation) was missed on this call.',
  },
  'column.csat': {
    category: 'Columns',
    title: 'Customer satisfaction',
    body:
      'High / Medium / Low — inferred from sentiment, customer affirmations, and outcome. Not a survey response.',
  },
  'column.disposition': {
    category: 'Columns',
    title: 'Disposition',
    body:
      'How the agent classified the call in the dialer (e.g. "Enrolled", "No contact", "Callback"). Use the disposition filter above to focus on one outcome.',
  },
  'column.severity': {
    category: 'Columns',
    title: 'Severity stripe',
    body:
      'A peach left-edge stripe marks manager escalations; yellow marks compliance failures. Both are worth a click before anything else.',
  },

  // -------- Modules --------
  'module.full_qa': {
    category: 'Modules',
    title: 'Full QA',
    body:
      'The complete scorecard analyzer: compliance + sales process + customer experience for the entire call. Most general-purpose alerts come from here.',
  },
  'module.budget_inputs': {
    category: 'Modules',
    title: 'Budget inputs',
    body:
      'Verifies the agent collected and disclosed budget figures correctly (income, expenses, debt totals) per program rules.',
  },
  'module.warm_transfer': {
    category: 'Modules',
    title: 'Warm transfer',
    body:
      'Checks whether the agent properly introduced the customer to the receiving party before disconnecting. Cold or silent transfers fail this check.',
  },
  'module.litigation_check': {
    category: 'Modules',
    title: 'Litigation check',
    body:
      'Detects mentions of pending lawsuits, garnishments, or attorneys. Agents must confirm or escalate per legal policy when these surface.',
  },
  'module.program_expectations': {
    category: 'Modules',
    title: 'Program expectations',
    body:
      'Verifies the agent set accurate expectations about timeline, fees, credit impact, and deliverables of the program before close.',
  },

  // -------- Violations --------
  'violation.manager_escalation': {
    category: 'Violations',
    title: 'Manager escalation',
    body:
      'Eavesly flagged this call as needing a manager review based on the call overview (agent unsure, customer escalating, edge case). Not necessarily a hard fail.',
  },
  'violation.budget_compliance': {
    category: 'Violations',
    title: 'Budget compliance',
    body:
      'A budget-disclosure or input-collection requirement was missed during the call.',
  },
  'violation.warm_transfer': {
    category: 'Violations',
    title: 'Warm transfer',
    body:
      'The agent did not warmly hand off the customer before transferring (no introduction or context to the receiving party).',
  },
  'violation.litigation_check': {
    category: 'Violations',
    title: 'Litigation check',
    body:
      'The customer mentioned legal proceedings that the agent did not confirm or escalate per policy.',
  },
  'violation.program_expectations': {
    category: 'Violations',
    title: 'Program expectations',
    body:
      'The agent set inaccurate expectations about the program (timeline, cost, credit impact, deliverables).',
  },

  // -------- Review actions (alert drawer "What did you do?") --------
  'action.coached': {
    category: 'Review actions',
    title: 'Coached the agent',
    body:
      'Use when you spoke with the agent (live, in 1:1, or via written feedback) about the behavior on this call.',
  },
  'action.escalated': {
    category: 'Review actions',
    title: 'Escalated',
    body:
      'Use when the issue went to QA, compliance, HR, or another manager. Escalations get extra weight in the audit trail.',
  },
  'action.follow_up_later': {
    category: 'Review actions',
    title: 'Will follow up later',
    body:
      'Holds the alert as reviewed but unresolved. Use when you need to pull the recording at next 1:1 or check back after a customer callback.',
  },
  'action.no_action_needed': {
    category: 'Review actions',
    title: 'No action needed',
    body:
      'The alert is accurate but not coachable (one-off, customer-driven, edge case the agent handled OK). Still records that you reviewed it.',
  },

  // -------- False-positive reasons (alert drawer "What was wrong?") --------
  'inaccuracy.soft_inquiry_misclassified': {
    category: 'False-positive reasons',
    title: 'Soft inquiry misclassified',
    body:
      'The model treated a soft inquiry (information-only, no commitment) as a violation. Use when the customer was just asking, not buying.',
  },
  'inaccuracy.wrong_context': {
    category: 'False-positive reasons',
    title: 'Wrong context',
    body:
      'The model misread the conversational context (e.g. agent was role-playing, joking, or quoting the customer back).',
  },
  'inaccuracy.evidence_misquoted': {
    category: 'False-positive reasons',
    title: 'Evidence misquoted',
    body:
      'The quoted snippet does not match the recording or transcript. Almost always a transcription error to flag to the model team.',
  },
  'inaccuracy.policy_does_not_apply': {
    category: 'False-positive reasons',
    title: 'Policy does not apply',
    body:
      'The rule the model invoked does not apply to this customer or program (e.g. state-specific disclosure not required here).',
  },
  'inaccuracy.addressed_off_call': {
    category: 'False-positive reasons',
    title: 'Already addressed off-call',
    body:
      'The "missing" disclosure or step happened in another channel (email, prior call, e-sign) the model could not see.',
  },
  'inaccuracy.other': {
    category: 'False-positive reasons',
    title: 'Other',
    body:
      'Use when none of the canned reasons fit. Always pair with a comment so the model team can understand.',
  },

  // -------- Settings (Threshold sheet) --------
  'setting.talk_time': {
    category: 'Settings',
    title: 'Talk-time band',
    body:
      'Calls outside this min/max are flagged on the dashboard as needing attention. Set wide bands for your team\'s normal range; outliers get noticed.',
  },
  'setting.handle_time': {
    category: 'Settings',
    title: 'Handle-time band',
    body:
      'Same idea as talk time but includes hold + wrap. A wide gap between talk and handle thresholds is a hint to coach on after-call work.',
  },
  'setting.compliance_threshold': {
    category: 'Settings',
    title: 'Compliance pass-rate floor',
    body:
      'When the team-wide compliance rate falls below this number for the window, calls are flagged as needing attention.',
  },
  'setting.csat_thresholds': {
    category: 'Settings',
    title: 'Customer-satisfaction bands',
    body:
      'Sets where the inferred CSAT score is bucketed into "High" and "Low" pills shown on the dashboard table.',
  },
} as const satisfies Record<string, HelpEntry>

export const HELP: Record<string, HelpEntry> = ENTRIES
export type HelpId = keyof typeof ENTRIES

// Per-domain maps so call sites can render help next to a label rendered from
// a label map (e.g. MODULE_LABELS) without hardcoding HelpIds.
export const MODULE_HELP_IDS: Record<string, HelpId> = {
  full_qa: 'module.full_qa',
  budget_inputs: 'module.budget_inputs',
  warm_transfer: 'module.warm_transfer',
  litigation_check: 'module.litigation_check',
  program_expectations: 'module.program_expectations',
}

export const VIOLATION_HELP_IDS: Record<string, HelpId> = {
  manager_escalation: 'violation.manager_escalation',
  budget_compliance: 'violation.budget_compliance',
  warm_transfer: 'violation.warm_transfer',
  litigation_check: 'violation.litigation_check',
  program_expectations: 'violation.program_expectations',
}

export const ACTION_HELP_IDS: Record<string, HelpId> = {
  coached: 'action.coached',
  escalated: 'action.escalated',
  follow_up_later: 'action.follow_up_later',
  no_action_needed: 'action.no_action_needed',
}

export const INACCURACY_HELP_IDS: Record<string, HelpId> = {
  soft_inquiry_misclassified: 'inaccuracy.soft_inquiry_misclassified',
  wrong_context: 'inaccuracy.wrong_context',
  evidence_misquoted: 'inaccuracy.evidence_misquoted',
  policy_does_not_apply: 'inaccuracy.policy_does_not_apply',
  addressed_off_call: 'inaccuracy.addressed_off_call',
  other: 'inaccuracy.other',
}

export function getHelp(id: HelpId): HelpEntry {
  return ENTRIES[id]
}
