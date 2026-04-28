-- Schedule mv_agent_daily_metrics to refresh every 5 minutes via pg_cron.
-- Five minutes is fine for the team page; tighten later or replace with
-- triggers if a use case needs sub-minute freshness.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'refresh_agent_daily_metrics';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'refresh_agent_daily_metrics',
  '*/5 * * * *',
  $$ SELECT private.refresh_agent_daily_metrics(); $$
);
