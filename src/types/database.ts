export type Call = {
  id: number
  call_id: string
  agent_email: string | null
  agent_full_name: string | null
  started_at: string
  ended_at: string | null
  completed_at: string | null
  direction: string | null
  disposition: string | null
  talk_time: number | null
  handle_time: number | null
  wrapup_time: number | null
  conversation_happened: boolean | null
  contact_phone: string | null
  campaign_name: string | null
  notes: string | null
  created_at: string
}

export type TranscriptionQA = {
  id: number
  call_id: string | null
  agent_email: string | null
  manager_email: string | null
  overall_score: string | null
  compliance_rating: string | null
  customer_satisfaction_likely: string | null
  manager_escalation: boolean | null
  qa_json: QAJson | null
  call_summary: string | null
  original_transcript: string | null
  transcription_link: string | null
  recording_link: string | null
  coaching_insights_analysis: string | null
  created_at: string
}

export type QAJson = {
  call_overview?: {
    call_topic: string
    call_outcome: string
    call_purpose: string
    overall_tone: string
    call_duration_assessment: string
    manager_review_required: boolean
    manager_review_reason: string
  }

  compliance_scorecard?: {
    overall_compliance_score: string
    agent_identification: string
    agent_identification_timestamp: string | null
    call_recording_disclosure: string
    call_recording_disclosure_timestamp: string | null
    credit_pull_consent: string
    credit_pull_consent_timestamp: string | null
    social_security_verification: string
    social_security_verification_timestamp: string | null
    accurate_representations: string
    accurate_representations_violations: string[]
    no_misleading_claims: string
    misleading_claims_violations: string[]
    compliance_violations: string[]
    requires_manager_review: boolean
    escalation_reason: string
  }

  sales_process_scorecard?: {
    // per-step values: complete | partial | missing | not_applicable
    overall_process_adherence: string // excellent | good | fair | poor
    step1_agenda_setting: string
    step1_location: string | null
    step2_credit_review: string
    step2_location: string | null
    step3_agent_inputs: string
    step3_location: string | null
    step4_paydown_projections: string
    step4_location: string | null
    step5_offers_review: string
    step5_location: string | null
    step6_debt_resolution: string
    step6_location: string | null
    expected_sections: number[]
    sections_attempted: number[]
    sections_completed: number[]
    key_process_moments: string[]
    section_gap_reasons: { section: number; reason: string }[]
    missed_opportunities: string[]
    process_notes: string
  }

  program_expectations_scorecard?: {
    section_status: string // pass | fail | not_applicable
    section_summary: string
    enrollment_completed: boolean
    enrollment_evidence_quote: string
    missing_elements: string[]
    phase_stabilization_covered: boolean
    phase_stabilization_evidence: string
    phase_recovery_covered: boolean
    phase_recovery_evidence: string
    phase_rebuild_covered: boolean
    phase_rebuild_evidence: string
    phase_impact_covered: boolean
    phase_impact_evidence: string
    payments_point_covered: boolean
    payments_point_evidence: string
    creditor_calls_point_covered: boolean
    creditor_calls_point_evidence: string
    legal_action_point_covered: boolean
    legal_action_point_evidence: string
  }

  coaching_recommendations?: {
    strengths: string[]
    areas_for_improvement: string[]
    specific_coaching_points: string[]
    training_recommendations: string[]
  }

  customer_experience_scorecard?: {
    overall_customer_experience: string
    professional_tone: string
    professional_tone_examples: string[]
    clear_communication: string
    clear_communication_examples: string[]
    active_listening: string
    active_listening_examples: string[]
    patience_empathy: string
    patience_empathy_examples: string[]
    customer_focused: string
    customer_focused_examples: string[]
    customer_experience_notes: string
  }
}

export type CallWithQA = Call & {
  qa: TranscriptionQA | null
}

// Eavesly alerts — rows from view eavesly_alerts_with_feedback
// (eavesly_module_results LEFT JOIN agent_manager_mapping LEFT JOIN eavesly_alert_feedback)

export type AlertViolationType =
  | 'manager_escalation'
  | 'budget_compliance'
  | 'warm_transfer'
  | 'litigation_check'
  | 'program_expectations'

export type AlertModuleName =
  | 'full_qa'
  | 'budget_inputs'
  | 'warm_transfer'
  | 'litigation_check'
  | 'program_expectations'

export type AlertActionTaken =
  | 'coached'
  | 'escalated'
  | 'follow_up_later'
  | 'no_action_needed'

export type AlertInaccuracyReason =
  | 'soft_inquiry_misclassified'
  | 'wrong_context'
  | 'evidence_misquoted'
  | 'policy_does_not_apply'
  | 'addressed_off_call'
  | 'covered_not_verbatim'
  | 'call_dropped_incomplete'
  | 'other'

export type AlertWithFeedback = {
  module_result_id: number
  alert_created_at: string
  alert_sent_at: string | null
  call_id: string
  module_name: AlertModuleName | string
  violation_type: AlertViolationType | string
  has_violation: boolean
  alert_sent: boolean
  agent_email: string | null
  contact_name: string | null
  contact_phone: string | null
  recording_link: string | null
  transcript_url: string | null
  call_summary: string | null
  sfdc_lead_id: string | null
  processing_time_ms: number | null
  result_json: any
  assigned_manager_email: string | null
  feedback_id: number | null
  feedback_by: string | null
  accurate: boolean | null
  action_taken: AlertActionTaken | null
  inaccuracy_reason: AlertInaccuracyReason | null
  feedback_comment: string | null
  reviewed_at: string | null
  is_reviewed: boolean
  message_count: number
  last_message_at: string | null
  acker_emails: string[]
}

export type AlertMessage = {
  id: number
  call_id: string
  module_name: string
  author_email: string
  body: string
  parent_message_id: number | null
  posted_at: string
  edited_at: string | null
  deleted_at: string | null
  requires_acknowledgment: boolean
}

export type NotificationKind =
  | 'alert_message'
  | 'alert_ack_required'
  | 'alert_ack'

export type EavlNotification = {
  id: number
  recipient_email: string
  kind: NotificationKind
  call_id: string
  module_name: string
  source_actor_email: string
  source_message_id: number | null
  payload_json: { snippet?: string; parent_message_id?: number | null; acknowledged_at?: string } | null
  read_at: string | null
  created_at: string
}

export type AlertAck = {
  id: number
  call_id: string
  module_name: string
  acker_email: string
  acknowledged_at: string
}

export type AlertFeedbackInput = {
  call_id: string
  module_name: string
  manager_email: string
  accurate: boolean
  action_taken?: AlertActionTaken | null
  inaccuracy_reason?: AlertInaccuracyReason | null
  comment?: string | null
}
