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
    overall_process_adherence: string
    step1_agenda_setting: string
    step1_timestamp: string | null
    step2_credit_review: string
    step2_timestamp: string | null
    step3_agent_inputs: string
    step3_timestamp: string | null
    step4_paydown_projections: string
    step4_timestamp: string | null
    step5_offers_review: string
    step5_timestamp: string | null
    step6_debt_resolution: string
    step6_timestamp: string | null
    missed_opportunities: string[]
    process_notes: string
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
