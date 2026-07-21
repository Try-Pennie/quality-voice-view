-- Follow-up to agent_name_directory_backfill_and_trigger: trigger functions
-- can't be invoked directly anyway, but keep the PostgREST RPC surface closed
-- (matches 20260708194837_revoke_anon_rpc_execute convention).
revoke execute on function public.eavesly_calls_resolve_agent_name() from public, anon, authenticated;
