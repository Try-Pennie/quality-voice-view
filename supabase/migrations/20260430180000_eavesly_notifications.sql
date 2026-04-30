-- In-app notification fan-out for the alert review loop (issue #14).
--
-- When someone posts a message or marks an ack on an alert, fan out
-- notifications to every other thread participant + the assigned manager.
-- Recipients see them in a bell dropdown in the dash; clicking one deep-links
-- to /dashboard/alerts/:call_id/:module_name and marks the row read.
--
-- Role-agnostic: the fan-out doesn't care whether the actor is a manager,
-- director, or agent. Anyone in the thread (or assigned to the alert) gets
-- pinged on new activity, with the actor themselves excluded.

-- 1) Per-message acknowledgment flag. Anyone can set it; the recipient sees
--    an "Acknowledge" affordance and is expected to reply in-thread.
ALTER TABLE public.eavesly_alert_messages
  ADD COLUMN IF NOT EXISTS requires_acknowledgment BOOLEAN NOT NULL DEFAULT false;

-- 2) Notifications table. RLS scopes reads + writes to the recipient; the
--    trigger functions run SECURITY DEFINER so they can fan out across users.
CREATE TABLE IF NOT EXISTS public.eavesly_notifications (
  id                  BIGSERIAL PRIMARY KEY,
  recipient_email     TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN (
    'alert_message',         -- new message in a thread you participate in
    'alert_ack_required',    -- a message addressed to you needs acknowledgment
    'alert_ack'              -- someone marked the alert as reviewed
  )),
  call_id             TEXT NOT NULL,
  module_name         TEXT NOT NULL,
  source_actor_email  TEXT NOT NULL,
  source_message_id   BIGINT REFERENCES public.eavesly_alert_messages(id) ON DELETE CASCADE,
  payload_json        JSONB,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eavesly_notifications_recipient_unread_idx
  ON public.eavesly_notifications (recipient_email, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS eavesly_notifications_alert_idx
  ON public.eavesly_notifications (call_id, module_name);

ALTER TABLE public.eavesly_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own notifications" ON public.eavesly_notifications;
CREATE POLICY "Read own notifications"
  ON public.eavesly_notifications
  FOR SELECT
  TO authenticated
  USING (lower(recipient_email) = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Mark own notifications read" ON public.eavesly_notifications;
CREATE POLICY "Mark own notifications read"
  ON public.eavesly_notifications
  FOR UPDATE
  TO authenticated
  USING (lower(recipient_email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (lower(recipient_email) = lower(auth.jwt() ->> 'email'));

-- Direct INSERT is blocked for clients — only the trigger functions (running
-- as definer) write here.

-- 3) Recipient resolver. Returns thread participants ∪ assigned manager,
--    minus the actor and minus sentinel manager_email values ("No longer at
--    Pennie", etc., which agent_manager_mapping uses for housekeeping).
CREATE OR REPLACE FUNCTION private.alert_notification_recipients(
  p_call_id     text,
  p_module_name text,
  p_actor_email text
)
RETURNS TABLE(recipient_email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH participants AS (
    SELECT DISTINCT lower(msg.author_email) AS email
    FROM public.eavesly_alert_messages msg
    WHERE msg.call_id = p_call_id
      AND msg.module_name = p_module_name
      AND msg.deleted_at IS NULL
  ),
  assigned AS (
    SELECT DISTINCT lower(am.manager_email) AS email
    FROM public.eavesly_module_results m
    JOIN public.agent_manager_mapping am ON am.agent_email = m.agent_email
    WHERE m.call_id = p_call_id
      AND m.module_name = p_module_name
      AND am.manager_email LIKE '%@%'
  )
  SELECT email FROM participants
  UNION
  SELECT email FROM assigned
  EXCEPT
  SELECT lower(p_actor_email);
END;
$$;

REVOKE ALL ON FUNCTION private.alert_notification_recipients(text, text, text) FROM PUBLIC;

-- 4) Trigger: new message → fan out. The kind depends on whether the message
--    requires acknowledgment; a single message can fire both kinds for
--    different recipients only if we wanted per-recipient targeting, which
--    we don't — for the MVP, a `requires_acknowledgment` message produces
--    `alert_ack_required` for every recipient.
CREATE OR REPLACE FUNCTION private.notify_on_alert_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_payload jsonb;
BEGIN
  v_kind := CASE
    WHEN NEW.requires_acknowledgment THEN 'alert_ack_required'
    ELSE 'alert_message'
  END;

  v_payload := jsonb_build_object(
    'snippet', left(NEW.body, 240),
    'parent_message_id', NEW.parent_message_id
  );

  INSERT INTO public.eavesly_notifications (
    recipient_email, kind, call_id, module_name,
    source_actor_email, source_message_id, payload_json
  )
  SELECT
    r.recipient_email,
    v_kind,
    NEW.call_id,
    NEW.module_name,
    NEW.author_email,
    NEW.id,
    v_payload
  FROM private.alert_notification_recipients(NEW.call_id, NEW.module_name, NEW.author_email) r;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_alert_message ON public.eavesly_alert_messages;
CREATE TRIGGER notify_on_alert_message
  AFTER INSERT ON public.eavesly_alert_messages
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_on_alert_message();

-- 5) Trigger: new ack → fan out. Skip the acker themselves.
CREATE OR REPLACE FUNCTION private.notify_on_alert_ack()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.eavesly_notifications (
    recipient_email, kind, call_id, module_name,
    source_actor_email, payload_json
  )
  SELECT
    r.recipient_email,
    'alert_ack',
    NEW.call_id,
    NEW.module_name,
    NEW.acker_email,
    jsonb_build_object('acknowledged_at', NEW.acknowledged_at)
  FROM private.alert_notification_recipients(NEW.call_id, NEW.module_name, NEW.acker_email) r;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_alert_ack ON public.eavesly_alert_acks;
CREATE TRIGGER notify_on_alert_ack
  AFTER INSERT ON public.eavesly_alert_acks
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_on_alert_ack();

GRANT SELECT, UPDATE ON public.eavesly_notifications TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.eavesly_notifications_id_seq TO authenticated;
