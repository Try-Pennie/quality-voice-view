-- PII-free operational snapshot for Eavesly's public health endpoints.
-- The Worker calls this RPC with the service-role credential and projects only
-- aggregate status/counts to Noodge. No event payloads or customer identifiers
-- leave Postgres through this function.

CREATE INDEX IF NOT EXISTS idx_regal_call_events_type_received_at
  ON public.eavesly_regal_call_events (event_type, received_at DESC, regal_task_id);

CREATE INDEX IF NOT EXISTS idx_regal_resolver_plans_computed_at
  ON public.eavesly_regal_resolver_plans (computed_at DESC);

CREATE OR REPLACE FUNCTION public.eavesly_monitoring_snapshot()
RETURNS TABLE (
  observed_at timestamptz,
  latest_call_completed_at timestamptz,
  latest_transcript_available_at timestamptz,
  events_missing_plan bigint,
  completed_events_missing_call_projection bigint,
  triggered_plans_missing_results bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH clock AS (
    SELECT now() AS observed_at
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
    (
      SELECT count(DISTINCT p.regal_task_id)
      FROM public.eavesly_regal_resolver_plans p
      WHERE p.computed_at >= clock.observed_at - interval '3 hours'
        AND p.computed_at <= clock.observed_at - interval '60 minutes'
        AND pg_catalog.cardinality(p.triggered_modules) > 0
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
  FROM clock;
$function$;

REVOKE ALL ON FUNCTION public.eavesly_monitoring_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eavesly_monitoring_snapshot() FROM anon;
REVOKE ALL ON FUNCTION public.eavesly_monitoring_snapshot() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.eavesly_monitoring_snapshot() TO service_role;
