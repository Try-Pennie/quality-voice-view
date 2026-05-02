-- Add false_positive_count to the agent daily metrics MV so the Team
-- leaderboard and per-manager rollup can subtract confirmed false alarms
-- from the headline alert total. Closes issue #21.
--
-- Confirmed false alarm = alert with has_violation = true and a feedback
-- row where accurate = false. Open / unreviewed alerts still count toward
-- the total — only adjudicated false alarms are excluded.

DROP FUNCTION IF EXISTS public.team_daily_metrics(date, date);
DROP FUNCTION IF EXISTS public.agent_daily_metrics(text, date, date);
DROP MATERIALIZED VIEW IF EXISTS private.mv_agent_daily_metrics;

CREATE MATERIALIZED VIEW private.mv_agent_daily_metrics AS
WITH managers AS (
  SELECT DISTINCT lower(manager_email) AS email FROM public.agent_manager_mapping
  UNION
  SELECT DISTINCT lower(manager_email) FROM public.manager_coaching_prompts
),
call_day AS (
  SELECT
    c.agent_email,
    (c.started_at AT TIME ZONE 'America/New_York')::date AS bucket_day,
    COUNT(*) AS call_count,
    COALESCE(SUM(c.talk_time), 0) AS talk_time_sum,
    COUNT(*) FILTER (WHERE c.talk_time IS NOT NULL) AS talk_time_n,
    COUNT(qa.call_id) AS qa_count,
    COUNT(*) FILTER (WHERE qa.compliance_rating = 'pass') AS compliance_pass_count,
    COUNT(*) FILTER (WHERE qa.compliance_rating IN ('pass','fail')) AS compliance_total_count,
    COUNT(*) FILTER (WHERE qa.manager_escalation = true) AS escalation_count,
    COUNT(*) FILTER (WHERE qa.customer_satisfaction_likely = 'high') AS csat_high_count,
    COUNT(*) FILTER (WHERE qa.customer_satisfaction_likely = 'medium') AS csat_medium_count,
    COUNT(*) FILTER (WHERE qa.customer_satisfaction_likely = 'low') AS csat_low_count
  FROM public.eavesly_calls c
  LEFT JOIN public.eavesly_transcription_qa qa ON qa.call_id = c.call_id
  WHERE c.agent_email IS NOT NULL
    AND c.started_at IS NOT NULL
    AND lower(c.agent_email) NOT IN (SELECT email FROM managers)
    AND EXTRACT(DOW FROM (c.started_at AT TIME ZONE 'America/New_York')) <> 0
  GROUP BY c.agent_email, (c.started_at AT TIME ZONE 'America/New_York')::date
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
  false_positive_count    bigint
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
    mv.false_positive_count
  FROM private.mv_agent_daily_metrics mv
  JOIN scope s ON lower(mv.agent_email) = s.agent_email
  WHERE mv.bucket_day >= p_start
    AND mv.bucket_day <= p_end;
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
  false_positive_count    bigint
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
    mv.false_positive_count
  FROM private.mv_agent_daily_metrics mv
  WHERE lower(mv.agent_email) = lower(p_agent_email)
    AND mv.bucket_day >= p_start
    AND mv.bucket_day <= p_end;
END;
$$;

GRANT EXECUTE ON FUNCTION public.team_daily_metrics(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_daily_metrics(text, date, date) TO authenticated;

-- Populate the new column for the existing data window so the leaderboard
-- subtraction lands the moment this migration applies. The cron job
-- (private.refresh_agent_daily_metrics) keeps it fresh thereafter.
REFRESH MATERIALIZED VIEW private.mv_agent_daily_metrics;
