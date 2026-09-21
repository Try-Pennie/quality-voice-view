-- Apply only after the indexed plan and repeated bounded refreshes pass.
-- Restore the five-minute cadence with a timeout shorter than that cadence;
-- a future slow run must not occupy the database continuously for ten minutes.
DO $$
DECLARE v_job_id bigint;
BEGIN
  IF position('qa_transcripts AS MATERIALIZED' in
    pg_get_viewdef('private.mv_agent_daily_metrics', true)) = 0
    OR position('regal_transcripts AS MATERIALIZED' in
    pg_get_viewdef('private.mv_agent_daily_metrics', true)) = 0 THEN
    RAISE EXCEPTION 'Refusing to resume the transcript-reading refresh plan';
  END IF;

  SELECT jobid INTO STRICT v_job_id FROM cron.job
  WHERE jobname = 'refresh_agent_daily_metrics';
  PERFORM cron.alter_job(
    v_job_id,
    command := $command$
      SET statement_timeout = '2min';
      SET work_mem = '32MB';
      SELECT private.refresh_agent_daily_metrics();
    $command$,
    active := true
  );
END;
$$;
