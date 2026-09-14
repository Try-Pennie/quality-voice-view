#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
baseline_migration="$repo_root/supabase/migrations/20260914010000_ui_load_performance.sql"
migration="$repo_root/supabase/migrations/20260916010000_optimize_calls_summary.sql"
container="ui-load-performance-check-$RANDOM-$$"
tmp="$(mktemp -d)"

cleanup() {
  docker rm -fv "$container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:17-alpine \
  -c shared_buffers=256MB -c effective_cache_size=768MB \
  -c random_page_cost=1.1 -c work_mem=3500kB -c jit=off >/dev/null
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
  cat "$baseline_migration"
  cat <<'SQL'

-- Preserve the exact applied implementation as a Docker-only comparison
-- function before the new migration replaces the production signature.
alter function public.eavesly_calls_summary(
  timestamptz, timestamptz, text[], text[], text, jsonb
) rename to eavesly_calls_summary_baseline;

create temporary table summary_parity_cases as
select
  row_number() over () as case_id,
  a.p_agents,
  d.p_dispositions,
  q.p_quick_filter,
  t.p_thresholds,
  public.eavesly_calls_summary_baseline(
    '2026-01-01+00', '2026-01-09 23:59:59+00',
    a.p_agents, d.p_dispositions, q.p_quick_filter, t.p_thresholds
  ) as baseline_result
from (values
  (array[]::text[]),
  (array['agent-a@example.test']::text[])
) a(p_agents)
cross join (values
  (array[]::text[]),
  (array['D1']::text[])
) d(p_dispositions)
cross join (values
  ('all'), ('escalations'), ('compliance'), ('threshold'), ('rushed')
) q(p_quick_filter)
cross join (values
  ('{}'::jsonb),
  ('{"overallScore":"good","compliance":"pass","customerSat":"medium"}'::jsonb)
) t(p_thresholds);
SQL
  cat "$migration"
  cat <<'SQL'

-- Every quick filter and the agent/disposition/threshold cross-product must
-- return exactly equal JSONB values to the applied implementation.
do $$
declare c record; actual jsonb;
begin
  for c in select * from summary_parity_cases order by case_id loop
    actual := public.eavesly_calls_summary(
      '2026-01-01+00', '2026-01-09 23:59:59+00',
      c.p_agents, c.p_dispositions, c.p_quick_filter, c.p_thresholds
    );
    if actual is distinct from c.baseline_result then
      raise exception 'summary old/new parity failed for case %: old=%, new=%',
        c.case_id, c.baseline_result, actual;
    end if;
  end loop;
end $$;

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
      or (select prosecdef from pg_proc where oid = f)
      or not exists (
        select 1
        from pg_proc p cross join lateral unnest(p.proconfig) setting
        where p.oid = f and setting = 'search_path=""'
      ) then
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

-- Replace behavior fixtures with production-count, wide-row benchmark data:
-- 846,429 Calls and 496,959 QA overall, with exactly 69,204 Calls in-window.
truncate public.eavesly_transcription_qa, public.eavesly_calls restart identity;
insert into public.eavesly_calls(
  call_id, agent_email, agent_full_name, started_at, ended_at, completed_at,
  direction, disposition, talk_time, handle_time, wrapup_time,
  conversation_happened, contact_phone, campaign_name, notes
)
select
  'BENCH-' || g,
  'agent-' || (g % 100) || '@example.test',
  'Agent ' || (g % 100),
  case when g <= 69204 then
    '2026-08-31 23:59:59+00'::timestamptz - g * interval '1 second'
  else
    '2026-01-01+00'::timestamptz + (g - 69205) * interval '1 second'
  end,
  '2026-01-01+00'::timestamptz,
  '2026-01-01+00'::timestamptz,
  case when g % 2 = 0 then 'outbound' else 'inbound' end,
  case when g % 17 = 0 then ''
    when g % 13 = 0 then 'CALL NOW REQUESTED'
    when g % 11 = 0 then 'No Show'
    when g % 7 = 0 then 'Sale'
    else 'Connected'
  end,
  (g % 2700) - 2,
  g % 3000,
  g % 400,
  g % 3 <> 0,
  '+1555' || lpad((g % 10000000)::text, 7, '0'),
  case when g % 19 = 0 then 'Cal.com Meeting' else 'Outbound Campaign ' || (g % 23) end,
  md5(g::text || '-n1') || md5(g::text || '-n2')
    || md5(g::text || '-n3') || md5(g::text || '-n4')
from generate_series(1, 846429) g;
insert into public.eavesly_transcription_qa(
  call_id, agent_email, manager_email, overall_score, compliance_rating,
  customer_satisfaction_likely, manager_escalation, qa_json, call_summary,
  original_transcript, transcription_link, recording_link,
  coaching_insights_analysis, created_at
)
select
  'BENCH-' || (1 + ((g - 1) % 400000)),
  'agent-' || (g % 100) || '@example.test',
  'manager@example.test',
  (array['excellent','good','needs_improvement','poor'])[1 + g % 4],
  (array['pass','fail'])[1 + g % 2],
  (array['high','medium','low'])[1 + g % 3],
  g % 29 = 0,
  jsonb_build_object('grade', g % 5, 'detail', md5(g::text || '-j')),
  md5(g::text || '-s1') || md5(g::text || '-s2'),
  md5(g::text || '-t1') || md5(g::text || '-t2')
    || md5(g::text || '-t3') || md5(g::text || '-t4')
    || md5(g::text || '-t5') || md5(g::text || '-t6')
    || md5(g::text || '-t7') || md5(g::text || '-t8'),
  'https://example.test/transcription/' || g,
  'https://example.test/recording/' || g,
  md5(g::text || '-c1') || md5(g::text || '-c2')
    || md5(g::text || '-c3') || md5(g::text || '-c4'),
  case when g % 997 = 0 then null else
    '2026-09-01+00'::timestamptz + g * interval '1 millisecond'
  end
from generate_series(1, 496959) g;
vacuum (analyze) public.eavesly_calls;
vacuum (analyze) public.eavesly_transcription_qa;

select set_config('request.jwt.claims', '{"email":"manager@example.test"}', false);
set role authenticated;
do $$
declare baseline jsonb; optimized jsonb;
begin
  baseline := public.eavesly_calls_summary_baseline(
    '2026-08-01+00', '2026-09-01+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb
  );
  optimized := public.eavesly_calls_summary(
    '2026-08-01+00', '2026-09-01+00', array[]::text[], array[]::text[],
    'all', '{}'::jsonb
  );
  if optimized is distinct from baseline
    or (optimized ->> 'window_calls')::integer <> 69204
    or (optimized ->> 'total_calls')::integer <> 69204 then
    raise exception 'production-shaped summary parity/count failed: old=%, new=%',
      baseline, optimized;
  end if;
end $$;
reset role;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres

claims='{"email":"god@example.test"}'
page_sql="select public.eavesly_calls_page('2026-08-01+00','2026-09-01+00',array[]::text[],array[]::text[],'all','{}'::jsonb,'time',true,0,25)"
summary_call() {
  local function="$1" quick_filter="$2" start="${3:-2026-08-01+00}" agents="${4:-array[]::text[]}"
  local thresholds='{}'
  if [[ "$quick_filter" == threshold ]]; then
    thresholds='{"overallScore":"needs_improvement","compliance":"fail","customerSat":"low"}'
  fi
  printf "select public.%s('%s','2026-09-01+00',%s,array[]::text[],'%s','%s'::jsonb)" \
    "$function" "$start" "$agents" "$quick_filter" "$thresholds"
}

baseline_summary_sql="$(summary_call eavesly_calls_summary_baseline all)"
summary_sql="$(summary_call eavesly_calls_summary all)"

benchmark() {
  local label="$1" sql="$2" runs="${3:-5}" times=() output value median_line
  for _ in $(seq 1 "$runs"); do
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
  median_line=$((runs / 2 + 1))
  printf 'benchmark %s_ms median=%s runs=%s\n' \
    "$label" "$(sed -n "${median_line}p" "$tmp/$label-times")" "$(paste -sd, "$tmp/$label-times")"
}

assert_not_materially_slower() {
  local label="$1" allowed_ratio="${2:-1.25}" baseline optimized
  baseline="$(sed -n "$(( $(wc -l <"$tmp/${label}_baseline-times") / 2 + 1 ))p" "$tmp/${label}_baseline-times")"
  optimized="$(sed -n "$(( $(wc -l <"$tmp/${label}_optimized-times") / 2 + 1 ))p" "$tmp/${label}_optimized-times")"
  awk -v baseline="$baseline" -v optimized="$optimized" -v allowed="$allowed_ratio" \
    'BEGIN { if (optimized > baseline * allowed) exit 1 }' || {
      echo "$label summary regressed materially: baseline=${baseline}ms optimized=${optimized}ms" >&2
      exit 1
    }
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

printf '%s\n' 'synthetic PostgreSQL 17 benchmark (846,429 Calls / 496,959 QA / 69,204-window Calls; not production latency)'
printf '%s\n' 'each timed run uses a fresh connection, which is not a cold OS-page-cache run'
benchmark page "$page_sql"
# QA-based sorts must evaluate the window to rank it; only the response is page-bounded.
benchmark score_page "select public.eavesly_calls_page('2026-08-01+00','2026-09-01+00',array[]::text[],array[]::text[],'all','{}'::jsonb,'score',true,0,25)"
benchmark summary_baseline "$baseline_summary_sql"
benchmark summary_optimized "$summary_sql"
assert_not_materially_slower summary
for quick_filter in rushed threshold compliance; do
  benchmark "${quick_filter}_baseline" \
    "$(summary_call eavesly_calls_summary_baseline "$quick_filter")" 3
  benchmark "${quick_filter}_optimized" \
    "$(summary_call eavesly_calls_summary "$quick_filter")" 3
  assert_not_materially_slower "$quick_filter"
done
benchmark agent_selective_baseline \
  "$(summary_call eavesly_calls_summary_baseline all '2026-08-01+00' "array['agent-7@example.test']")" 3
benchmark agent_selective_optimized \
  "$(summary_call eavesly_calls_summary all '2026-08-01+00' "array['agent-7@example.test']")" 3
assert_not_materially_slower agent_selective
benchmark date_selective_baseline \
  "$(summary_call eavesly_calls_summary_baseline all '2026-08-31 18:00+00')" 3
benchmark date_selective_optimized \
  "$(summary_call eavesly_calls_summary all '2026-08-31 18:00+00')" 3
assert_not_materially_slower date_selective

capture_summary_plan() {
  local label="$1" sql="$2"
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >"$tmp/$label-plan" 2>&1 <<SQL
load 'auto_explain';
set client_min_messages = log;
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
select set_config('request.jwt.claims', '$claims', false);
set role authenticated;
\o /dev/null
$sql;
SQL
}
capture_summary_plan summary-baseline "$baseline_summary_sql"
capture_summary_plan summary-optimized "$summary_sql"
capture_summary_plan summary-rushed \
  "$(summary_call eavesly_calls_summary rushed)"
if ! grep -q 'CTE Scan on joined' "$tmp/summary-baseline-plan" \
  || grep -q 'CTE Scan on joined' "$tmp/summary-optimized-plan" \
  || ! grep -q 'CTE Scan on windowed' "$tmp/summary-optimized-plan" \
  || [[ "$(grep -o "cal com meeting" "$tmp/summary-rushed-plan" | wc -l)" -gt 2 ]]; then
  cat "$tmp/summary-baseline-plan" "$tmp/summary-optimized-plan" \
    "$tmp/summary-rushed-plan" >&2
  echo 'summary plan did not stream joined rows or repeated the rushed predicate' >&2
  exit 1
fi
printf '%s\n' 'summary baseline plan (buffers/temp):'
grep -E 'CTE Scan on (joined|windowed)|Buffers:.*temp|Execution Time' "$tmp/summary-baseline-plan" | tail -8
printf '%s\n' 'summary optimized plan (buffers/temp):'
grep -E 'CTE Scan on (joined|windowed)|Buffers:.*temp|Execution Time' "$tmp/summary-optimized-plan" | tail -8
printf 'summary rushed predicate plan occurrences=%s (query text + one Filter)\n' \
  "$(grep -o "cal com meeting" "$tmp/summary-rushed-plan" | wc -l)"

printf '%s\n' 'ui-load-performance.integration.check.sh: all assertions passed'
