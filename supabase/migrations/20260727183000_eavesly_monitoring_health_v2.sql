-- Split source-event pairing gaps from failures in evaluations that could launch.
-- The Worker exposes these aggregate, PII-free counts through separate Noodge
-- health endpoints. Keep v1 available until the Worker switches to this RPC.

CREATE OR REPLACE FUNCTION public.eavesly_monitoring_snapshot_v2()
RETURNS TABLE (
  observed_at timestamptz,
  latest_call_completed_at timestamptz,
  latest_transcript_available_at timestamptz,
  events_missing_plan bigint,
  completed_events_missing_call_projection bigint,
  completed_events_sampled bigint,
  completed_events_missing_transcript bigint,
  transcript_events_sampled bigint,
  transcript_events_missing_completion bigint,
  launched_plans_missing_results bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH clock AS (
    SELECT now() AS observed_at
  ),
  pairing AS (
    SELECT
      count(*) FILTER (WHERE e.event_type = 'call_completed') AS completed_events_sampled,
      count(*) FILTER (
        WHERE e.event_type = 'call_completed'
          AND NOT EXISTS (
            SELECT 1
            FROM public.eavesly_regal_call_events transcript
            WHERE transcript.regal_task_id = e.regal_task_id
              AND transcript.event_type = 'transcript_available'
          )
      ) AS completed_events_missing_transcript,
      count(*) FILTER (WHERE e.event_type = 'transcript_available') AS transcript_events_sampled,
      count(*) FILTER (
        WHERE e.event_type = 'transcript_available'
          AND NOT EXISTS (
            SELECT 1
            FROM public.eavesly_regal_call_events completed
            WHERE completed.regal_task_id = e.regal_task_id
              AND completed.event_type = 'call_completed'
          )
      ) AS transcript_events_missing_completion
    FROM public.eavesly_regal_call_events e
    CROSS JOIN clock
    WHERE e.event_type IN ('call_completed', 'transcript_available')
      AND e.received_at >= clock.observed_at - interval '2 hours'
      AND e.received_at <= clock.observed_at - interval '15 minutes'
  )
  SELECT
    clock.observed_at,
    (
      SELECT max(e.received_at)
      FROM public.eavesly_regal_call_events e
      WHERE e.event_type = 'call_completed'
    ),
    (
      SELECT max(e.received_at)
      FROM public.eavesly_regal_call_events e
      WHERE e.event_type = 'transcript_available'
    ),
    (
      SELECT count(DISTINCT e.regal_task_id)
      FROM public.eavesly_regal_call_events e
      LEFT JOIN public.eavesly_regal_resolver_plans p
        ON p.regal_task_id = e.regal_task_id
      WHERE e.received_at >= clock.observed_at - interval '2 hours'
        AND e.received_at <= clock.observed_at - interval '5 minutes'
        AND p.regal_task_id IS NULL
    ),
    (
      SELECT count(*)
      FROM public.eavesly_regal_call_events e
      LEFT JOIN public.eavesly_calls c
        ON c.call_id = e.regal_task_id
      WHERE e.event_type = 'call_completed'
        AND e.received_at >= clock.observed_at - interval '2 hours'
        AND e.received_at <= clock.observed_at - interval '5 minutes'
        AND c.call_id IS NULL
    ),
    pairing.completed_events_sampled,
    pairing.completed_events_missing_transcript,
    pairing.transcript_events_sampled,
    pairing.transcript_events_missing_completion,
    (
      SELECT count(DISTINCT p.regal_task_id)
      FROM public.eavesly_regal_resolver_plans p
      WHERE p.computed_at >= clock.observed_at - interval '3 hours'
        AND p.computed_at <= clock.observed_at - interval '60 minutes'
        AND pg_catalog.cardinality(p.triggered_modules) > 0
        -- The event route can only launch workflows once a transcript exists.
        -- Plans without that prerequisite belong to event-pairing health instead.
        AND EXISTS (
          SELECT 1
          FROM public.eavesly_regal_call_events transcript
          WHERE transcript.regal_task_id = p.regal_task_id
            AND transcript.event_type = 'transcript_available'
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(p.triggered_modules) AS expected(module_name)
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.eavesly_module_results r
            WHERE r.call_id = p.regal_task_id
              AND r.module_name = expected.module_name
          )
        )
    )
  FROM clock
  CROSS JOIN pairing;
$function$;

REVOKE ALL ON FUNCTION public.eavesly_monitoring_snapshot_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eavesly_monitoring_snapshot_v2() FROM anon;
REVOKE ALL ON FUNCTION public.eavesly_monitoring_snapshot_v2() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.eavesly_monitoring_snapshot_v2() TO service_role;
