-- ============================================================================
-- protect-manager-role.check.sql
-- Independent RLS authority harness for public.manager_coaching_prompts.
-- Reproduces the EXACT production policies captured in
--   analysis/production-readiness-2026-09-20/private-catalog.json
-- and validates (a) the current INSERT self-elevation vulnerability,
-- (b) that the current UPDATE policy already blocks self-elevation while
-- allowing legitimate directors to edit their own prompt, and
-- (c) the proposed minimal INSERT fix closes the INSERT vector without
-- affecting UPDATE behavior or ordinary onboarding.
--
-- Disposable only. No production contact. Run against a throwaway Postgres:
--   docker run -d --name pg_prompt_auth -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=t postgres:15
--   docker exec pg_prompt_auth mkdir /c && docker cp ./. pg_prompt_auth:/c/
--   docker exec -e PGPASSWORD=pw pg_prompt_auth psql -U postgres -d t -f /c/protect-manager-role.check.sql
--   docker rm -f pg_prompt_auth
-- ============================================================================

\set ON_ERROR_STOP on

-- ---- Supabase primitives -------------------------------------------------
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb
  language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
  then create role authenticated nologin; end if; end $$;

-- ---- Table: ONLY PK (uuid) + UNIQUE(manager_email); zero CHECK; default false
drop table if exists public.manager_coaching_prompts cascade;
create table public.manager_coaching_prompts (
  id            uuid primary key default gen_random_uuid(),
  manager_email text not null unique,
  is_god_mode   boolean not null default false,
  coaching_prompt text
);
alter table public.manager_coaching_prompts enable row level security;

-- Observed privileges: authenticated may SELECT/INSERT/UPDATE (incl. is_god_mode col)
grant select, insert, update on public.manager_coaching_prompts to authenticated;

-- ---- EXACT production policies (verbatim predicates) ----------------------
create policy "Users can view own prompt data"
  on public.manager_coaching_prompts for select to authenticated
  using (manager_email = (auth.jwt() ->> 'email'::text));

create policy "Users can insert own prompt data"
  on public.manager_coaching_prompts for insert to authenticated
  with check (manager_email = (auth.jwt() ->> 'email'::text));

create policy "Users can update own prompt data"
  on public.manager_coaching_prompts for update to authenticated
  using (manager_email = (auth.jwt() ->> 'email'::text))
  with check ((manager_email = (auth.jwt() ->> 'email'::text)) AND (is_god_mode = ( SELECT manager_coaching_prompts_1.is_god_mode
     FROM manager_coaching_prompts manager_coaching_prompts_1
    WHERE (manager_coaching_prompts_1.manager_email = (auth.jwt() ->> 'email'::text)))));

-- ---- Seed as owner (service_role-equivalent; bypasses RLS) ----------------
insert into public.manager_coaching_prompts(manager_email, is_god_mode, coaching_prompt) values
  ('director@trypennie.com', true,  'director notes'),
  ('manager@trypennie.com',  false, 'manager notes');

-- ---- Assertion helper ----------------------------------------------------
create or replace function pg_temp.expect(p_label text, p_ok boolean) returns void
  language plpgsql as $$ begin
    if p_ok is distinct from true then raise exception 'FAIL: %', p_label; end if;
    raise notice 'PASS: %', p_label;
  end $$;

create or replace function pg_temp.as_user(p_email text) returns void
  language plpgsql as $$ begin
    perform set_config('request.jwt.claims', json_build_object('email',p_email)::text, false);
  end $$;

-- ==========================================================================
-- PHASE 1 — CURRENT (observed) policies
-- ==========================================================================
set role authenticated;

-- T1: user with NO row self-inserts is_god_mode=true  -> currently SUCCEEDS (vuln)
select pg_temp.as_user('attacker@trypennie.com');
do $$ declare ok boolean; begin
  begin
    insert into public.manager_coaching_prompts(manager_email,is_god_mode) values('attacker@trypennie.com',true);
    ok := exists(select 1 from public.manager_coaching_prompts where manager_email='attacker@trypennie.com' and is_god_mode);
  exception when others then ok := false; end;
  perform pg_temp.expect('T1 current INSERT self-grant god SUCCEEDS (documents vulnerability)', ok = true);
end $$;

-- T2: existing ordinary user UPDATE false->true -> must be DENIED by update guard
select pg_temp.as_user('manager@trypennie.com');
do $$ declare denied boolean := false; begin
  begin
    update public.manager_coaching_prompts set is_god_mode=true where manager_email='manager@trypennie.com';
  exception when others then denied := true; end;
  denied := denied or not exists(select 1 from public.manager_coaching_prompts where manager_email='manager@trypennie.com' and is_god_mode);
  perform pg_temp.expect('T2 current UPDATE self-elevation false->true DENIED', denied);
end $$;

-- T3: legitimate director edits own prompt text, keeps god=true -> must be ALLOWED
select pg_temp.as_user('director@trypennie.com');
do $$ declare ok boolean; begin
  begin
    update public.manager_coaching_prompts set coaching_prompt='director edit 1' where manager_email='director@trypennie.com';
    ok := exists(select 1 from public.manager_coaching_prompts where manager_email='director@trypennie.com' and is_god_mode and coaching_prompt='director edit 1');
  exception when others then ok := false; end;
  perform pg_temp.expect('T3 current UPDATE director edits own prompt (keeps god) ALLOWED', ok);
end $$;

reset role;

-- ==========================================================================
-- PHASE 2 — Apply proposed minimal INSERT fix ONLY (UPDATE/SELECT unchanged)
--   with check (manager_email = jwt email AND is_god_mode IS FALSE)
-- ==========================================================================
\ir 20260920200000_protect_manager_role_on_insert.sql

set role authenticated;

-- T4: user with NO row self-inserts god=true -> must now be DENIED
select pg_temp.as_user('attacker2@trypennie.com');
do $$ declare denied boolean := false; begin
  begin
    insert into public.manager_coaching_prompts(manager_email,is_god_mode) values('attacker2@trypennie.com',true);
  exception when others then denied := true; end;
  denied := denied and not exists(select 1 from public.manager_coaching_prompts where manager_email='attacker2@trypennie.com');
  perform pg_temp.expect('T4 fixed INSERT self-grant god DENIED', denied);
end $$;

-- T5: ordinary onboarding self-insert god=false -> still ALLOWED
select pg_temp.as_user('attacker2@trypennie.com');
do $$ declare ok boolean; begin
  begin
    insert into public.manager_coaching_prompts(manager_email,is_god_mode) values('attacker2@trypennie.com',false);
    ok := exists(select 1 from public.manager_coaching_prompts where manager_email='attacker2@trypennie.com' and not is_god_mode);
  exception when others then ok := false; end;
  perform pg_temp.expect('T5 fixed INSERT ordinary self-insert (god=false) ALLOWED', ok);
end $$;

-- T6: UPDATE self-elevation still DENIED (policy untouched)
select pg_temp.as_user('manager@trypennie.com');
do $$ declare denied boolean := false; begin
  begin
    update public.manager_coaching_prompts set is_god_mode=true where manager_email='manager@trypennie.com';
  exception when others then denied := true; end;
  denied := denied or not exists(select 1 from public.manager_coaching_prompts where manager_email='manager@trypennie.com' and is_god_mode);
  perform pg_temp.expect('T6 post-fix UPDATE self-elevation still DENIED', denied);
end $$;

-- T7: legitimate director prompt edit still ALLOWED (policy untouched)
select pg_temp.as_user('director@trypennie.com');
do $$ declare ok boolean; begin
  begin
    update public.manager_coaching_prompts set coaching_prompt='director edit 2' where manager_email='director@trypennie.com';
    ok := exists(select 1 from public.manager_coaching_prompts where manager_email='director@trypennie.com' and is_god_mode and coaching_prompt='director edit 2');
  exception when others then ok := false; end;
  perform pg_temp.expect('T7 post-fix director edits own prompt (keeps god) ALLOWED', ok);
end $$;

-- T8: director saves via upsert WITHOUT is_god_mode in payload -> ALLOWED, keeps god.
-- (INSERT check runs on the proposed row even on the DO UPDATE path; default false passes.)
do $$ declare ok boolean; begin
  begin
    insert into public.manager_coaching_prompts(manager_email,coaching_prompt) values('director@trypennie.com','director upsert')
      on conflict (manager_email) do update set coaching_prompt=excluded.coaching_prompt;
    ok := exists(select 1 from public.manager_coaching_prompts where manager_email='director@trypennie.com' and is_god_mode and coaching_prompt='director upsert');
  exception when others then ok := false; end;
  perform pg_temp.expect('T8 post-fix director upsert without role column ALLOWED (keeps god)', ok);
end $$;

-- T9: KNOWN LIMIT — director upsert that echoes is_god_mode=true is rejected by the INSERT check.
-- Any client that upserts must omit is_god_mode (or use UPDATE).
do $$ declare denied boolean := false; begin
  begin
    insert into public.manager_coaching_prompts(manager_email,is_god_mode,coaching_prompt) values('director@trypennie.com',true,'x')
      on conflict (manager_email) do update set coaching_prompt=excluded.coaching_prompt;
  exception when others then denied := true; end;
  perform pg_temp.expect('T9 post-fix director upsert echoing god=true DENIED (documented limit)', denied);
end $$;

reset role;
