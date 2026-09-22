-- These service-only batch RPCs legitimately exceed PostgREST's default 8s
-- under shared database load. Keep finite, function-scoped budgets rather than
-- increasing the timeout for the API or its roles globally.
alter function public.get_achieve_agent_feedback_dashboard(timestamptz, timestamptz, integer, integer)
  set statement_timeout = '30s';
alter function public.ingest_achieve_first_pay_outcome_snapshot(date, integer, bigint, jsonb)
  set statement_timeout = '60s';
notify pgrst, 'reload schema';
