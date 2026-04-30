-- Stabilize team_daily_metrics row order so the client's PostgREST `.range()`
-- pagination doesn't drop or duplicate rows. Without ORDER BY the planner is
-- free to return rows in different orders across the two HTTP calls that
-- cover (0,999) and (1000,1999), which silently skips agents whose daily
-- rows shift across the page boundary.

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
  total_alerts_count      bigint,
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
    mv.unreviewed_alerts
  FROM private.mv_agent_daily_metrics mv
  JOIN scope s ON lower(mv.agent_email) = s.agent_email
  WHERE mv.bucket_day >= p_start
    AND mv.bucket_day <= p_end
  ORDER BY mv.bucket_day, mv.agent_email;
END;
$$;
