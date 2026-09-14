#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260914010000_ui_load_performance.sql"
container="ui-load-performance-check-$RANDOM-$$"
tmp="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

{
  cat <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

create table public.eavesly_calls (
  id bigint generated always as identity primary key,
  call_id text not null,
  agent_email text,
  agent_full_name text,
  started_at timestamptz,
  ended_at timestamptz,
  completed_at timestamptz,
  direction text,
  disposition text,
  talk_time integer,
  handle_time integer,
  wrapup_time integer,
  conversation_happened boolean,
  contact_phone text,
  campaign_name text,
  notes text,
  created_at timestamptz not null default now()
);
-- Match the deployed index exactly; do not give the benchmark a test-only id key.
create index idx_eavesly_calls_started_at_desc
  on public.eavesly_calls (started_at desc nulls last);

create table public.eavesly_transcription_qa (
  id bigint generated always as identity primary key,
  call_id text,
  agent_email text,
  manager_email text,
  overall_score text,
  compliance_rating text,
  customer_satisfaction_likely text,
  manager_escalation boolean,
  qa_json jsonb,
  call_summary text,
  original_transcript text,
  transcription_link text,
  recording_link text,
  coaching_insights_analysis text,
  created_at timestamptz
);
create index eavesly_transcription_qa_call_id_idx on public.eavesly_transcription_qa (call_id);

create table public.agent_manager_mapping (
  agent_email text,
  manager_email text not null
);
create table public.manager_coaching_prompts (
  manager_email text primary key,
  is_god_mode boolean not null default false
);

alter table public.eavesly_calls enable row level security;
alter table public.eavesly_transcription_qa enable row level security;
alter table public.agent_manager_mapping enable row level security;
alter table public.manager_coaching_prompts enable row level security;
create policy calls_authenticated_read on public.eavesly_calls
  for select to authenticated using (true);
create policy qa_authenticated_read on public.eavesly_transcription_qa
  for select to authenticated using (true);
create policy mapping_authenticated_read on public.agent_manager_mapping
  for select to authenticated using (true);
create policy prompts_own_row on public.manager_coaching_prompts
  for select to authenticated
  using (manager_email = auth.jwt() ->> 'email');

grant select on public.eavesly_calls, public.eavesly_transcription_qa,
  public.agent_manager_mapping, public.manager_coaching_prompts to authenticated;
revoke all on public.eavesly_calls, public.eavesly_transcription_qa,
  public.agent_manager_mapping, public.manager_coaching_prompts from anon, public;

insert into public.agent_manager_mapping(agent_email, manager_email) values
  ('agent-a@example.test', 'manager@example.test'),
  ('agent-zero@example.test', 'manager@example.test'),
  ('out-agent@example.test', 'other-manager@example.test'),
  ('', 'manager@example.test'),
  (null, 'manager@example.test');
insert into public.manager_coaching_prompts(manager_email, is_god_mode) values
  ('manager@example.test', false),
  ('other-manager@example.test', false),
  ('god@example.test', true),
  ('outsider@example.test', false);

-- More than PostgREST's default row cap, for pagination and complete export order.
insert into public.eavesly_calls(
  call_id, agent_email, agent_full_name, started_at, disposition, talk_time, handle_time
)
select 'B-' || g, 'bulk@example.test', 'Bulk Agent',
  '2026-01-02 00:00:00+00'::timestamptz + g * interval '1 second',
  'Bulk', g % 300, g % 400
from generate_series(1, 1005) g;

-- Latest-QA selection: newest timestamp, then highest id; null timestamps sort last.
insert into public.eavesly_calls(call_id, agent_email, started_at, disposition)
values ('DEDUPE', 'agent-a@example.test', '2026-01-03 12:00+00', 'Deduped'),
       ('NO-QA', 'agent-a@example.test', '2026-01-03 11:00+00', 'No QA');
insert into public.eavesly_transcription_qa(
  call_id, overall_score, compliance_rating, customer_satisfaction_likely,
  manager_escalation, call_summary, original_transcript, created_at
) values
  ('DEDUPE', 'poor', 'fail', 'low', true, 'old', 'secret old', '2026-01-01+00'),
  ('DEDUPE', 'good', 'pass', 'medium', false, 'same-time lower id', 'secret', '2026-01-05+00'),
  ('DEDUPE', 'excellent', 'pass', 'high', false, 'same-time winner', 'secret', '2026-01-05+00'),
  ('DEDUPE', 'poor', 'fail', 'low', true, 'null timestamp', 'secret', null);

-- Score ranks and deterministic tie-breaking.
insert into public.eavesly_calls(call_id, agent_email, started_at, disposition)
values ('SC-EX', 'agent-a@example.test', '2026-01-04 12:00+00', 'Score'),
       ('SC-GOOD', 'agent-a@example.test', '2026-01-04 12:00+00', 'Score'),
       ('SC-FAIR', 'agent-a@example.test', '2026-01-04 12:00+00', 'Score'),
       ('SC-UNKNOWN', 'agent-a@example.test', '2026-01-04 12:00+00', 'Score');
insert into public.eavesly_transcription_qa(call_id, overall_score, created_at) values
  ('SC-EX', 'excellent', '2026-01-04+00'),
  ('SC-GOOD', 'good', '2026-01-04+00'),
  ('SC-FAIR', 'fair', '2026-01-04+00');

-- KPI denominator/rounding and disposition-option behavior.
insert into public.eavesly_calls(
  call_id, agent_email, started_at, disposition, talk_time, handle_time
) values
  ('AVG-1', 'agent-a@example.test', '2026-01-05 10:00+00', 'D1', null, null),
  ('AVG-2', 'agent-a@example.test', '2026-01-05 11:00+00', 'D1', 10, 20),
  ('AVG-3', 'agent-a@example.test', '2026-01-05 12:00+00', 'D2', 11, null),
  ('AVG-4', 'agent-a@example.test', '2026-01-05 13:00+00', 'D2', null, 21);
insert into public.eavesly_transcription_qa(
  call_id, overall_score, compliance_rating, customer_satisfaction_likely,
  manager_escalation, created_at
) values
  ('AVG-2', 'excellent', 'pass', 'high', false, '2026-01-05+00'),
  ('AVG-3', null, null, null, false, '2026-01-05+00'),
  ('AVG-4', 'poor', 'fail', 'low', false, '2026-01-05+00');

-- Threshold edge cases and pitch normalization/bounds.
insert into public.eavesly_calls(call_id, agent_email, started_at, disposition, campaign_name, talk_time)
values
  ('TH-KNOWN', 'agent-a@example.test', '2026-01-06 01:00+00', 'Threshold', 'Cold', 2000),
  ('TH-NULL', 'agent-a@example.test', '2026-01-06 02:00+00', 'Threshold', 'Cold', 2000),
  ('TH-SAT', 'agent-a@example.test', '2026-01-06 02:30+00', 'Threshold', 'Cold', 2000),
  ('R-1799', 'agent-a@example.test', '2026-01-06 03:00+00', 'Connected', 'CAL.COM__MEETING', 1799),
  ('R-1800', 'agent-a@example.test', '2026-01-06 04:00+00', 'call-now requested', null, 1800),
  ('R-ZERO', 'agent-a@example.test', '2026-01-06 05:00+00', 'Connected', 'Cal.com Meeting', 0),
  ('R-NEG', 'agent-a@example.test', '2026-01-06 06:00+00', 'CALL NOW REQUESTED', null, -1),
  ('R-NOSHOW', 'agent-a@example.test', '2026-01-06 07:00+00', '1.1A - No__Show - First Call', 'Cal.com Meeting', 5),
  ('R-OUT', 'out-agent@example.test', '2026-01-06 08:00+00', 'Connected', 'call--now requested', 10);
insert into public.eavesly_transcription_qa(
  call_id, overall_score, compliance_rating, customer_satisfaction_likely,
  manager_escalation, created_at
) values
  ('TH-KNOWN', 'good', 'pass', 'high', false, '2026-01-06+00'),
  ('TH-NULL', null, null, null, false, '2026-01-06+00'),
  ('TH-SAT', null, 'pass', 'high', false, '2026-01-06+00');

-- Active-agent name selection ignores null names and chooses newest deterministically.
insert into public.eavesly_calls(call_id, agent_email, agent_full_name, started_at)
values ('NAME-OLD', 'agent-a@example.test', 'Agent A Old', '2026-01-07 01:00+00'),
       ('NAME-NEW', 'agent-a@example.test', 'Agent A New', '2026-01-07 02:00+00'),
       ('NAME-NULL', 'agent-a@example.test', null, '2026-01-07 03:00+00'),
       ('ONLY-NULL', 'null-name@example.test', null, '2026-01-07 04:00+00');

-- JS Math.round differs from PostgreSQL round for negative halves. Empty
-- dispositions are falsey in the legacy browser filter and are not options.
insert into public.eavesly_calls(
  call_id, agent_email, started_at, disposition, talk_time, handle_time
) values
  ('NEG-1', 'agent-a@example.test', '2026-01-08 01:00+00', 'Named', -1, -3),
  ('NEG-2', 'agent-a@example.test', '2026-01-08 02:00+00', '', null, null);

-- Agent sorting uses the rendered fallback, including separator collapse and
-- Unknown when no trimmed email local-part exists.
insert into public.eavesly_calls(call_id, agent_email, agent_full_name, started_at)
values
  ('AG-ALICE', 'other@example.test', ' Alice ', '2026-01-09 01:00+00'),
  ('AG-BOB', 'bob__jones@example.test', null, '2026-01-09 02:00+00'),
  ('AG-UNKNOWN', null, null, '2026-01-09 03:00+00'),
  ('AG-EMPTY', '', null, '2026-01-09 04:00+00');
SQL
  cat "$migration"
  cat <<'SQL'

-- Grants, invoker mode, and RLS remain the authorization boundary.
do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.eavesly_calls_page(timestamptz,timestamptz,text[],text[],text,jsonb,text,boolean,integer,integer)'::regprocedure,
    'public.eavesly_calls_summary(timestamptz,timestamptz,text[],text[],text,jsonb)'::regprocedure,
    'public.eavesly_active_call_agents(timestamptz)'::regprocedure,
    'public.eavesly_team_pitch_risk(timestamptz,timestamptz)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'execute')
      or has_function_privilege('public', f, 'execute')
      or not has_function_privilege('authenticated', f, 'execute')
      or (select prosecdef from pg_proc where oid = f) then
      raise exception 'unsafe RPC privilege or security mode: %', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.eavesly_calls', 'select')
    or has_table_privilege('anon', 'public.eavesly_transcription_qa', 'select')
    or not has_table_privilege('authenticated', 'public.eavesly_calls', 'select') then
    raise exception 'base-table grants changed';
  end if;
end $$;

select set_config('request.jwt.claims',
  '{"email":"manager@example.test"}', false);
set role authenticated;

do $$
declare first_page jsonb; second_page jsonb;
begin
  first_page := public.eavesly_calls_page(
    '2026-01-02+00', '2026-01-02 23:59:59+00', array['bulk@example.test'],
    array[]::text[], 'all', '{}'::jsonb, 'time', true, 0, 1000);
  second_page := public.eavesly_calls_page(
    '2026-01-02+00', '2026-01-02 23:59:59+00', array['bulk@example.test'],
    array[]::text[], 'all', '{}'::jsonb, 'time', true, 1000, 1000);
  if jsonb_array_length(first_page->'rows') <> 1000
    or not (first_page->>'has_more')::boolean
    or jsonb_array_length(second_page->'rows') <> 5
    or (second_page->>'has_more')::boolean
    or first_page->'rows'->0->>'call_id' <> 'B-1005'
    or first_page->'rows'->999->>'call_id' <> 'B-6'
    or second_page->'rows'->0->>'call_id' <> 'B-5'
    or second_page->'rows'->4->>'call_id' <> 'B-1'
    or (select count(distinct r->>'call_id')
        from jsonb_array_elements((first_page->'rows') || (second_page->'rows')) r) <> 1005 then
    raise exception 'pagination/export order failed: %, %', first_page, second_page;
  end if;
end $$;

do $$
declare r jsonb; s jsonb;
begin
  r := public.eavesly_calls_page(
    '2026-01-03+00', '2026-01-03 23:59:59+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb, 'time', true, 0, 25);
  if jsonb_array_length(r->'rows') <> 2
    or r->'rows'->0->>'call_id' <> 'DEDUPE'
    or r->'rows'->0->'qa'->>'overall_score' <> 'excellent'
    or r->'rows'->0->'qa' ? 'call_summary'
    or r->'rows'->1->'qa' <> 'null'::jsonb
    or (select array_agg(k order by k) from jsonb_object_keys(r->'rows'->0->'qa') k)
       <> array['call_id','compliance_rating','customer_satisfaction_likely','manager_escalation','overall_score'] then
    raise exception 'latest compact QA/no-QA behavior failed: %', r;
  end if;
  s := public.eavesly_calls_summary(
    '2026-01-03+00', '2026-01-03 23:59:59+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb);
  if (s->>'total_calls')::int <> 2
    or (s->>'calls_requiring_attention')::int <> 0
    or (s->>'compliance_pass_rate')::int <> 100 then
    raise exception 'summary did not use the same latest QA: %', s;
  end if;
end $$;

do $$
declare r jsonb;
begin
  r := public.eavesly_calls_page(
    '2026-01-04+00', '2026-01-04 23:59:59+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb, 'score', true, 0, 25);
  if (select array_agg(x->>'call_id' order by ord)
      from jsonb_array_elements(r->'rows') with ordinality t(x, ord))
      <> array['SC-EX','SC-GOOD','SC-FAIR','SC-UNKNOWN'] then
    raise exception 'score rank/tie order failed: %', r;
  end if;
end $$;

do $$
declare r jsonb;
begin
  r := public.eavesly_calls_page(
    '2026-01-06+00', '2026-01-06 23:59:59+00', array[]::text[], array[]::text[],
    'threshold', '{"overallScore":"not-a-score","compliance":null,"customerSat":null}',
    'time', true, 0, 25);
  if (select array_agg(x->>'call_id' order by ord)
      from jsonb_array_elements(r->'rows') with ordinality t(x, ord))
      <> array['TH-SAT','TH-KNOWN'] then
    raise exception 'unknown/null threshold JS parity failed: %', r;
  end if;

  r := public.eavesly_calls_page(
    '2026-01-06+00', '2026-01-06 23:59:59+00', array[]::text[], array[]::text[],
    'rushed', '"malformed settings"'::jsonb, 'time', true, 0, 25);
  if jsonb_array_length(r->'rows') <> 2
    or not (r->'rows' @> '[{"call_id":"R-1799"}]')
    or not (r->'rows' @> '[{"call_id":"R-OUT"}]') then
    raise exception 'pitch normalization/no-show/1800 boundary failed: %', r;
  end if;
end $$;

do $$
declare s jsonb;
begin
  s := public.eavesly_calls_summary(
    '2026-01-05+00', '2026-01-05 23:59:59+00', array[]::text[], array['D1'],
    'all', '{}'::jsonb);
  if (s->>'total_calls')::int <> 2
    or (s->>'window_calls')::int <> 4
    or (s->>'calls_requiring_attention')::int <> 0
    or (s->>'avg_talk_time')::int <> 5
    or (s->>'avg_handle_time')::int <> 10
    or (s->>'compliance_pass_rate')::int <> 100
    or (s->>'high_sat_rate')::int <> 100
    or s->'dispositions' <> '["D1", "D2"]'::jsonb then
    raise exception 'filtered summary/window/options failed: %', s;
  end if;

  s := public.eavesly_calls_summary(
    '2026-01-05+00', '2026-01-05 23:59:59+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb);
  if (s->>'total_calls')::int <> 4
    or (s->>'calls_requiring_attention')::int <> 1
    or (s->>'avg_talk_time')::int <> 5
    or (s->>'avg_handle_time')::int <> 10
    or (s->>'compliance_pass_rate')::int <> 33
    or (s->>'high_sat_rate')::int <> 33 then
    raise exception 'KPI denominator/null-as-zero/rounding failed: %', s;
  end if;

  s := public.eavesly_calls_summary(
    '2026-01-06+00', '2026-01-06 23:59:59+00', array[]::text[], array[]::text[],
    'threshold', '{"overallScore":null,"compliance":null,"customerSat":null}');
  if (s->>'total_calls')::int <> 2 then
    raise exception 'summary threshold parity diverged from page: %', s;
  end if;
end $$;

do $$
declare a jsonb;
begin
  a := public.eavesly_active_call_agents('2026-01-01+00');
  if (select count(*) from jsonb_array_elements(a) x
      where x->>'agent_email' = 'agent-a@example.test') <> 1
    or (select x->>'agent_full_name' from jsonb_array_elements(a) x
        where x->>'agent_email' = 'agent-a@example.test') <> 'Agent A New'
    or exists (select 1 from jsonb_array_elements(a) x
        where x->>'agent_email' in ('agent-zero@example.test','null-name@example.test')) then
    raise exception 'active-agent distinct/latest/non-null behavior failed: %', a;
  end if;
end $$;

do $$
declare r jsonb; s jsonb;
begin
  r := public.eavesly_calls_page(
    '2026-01-09+00', '2026-01-09 23:59:59+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb, 'agent', false, 0, 25);
  if (select array_agg(x->>'call_id' order by ord)
      from jsonb_array_elements(r->'rows') with ordinality t(x, ord))
      <> array['AG-ALICE','AG-BOB','AG-EMPTY','AG-UNKNOWN'] then
    raise exception 'agent display-name fallback sort failed: %', r;
  end if;

  s := public.eavesly_calls_summary(
    '2026-01-08+00', '2026-01-08 23:59:59+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb);
  if (s->>'avg_talk_time')::int <> 0
    or (s->>'avg_handle_time')::int <> -1
    or s->'dispositions' <> '["Named"]'::jsonb then
    raise exception 'JS negative-half rounding or empty disposition parity failed: %', s;
  end if;
end $$;

-- The invoker reads calls through authenticated RLS, but Team scope is narrower.
do $$
declare r jsonb;
begin
  if (select count(*) from public.eavesly_calls) < 1020
    or (select count(*) from public.agent_manager_mapping) <> 5 then
    raise exception 'authenticated calls or manager-directory RLS changed';
  end if;
  r := public.eavesly_team_pitch_risk('2026-01-06+00', '2026-01-06 23:59:59+00');
  if jsonb_array_length(r) <> 2
    or (select (x->>'pitch_call_count')::int from jsonb_array_elements(r) x
        where x->>'agent_email' = 'agent-a@example.test') <> 4
    or (select (x->>'rushed_pitch_count')::int from jsonb_array_elements(r) x
        where x->>'agent_email' = 'agent-a@example.test') <> 1
    or (select (x->>'pitch_call_count')::int from jsonb_array_elements(r) x
        where x->>'agent_email' = 'agent-zero@example.test') <> 0
    or exists (select 1 from jsonb_array_elements(r) x
        where x->>'agent_email' = 'out-agent@example.test') then
    raise exception 'manager pitch scope/counts failed: %', r;
  end if;
end $$;
reset role;

-- JWT and mapping email comparisons are exact, matching fetchUserScope.
select set_config('request.jwt.claims', '{"email":"Manager@example.test"}', false);
set role authenticated;
do $$
begin
  if public.eavesly_team_pitch_risk('2026-01-06+00', '2026-01-06 23:59:59+00') <> '[]'::jsonb then
    raise exception 'case-mismatched manager JWT broadened Team scope';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{}', false);
set role authenticated;
do $$
begin
  if public.eavesly_team_pitch_risk('2026-01-06+00', '2026-01-06 23:59:59+00') <> '[]'::jsonb then
    raise exception 'missing-email JWT received Team scope';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"email":"god@example.test"}', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.eavesly_team_pitch_risk('2026-01-06+00', '2026-01-06 23:59:59+00');
  if not (r @> '[{"agent_email":"out-agent@example.test","pitch_call_count":1,"rushed_pitch_count":1}]') then
    raise exception 'god-mode pitch scope failed: %', r;
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"email":"outsider@example.test"}', false);
set role authenticated;
do $$
begin
  if public.eavesly_team_pitch_risk('2026-01-06+00', '2026-01-06 23:59:59+00') <> '[]'::jsonb then
    raise exception 'unmapped manager received pitch rows';
  end if;
end $$;
reset role;

-- Boundary checks reject unbounded pages and invalid finite selectors.
select set_config('request.jwt.claims', '{"email":"manager@example.test"}', false);
set role authenticated;
do $$
begin
  begin
    perform public.eavesly_calls_page(
      '2026-01-01+00', '2026-01-08+00', null, null, 'all', null, 'time', true, 0, 1001);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
  begin
    perform public.eavesly_calls_page(
      '2026-01-01+00', '2026-01-08+00', null, null, 'all', null, 'not-a-sort', true, 0, 25);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
  begin
    perform public.eavesly_calls_page(
      '2026-01-01+00', '2026-01-08+00', null, null, 'all', null, 'time', true, -1, 25);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
  begin
    perform public.eavesly_calls_page(
      '2026-01-01+00', '2026-01-08+00', null, null, 'all', null, 'time', true, 0, -1);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
  begin
    perform public.eavesly_calls_page(
      '-infinity', 'infinity', null, null, 'all', null, 'time', true, 0, 25);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
  begin
    perform public.eavesly_calls_summary(
      '-infinity', 'infinity', null, null, 'all', null);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
  begin
    perform public.eavesly_active_call_agents('-infinity');
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
  begin
    perform public.eavesly_team_pitch_risk('-infinity', 'infinity');
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_CALLS_QUERY' then raise; end if;
  end;
end $$;
reset role;

select 'ui-load-performance behavior/auth assertions passed' as result;

-- Replace behavior fixtures with a deterministic 70k-call benchmark corpus.
truncate public.eavesly_transcription_qa, public.eavesly_calls restart identity;
insert into public.eavesly_calls(
  call_id, agent_email, agent_full_name, started_at, disposition,
  campaign_name, talk_time, handle_time
)
select
  'BENCH-' || g,
  'agent-' || (g % 100) || '@example.test',
  'Agent ' || (g % 100),
  '2026-08-31 23:59:59+00'::timestamptz - g * interval '1 second',
  case when g % 7 = 0 then 'CALL NOW REQUESTED' else 'Connected' end,
  case when g % 11 = 0 then 'Cal.com Meeting' else 'Outbound' end,
  g % 2700,
  g % 3000
from generate_series(1, 70000) g;
insert into public.eavesly_transcription_qa(
  call_id, overall_score, compliance_rating, customer_satisfaction_likely,
  manager_escalation, created_at
)
select
  'BENCH-' || g,
  (array['excellent','good','fair','poor'])[1 + g % 4],
  (array['pass','fail'])[1 + g % 2],
  (array['high','medium','low'])[1 + g % 3],
  g % 29 = 0,
  '2026-09-01+00'::timestamptz + g * interval '1 millisecond'
from generate_series(1, 70000) g;
analyze public.eavesly_calls;
analyze public.eavesly_transcription_qa;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres

claims='{"email":"god@example.test"}'
page_sql="select public.eavesly_calls_page('2026-08-01+00','2026-09-01+00',array[]::text[],array[]::text[],'all','{}'::jsonb,'time',true,0,25)"
summary_sql="select public.eavesly_calls_summary('2026-08-01+00','2026-09-01+00',array[]::text[],array[]::text[],'all','{}'::jsonb)"

benchmark() {
  local label="$1" sql="$2" times=() output value
  for _ in $(seq 1 5); do
    output="$(docker exec -i "$container" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
select set_config('request.jwt.claims', '$claims', false);
set role authenticated;
explain (analyze, buffers, format json) $sql;
SQL
)"
    value="$(grep -o '"Execution Time": [0-9.]*' <<<"$output" | awk '{print $3}')"
    [[ -n "$value" ]]
    times+=("$value")
  done
  printf '%s\n' "${times[@]}" | sort -n >"$tmp/$label-times"
  printf 'benchmark %s_ms median=%s runs=%s\n' \
    "$label" "$(sed -n '3p' "$tmp/$label-times")" "$(paste -sd, "$tmp/$label-times")"
}

# auto_explain exposes the nested invoker-function plan; the assertion guards
# the default first page against probing every QA row.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >"$tmp/page-plan" 2>&1 <<SQL
load 'auto_explain';
set client_min_messages = log;
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
select set_config('request.jwt.claims', '$claims', false);
set role authenticated;
\o /dev/null
$page_sql;
SQL
if ! grep -q 'idx_eavesly_calls_started_at_desc' "$tmp/page-plan" \
  || ! grep -q 'eavesly_transcription_qa_latest_idx' "$tmp/page-plan" \
  || ! grep -Eq 'eavesly_transcription_qa_latest_idx.*loops=(2[5-9]|30)' "$tmp/page-plan"; then
  cat "$tmp/page-plan" >&2
  echo 'default page plan did not use bounded latest-QA index lookups' >&2
  exit 1
fi
grep -E 'idx_eavesly_calls_started_at_desc|eavesly_transcription_qa_latest_idx' "$tmp/page-plan" | head -4

printf '%s\n' 'synthetic PostgreSQL 17 benchmark (70k calls; not production latency)'
benchmark page "$page_sql"
benchmark summary "$summary_sql"
printf '%s\n' 'ui-load-performance.integration.check.sh: all assertions passed'
