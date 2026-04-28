-- Team rollup materialized view + RPCs.
--
-- Replaces the client-side aggregation in src/lib/team-queries.ts which was
-- hitting the PostgREST 1000-row cap on the eavesly_calls fetch. The MV
-- pre-aggregates per (agent_email, bucket_day NY-time), so a 30-day team
-- query returns ~agents × days rows (~5K) instead of pulling 50K raw calls.
--
-- The MV lives in a private schema; clients call SECURITY DEFINER RPCs that
-- resolve scope from manager_coaching_prompts.is_god_mode + agent_manager_mapping.

-- 1) Private schema. Lock it down: only postgres can use it directly; the
--    rest of the world goes through the RPCs.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres;

-- 2) Daily metrics per agent. Buckets on America/New_York calendar day so
--    the picker (a browser Date object created in the user's local tz) lines
--    up with what they expect to see — Pennie HQ is east-coast.
CREATE MATERIALIZED VIEW private.mv_agent_daily_metrics AS
WITH call_day AS (
  SELECT
    c.agent_email,
    (c.started_at AT TIME ZONE 'America/New_York')::date AS bucket_day,
    COUNT(*)                                                                AS call_count,
    COALESCE(SUM(c.talk_time), 0)                                           AS talk_time_sum,
    COUNT(*) FILTER (WHERE c.talk_time IS NOT NULL)                         AS talk_time_n,
    COUNT(qa.call_id)                                                       AS qa_count,
    COUNT(*) FILTER (WHERE qa.compliance_rating = 'pass')                   AS compliance_pass_count,
    COUNT(*) FILTER (WHERE qa.compliance_rating IN ('pass','fail'))         AS compliance_total_count,
    COUNT(*) FILTER (WHERE qa.manager_escalation = true)                    AS escalation_count,
    COUNT(*) FILTER (WHERE qa.customer_satisfaction_likely = 'high')        AS csat_high_count,
    COUNT(*) FILTER (WHERE qa.customer_satisfaction_likely = 'medium')      AS csat_medium_count,
    COUNT(*) FILTER (WHERE qa.customer_satisfaction_likely = 'low')         AS csat_low_count
  FROM public.eavesly_calls c
  LEFT JOIN public.eavesly_transcription_qa qa ON qa.call_id = c.call_id
  WHERE c.agent_email IS NOT NULL
    AND c.started_at IS NOT NULL
  GROUP BY c.agent_email, (c.started_at AT TIME ZONE 'America/New_York')::date
),
alert_day AS (
  -- Alerts bucket on alert_created_at (≠ call started_at), so they're
  -- aggregated separately and full-outer-joined.
  SELECT
    m.agent_email,
    (m.created_at AT TIME ZONE 'America/New_York')::date  AS bucket_day,
    COUNT(*) FILTER (WHERE m.has_violation = true)                              AS open_alerts,
    COUNT(*) FILTER (WHERE m.has_violation = true AND f.id IS NULL)             AS unreviewed_alerts
  FROM public.eavesly_module_results m
  LEFT JOIN public.eavesly_alert_feedback f
    ON f.call_id = m.call_id AND f.module_name = m.module_name
  WHERE m.alert_sent = true
    AND m.agent_email IS NOT NULL
    AND m.created_at IS NOT NULL
  GROUP BY m.agent_email, (m.created_at AT TIME ZONE 'America/New_York')::date
),
agent_name AS (
  -- Most recent non-null full name for each agent.
  SELECT DISTINCT ON (agent_email)
    agent_email,
    agent_full_name
  FROM public.eavesly_calls
  WHERE agent_email IS NOT NULL AND agent_full_name IS NOT NULL
  ORDER BY agent_email, started_at DESC NULLS LAST
)
SELECT
  COALESCE(c.agent_email, a.agent_email)                                AS agent_email,
  COALESCE(c.bucket_day, a.bucket_day)                                  AS bucket_day,
  n.agent_full_name                                                     AS agent_full_name,
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
  COALESCE(a.open_alerts, 0)             AS open_alerts,
  COALESCE(a.unreviewed_alerts, 0)       AS unreviewed_alerts
FROM call_day c
FULL OUTER JOIN alert_day a USING (agent_email, bucket_day)
LEFT JOIN agent_name n ON n.agent_email = COALESCE(c.agent_email, a.agent_email);

-- Unique index is required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX mv_agent_daily_metrics_pk
  ON private.mv_agent_daily_metrics (agent_email, bucket_day);

CREATE INDEX mv_agent_daily_metrics_day_idx
  ON private.mv_agent_daily_metrics (bucket_day);

-- 3) Scope helper. Resolves caller email to the set of agent emails they may
--    see. God-mode users (manager_coaching_prompts.is_god_mode = true) see
--    everyone; others see only the agents in agent_manager_mapping.
--    SECURITY DEFINER + locked search_path so the function can read tables
--    without granting direct access to the caller.
CREATE OR REPLACE FUNCTION private.scope_for(p_caller text)
RETURNS TABLE(agent_email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_god boolean;
BEGIN
  SELECT COALESCE(MAX(is_god_mode::int), 0) = 1
    INTO v_god
  FROM public.manager_coaching_prompts
  WHERE manager_email = p_caller;

  IF v_god THEN
    RETURN QUERY
      SELECT DISTINCT mv.agent_email
      FROM private.mv_agent_daily_metrics mv
      WHERE mv.agent_email IS NOT NULL;
  ELSE
    RETURN QUERY
      SELECT m.agent_email
      FROM public.agent_manager_mapping m
      WHERE m.manager_email = p_caller;
  END IF;
END;
$$;

-- 4) Public RPC: per-agent daily metrics in a date window.
--    The client groups these into AgentRollups and the team trend.
--    Returns at most ~(scope_size × days_in_window) rows.
CREATE OR REPLACE FUNCTION public.team_daily_metrics(
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
  open_alerts             bigint,
  unreviewed_alerts       bigint
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
  ),
  rows AS (
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
      mv.open_alerts,
      mv.unreviewed_alerts
    FROM private.mv_agent_daily_metrics mv
    JOIN scope s ON lower(mv.agent_email) = s.agent_email
    WHERE mv.bucket_day >= p_start
      AND mv.bucket_day <= p_end
  )
  SELECT * FROM rows;
END;
$$;

-- 5) Public RPC: per-agent profile metrics. Same shape, single agent.
--    The agent profile page calls this instead of fetchAgentProfile's batch
--    pulls of every call in the window.
CREATE OR REPLACE FUNCTION public.agent_daily_metrics(
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
  open_alerts             bigint,
  unreviewed_alerts       bigint
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
    mv.open_alerts,
    mv.unreviewed_alerts
  FROM private.mv_agent_daily_metrics mv
  WHERE lower(mv.agent_email) = lower(p_agent_email)
    AND mv.bucket_day >= p_start
    AND mv.bucket_day <= p_end;
END;
$$;

-- 6) Refresh helper. Owned by postgres, called by pg_cron and on-demand.
CREATE OR REPLACE FUNCTION private.refresh_agent_daily_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY private.mv_agent_daily_metrics;
END;
$$;

-- 7) Grant execute. SECURITY DEFINER means the function body runs as the
--    function owner, but EXECUTE permission still has to be granted.
GRANT EXECUTE ON FUNCTION public.team_daily_metrics(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_daily_metrics(text, date, date) TO authenticated;
