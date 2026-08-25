#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260822120000_achieve_first_pay_outcomes.sql"
container="achieve-first-pay-outcomes-check-$RANDOM-$$"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

{
  cat <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
SQL
  cat "$migration"
  cat <<'SQL'

select public.ingest_achieve_first_pay_outcome_snapshot(
  '2026-08-20', 1, 1,
  '[{"cohort_date":"2026-08-01","agent_name":"Old Agent","agent_email":"old@example.test","n":1,"paid":1,"no_deposit":0,"rescinded":0,"never_paid":0}]'::jsonb
);

set role service_role;
select public.ingest_achieve_first_pay_outcome_snapshot(
  '2026-09-01', 5, 72,
  '[
    {"cohort_date":"2026-08-18","agent_name":"Agent A","agent_email":"a@example.test","n":30,"paid":15,"no_deposit":15,"rescinded":10,"never_paid":5},
    {"cohort_date":"2026-08-18","agent_name":"Agent B","agent_email":"b@example.test","n":30,"paid":24,"no_deposit":6,"rescinded":1,"never_paid":5},
    {"cohort_date":"2026-07-15","agent_name":"Agent C","agent_email":"c@example.test","n":1,"paid":1,"no_deposit":0,"rescinded":0,"never_paid":0},
    {"cohort_date":"2026-07-15","agent_name":"Agent D","agent_email":"d@example.test","n":1,"paid":0,"no_deposit":1,"rescinded":0,"never_paid":1},
    {"cohort_date":"2026-07-01","agent_name":"Solo Agent","agent_email":"solo@example.test","n":10,"paid":8,"no_deposit":2,"rescinded":1,"never_paid":1}
  ]'::jsonb
);
reset role;

do $$
declare
  report jsonb;
  six_weeks jsonb;
  agent_a jsonb;
  agent_b jsonb;
  solo_agent jsonb;
  boundary_agent jsonb;
  before_rows bigint;
begin
  if (select count(*) from public.achieve_first_pay_outcome_daily) <> 5
    or exists (select 1 from public.achieve_first_pay_outcome_daily where agent_email = 'old@example.test') then
    raise exception 'full snapshot was not replaced';
  end if;

  begin
    perform public.ingest_achieve_first_pay_outcome_snapshot(
      '2026-09-01', 1, 4,
      '[{"cohort_date":"2026-08-18","agent_name":"Broken","agent_email":"broken@example.test","n":4,"paid":1,"no_deposit":3,"rescinded":1,"never_paid":1}]'::jsonb
    );
    raise exception 'invalid reconciliation was accepted';
  exception when check_violation or invalid_parameter_value then
    null;
  end;

  select count(*) into before_rows from public.achieve_first_pay_outcome_daily;
  begin
    perform public.ingest_achieve_first_pay_outcome_snapshot(
      '2026-09-01', 2, 31,
      '[
        {"cohort_date":"2026-08-18","agent_name":"Agent A","agent_email":"a@example.test","n":30,"paid":15,"no_deposit":15,"rescinded":10,"never_paid":5},
        {"cohort_date":"2026-08-23","agent_name":"Too New","agent_email":"new@example.test","n":1,"paid":1,"no_deposit":0,"rescinded":0,"never_paid":0}
      ]'::jsonb
    );
    raise exception 'immature cohort was accepted';
  exception when check_violation or invalid_parameter_value then
    null;
  end;
  if (select count(*) from public.achieve_first_pay_outcome_daily) <> before_rows then
    raise exception 'failed ingest partially replaced snapshot';
  end if;

  begin
    perform public.ingest_achieve_first_pay_outcome_snapshot(
      '2026-09-01', 2, 60,
      '[{"cohort_date":"2026-08-18","agent_name":"Agent A","agent_email":"a@example.test","n":30,"paid":15,"no_deposit":15,"rescinded":10,"never_paid":5}]'::jsonb
    );
    raise exception 'truncated source controls were accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.ingest_achieve_first_pay_outcome_snapshot(
      '2026-08-31', 1, 1,
      '[{"cohort_date":"2026-08-01","agent_name":"Stale","agent_email":"stale@example.test","n":1,"paid":1,"no_deposit":0,"rescinded":0,"never_paid":0}]'::jsonb
    );
    raise exception 'stale source watermark was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.ingest_achieve_first_pay_outcome_snapshot(
      '2026-09-01', 2, 2,
      '[
        {"cohort_date":"2026-08-18","agent_name":"Duplicate","agent_email":"duplicate@example.test","n":1,"paid":1,"no_deposit":0,"rescinded":0,"never_paid":0},
        {"cohort_date":"2026-08-18","agent_name":"Duplicate","agent_email":"duplicate@example.test","n":1,"paid":1,"no_deposit":0,"rescinded":0,"never_paid":0}
      ]'::jsonb
    );
    raise exception 'duplicate aggregate rows were accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.achieve_first_pay_outcome_daily) <> before_rows then
    raise exception 'rejected source controls changed the snapshot';
  end if;

  select public.get_achieve_first_pay_outcomes() into report;
  if report->>'source_as_of' <> '2026-09-01'
    or report->>'maturity_cutoff' <> '2026-08-22'
    or nullif(report->>'refreshed_at', '') is null then
    raise exception 'freshness metadata missing: %', report;
  end if;
  if jsonb_array_length(report->'periods') <> 3 then
    raise exception 'expected three reporting periods: %', report;
  end if;
  if exists (
      select 1
      from jsonb_array_elements(report->'periods') period,
        jsonb_array_elements(period->'agents') agent
      where period->>'key' = 'mature_4_weeks' and agent->>'agent_email' = 'c@example.test'
    ) or not exists (
      select 1
      from jsonb_array_elements(report->'periods') period,
        jsonb_array_elements(period->'agents') agent
      where period->>'key' = 'mature_6_weeks' and agent->>'agent_email' = 'c@example.test'
    ) then
    raise exception 'mature trailing windows used the wrong cohort dates: %', report->'periods';
  end if;

  select value into six_weeks
  from jsonb_array_elements(report->'periods')
  where value->>'key' = 'mature_6_weeks';
  select value into agent_a
  from jsonb_array_elements(six_weeks->'agents')
  where value->>'agent_email' = 'a@example.test';
  select value into agent_b
  from jsonb_array_elements(six_weeks->'agents')
  where value->>'agent_email' = 'b@example.test';

  if agent_a->>'n' <> '30'
    or agent_a->>'failures' <> '15'
    or agent_a->>'rescinded' <> '10'
    or agent_a->>'never_paid' <> '5'
    or agent_a->>'expected_failures' <> '6.0000'
    or agent_a->>'expected_successes' <> '24.0000'
    or agent_a->>'delta_pp' <> '30.0000'
    or agent_a->>'z' <> '4.1079'
    or agent_a->>'sample_qualified' <> 'true'
    or agent_a->>'rank' <> '1' then
    raise exception 'Agent A leave-one-out math failed: %', agent_a;
  end if;
  if agent_b->>'z' <> '-3.2863' or agent_b->>'rank' <> '2' then
    raise exception 'negative roster comparison or rank failed: %', agent_b;
  end if;
  if (agent_a->>'failures')::integer <> (agent_a->>'rescinded')::integer + (agent_a->>'never_paid')::integer then
    raise exception 'failure reconciliation changed: %', agent_a;
  end if;

  select agent into solo_agent
  from jsonb_array_elements(report->'periods') period,
    jsonb_array_elements(period->'agents') agent
  where period->>'key' = 'all_time' and agent->>'agent_email' = 'solo@example.test';
  if solo_agent->>'n' <> '10'
    or solo_agent->'expected_rate' <> 'null'::jsonb
    or solo_agent->'z' <> 'null'::jsonb
    or solo_agent->'rank' <> 'null'::jsonb
    or solo_agent->>'sample_qualified' <> 'false' then
    raise exception 'solo-week agent received an unmatched comparison: %', solo_agent;
  end if;

  perform public.ingest_achieve_first_pay_outcome_snapshot(
    '2026-09-01', 2, 200010,
    '[
      {"cohort_date":"2026-08-18","agent_name":"Boundary Agent","agent_email":"boundary@example.test","n":10,"paid":5,"no_deposit":5,"rescinded":2,"never_paid":3},
      {"cohort_date":"2026-08-18","agent_name":"Boundary Peer","agent_email":"peer@example.test","n":200000,"paid":100001,"no_deposit":99999,"rescinded":40000,"never_paid":59999}
    ]'::jsonb
  );
  select agent into boundary_agent
  from jsonb_array_elements(public.get_achieve_first_pay_outcomes()->'periods') period,
    jsonb_array_elements(period->'agents') agent
  where period->>'key' = 'mature_6_weeks' and agent->>'agent_email' = 'boundary@example.test';
  if boundary_agent->>'expected_failures' <> '5.0000'
    or boundary_agent->>'expected_successes' <> '5.0001'
    or boundary_agent->>'sample_qualified' <> 'true'
    or boundary_agent->>'rank' <> '1' then
    raise exception 'rounded qualification boundary is inconsistent: %', boundary_agent;
  end if;

  if has_function_privilege('anon', 'public.ingest_achieve_first_pay_outcome_snapshot(date,integer,bigint,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.ingest_achieve_first_pay_outcome_snapshot(date,integer,bigint,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.ingest_achieve_first_pay_outcome_snapshot(date,integer,bigint,jsonb)', 'execute')
    or has_table_privilege('anon', 'public.achieve_first_pay_outcome_daily', 'select')
    or has_table_privilege('authenticated', 'public.achieve_first_pay_outcome_snapshot', 'select')
    or has_function_privilege('anon', 'public.get_achieve_first_pay_outcomes()', 'execute')
    or has_function_privilege('authenticated', 'public.get_achieve_first_pay_outcomes()', 'execute') then
    raise exception 'first-pay outcome privileges are unsafe';
  end if;
end
$$;

select 'achieve-first-pay-outcomes.integration.check.sh: all assertions passed' as result;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
