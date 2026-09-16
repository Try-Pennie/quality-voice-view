import { expect, type Page } from '@playwright/test'
import type { AlertMessage, AlertWithFeedback } from '../src/types/database'

export const NOW = new Date('2026-09-07T16:00:00Z')
export const EMAIL = 'manager@example.test'
export const QUOTES = ['Your credit may be affected.', 'You can cancel at any time.']
export const TRANSCRIPT = `[handling agent]: Hello, let us discuss your program.\n[contact]: I have questions about my credit.\n[handling agent]: ${QUOTES[0]} Please consider the implications.\n[contact]: What if I change my mind?\n[handling agent]: ${QUOTES[1]} We can explain the process.\n[contact]: Thank you for explaining.`
export const FULL_QA_PROMPT_SHA = '1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37'

const criterion = (key: string, label: string, section: string, scorePath: string, evidencePath: string, domain: readonly (string | boolean)[], findingCategory: string) => ({
  key, label, section, rule: `Exact synthetic rule for ${label}.`, score_path: scorePath, evidence_path: evidencePath, domain, finding_category: findingCategory,
})
export const FULL_QA_CRITERIA = [
  criterion('call_recording_disclosure', 'Call recording disclosure', 'Compliance', 'compliance_scorecard.call_recording_disclosure', 'compliance_scorecard.call_recording_disclosure_evidence', ['pass', 'fail', 'not_applicable'], 'compliance'),
  criterion('credit_pull_consent', 'Credit pull consent', 'Compliance', 'compliance_scorecard.credit_pull_consent', 'compliance_scorecard.credit_pull_consent_evidence', ['pass', 'fail', 'not_applicable'], 'compliance'),
  criterion('social_security_verification', 'Social security verification', 'Compliance', 'compliance_scorecard.social_security_verification', 'compliance_scorecard.social_security_verification_evidence', ['pass', 'fail', 'not_applicable'], 'compliance'),
  criterion('accurate_representations', 'Accurate representations', 'Compliance', 'compliance_scorecard.accurate_representations', 'compliance_scorecard.accurate_representations_violations', ['pass', 'fail'], 'compliance'),
  criterion('no_misleading_claims', 'No misleading claims', 'Compliance', 'compliance_scorecard.no_misleading_claims', 'compliance_scorecard.misleading_claims_violations', ['pass', 'fail'], 'compliance'),
  ...['professional_tone', 'active_listening', 'patience_empathy', 'clear_communication', 'customer_focused'].map(key => criterion(key, key.split('_').join(' '), 'Customer experience', `customer_experience_scorecard.${key}`, `customer_experience_scorecard.${key}_examples`, ['excellent', 'good', 'fair', 'poor'], 'customer_experience')),
  ...['step1_agenda_setting', 'step2_credit_review', 'step3_agent_inputs', 'step4_paydown_projections', 'step5_offers_review', 'step6_debt_resolution'].map(key => criterion(key, key.split('_').join(' '), 'Sales process', `sales_process_scorecard.${key}`, `sales_process_scorecard.${key.replace(/_(agenda_setting|credit_review|agent_inputs|paydown_projections|offers_review|debt_resolution)$/, '_location')}`, ['complete', 'partial', 'missing', 'not_applicable'], 'sales_process')),
  ...['phase_impact_covered', 'phase_stabilization_covered', 'phase_recovery_covered', 'phase_rebuild_covered', 'payments_point_covered', 'creditor_calls_point_covered', 'legal_action_point_covered'].map(key => criterion(key, key.split('_').join(' '), 'Program expectations', `program_expectations_scorecard.${key}`, `program_expectations_scorecard.${key.replace('_covered', '_evidence')}`, [true, false], 'program_expectations')),
]

export const FULL_QA_RESULT = {
  _evaluation_provenance: { version: 1, module_name: 'full_qa', prompt_sha256: FULL_QA_PROMPT_SHA, user_prompt_sha256: 'a'.repeat(64), transcript_sha256: 'b'.repeat(64) },
  call_overview: { manager_review_reason: 'Review both quoted passages in context.', manager_focus_areas: QUOTES.map(quote => ({ quote })) },
  compliance_scorecard: { call_recording_disclosure: 'pass', call_recording_disclosure_evidence: [{ quote: QUOTES[1] }], credit_pull_consent: 'fail', credit_pull_consent_evidence: [{ quote: QUOTES[0] }], social_security_verification: 'pass', social_security_verification_evidence: [], accurate_representations: 'fail', accurate_representations_violations: ['Synthetic inaccurate statement'], no_misleading_claims: 'pass', misleading_claims_violations: [] },
  customer_experience_scorecard: { professional_tone: 'good', professional_tone_examples: [], active_listening: 'good', active_listening_examples: [], patience_empathy: 'fair', patience_empathy_examples: [], clear_communication: 'good', clear_communication_examples: [], customer_focused: 'good', customer_focused_examples: [] },
  sales_process_scorecard: { step1_agenda_setting: 'complete', step1_location: 'opening', step2_credit_review: 'complete', step2_location: 'review', step3_agent_inputs: 'complete', step3_location: 'inputs', step4_paydown_projections: 'not_applicable', step4_location: null, step5_offers_review: 'complete', step5_location: 'offers', step6_debt_resolution: 'partial', step6_location: 'closing' },
  program_expectations_scorecard: { phase_impact_covered: true, phase_impact_evidence: 'quote', phase_stabilization_covered: true, phase_stabilization_evidence: 'quote', phase_recovery_covered: false, phase_recovery_evidence: '', phase_rebuild_covered: false, phase_rebuild_evidence: '', payments_point_covered: true, payments_point_evidence: 'quote', creditor_calls_point_covered: false, creditor_calls_point_evidence: '', legal_action_point_covered: false, legal_action_point_evidence: '' },
}

/** Synthetic records only; never reads or writes live customer data. */
export function alertRow(id: string, overrides: Partial<AlertWithFeedback> = {}): AlertWithFeedback {
  return {
    module_result_id: 1, alert_sent_at: '2026-09-04T16:00:00Z',
    processing_time_ms: null, assigned_manager_email: EMAIL,
    call_id: id, module_name: 'full_qa', violation_type: 'manager_escalation',
    alert_created_at: '2026-09-04T16:00:00Z', has_violation: true, alert_sent: true,
    agent_email: 'agent@example.test', contact_name: `Example ${id}`, contact_phone: null,
    call_summary: 'Synthetic call for manager review checks.', sfdc_lead_id: null,
    is_reviewed: false, accurate: null, action_taken: null, inaccuracy_reason: null,
    feedback_id: null, feedback_by: null, feedback_comment: null, reviewed_at: null,
    violation_details: null, action_details: null, review_revision: overrides.is_reviewed ? 1 : null,
    initial_manager_review: null, current_decision_id: null, current_decision: null,
    current_decision_by: null, current_decision_instructions: null,
    current_decided_at: null, current_decision_source: null,
    message_count: 0, last_message_at: null, acker_emails: [], recording_link: null,
    transcript_url: null,
    result_json: FULL_QA_RESULT,
    ...overrides,
  }
}

/** A non-Full-QA row for tests that exercise the shared legacy review lifecycle. */
export function genericAlertRow(id: string, overrides: Partial<AlertWithFeedback> = {}): AlertWithFeedback {
  return alertRow(id, { module_name: 'budget_inputs', ...overrides })
}

/** Supabase HTTP contract fixture. Auth/data traffic is intercepted before leaving the browser.
 * It exercises real hooks, queries, pagination requests and mutations, not patched modules.
 * This proves client behavior, not production RLS/SQL execution.
 */
export async function reviewFixture(page: Page, rows: AlertWithFeedback[], options: { god?: boolean; noAgents?: boolean; managedAgents?: string[]; managerNames?: Record<string, string>; dailyMetrics?: unknown[]; email?: string; messages?: AlertMessage[]; fullQaOccurrences?: unknown[]; fullQaCriteria?: typeof FULL_QA_CRITERIA; fullQaReviews?: ReadonlyMap<string, Record<string, unknown>>; fullQaProposals?: ReadonlyMap<string, Record<string, unknown>[]> } = {}) {
  const fixtureEmail = options.email ?? EMAIL
  const state = {
    rows, writes: [] as unknown[], requests: [] as URL[], transcript: TRANSCRIPT as string | null,
    failFeedback: false, failTranscript: false, failQueueOffset: -1, failBreakdown: false,
    transcriptGate: Promise.resolve(), alertGate: Promise.resolve(), queueGate: Promise.resolve(), ackGate: Promise.resolve(), decisionGate: Promise.resolve(), fullQaSubmitGate: Promise.resolve(),
    failedAckIds: new Set<string>(), failedDecisionIds: new Set<string>(),
    ackInFlight: 0, maxAckInFlight: 0, decisionInFlight: 0, maxDecisionInFlight: 0,
    nextDecisionId: 100, nextProposalId: 1,
    fullQaReviews: new Map<string, Record<string, unknown>>(options.fullQaReviews),
    fullQaProposals: new Map<string, Record<string, unknown>[]>(options.fullQaProposals),
    fullQaSourceFingerprints: new Map(rows.map(row => [row.call_id, 'c'.repeat(64)])),
    fullQaSources: new Map<string, Record<string, unknown>>(),
  }
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(({ email }) => {
    localStorage.setItem('sb-miikotqnovnixpeqtqnd-auth-token', JSON.stringify({
      access_token: 'synthetic-test-token', refresh_token: 'synthetic-refresh-token',
      token_type: 'bearer', expires_at: 4102444800,
      user: { id: '00000000-0000-4000-8000-000000000001', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
    }))
  }, { email: fixtureEmail })
  await page.routeWebSocket(/.*/, socket => socket.close())
  await page.route(url => url.protocol === 'https:', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.hostname.endsWith('.supabase.co')) {
      await route.abort()
      return
    }
    state.requests.push(url)
    const table = url.pathname.split('/').pop()
    const respond = (data: unknown, status = 200) => route.fulfill({ status, json: data })
    if (table === 'agent_manager_mapping') return respond(options.noAgents ? [] : (options.managedAgents ?? ['agent@example.test']).map(agent_email => ({ agent_email })))
    if (table === 'manager_coaching_prompts') return respond({ is_god_mode: options.god ?? false })
    if (table === 'agent_directory') {
      return respond(Object.entries(options.managerNames ?? {}).map(([agent_email, agent_full_name]) => ({ agent_email, agent_full_name })))
    }
    if (table === 'eavesly_calls_page') return respond({ rows: [], has_more: false })
    if (table === 'eavesly_calls_summary') return respond({ total_calls: 0, window_calls: 0, calls_requiring_attention: 0, avg_talk_time: 0, avg_handle_time: 0, compliance_pass_rate: 0, high_sat_rate: 0, dispositions: [] })
    if (table === 'eavesly_active_call_agents' || table === 'eavesly_team_pitch_risk') return respond([])
    if (table === 'team_daily_metrics') return respond(options.dailyMetrics ?? [])
    if (table === 'agent_daily_metrics') {
      const email = url.searchParams.get('p_agent_email')?.replace(/^eq\./, '')
      return respond((options.dailyMetrics ?? []).filter(row => !email || (row && typeof row === 'object' && 'agent_email' in row && row.agent_email === email)))
    }
    if (table === 'eavesly_alerts_with_feedback') {
      const params = url.searchParams
      let selected = [...state.rows]
      for (const [key, value] of params) {
        if (key === 'call_id' && value.startsWith('eq.')) selected = selected.filter(row => row.call_id === value.slice(3))
        if (key === 'module_name' && value.startsWith('eq.')) selected = selected.filter(row => row.module_name === value.slice(3))
        if (key === 'module_name' && value.startsWith('neq.')) selected = selected.filter(row => row.module_name !== value.slice(4))
        if (key === 'module_name' && value.startsWith('in.')) selected = selected.filter(row => value.includes(row.module_name))
        if (key === 'alert_sent' && value === 'eq.true') selected = selected.filter(row => row.alert_sent === true)
        if (key === 'agent_email' && value.startsWith('in.')) selected = selected.filter(row => value.includes(row.agent_email ?? 'no-agent'))
        if (key === 'agent_email' && value.startsWith('eq.')) selected = selected.filter(row => row.agent_email === value.slice(3))
        if (key === 'alert_created_at' && value.startsWith('gte.')) selected = selected.filter(row => row.alert_created_at >= value.slice(4))
        if (key === 'alert_created_at' && value.startsWith('lte.')) selected = selected.filter(row => row.alert_created_at <= value.slice(4))
      }
      if (request.headers().accept?.includes('vnd.pgrst.object')) {
        const detail = selected[0] ? { ...selected[0] } : null
        await state.alertGate
        return respond(detail)
      }
      selected.sort((a, b) => b.alert_created_at.localeCompare(a.alert_created_at) || a.call_id.localeCompare(b.call_id) || a.module_name.localeCompare(b.module_name))
      const offset = Number(params.get('offset') ?? 0)
      const projection = params.get('select') ?? ''
      const list = projection.includes('feedback_comment')
      const breakdown = projection.includes('feedback_by') && projection.includes('has_violation') && !list
      if (list && offset === state.failQueueOffset) return respond({ message: 'Synthetic queue failure' }, 500)
      if (breakdown && state.failBreakdown) return respond({ message: 'Synthetic breakdown failure' }, 500)
      const pageRows = selected.slice(offset, offset + Math.min(Number(params.get('limit') ?? 1000), 1000))
      if (list) {
        await state.queueGate
        // Real list projection deliberately omits heavy fields.
        return respond(pageRows.map(({
          result_json: _result,
          recording_link: _recording,
          transcript_url: _transcript,
          initial_manager_review: _initial,
          current_decision_instructions: _instructions,
          ...row
        }) => row))
      }
      return respond(pageRows)
    }
    if (table === 'get_full_qa_review_context' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      const callId = input && typeof input === 'object' && 'p_call_id' in input && typeof input.p_call_id === 'string' ? input.p_call_id : ''
      const row = state.rows.find(candidate => candidate.call_id === callId)
      if (!row) return respond({ message: 'EAVESLY_ALERT_NOT_FOUND' }, 400)
      const currentResult = row.result_json && typeof row.result_json === 'object' ? row.result_json as Record<string, unknown> : {}
      const result = state.fullQaSources.get(callId) ?? currentResult
      const provenance = result._evaluation_provenance && typeof result._evaluation_provenance === 'object' ? result._evaluation_provenance as Record<string, unknown> : null
      const promptHash = provenance && typeof provenance.prompt_sha256 === 'string' ? provenance.prompt_sha256 : null
      const referenceKind = promptHash === FULL_QA_PROMPT_SHA ? 'known' : promptHash === null ? 'legacy_current_reference' : 'unknown_hash'
      return respond({ source_fingerprint: state.fullQaSourceFingerprints.get(callId) ?? 'c'.repeat(64), source_result_json: result, source_prompt_sha256: promptHash,
        reference_prompt_sha256: FULL_QA_PROMPT_SHA, source_reference_kind: referenceKind,
        criteria_reference_kind: referenceKind === 'known' ? 'exact_evaluation_rubric' : referenceKind === 'legacy_current_reference' ? 'current_reference_only' : 'current_field_map_only',
        rubric_prompt_text: referenceKind === 'unknown_hash' ? null : 'Synthetic exact scoring policy. Two distinct compliance findings or explicit severe customer mistreatment justify escalation. Program expectations use enrollment gating, handling-agent delivery, and exclude ACDR/GOTA-only discussion points.', criteria_manifest: options.fullQaCriteria ?? FULL_QA_CRITERIA,
        review: state.fullQaReviews.get(callId) ?? null, proposals: state.fullQaProposals.get(callId) ?? [] })
    }
    if (table === 'submit_full_qa_review' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      state.writes.push(input)
      await state.fullQaSubmitGate
      if (state.failFeedback) return respond({ message: 'Synthetic save failure' }, 500)
      if (!input || typeof input !== 'object' || !('p_call_id' in input) || typeof input.p_call_id !== 'string'
        || !('p_expected_revision' in input) || typeof input.p_expected_revision !== 'number'
        || !('p_expected_source_fingerprint' in input) || typeof input.p_expected_source_fingerprint !== 'string'
        || !('p_corrections' in input) || !Array.isArray(input.p_corrections) || input.p_corrections.length !== 23
        || !('p_findings' in input) || !Array.isArray(input.p_findings) || !('p_escalation_justified' in input) || typeof input.p_escalation_justified !== 'boolean') return respond({ message: 'EAVESLY_INVALID_FULL_QA_REVIEW' }, 400)
      const row = state.rows.find(candidate => candidate.call_id === input.p_call_id)
      if (row && input.p_expected_source_fingerprint !== state.fullQaSourceFingerprints.get(row.call_id)) return respond({ message: 'EAVESLY_STALE_FULL_QA_SOURCE' }, 400)
      if (!row || input.p_expected_revision !== (row.review_revision ?? 0) || !('p_expected_decision_id' in input) || input.p_expected_decision_id !== row.current_decision_id) return respond({ message: 'EAVESLY_STALE_REVIEW' }, 400)
      row.feedback_id ??= 1; row.feedback_by = fixtureEmail; row.is_reviewed = true; row.review_revision = (row.review_revision ?? 0) + 1
      row.accurate = input.p_escalation_justified
      row.inaccuracy_reason = !input.p_escalation_justified && 'p_inaccuracy_reason' in input ? input.p_inaccuracy_reason as AlertWithFeedback['inaccuracy_reason'] : null
      row.action_taken = 'p_action' in input ? input.p_action as AlertWithFeedback['action_taken'] : null
      row.action_details = 'p_action_details' in input && typeof input.p_action_details === 'string' ? input.p_action_details : null
      row.violation_details = 'p_escalation_reason' in input && typeof input.p_escalation_reason === 'string' ? input.p_escalation_reason : null
      row.feedback_comment = input.p_escalation_justified ? null : row.violation_details
      row.reviewed_at = NOW.toISOString(); row.current_decision_id = null; row.current_decision = null; row.current_decision_by = null; row.current_decision_instructions = null; row.current_decided_at = null; row.current_decision_source = null
      state.fullQaReviews.set(input.p_call_id, { feedback_revision: row.review_revision, corrections: input.p_corrections, findings: input.p_findings,
        escalation_justified: input.p_escalation_justified, escalation_reason: row.violation_details,
        escalation_inaccuracy_reason: row.inaccuracy_reason, action_taken: row.action_taken,
        action_details: row.action_details, saved_by: fixtureEmail, saved_at: row.reviewed_at })
      return respond({ feedback_id: row.feedback_id, review_revision: row.review_revision, reviewed_at: row.reviewed_at, idempotent: false })
    }
    if (table === 'propose_full_qa_rule' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON(); state.writes.push(input)
      if (!input || typeof input !== 'object' || !('p_call_id' in input) || typeof input.p_call_id !== 'string') return respond({ message: 'EAVESLY_INVALID_RULE_PROPOSAL' }, 400)
      const proposal = { id: state.nextProposalId++, criterion_key: 'p_criterion_key' in input ? input.p_criterion_key : '', proposed_rule: 'p_proposed_rule' in input ? input.p_proposed_rule : '', why: 'p_why' in input ? input.p_why : '', proposed_by: fixtureEmail, proposed_at: NOW.toISOString(), decision: 'pending', decided_by: null, decided_at: null, decision_reason: null }
      state.fullQaProposals.set(input.p_call_id, [...(state.fullQaProposals.get(input.p_call_id) ?? []), proposal])
      return respond({ proposal_id: proposal.id, proposed_at: proposal.proposed_at, decision: 'pending' })
    }
    if (table === 'decide_full_qa_rule_proposal' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON(); state.writes.push(input)
      if (!input || typeof input !== 'object' || !('p_proposal_id' in input)) return respond({ message: 'EAVESLY_INVALID_RULE_PROPOSAL_DECISION' }, 400)
      const proposal = [...state.fullQaProposals.values()].flat().find(item => item.id === input.p_proposal_id)
      if (!proposal || proposal.decision !== 'pending') return respond({ message: 'EAVESLY_RULE_PROPOSAL_DECISION_CONFLICT' }, 400)
      proposal.decision = 'p_decision' in input ? input.p_decision : 'rejected'; proposal.decided_by = fixtureEmail; proposal.decided_at = NOW.toISOString(); proposal.decision_reason = 'p_reason' in input ? input.p_reason : ''
      return respond({ proposal_id: proposal.id, decision: proposal.decision, decided_at: proposal.decided_at, idempotent: false })
    }
    if (table === 'full_qa_finding_occurrences' && request.method() === 'POST') return respond(options.fullQaOccurrences ?? [])
    if (table === 'submit_internal_alert_feedback' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      state.writes.push(input)
      if (state.failFeedback) return respond({ message: 'Synthetic save failure' }, 500)
      if (!input || typeof input !== 'object'
        || !('p_call_id' in input) || typeof input.p_call_id !== 'string'
        || !('p_expected_revision' in input) || typeof input.p_expected_revision !== 'number'
        || !('p_expected_decision_id' in input)
        || !('p_verdict' in input) || typeof input.p_verdict !== 'boolean') return respond({ message: 'EAVESLY_INVALID_FEEDBACK' }, 400)
      const row = state.rows.find(candidate => candidate.call_id === input.p_call_id)
      if (!row) return respond({ message: 'EAVESLY_ALERT_NOT_FOUND' }, 400)
      const revision = row.review_revision ?? 0
      if (input.p_expected_revision !== revision || input.p_expected_decision_id !== row.current_decision_id) {
        return respond({ message: 'EAVESLY_STALE_REVIEW' }, 400)
      }
      row.initial_manager_review ??= revision === 0 ? {
        manager_email: fixtureEmail,
        accurate: input.p_verdict,
        action_taken: 'p_action' in input ? input.p_action : null,
        inaccuracy_reason: 'p_reason' in input ? input.p_reason : null,
        comment: 'p_false_alarm_details' in input ? input.p_false_alarm_details : null,
        violation_details: 'p_violation_details' in input ? input.p_violation_details : null,
        action_details: 'p_action_details' in input ? input.p_action_details : null,
        reviewed_at: NOW.toISOString(),
      } : null
      row.is_reviewed = true
      row.accurate = input.p_verdict
      row.feedback_by = fixtureEmail
      row.feedback_id ??= 1
      row.review_revision = revision + 1
      row.reviewed_at = NOW.toISOString()
      const rpcAction = 'p_action' in input ? input.p_action : null
      row.action_taken = input.p_verdict && (rpcAction === 'coached' || rpcAction === 'escalated' || rpcAction === 'follow_up_later' || rpcAction === 'no_action_needed') ? rpcAction : null
      const rpcReason = 'p_reason' in input ? input.p_reason : null
      row.inaccuracy_reason = !input.p_verdict && (rpcReason === 'soft_inquiry_misclassified' || rpcReason === 'wrong_context' || rpcReason === 'evidence_misquoted' || rpcReason === 'policy_does_not_apply' || rpcReason === 'addressed_off_call' || rpcReason === 'covered_not_verbatim' || rpcReason === 'call_dropped_incomplete' || rpcReason === 'other') ? rpcReason : null
      row.feedback_comment = !input.p_verdict && 'p_false_alarm_details' in input && typeof input.p_false_alarm_details === 'string' ? input.p_false_alarm_details : null
      row.violation_details = input.p_verdict && 'p_violation_details' in input && typeof input.p_violation_details === 'string' ? input.p_violation_details : null
      row.action_details = input.p_verdict && 'p_action_details' in input && typeof input.p_action_details === 'string' ? input.p_action_details : null
      row.current_decision_id = null
      row.current_decision = null
      row.current_decision_by = null
      row.current_decision_instructions = null
      row.current_decided_at = null
      row.current_decision_source = null
      return respond({ feedback_id: row.feedback_id, review_revision: row.review_revision, reviewed_at: row.reviewed_at, idempotent: false })
    }
    if (table === 'decide_internal_alert_feedback' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      state.writes.push(input)
      state.decisionInFlight++
      state.maxDecisionInFlight = Math.max(state.maxDecisionInFlight, state.decisionInFlight)
      await state.decisionGate
      state.decisionInFlight--
      if (!input || typeof input !== 'object'
        || !('p_call_id' in input) || typeof input.p_call_id !== 'string'
        || !('p_expected_revision' in input) || typeof input.p_expected_revision !== 'number'
        || !('p_decision' in input) || (input.p_decision !== 'approved' && input.p_decision !== 'changes_requested')) return respond({ message: 'EAVESLY_INVALID_DECISION' }, 400)
      if (state.failedDecisionIds.has(input.p_call_id)) return respond({ message: 'Synthetic approval failure' }, 500)
      const row = state.rows.find(candidate => candidate.call_id === input.p_call_id)
      if (!row || row.review_revision !== input.p_expected_revision) return respond({ message: 'EAVESLY_STALE_REVIEW' }, 400)
      if (row.current_decision) {
        if (row.current_decision !== input.p_decision) return respond({ message: 'EAVESLY_DECISION_CONFLICT' }, 400)
        return respond({ decision_id: row.current_decision_id, feedback_revision: row.review_revision, decision: row.current_decision, decided_at: row.current_decided_at, idempotent: true })
      }
      row.current_decision_id = state.nextDecisionId++
      row.current_decision = input.p_decision
      row.current_decision_by = fixtureEmail
      row.current_decision_instructions = input.p_decision === 'changes_requested' && 'p_instructions' in input && typeof input.p_instructions === 'string' ? input.p_instructions : null
      row.current_decided_at = NOW.toISOString()
      row.current_decision_source = 'typed'
      if (input.p_decision === 'changes_requested') row.message_count += 1
      return respond({ decision_id: row.current_decision_id, feedback_revision: row.review_revision, decision: row.current_decision, decided_at: row.current_decided_at, idempotent: false })
    }
    if (table === 'eavesly_alert_feedback' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      state.writes.push(input)
      if (state.failFeedback) return respond({ message: 'Synthetic save failure' }, 500)
      if (!input || typeof input !== 'object' || !('call_id' in input)) return respond({}, 400)
      const row = state.rows.find(row => row.call_id === input.call_id)
      if (!row || !('accurate' in input) || typeof input.accurate !== 'boolean') return respond({}, 400)
      row.is_reviewed = true
      row.accurate = input.accurate
      row.feedback_by = fixtureEmail
      row.feedback_id = 1
      row.reviewed_at = NOW.toISOString()
      if ('comment' in input) {
        if (typeof input.comment === 'string') row.feedback_comment = input.comment
        else if (input.comment === null) row.feedback_comment = null
      }
      if ('action_taken' in input) {
        if (input.action_taken === 'coached' || input.action_taken === 'escalated' || input.action_taken === 'follow_up_later' || input.action_taken === 'no_action_needed') row.action_taken = input.action_taken
        else if (input.action_taken === null) row.action_taken = null
      }
      return respond(null)
    }
    if (table === 'eavesly_alert_messages' && request.method() === 'GET') return respond(options.messages ?? [])
    if (table === 'eavesly_alert_messages' && request.method() === 'POST') {
      state.writes.push(request.postDataJSON())
      return respond({ id: 1, call_id: rows[0]?.call_id, module_name: 'full_qa', author_email: fixtureEmail, body: 'A synthetic discussion message.', posted_at: NOW.toISOString(), parent_message_id: null, requires_acknowledgment: false, deleted_at: null })
    }
    if (table === 'eavesly_alert_acks' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      state.writes.push(input)
      state.ackInFlight++
      state.maxAckInFlight = Math.max(state.maxAckInFlight, state.ackInFlight)
      await state.ackGate
      state.ackInFlight--
      if (input && typeof input === 'object' && 'call_id' in input && typeof input.call_id === 'string') {
        if (state.failedAckIds.has(input.call_id)) return respond({ message: 'Synthetic approval failure' }, 500)
        const row = state.rows.find(row => row.call_id === input.call_id)
        if (row) row.acker_emails = [...row.acker_emails, fixtureEmail]
      }
      return respond(null)
    }
    if (table === 'eavesly_calls') {
      if (url.searchParams.get('select') !== '*' || !url.searchParams.get('call_id')?.startsWith('eq.')) return respond([])
      await state.transcriptGate
      if (state.failTranscript) return respond({ message: 'Synthetic transcript failure' }, 500)
      return respond({ call_id: url.searchParams.get('call_id')?.slice(3), agent_email: 'agent@example.test', started_at: NOW.toISOString(), ended_at: NOW.toISOString(), direction: 'inbound', conversation_happened: true })
    }
    if (table === 'eavesly_transcription_qa') return respond({ original_transcript: state.transcript, recording_link: null })
    if (request.method() !== 'GET' && !url.pathname.includes('/rpc/')) {
      throw new Error(`Unexpected mutation in browser fixture: ${url.pathname}`)
    }
    return respond([])
  })
  return state
}

/** Open a visible row by its synthetic contact name. */
export async function openAlert(page: Page, id: string) {
  await page.getByRole('button', { name: `Review Manager escalation alert for Example ${id}`, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Review both quoted passages in context.')).toBeVisible()
}
