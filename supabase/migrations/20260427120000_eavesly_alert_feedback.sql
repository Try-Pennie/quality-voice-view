-- Eavesly Alert Review: feedback table + read access to module_results + joined view
-- Mirrors the per-manager scoping pattern used by manager_coaching_prompts.

-- 1) Allow authenticated/public read on eavesly_module_results so the dashboard can list alerts.
--    (RLS is enabled on the table but currently has no SELECT policy, blocking all dashboard reads.)
CREATE POLICY "Enable read access for all users"
ON public.eavesly_module_results
FOR SELECT
TO public
USING (true);

-- 2) Feedback table — one row per (call_id, module_name); upsert, latest wins.
CREATE TABLE public.eavesly_alert_feedback (
  id                BIGSERIAL PRIMARY KEY,
  call_id           TEXT NOT NULL,
  module_name       TEXT NOT NULL,
  manager_email     TEXT NOT NULL,
  accurate          BOOLEAN NOT NULL,
  action_taken      TEXT CHECK (action_taken IS NULL OR action_taken IN (
                      'coached',
                      'escalated',
                      'follow_up_later',
                      'no_action_needed'
                    )),
  inaccuracy_reason TEXT CHECK (inaccuracy_reason IS NULL OR inaccuracy_reason IN (
                      'soft_inquiry_misclassified',
                      'wrong_context',
                      'evidence_misquoted',
                      'policy_does_not_apply',
                      'addressed_off_call',
                      'other'
                    )),
  comment           TEXT,
  reviewed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eavesly_alert_feedback_unique UNIQUE (call_id, module_name),
  CONSTRAINT eavesly_alert_feedback_action_xor CHECK (
    NOT (action_taken IS NOT NULL AND inaccuracy_reason IS NOT NULL)
  )
);

CREATE INDEX eavesly_alert_feedback_manager_idx
  ON public.eavesly_alert_feedback (manager_email, reviewed_at DESC);

CREATE INDEX eavesly_alert_feedback_module_idx
  ON public.eavesly_alert_feedback (module_name, reviewed_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER eavesly_alert_feedback_set_updated_at
  BEFORE UPDATE ON public.eavesly_alert_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) RLS on feedback — read open, writes scoped to the manager who owns the row.
ALTER TABLE public.eavesly_alert_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users"
ON public.eavesly_alert_feedback
FOR SELECT
TO public
USING (true);

CREATE POLICY "Manager inserts own feedback"
ON public.eavesly_alert_feedback
FOR INSERT
TO authenticated
WITH CHECK (manager_email = (auth.jwt() ->> 'email'::text));

CREATE POLICY "Manager updates own feedback"
ON public.eavesly_alert_feedback
FOR UPDATE
TO authenticated
USING (manager_email = (auth.jwt() ->> 'email'::text))
WITH CHECK (manager_email = (auth.jwt() ->> 'email'::text));

-- 4) View — single source the dashboard reads from.
--    Joins module_results to feedback and the agent's assigned manager.
--    WHERE alert_sent = true so the inbox only shows things that actually fired.
CREATE OR REPLACE VIEW public.eavesly_alerts_with_feedback AS
SELECT
  m.id                   AS module_result_id,
  m.created_at           AS alert_created_at,
  m.alert_sent_at,
  m.call_id,
  m.module_name,
  m.violation_type,
  m.has_violation,
  m.alert_sent,
  m.agent_email,
  m.contact_name,
  m.contact_phone,
  m.recording_link,
  m.transcript_url,
  m.call_summary,
  m.sfdc_lead_id,
  m.processing_time_ms,
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
 AND f.module_name = m.module_name
WHERE m.alert_sent = true;
