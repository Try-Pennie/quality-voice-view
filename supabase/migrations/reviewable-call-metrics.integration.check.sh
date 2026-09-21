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
create index on public.eavesly_transcription_qa(call_id);
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
  ('retry', 'pass', false, 'high', 'Conversation', '2026-09-21 14:00Z'),
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
printf '\nReviewable call metrics: PASS (population, QA retries, ET dates, refresh, scope, grants)\n'
