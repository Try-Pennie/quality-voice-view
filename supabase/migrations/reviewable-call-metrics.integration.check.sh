#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="reviewable-metrics-$RANDOM-$$"
trap 'docker rm -fv "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
sql() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1; }
sql <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create table public.agent_manager_mapping (agent_email text, manager_email text);
create table public.manager_coaching_prompts (manager_email text, is_god_mode boolean);
create table public.eavesly_calls (
  call_id text primary key, agent_email text, agent_full_name text,
  started_at timestamptz, talk_time integer, conversation_happened boolean
);
create table public.eavesly_transcription_qa (
  id bigint generated always as identity primary key, call_id text,
  compliance_rating text, manager_escalation boolean, customer_satisfaction_likely text,
  original_transcript text, created_at timestamptz default now()
);
create index eavesly_transcription_qa_latest_idx
  on public.eavesly_transcription_qa(call_id, created_at desc nulls last, id desc)
  include (compliance_rating, customer_satisfaction_likely, manager_escalation);
create table public.eavesly_regal_call_events (
  regal_task_id text, event_type text, payload jsonb,
  primary key (regal_task_id, event_type)
);
create table public.eavesly_module_results (
  call_id text, module_name text, agent_email text, created_at timestamptz,
  has_violation boolean, alert_sent boolean
);
create table public.eavesly_alert_feedback (
  id bigint, call_id text, module_name text, accurate boolean
);
insert into public.agent_manager_mapping values
  ('agent@example.test', 'manager@example.test'),
  ('outside@example.test', 'other-manager@example.test'),
  ('alert-only@example.test', 'manager@example.test');
insert into public.manager_coaching_prompts values ('director@example.test', true);
insert into public.eavesly_calls
select id, 'agent@example.test', 'Agent Alpha', '2026-09-21 12:00Z', 60, conversation
from (values
  ('scored', true), ('pending', true), ('legacy', true), ('retry', true),
  ('no-answer', false), ('unknown', null::boolean), ('missing', true),
  ('blank', true), ('bad-json', true), ('short', true)
) v(id, conversation);
-- A short actual conversation is not excluded by a made-up duration threshold.
update public.eavesly_calls set talk_time = 2 where call_id = 'short';
insert into public.eavesly_calls values
  ('outside', 'outside@example.test', 'Outside Agent', '2026-09-21 12:00Z', 60, true),
  ('manager', 'manager@example.test', 'Manager', '2026-09-21 12:00Z', 60, true),
  ('sunday', 'agent@example.test', 'Agent Alpha', '2026-09-21 02:00Z', 60, true),
  ('boundary', 'agent@example.test', 'Agent Alpha', '2026-09-22 03:59Z', 60, true),
  ('next-day', 'agent@example.test', 'Agent Alpha', '2026-09-22 04:00Z', 60, true);
insert into public.eavesly_regal_call_events
select call_id, 'transcript_available', '{"transcript":"Agent: Hello. Customer: Hi."}'::jsonb
from public.eavesly_calls where call_id not in ('legacy', 'missing', 'blank', 'bad-json');
insert into public.eavesly_regal_call_events values
  ('blank', 'transcript_available', jsonb_build_object('transcript', E' \n\t\r ')),
  ('bad-json', 'transcript_available', '{"transcript": {"text": "not a transcript string"}}');
insert into public.eavesly_transcription_qa(call_id, compliance_rating, manager_escalation, customer_satisfaction_likely, original_transcript, created_at) values
  ('scored', 'pass', true, 'high', 'Conversation', '2026-09-21 13:00Z'),
  ('legacy', 'fail', false, 'low', 'Legacy conversation', '2026-09-21 13:00Z'),
  ('retry', 'fail', true, 'low', 'Conversation', '2026-09-21 13:00Z'),
  ('retry', 'fail', true, 'low', 'Conversation', '2026-09-21 14:00Z'),
  ('retry', 'pass', false, 'high', 'Conversation', '2026-09-21 14:00Z'),
  ('retry', 'fail', true, 'low', 'Conversation', null),
  ('no-answer', 'fail', true, 'low', 'Voicemail', '2026-09-21 13:00Z'),
  ('unknown', 'fail', true, 'low', 'Unknown conversation', '2026-09-21 13:00Z');
insert into public.eavesly_module_results values
  ('missing', 'full_qa', 'agent@example.test', '2026-09-21 12:00Z', true, true),
  ('alert-only', 'full_qa', 'alert-only@example.test', '2026-09-21 12:00Z', true, true);
SQL
# Exercise the real scope helper, refresh function, and upgrade from the previous RPCs.
for migration in 20260427230000_team_rollup_mv.sql 20260619162000_hide_disposition_review_from_alert_rollups.sql 20260921100000_reviewable_call_metrics.sql; do
  sql < "$root/supabase/migrations/$migration"
done
sql <<'SQL'
create table baseline_definition as select pg_get_viewdef('private.mv_agent_daily_metrics', true) as query;
create table baseline_rows as table private.mv_agent_daily_metrics;
SQL
for migration in 20260921124725_qa_usable_transcript_index.sql 20260921124740_regal_usable_transcript_index.sql; do
  sql < "$root/supabase/migrations/$migration"
done
# Warm the RPC's cached relation plan, replace the MV in the same connection,
# then prove both cached RPC execution and the refresh function use the new MV.
{
  printf "set request.jwt.claims = '{\"email\":\"manager@example.test\"}'; select count(*) from public.team_daily_metrics('2026-09-21','2026-09-21');\n"
  cat "$root/supabase/migrations/20260921125014_indexed_reviewable_metrics.sql"
  printf "select count(*) from public.team_daily_metrics('2026-09-21','2026-09-21'); select private.refresh_agent_daily_metrics();\n"
} | sql
sql <<'SQL'
do $$ begin
  assert not exists (
    (table baseline_rows except all table private.mv_agent_daily_metrics)
    union all (table private.mv_agent_daily_metrics except all table baseline_rows)
  ), 'indexed eligibility must preserve every rollup field';
end $$;
select private.refresh_agent_daily_metrics();
set role authenticated;
set request.jwt.claims = '{"email":"manager@example.test"}';
do $$
declare r record;
begin
  select * into strict r from public.agent_daily_metrics('agent@example.test', '2026-09-21', '2026-09-21');
  assert r.call_count = 11, 'one count per call; Sunday and next ET day excluded';
  assert r.reviewable_call_count = 6, 'scored, pending, legacy, retry, short, boundary';
  assert r.qa_count = 3, 'only reviewable calls with latest QA count';
  assert r.reviewable_call_count - r.qa_count = 3, 'pending or failed QA remains visible';
  assert r.compliance_pass_count = 2 and r.compliance_total_count = 3;
  assert r.escalation_count = 1 and r.csat_high_count = 2 and r.csat_low_count = 1;
  assert r.talk_time_sum = 302 and r.talk_time_n = 6;
  assert r.total_alerts_count = 1, 'call eligibility does not remove alert workload';
  assert (select count(*) = 2 from public.team_daily_metrics('2026-09-21', '2026-09-21'));
  assert not exists(select 1 from public.agent_daily_metrics('outside@example.test', '2026-09-21', '2026-09-21')), 'manager cannot access another team';
  assert exists(select 1 from public.team_daily_metrics('2026-09-21', '2026-09-21') where agent_email = 'alert-only@example.test' and reviewable_call_count = 0 and total_alerts_count = 1);
end $$;
set request.jwt.claims = '{}';
do $$ begin
  assert not exists(select 1 from public.team_daily_metrics('2026-09-21', '2026-09-21'));
end $$;
set request.jwt.claims = '{"email":"director@example.test"}';
do $$ begin
  assert (select count(*) = 3 from public.team_daily_metrics('2026-09-21', '2026-09-21')), 'god mode sees both teams and alert-only agent, not manager';
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon', 'public.team_daily_metrics(date,date)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.agent_daily_metrics(text,date,date)', 'EXECUTE');
  assert not has_schema_privilege('authenticated', 'private', 'USAGE');
  assert not has_table_privilege('authenticated', 'public.eavesly_regal_call_events', 'SELECT');
end $$;
-- A later evaluation closes the gap without changing eligibility or volume.
insert into public.eavesly_transcription_qa(call_id, compliance_rating, manager_escalation, customer_satisfaction_likely)
values ('pending', 'pass', false, 'high');
select private.refresh_agent_daily_metrics();
set role authenticated;
set request.jwt.claims = '{"email":"manager@example.test"}';
do $$ begin
  assert exists(select 1 from public.agent_daily_metrics('agent@example.test', '2026-09-21', '2026-09-21')
    where call_count = 11 and reviewable_call_count = 6 and qa_count = 4);
end $$;
SQL
sql <<'SQL'
-- PostgreSQL maintains predicate membership for late transcripts, edits, latest
-- retry changes and deletes. An older usable QA must not qualify a blank winner.
insert into public.eavesly_transcription_qa(call_id, original_transcript, created_at)
values ('legacy', E' \n\t ', '2026-09-22 12:00Z');
select private.refresh_agent_daily_metrics();
do $$ begin
  assert (select reviewable_call_count = 5 and qa_count = 3 from private.mv_agent_daily_metrics
    where agent_email='agent@example.test' and bucket_day='2026-09-21');
end $$;
insert into public.eavesly_regal_call_events values ('legacy','transcript_available','{"transcript":"Late transcript"}');
select private.refresh_agent_daily_metrics();
do $$ begin
  assert (select reviewable_call_count = 6 and qa_count = 4 from private.mv_agent_daily_metrics
    where agent_email='agent@example.test' and bucket_day='2026-09-21');
end $$;
update public.eavesly_regal_call_events set payload='{"transcript":{"text":"Not a string"}}' where regal_task_id='legacy';
select private.refresh_agent_daily_metrics();
do $$ begin
  assert (select reviewable_call_count = 5 from private.mv_agent_daily_metrics
    where agent_email='agent@example.test' and bucket_day='2026-09-21');
end $$;
update public.eavesly_transcription_qa set original_transcript='Restored transcript'
where call_id='legacy' and created_at='2026-09-22 12:00Z';
select private.refresh_agent_daily_metrics();
do $$ begin
  assert (select reviewable_call_count = 6 from private.mv_agent_daily_metrics
    where agent_email='agent@example.test' and bucket_day='2026-09-21');
end $$;
delete from public.eavesly_transcription_qa where call_id='legacy';
delete from public.eavesly_regal_call_events where regal_task_id='short';
select private.refresh_agent_daily_metrics();
do $$ begin
  assert (select reviewable_call_count = 4 and qa_count = 3 from private.mv_agent_daily_metrics
    where agent_email='agent@example.test' and bucket_day='2026-09-21');
end $$;
SQL
printf '\nReviewable call metrics: PASS (population, QA retries, ET dates, refresh, scope, grants, indexed transcript changes)\n'

# Optional TOAST-heavy benchmark: checks exact results and reports both runtimes.
if [[ "${REVIEWABLE_BENCHMARK:-0}" == "1" ]]; then
  sql <<'SQL'
reset role;
set jit = off;
set statement_timeout = '3min';
create temp table text_fixture as
  select string_agg(md5(i::text), '') as transcript from generate_series(1, 256) i;
insert into public.eavesly_calls
  select 'bench-'||i, 'agent@example.test', 'Agent Alpha', '2026-09-21 12:00Z', 60, true
  from generate_series(1, 20000) i;
insert into public.eavesly_transcription_qa(call_id, compliance_rating, manager_escalation, customer_satisfaction_likely, original_transcript)
  select 'bench-'||i, 'pass', false, 'high', t.transcript
  from generate_series(1, 10000) i cross join text_fixture t;
insert into public.eavesly_regal_call_events
  select 'bench-'||i, 'transcript_available', jsonb_build_object('transcript', t.transcript)
  from generate_series(10001, 20000) i cross join text_fixture t;
vacuum analyze public.eavesly_calls;
vacuum analyze public.eavesly_transcription_qa;
vacuum analyze public.eavesly_regal_call_events;
do $$
declare original text; optimized text; started timestamptz; plan json;
begin
  optimized := pg_get_viewdef('private.mv_agent_daily_metrics', true);
  select query into original from baseline_definition;
  execute 'explain (format json) ' || optimized into plan;
  assert jsonb_path_query_array(plan::jsonb,
    '$.** ? (@."Node Type" == "Index Only Scan")."Index Name"')
    @> '["eavesly_qa_usable_transcript_idx", "eavesly_regal_usable_transcript_idx", "eavesly_transcription_qa_latest_idx"]'::jsonb,
    'refresh must use index-only membership and latest-QA scans';
  started := clock_timestamp();
  execute 'create temp table baseline_results as ' || original;
  raise notice 'baseline_elapsed: %', clock_timestamp() - started;
  started := clock_timestamp();
  execute 'create temp table materialized_results as ' || optimized;
  raise notice 'indexed_elapsed: %', clock_timestamp() - started;
  assert not exists(
    (table baseline_results except table materialized_results)
    union all (table materialized_results except table baseline_results)
  ), 'output must match in both directions';
  raise notice 'EXCEPT equivalence passed (20,000 TOAST-heavy calls)';
end $$;
SQL
fi
