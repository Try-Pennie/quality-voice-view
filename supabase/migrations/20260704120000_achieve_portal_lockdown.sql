-- PSAI-204: Achieve portal server boundary — remove anonymous read access.
--
-- The external /achieve portal previously read eavesly tables directly from
-- the browser with the anon key behind a client-side-only password gate. It
-- now goes through the achieve-portal edge function (service role + server-
-- side password check), so the anon role must no longer be able to read QA
-- results, transcripts, calls, or feedback — directly or through the
-- SECURITY DEFINER-style views that join them.
--
-- The internal dashboard signs in with Google OAuth and queries as
-- `authenticated`; its access is preserved. The eavesly pipeline writes with
-- the service role, which bypasses RLS.

-- 1) Drop every anon/public SELECT policy on the sensitive tables. Policy
--    names vary (some were created in the dashboard, not in migrations), so
--    match by role instead of name.
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'eavesly_calls',
        'eavesly_module_results',
        'eavesly_transcription_qa',
        'eavesly_alert_feedback'
      )
      and cmd = 'SELECT'
      and (roles @> '{public}' or roles @> '{anon}')
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- 2) Make sure RLS is on and authenticated reads still work.
alter table public.eavesly_calls enable row level security;
alter table public.eavesly_module_results enable row level security;
alter table public.eavesly_transcription_qa enable row level security;
alter table public.eavesly_alert_feedback enable row level security;

drop policy if exists "Authenticated read access" on public.eavesly_calls;
create policy "Authenticated read access"
  on public.eavesly_calls for select to authenticated using (true);

drop policy if exists "Authenticated read access" on public.eavesly_module_results;
create policy "Authenticated read access"
  on public.eavesly_module_results for select to authenticated using (true);

drop policy if exists "Authenticated read access" on public.eavesly_transcription_qa;
create policy "Authenticated read access"
  on public.eavesly_transcription_qa for select to authenticated using (true);

drop policy if exists "Authenticated read access" on public.eavesly_alert_feedback;
create policy "Authenticated read access"
  on public.eavesly_alert_feedback for select to authenticated using (true);

-- 3) Belt and suspenders: pull the table grants too, and close the definer
--    views that would otherwise let anon read around RLS. PUBLIC is included
--    because anon inherits any PUBLIC grant, and the views (plain CREATE VIEW,
--    definer semantics) are gated by grants alone.
revoke all on table public.eavesly_calls from anon, public;
revoke all on table public.eavesly_module_results from anon, public;
revoke all on table public.eavesly_transcription_qa from anon, public;
revoke all on table public.eavesly_alert_feedback from anon, public;
revoke all on table public.eavesly_alerts_with_feedback from anon, public;
revoke all on table public.eavesly_disposition_audit from anon, public;
