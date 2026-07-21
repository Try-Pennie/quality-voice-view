-- The GOTA adoption page needs every gota_check evaluation, but
-- eavesly_alerts_with_feedback filters to alert_sent = true, so clean calls
-- (walkthrough conducted, no violation) never reach the page and adoption
-- reads 0%. This view mirrors the alerts view WITHOUT that filter, and drops
-- the alert-thread lateral joins (messages/acks) that only make sense for
-- alerts. One row per module evaluation, joined to manager mapping and
-- review feedback.
CREATE OR REPLACE VIEW public.eavesly_module_results_with_feedback AS
SELECT
  m.id                   AS module_result_id,
  m.created_at,
  m.call_id,
  m.module_name,
  m.violation_type,
  m.has_violation,
  m.alert_sent,
  m.alert_sent_at,
  m.agent_email,
  m.contact_name,
  m.contact_phone,
  m.recording_link,
  m.transcript_url,
  m.call_summary,
  m.sfdc_lead_id,
  m.result_json,
  am.manager_email       AS assigned_manager_email,
  f.id                   AS feedback_id,
  f.manager_email        AS feedback_by,
  f.accurate,
  f.action_taken,
  f.inaccuracy_reason,
  f.comment              AS feedback_comment,
  f.reviewed_at,
  (f.id IS NOT NULL)     AS is_reviewed
FROM public.eavesly_module_results m
LEFT JOIN public.agent_manager_mapping am
  ON am.agent_email = m.agent_email
LEFT JOIN public.eavesly_alert_feedback f
  ON f.call_id = m.call_id
 AND f.module_name = m.module_name;

COMMENT ON VIEW public.eavesly_module_results_with_feedback IS
  'All Eavesly module evaluations (not just alert-sent rows) with manager '
  'mapping and review feedback. Used by report pages that compute rates over '
  'clean + violating calls, e.g. GOTA adoption.';

-- Same lockdown convention as eavesly_alerts_with_feedback
-- (20260704131744_achieve_portal_lockdown.sql): plain view with definer
-- semantics, gated by grants alone — keep anon/PUBLIC out.
GRANT SELECT ON public.eavesly_module_results_with_feedback TO authenticated;
REVOKE ALL ON TABLE public.eavesly_module_results_with_feedback FROM anon, PUBLIC;
