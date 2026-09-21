-- Reviewability is independent of QA success: Regal confirms a conversation and
-- Eavesly has a nonblank transcript (raw event or legacy QA transcript).
-- No guessed duration threshold: Full QA runs when a transcript is available.
-- Keep total call volume; restrict AI metrics to the reviewable population.
BEGIN;
-- Full-history population needs more than the management API's two-minute default.
-- These budgets end with this transaction; no permanent settings are changed.
SET LOCAL statement_timeout = '10min';
SET LOCAL work_mem = '32MB';

DROP FUNCTION IF EXISTS public.team_daily_metrics(date, date);
DROP FUNCTION IF EXISTS public.agent_daily_metrics(text, date, date);
DROP MATERIALIZED VIEW IF EXISTS private.mv_agent_daily_metrics;

CREATE MATERIALIZED VIEW private.mv_agent_daily_metrics AS
WITH managers AS (
  SELECT DISTINCT lower(manager_email) AS email FROM public.agent_manager_mapping
  UNION
  SELECT DISTINCT lower(manager_email) FROM public.manager_coaching_prompts
),
-- Pick retry winners in one index-only pass. Carry only IDs here so the full
-- rollup can use sequential/hash joins instead of per-call random heap reads.
latest_qa AS MATERIALIZED (
  SELECT DISTINCT ON (call_id) call_id, id
  FROM public.eavesly_transcription_qa
  WHERE call_id IS NOT NULL
  ORDER BY call_id, created_at DESC NULLS LAST, id DESC
),
-- Evaluate transcript availability once per call, not once per aggregate FILTER.
-- Keep large transcript/JSON values out of the materialized rows.
call_population AS MATERIALIZED (
  SELECT
    c.agent_email, c.started_at, c.talk_time,
    qa.call_id AS qa_call_id, qa.compliance_rating,
    qa.manager_escalation, qa.customer_satisfaction_likely,
    c.conversation_happened IS TRUE AND (
      COALESCE(qa.original_transcript ~ '[^[:space:]]', false)
      OR (jsonb_typeof(e.payload->'transcript') = 'string'
        AND COALESCE(e.payload->>'transcript' ~ '[^[:space:]]', false))
    ) IS TRUE AS reviewable
  FROM public.eavesly_calls c
  -- QA has no unique call_id constraint. A retry must not multiply call counts.
  LEFT JOIN latest_qa latest ON latest.call_id = c.call_id
  LEFT JOIN public.eavesly_transcription_qa qa ON qa.id = latest.id
  LEFT JOIN public.eavesly_regal_call_events e
    ON e.regal_task_id = c.call_id AND e.event_type = 'transcript_available'
  WHERE c.agent_email IS NOT NULL
    AND c.started_at IS NOT NULL
    AND lower(c.agent_email) NOT IN (SELECT email FROM managers)
    AND EXTRACT(DOW FROM (c.started_at AT TIME ZONE 'America/New_York')) <> 0
),
call_day AS (
  SELECT
    agent_email,
    (started_at AT TIME ZONE 'America/New_York')::date AS bucket_day,
    COUNT(*) AS call_count,
    COUNT(*) FILTER (WHERE reviewable) AS reviewable_call_count,
    COALESCE(SUM(talk_time) FILTER (WHERE reviewable), 0) AS talk_time_sum,
    COUNT(*) FILTER (WHERE reviewable AND talk_time IS NOT NULL) AS talk_time_n,
    COUNT(qa_call_id) FILTER (WHERE reviewable) AS qa_count,
    COUNT(*) FILTER (WHERE reviewable AND compliance_rating = 'pass') AS compliance_pass_count,
    COUNT(*) FILTER (WHERE reviewable AND compliance_rating IN ('pass','fail')) AS compliance_total_count,
    COUNT(*) FILTER (WHERE reviewable AND manager_escalation = true) AS escalation_count,
    COUNT(*) FILTER (WHERE reviewable AND customer_satisfaction_likely = 'high') AS csat_high_count,
    COUNT(*) FILTER (WHERE reviewable AND customer_satisfaction_likely = 'medium') AS csat_medium_count,
    COUNT(*) FILTER (WHERE reviewable AND customer_satisfaction_likely = 'low') AS csat_low_count
  FROM call_population
  GROUP BY agent_email, (started_at AT TIME ZONE 'America/New_York')::date
),
alert_day AS (
  SELECT
    m.agent_email,
    (m.created_at AT TIME ZONE 'America/New_York')::date AS bucket_day,
    COUNT(*)                                                                     AS total_alerts_count,
    COUNT(*) FILTER (WHERE m.has_violation = true)                               AS open_alerts,
    COUNT(*) FILTER (WHERE m.has_violation = true AND f.id IS NULL)              AS unreviewed_alerts,
    COUNT(*) FILTER (WHERE m.has_violation = true AND f.accurate IS FALSE)       AS false_positive_count
  FROM public.eavesly_module_results m
  LEFT JOIN public.eavesly_alert_feedback f
    ON f.call_id = m.call_id AND f.module_name = m.module_name
  WHERE m.alert_sent = true
    AND m.module_name <> 'disposition_review'
    AND m.agent_email IS NOT NULL
    AND m.created_at IS NOT NULL
    AND lower(m.agent_email) NOT IN (SELECT email FROM managers)
    AND EXTRACT(DOW FROM (m.created_at AT TIME ZONE 'America/New_York')) <> 0
  GROUP BY m.agent_email, (m.created_at AT TIME ZONE 'America/New_York')::date
),
agent_name AS (
  SELECT DISTINCT ON (agent_email) agent_email, agent_full_name
  FROM public.eavesly_calls
  WHERE agent_email IS NOT NULL AND agent_full_name IS NOT NULL
    AND lower(agent_email) NOT IN (SELECT email FROM managers)
  ORDER BY agent_email, started_at DESC NULLS LAST
)
SELECT
  COALESCE(c.agent_email, a.agent_email) AS agent_email,
  COALESCE(c.bucket_day, a.bucket_day) AS bucket_day,
  n.agent_full_name,
  COALESCE(c.call_count, 0)              AS call_count,
  COALESCE(c.reviewable_call_count, 0)   AS reviewable_call_count,
  COALESCE(c.talk_time_sum, 0)           AS talk_time_sum,
  COALESCE(c.talk_time_n, 0)             AS talk_time_n,
  COALESCE(c.qa_count, 0)                AS qa_count,
  COALESCE(c.compliance_pass_count, 0)   AS compliance_pass_count,
  COALESCE(c.compliance_total_count, 0)  AS compliance_total_count,
  COALESCE(c.escalation_count, 0)        AS escalation_count,
  COALESCE(c.csat_high_count, 0)         AS csat_high_count,
  COALESCE(c.csat_medium_count, 0)       AS csat_medium_count,
  COALESCE(c.csat_low_count, 0)          AS csat_low_count,
  COALESCE(a.total_alerts_count, 0)      AS total_alerts_count,
  COALESCE(a.open_alerts, 0)             AS open_alerts,
  COALESCE(a.unreviewed_alerts, 0)       AS unreviewed_alerts,
  COALESCE(a.false_positive_count, 0)    AS false_positive_count
FROM call_day c
FULL OUTER JOIN alert_day a USING (agent_email, bucket_day)
LEFT JOIN agent_name n ON n.agent_email = COALESCE(c.agent_email, a.agent_email);

CREATE UNIQUE INDEX mv_agent_daily_metrics_pk
  ON private.mv_agent_daily_metrics (agent_email, bucket_day);

CREATE INDEX mv_agent_daily_metrics_day_idx
  ON private.mv_agent_daily_metrics (bucket_day);

CREATE FUNCTION public.team_daily_metrics(
  p_start date,
  p_end   date
)
RETURNS TABLE(
  agent_email             text,
  agent_full_name         text,
  bucket_day              date,
  call_count              bigint,
  talk_time_sum           bigint,
  talk_time_n             bigint,
  qa_count                bigint,
  compliance_pass_count   bigint,
  compliance_total_count  bigint,
  escalation_count        bigint,
  csat_high_count         bigint,
  csat_medium_count       bigint,
  csat_low_count          bigint,
  total_alerts_count      bigint,
  open_alerts             bigint,
  unreviewed_alerts       bigint,
  false_positive_count    bigint,
  reviewable_call_count   bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller text;
BEGIN
  v_caller := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_caller = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH scope AS (
    SELECT lower(s.agent_email) AS agent_email
    FROM private.scope_for(v_caller) s
  )
  SELECT
    mv.agent_email,
    mv.agent_full_name,
    mv.bucket_day,
    mv.call_count,
    mv.talk_time_sum,
    mv.talk_time_n,
    mv.qa_count,
    mv.compliance_pass_count,
    mv.compliance_total_count,
    mv.escalation_count,
    mv.csat_high_count,
    mv.csat_medium_count,
    mv.csat_low_count,
    mv.total_alerts_count,
    mv.open_alerts,
    mv.unreviewed_alerts,
    mv.false_positive_count,
    mv.reviewable_call_count
  FROM private.mv_agent_daily_metrics mv
  JOIN scope s ON lower(mv.agent_email) = s.agent_email
  WHERE mv.bucket_day >= p_start
    AND mv.bucket_day <= p_end
  ORDER BY mv.bucket_day, mv.agent_email;
END;
$$;

CREATE FUNCTION public.agent_daily_metrics(
  p_agent_email text,
  p_start       date,
  p_end         date
)
RETURNS TABLE(
  agent_email             text,
  agent_full_name         text,
  bucket_day              date,
  call_count              bigint,
  talk_time_sum           bigint,
  talk_time_n             bigint,
  qa_count                bigint,
  compliance_pass_count   bigint,
  compliance_total_count  bigint,
  escalation_count        bigint,
  csat_high_count         bigint,
  csat_medium_count       bigint,
  csat_low_count          bigint,
  total_alerts_count      bigint,
  open_alerts             bigint,
  unreviewed_alerts       bigint,
  false_positive_count    bigint,
  reviewable_call_count   bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller text;
  v_allowed boolean;
BEGIN
  v_caller := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_caller = '' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM private.scope_for(v_caller) s
    WHERE lower(s.agent_email) = lower(p_agent_email)
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    mv.agent_email,
    mv.agent_full_name,
    mv.bucket_day,
    mv.call_count,
    mv.talk_time_sum,
    mv.talk_time_n,
    mv.qa_count,
    mv.compliance_pass_count,
    mv.compliance_total_count,
    mv.escalation_count,
    mv.csat_high_count,
    mv.csat_medium_count,
    mv.csat_low_count,
    mv.total_alerts_count,
    mv.open_alerts,
    mv.unreviewed_alerts,
    mv.false_positive_count,
    mv.reviewable_call_count
  FROM private.mv_agent_daily_metrics mv
  WHERE lower(mv.agent_email) = lower(p_agent_email)
    AND mv.bucket_day >= p_start
    AND mv.bucket_day <= p_end;
END;
$$;

GRANT EXECUTE ON FUNCTION public.team_daily_metrics(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_daily_metrics(text, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.team_daily_metrics(date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.agent_daily_metrics(text, date, date) FROM PUBLIC, anon;

-- CREATE MATERIALIZED VIEW populated the rows; the existing refresh cron remains.
COMMIT;
