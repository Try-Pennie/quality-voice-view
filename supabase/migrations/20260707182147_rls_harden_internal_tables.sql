-- Enable RLS on internal-only eavesly tables that were fully exposed to the
-- anon key (flagged by the Supabase rls_disabled advisor, 2026-07-07).
--
-- These tables are written and read ONLY by the eavesly worker, which connects
-- with the service role (SUPABASE_SERVICE_ROLE_KEY) and bypasses RLS. Nothing in
-- quality-voice-view queries them — not the anon browser path, not the
-- authenticated dashboard (verified by grep). So unlike the achieve-portal
-- lockdown (20260704_achieve_portal_lockdown), we add NO authenticated-read
-- policy: the correct end state is deny-all to anon + authenticated,
-- service-role-only.
--
--   eavesly_regal_call_events    — raw Regal webhook payloads INCLUDING full call
--                                  transcripts (the most sensitive of the set).
--   eavesly_regal_resolver_plans — per-call module trigger plans.
--
-- NOTE: when this ran against production it also hardened three one-off backup
-- tables (eavesly_module_results_achieve_v0_backup_20260702,
-- ..._predelete_20260702, ..._beyond_backup_20260707). They are ephemeral and
-- slated to be dropped, so they are intentionally omitted here — a committed
-- migration must not reference tables that won't exist on replay.

-- 1) Enable RLS. With no policies, anon and authenticated get nothing; the
--    service role still has full access (BYPASSRLS).
alter table public.eavesly_regal_call_events    enable row level security;
alter table public.eavesly_regal_resolver_plans enable row level security;

-- 2) Defensive: drop any stray anon/authenticated/public SELECT policy (some
--    tables get policies created ad hoc in the dashboard, not in migrations).
--    Match by role, not name — same approach as the achieve-portal lockdown.
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('eavesly_regal_call_events', 'eavesly_regal_resolver_plans')
      and (roles @> '{public}' or roles @> '{anon}' or roles @> '{authenticated}')
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- 3) Belt and suspenders: pull table grants so no role can read around RLS via
--    an inherited PUBLIC grant. service_role keeps its own explicit grants.
revoke all on table public.eavesly_regal_call_events    from anon, authenticated, public;
revoke all on table public.eavesly_regal_resolver_plans from anon, authenticated, public;
