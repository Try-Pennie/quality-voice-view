-- Collaborative alert review: thread + role-agnostic acks. Layered on top
-- of eavesly_alert_feedback (which still owns the structured Y/N + action
-- assertion); messages and acks "stack on top" — they don't close, lock,
-- or override anything.

-- Visibility helper. Returns true when caller can see the alert behind
-- (call_id, module_name). God-mode passes through unconditionally;
-- everyone else needs a row in agent_manager_mapping that matches the
-- alert's agent_email. Used in RLS for both new tables so messages and
-- acks track alert visibility regardless of whether the agent has any
-- materialized activity yet.
CREATE OR REPLACE FUNCTION private.alert_visible_to(
  p_caller text,
  p_call_id text,
  p_module_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_god boolean;
  v_agent text;
BEGIN
  SELECT m.agent_email INTO v_agent
  FROM public.eavesly_module_results m
  WHERE m.call_id = p_call_id
    AND m.module_name = p_module_name
  LIMIT 1;

  IF v_agent IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(MAX(is_god_mode::int), 0) = 1
    INTO v_god
  FROM public.manager_coaching_prompts
  WHERE lower(manager_email) = lower(p_caller);

  IF v_god THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.agent_manager_mapping
    WHERE lower(manager_email) = lower(p_caller)
      AND lower(agent_email) = lower(v_agent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION private.alert_visible_to(text, text, text) TO authenticated;

-- Messages. Author can edit/soft-delete their own; everyone with alert
-- access can read.
CREATE TABLE public.eavesly_alert_messages (
  id                 BIGSERIAL PRIMARY KEY,
  call_id            TEXT NOT NULL,
  module_name        TEXT NOT NULL,
  author_email       TEXT NOT NULL,
  body               TEXT NOT NULL CHECK (length(trim(body)) > 0),
  parent_message_id  BIGINT REFERENCES public.eavesly_alert_messages(id) ON DELETE SET NULL,
  posted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at          TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX eavesly_alert_messages_alert_idx
  ON public.eavesly_alert_messages (call_id, module_name, posted_at);

CREATE INDEX eavesly_alert_messages_author_idx
  ON public.eavesly_alert_messages (author_email, posted_at DESC);

ALTER TABLE public.eavesly_alert_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read messages on visible alerts"
  ON public.eavesly_alert_messages
  FOR SELECT
  TO authenticated
  USING (private.alert_visible_to(lower(auth.jwt() ->> 'email'), call_id, module_name));

CREATE POLICY "Insert own messages on visible alerts"
  ON public.eavesly_alert_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    lower(author_email) = lower(auth.jwt() ->> 'email')
    AND private.alert_visible_to(lower(auth.jwt() ->> 'email'), call_id, module_name)
  );

CREATE POLICY "Update own messages"
  ON public.eavesly_alert_messages
  FOR UPDATE
  TO authenticated
  USING (lower(author_email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (lower(author_email) = lower(auth.jwt() ->> 'email'));

-- Acks. Single-state stamp ("I've reviewed this"). Anyone with alert
-- access can mark+unmark; one row per (alert, user). Does not close,
-- lock, or override anything.
CREATE TABLE public.eavesly_alert_acks (
  id                BIGSERIAL PRIMARY KEY,
  call_id           TEXT NOT NULL,
  module_name       TEXT NOT NULL,
  acker_email       TEXT NOT NULL,
  acknowledged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eavesly_alert_acks_unique UNIQUE (call_id, module_name, acker_email)
);

CREATE INDEX eavesly_alert_acks_alert_idx
  ON public.eavesly_alert_acks (call_id, module_name);

ALTER TABLE public.eavesly_alert_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read acks on visible alerts"
  ON public.eavesly_alert_acks
  FOR SELECT
  TO authenticated
  USING (private.alert_visible_to(lower(auth.jwt() ->> 'email'), call_id, module_name));

CREATE POLICY "Insert own acks on visible alerts"
  ON public.eavesly_alert_acks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    lower(acker_email) = lower(auth.jwt() ->> 'email')
    AND private.alert_visible_to(lower(auth.jwt() ->> 'email'), call_id, module_name)
  );

CREATE POLICY "Delete own acks"
  ON public.eavesly_alert_acks
  FOR DELETE
  TO authenticated
  USING (lower(acker_email) = lower(auth.jwt() ->> 'email'));

-- Replace the alerts view to expose thread + ack summaries for inbox
-- previews. message_count excludes soft-deleted; acker_emails is empty
-- array (not null) so client code can render unconditionally.
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
  (f.id IS NOT NULL)     AS is_reviewed,
  COALESCE(msg.message_count, 0) AS message_count,
  msg.last_message_at,
  COALESCE(ack.acker_emails, ARRAY[]::text[]) AS acker_emails
FROM public.eavesly_module_results m
LEFT JOIN public.agent_manager_mapping am
  ON am.agent_email = m.agent_email
LEFT JOIN public.eavesly_alert_feedback f
  ON f.call_id = m.call_id
 AND f.module_name = m.module_name
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE deleted_at IS NULL) AS message_count,
    MAX(posted_at) FILTER (WHERE deleted_at IS NULL) AS last_message_at
  FROM public.eavesly_alert_messages msgs
  WHERE msgs.call_id = m.call_id
    AND msgs.module_name = m.module_name
) msg ON true
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT acker_email) AS acker_emails
  FROM public.eavesly_alert_acks acks
  WHERE acks.call_id = m.call_id
    AND acks.module_name = m.module_name
) ack ON true
WHERE m.alert_sent = true;
