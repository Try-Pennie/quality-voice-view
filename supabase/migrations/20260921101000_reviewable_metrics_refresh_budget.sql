-- Match the approved full-history rebuild budget without changing global
-- database settings or the existing five-minute refresh cadence.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO STRICT v_job_id FROM cron.job
  WHERE jobname = 'refresh_agent_daily_metrics';

  PERFORM cron.alter_job(
    v_job_id,
    command := $command$
      SET statement_timeout = '10min';
      SET work_mem = '32MB';
      SELECT private.refresh_agent_daily_metrics();
    $command$
  );
END;
$$;
