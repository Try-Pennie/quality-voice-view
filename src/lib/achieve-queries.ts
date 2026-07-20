import { supabase } from '@/integrations/supabase/client'
import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '@/types/database'

// All Achieve portal data flows through the achieve-portal edge function
// (PSAI-204): the portal password is validated server-side on every request,
// reads/writes run with the service role scoped to the Achieve module, and
// transcripts arrive pre-trimmed. The browser never queries eavesly tables
// for Achieve rows directly.

export const ACHIEVE_MODULE_NAME = 'achieve_welcome_call_qa'

// sessionStorage is only a UX cache so the reviewer doesn't retype the
// password per request — the server re-validates it on every call.
export const ACHIEVE_PASSWORD_SESSION_KEY = 'achieve_portal_password'

const showDemoData = import.meta.env.VITE_ACHIEVE_DEMO_DATA === 'true'

export type AchievePortalRow = AlertWithFeedback & {
  trimmed_transcript?: string | null
}

export type AchievePortalData = {
  alerts: AchievePortalRow[]
  allCalls: AchievePortalRow[]
}

export type AchieveReviewFeedbackInput = {
  call_id: string
  reviewer_email: string
  accurate: boolean
  action_taken?: AlertActionTaken | null
  inaccuracy_reason?: AlertInaccuracyReason | null
  comment?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokePortal(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const password = sessionStorage.getItem(ACHIEVE_PASSWORD_SESSION_KEY) ?? ''
  const { data, error } = await supabase.functions.invoke('achieve-portal', {
    body: { password, action, ...extra },
  })
  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (error as any)?.context?.status
    if (status === 401) {
      // Stale/rotated password: drop the cached one and land back on the gate.
      sessionStorage.removeItem(ACHIEVE_PASSWORD_SESSION_KEY)
      window.location.reload()
      throw new Error('invalid_password')
    }
    let message = error.message
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (error as any)?.context?.json?.()
      if (body?.error) message = body.error
    } catch {
      // keep the generic message
    }
    throw new Error(message)
  }
  return data
}

export async function verifyAchievePortalPassword(
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke('achieve-portal', {
    body: { password, action: 'verify' },
  })
  if (!error) return { ok: true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const status = (error as any)?.context?.status
  if (status === 401) return { ok: false, error: 'Incorrect password.' }
  if (status === 503) {
    return { ok: false, error: 'Portal access is not available yet. Contact your administrator.' }
  }
  console.error('Error verifying Achieve portal password:', error)
  return { ok: false, error: 'Could not reach the portal service. Try again.' }
}

export async function fetchAchievePortalData(): Promise<AchievePortalData> {
  try {
    const data = await invokePortal('list')
    const alerts = (data?.alerts ?? []) as AchievePortalRow[]
    const allCalls = (data?.all_calls ?? []) as AchievePortalRow[]
    if (showDemoData && alerts.length === 0 && allCalls.length === 0) {
      return { alerts: achieveDemoAlerts, allCalls: achieveDemoAlerts }
    }
    return { alerts, allCalls }
  } catch (error) {
    console.error('Error fetching Achieve portal data:', error)
    if (showDemoData) return { alerts: achieveDemoAlerts, allCalls: achieveDemoAlerts }
    throw error
  }
}

export async function submitAchieveReviewFeedback(
  input: AchieveReviewFeedbackInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await invokePortal('submit_feedback', {
      feedback: {
        call_id: input.call_id,
        reviewer_email: input.reviewer_email.trim(),
        accurate: input.accurate,
        action_taken: input.accurate ? input.action_taken ?? null : null,
        inaccuracy_reason: !input.accurate ? input.inaccuracy_reason ?? null : null,
        comment: input.comment?.trim() || null,
      },
    })
    return { ok: true }
  } catch (error) {
    console.error('Error submitting Achieve QA feedback:', error)
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

const achieveDemoAlert: AchievePortalRow = {
  module_result_id: -1,
  alert_created_at: '2026-06-29T18:00:00.000Z',
  alert_sent_at: null,
  call_id: 'WT8ace5e457629417521644859dcb187ca',
  module_name: ACHIEVE_MODULE_NAME,
  violation_type: 'script_adherence',
  has_violation: true,
  alert_sent: false,
  agent_email: 'demo-achieve@example.invalid',
  contact_name: 'Demo client',
  contact_phone: null,
  recording_link: null,
  transcript_url: null,
  call_summary: 'DEMO DATA: Client completed FDR enrollment handoff and welcome call; app/dashboard setup was completed and program basics were reviewed, but the agent never gave the required "recorded for quality and training purposes" disclosure.',
  sfdc_lead_id: null,
  processing_time_ms: null,
  result_json: {
    demo_data: true,
    script_version: 'fdr_wholesale_db_pilot_v1',
    script_adherence: {
      greeting_and_identity_completed: true,
      recording_disclosure_provided: false,
      company_credibility_covered: true,
      call_agenda_provided: true,
      dedicated_account_deposits_explained: true,
      creditor_negotiation_explained: true,
      settlement_authorizations_explained: true,
      dashboard_account_setup_covered: true,
      tools_and_resources_covered: true,
      closing_and_support_provided: true,
      overall_script_adherence: 'substantial',
      missing_elements: ['recording_disclosure'],
      key_evidence_quotes: [
        'My name again is Max. I am a client success advocate, and I\'m excited to get to help you get started with your program today.',
        'Starting today, instead of making monthly payments to your enrolled creditors, you\'ll be making automatic deposits into your dedicated account.',
        'Before I let you go, I do have the Freedom Debt Relief customer service number in case you\'d like to write that down. Call at any time you have questions in the future.',
      ],
      violation: true,
      violation_reason: 'Compliance gap: the agent never gave the verbatim recording_disclosure ("this call will be recorded for quality and training purposes"). All other required welcome-call elements were covered.',
    },
    assessment_confidence: {
      score: 0.86,
      level: 'high',
      rationale: 'DEMO DATA: Transcript clearly captured all required welcome-call elements with verbatim agent quotes; audio quality and segmentation were clean.',
      limitations: [
        'DEMO DATA: Client side of the call was partially inaudible during the payment-process explanation.',
      ],
    },
    transcript_segment: {
      segment_type: 'fdr_disclosure_and_welcome_call',
      start_line: 42,
      marker: 'My name again is Max. I am a client success advocate',
      segmentation_confidence: 'high',
      segmentation_score: 0.91,
      used_full_transcript_fallback: false,
    },
  },
  assigned_manager_email: null,
  feedback_id: null,
  feedback_by: null,
  accurate: null,
  action_taken: null,
  inaccuracy_reason: null,
  feedback_comment: null,
  reviewed_at: null,
  is_reviewed: false,
  message_count: 0,
  last_message_at: null,
  acker_emails: [],
  trimmed_transcript: null,
}

const achievePoorTransferDemoAlert: AchievePortalRow = {
  ...achieveDemoAlert,
  module_result_id: -2,
  alert_created_at: '2026-06-29T18:15:00.000Z',
  call_id: 'WTpoortransferfulldemo0000000000000001',
  contact_name: 'Demo transfer client',
  call_summary: 'DEMO DATA: The required welcome-call script was fully completed. During the handoff, the client returned to an automated phone menu before later reaching another live agent.',
  result_json: {
    demo_data: true,
    script_version: 'fdr_wholesale_db_pilot_v1',
    script_adherence: {
      greeting_and_identity_completed: true,
      recording_disclosure_provided: true,
      company_credibility_covered: true,
      call_agenda_provided: true,
      dedicated_account_deposits_explained: true,
      creditor_negotiation_explained: true,
      settlement_authorizations_explained: true,
      dashboard_account_setup_covered: true,
      tools_and_resources_covered: true,
      closing_and_support_provided: true,
      overall_script_adherence: 'full',
      missing_elements: [],
      key_evidence_quotes: [
        'This call will be recorded for quality and training purposes.',
        'Before I let you go, our Program Success Team is here for you seven days a week.',
      ],
      violation: false,
    },
    transfer_experience: {
      poor_transfer: true,
      reasons: ['live_rep_then_ivr_reentry_then_live_rep'],
      ivr_reentry_lines: [121],
      agent_attempts: [
        {
          line: 116,
          name_asr: 'Marissa',
          quote: 'I am going to connect you with the next specialist now.',
        },
        {
          line: 134,
          name_asr: 'Danial',
          quote: 'Hi, this is Daniel. I can help you from here.',
        },
      ],
      evidence: [
        { line: 121, quote: 'Please say or enter your selection from the following menu.' },
        { line: 134, quote: 'Hi, this is Daniel. I can help you from here.' },
      ],
      detection_version: 'achieve_poor_transfer_v1',
    },
    assessment_confidence: {
      score: 0.93,
      level: 'high',
      rationale: 'DEMO DATA: The partner-leg transcript clearly shows a return to an automated menu before a later live agent joined.',
      limitations: [
        'DEMO DATA: Agent names are ASR-derived and may not match the intended spelling.',
      ],
    },
    transcript_segment: {
      segment_type: 'fdr_disclosure_and_welcome_call',
      start_line: 82,
      marker: 'This call will be recorded for quality and training purposes',
      segmentation_confidence: 'high',
      segmentation_score: 0.95,
      used_full_transcript_fallback: false,
    },
  },
  trimmed_transcript: [
    'Agent: This call will be recorded for quality and training purposes.',
    'Agent: Before I let you go, our Program Success Team is here for you seven days a week.',
    'Agent: I am going to connect you with the next specialist now.',
    'Automated menu: Please say or enter your selection from the following menu.',
    'Agent: Hi, this is Daniel. I can help you from here.',
  ].join('\n'),
}

const achieveDemoAlerts = [achieveDemoAlert, achievePoorTransferDemoAlert]
