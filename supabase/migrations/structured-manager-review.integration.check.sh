#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260911120000_structured_manager_review.sql"
container="structured-manager-review-check-$RANDOM-$$"
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
create schema private;

create table auth.users (id uuid primary key, email text not null);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;

create table public.eavesly_module_results (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  alert_sent_at timestamptz,
  call_id text not null,
  module_name text not null,
  violation_type text,
  has_violation boolean not null default true,
  alert_sent boolean not null default true,
  agent_email text not null,
  contact_name text,
  contact_phone text,
  recording_link text,
  transcript_url text,
  call_summary text,
  sfdc_lead_id text,
  processing_time_ms integer,
  result_json jsonb
);
alter table public.eavesly_module_results enable row level security;

create table public.agent_manager_mapping (
  agent_email text primary key,
  manager_email text not null
);
create table public.manager_coaching_prompts (
  manager_email text primary key,
  is_god_mode boolean not null default false
);
SQL
  cat "$repo_root/supabase/migrations/20260427120000_eavesly_alert_feedback.sql"
  cat "$repo_root/supabase/migrations/20260429190000_eavesly_alert_thread.sql"
  cat "$repo_root/supabase/migrations/20260430180000_eavesly_notifications.sql"
  cat "$repo_root/supabase/migrations/20260527150000_add_inaccuracy_reasons.sql"
  cat <<'SQL'
-- A production dependency selects a.* from the alert view. The target migration
-- must append to the base view without recreating this excluded-module view.
create view public.eavesly_disposition_audit as
select a.* from public.eavesly_alerts_with_feedback a
where a.module_name = 'disposition_review';

-- Supabase normally supplies these grants; reproduce them in bare PostgreSQL.
grant select on public.eavesly_module_results, public.agent_manager_mapping,
  public.manager_coaching_prompts, public.eavesly_alerts_with_feedback to authenticated;
grant select, insert, update, delete on public.eavesly_alert_feedback,
  public.eavesly_alert_messages, public.eavesly_alert_acks to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on public.eavesly_alert_feedback to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.eavesly_module_results, public.eavesly_alert_feedback,
  public.eavesly_alerts_with_feedback from anon, public;

drop policy if exists "Enable read access for all users" on public.eavesly_alert_feedback;
create policy "Authenticated read access" on public.eavesly_alert_feedback
  for select to authenticated using (true);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'manager.one@trypennie.com'),
  ('22222222-2222-2222-2222-222222222222', 'manager.two@trypennie.com'),
  ('33333333-3333-3333-3333-333333333333', 'director.one@trypennie.com'),
  ('44444444-4444-4444-4444-444444444444', 'director.two@trypennie.com'),
  ('55555555-5555-5555-5555-555555555555', 'outsider@trypennie.com'),
  ('66666666-6666-6666-6666-666666666666', 'ordinary.acker@trypennie.com'),
  ('77777777-7777-7777-7777-777777777777', 'partner.writer@trypennie.com');

insert into public.manager_coaching_prompts(manager_email, is_god_mode) values
  ('manager.one@trypennie.com', false),
  ('manager.two@trypennie.com', false),
  ('director.one@trypennie.com', true),
  ('director.two@trypennie.com', true),
  ('outsider@trypennie.com', false),
  ('ordinary.acker@trypennie.com', false),
  ('partner.writer@trypennie.com', false);

insert into public.agent_manager_mapping(agent_email, manager_email) values
  ('agent-a@example.test', 'manager.one@trypennie.com'),
  ('agent-b@example.test', 'manager.one@trypennie.com'),
  ('agent-wrong@example.test', 'manager.two@trypennie.com'),
  ('agent-race@example.test', 'manager.one@trypennie.com'),
  ('agent-decision-race@example.test', 'manager.one@trypennie.com'),
  ('agent-db-constraint@example.test', 'manager.one@trypennie.com'),
  ('agent-legacy-god@example.test', 'manager.one@trypennie.com'),
  ('agent-legacy-ordinary@example.test', 'manager.one@trypennie.com'),
  ('agent-legacy-typed@example.test', 'manager.one@trypennie.com'),
  ('agent-legacy-stale@example.test', 'manager.one@trypennie.com'),
  ('agent-excluded@example.test', 'partner.writer@trypennie.com');

insert into public.eavesly_module_results(call_id, module_name, violation_type, agent_email)
values
  ('CALL-A', 'full_qa', 'manager_escalation', 'agent-a@example.test'),
  ('CALL-B', 'warm_transfer', 'warm_transfer', 'agent-b@example.test'),
  ('CALL-WRONG', 'full_qa', 'manager_escalation', 'agent-wrong@example.test'),
  ('CALL-RACE', 'full_qa', 'manager_escalation', 'agent-race@example.test'),
  ('CALL-DECISION-RACE', 'full_qa', 'manager_escalation', 'agent-decision-race@example.test'),
  ('CALL-DB-CONSTRAINT', 'full_qa', 'manager_escalation', 'agent-db-constraint@example.test'),
  ('CALL-LEGACY-GOD', 'full_qa', 'manager_escalation', 'agent-legacy-god@example.test'),
  ('CALL-LEGACY-ORDINARY', 'full_qa', 'manager_escalation', 'agent-legacy-ordinary@example.test'),
  ('CALL-LEGACY-TYPED', 'full_qa', 'manager_escalation', 'agent-legacy-typed@example.test'),
  ('CALL-LEGACY-STALE', 'full_qa', 'manager_escalation', 'agent-legacy-stale@example.test'),
  ('CALL-DISPOSITION', 'disposition_review', 'disposition_review', 'agent-excluded@example.test'),
  ('CALL-ACHIEVE', 'achieve_welcome_call_qa', 'achieve_welcome_call', 'agent-excluded@example.test');

-- Historic incomplete rows must survive the NOT VALID completeness constraint.
insert into public.eavesly_alert_feedback(
  call_id, module_name, manager_email, accurate, action_taken, inaccuracy_reason, comment
) values
  ('CALL-LEGACY-GOD', 'full_qa', 'manager.one@trypennie.com', true, null, null, 'historic note'),
  ('CALL-LEGACY-ORDINARY', 'full_qa', 'manager.one@trypennie.com', false, null, 'wrong_context', null),
  ('CALL-LEGACY-TYPED', 'full_qa', 'manager.one@trypennie.com', true, 'coached', null, null),
  ('CALL-LEGACY-STALE', 'full_qa', 'manager.one@trypennie.com', true, 'coached', null, null);

insert into public.eavesly_alert_acks(call_id, module_name, acker_email) values
  ('CALL-LEGACY-GOD', 'full_qa', 'director.one@trypennie.com'),
  ('CALL-LEGACY-GOD', 'full_qa', 'ordinary.acker@trypennie.com'),
  ('CALL-LEGACY-ORDINARY', 'full_qa', 'ordinary.acker@trypennie.com'),
  ('CALL-LEGACY-TYPED', 'full_qa', 'director.one@trypennie.com'),
  ('CALL-LEGACY-STALE', 'full_qa', 'director.one@trypennie.com');
SQL
  cat "$migration"
  cat <<'SQL'

do $$
begin
  if (select convalidated from pg_constraint
      where conname = 'eavesly_alert_feedback_structured_complete') then
    raise exception 'completeness constraint was unexpectedly validated';
  end if;
  if (select count(*) from public.eavesly_alert_feedback
      where call_id like 'CALL-LEGACY-%') <> 4 then
    raise exception 'historic feedback was not preserved';
  end if;
  if has_function_privilege('anon',
      'public.submit_internal_alert_feedback(text,text,integer,bigint,boolean,text,text,text,text,text)', 'execute')
    or has_function_privilege('anon',
      'public.decide_internal_alert_feedback(text,text,integer,text,text)', 'execute')
    or has_table_privilege('anon', 'public.eavesly_alert_review_decisions', 'select')
    or not has_function_privilege('authenticated',
      'public.submit_internal_alert_feedback(text,text,integer,bigint,boolean,text,text,text,text,text)', 'execute') then
    raise exception 'RPC or decision privileges are unsafe';
  end if;
end
$$;

-- Missing identity is a stable authentication failure.
select set_config('request.jwt.claims', '{}', false);
set role authenticated;
do $$
begin
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-A', 'full_qa', 0, null, true, 'coached', null,
      'The required disclosure was missed.', 'The manager coached the disclosure.', null);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_UNAUTHENTICATED' then raise; end if;
  end;
end
$$;
reset role;

-- Managers cannot spoof actors or bypass the RPC for internal rows.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
do $$
begin
  begin
    insert into public.eavesly_alert_feedback(
      call_id, module_name, manager_email, accurate, action_taken,
      violation_details, action_details, review_revision, initial_manager_review
    ) values (
      'CALL-A', 'full_qa', 'director.one@trypennie.com', true, 'coached',
      'The required disclosure was missed.', 'The manager coached the disclosure.', 99, '{"spoofed":true}'
    );
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' then raise; end if;
  end;
end
$$;

-- Boundary validation is uniform: every required prose field is 12..4000 trimmed characters.
do $$
begin
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-A', 'full_qa', 0, null, true, 'coached', null,
      '           ', 'Useful action details.', null);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_FEEDBACK' then raise; end if;
  end;
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-A', 'full_qa', 0, null, false, null, 'other', null, null, repeat('x', 4001));
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_FEEDBACK' then raise; end if;
  end;
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-A', 'full_qa', 0, null, true, 'coached', null,
      'Same useful sentence.', 'Same useful sentence.', null);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_FEEDBACK' then raise; end if;
  end;
end
$$;

select public.submit_internal_alert_feedback(
  'CALL-A', 'full_qa', 0, null, true, 'coached', null,
  'The required disclosure was missed.',
  'The manager coached the exact disclosure.', null);

-- Wrong-team manager cannot submit.
do $$
begin
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-WRONG', 'full_qa', 0, null, false, null, 'wrong_context',
      null, null, 'The evidence belongs to another context.');
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_FORBIDDEN' then raise; end if;
  end;
end
$$;
reset role;

-- The NOT VALID constraint preserves history but still rejects malformed future writes.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role service_role;
do $$
begin
  begin
    insert into public.eavesly_alert_feedback(
      call_id, module_name, manager_email, accurate, action_taken,
      violation_details, action_details
    ) values (
      'CALL-DB-CONSTRAINT', 'full_qa', 'spoofed@trypennie.com', true, 'coached',
      '   ', 'The manager discussed the warning.'
    );
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when check_violation then
    null;
  end;
end
$$;
reset role;

do $$
declare s jsonb;
begin
  select initial_manager_review into s from public.eavesly_alert_feedback where call_id = 'CALL-A';
  if s->>'manager_email' <> 'manager.one@trypennie.com'
    or s->>'violation_details' <> 'The required disclosure was missed.'
    or s ? 'contact_name'
    or (select review_revision from public.eavesly_alert_feedback where call_id = 'CALL-A') <> 1 then
    raise exception 'initial review snapshot is incomplete or contains customer data: %', s;
  end if;
end
$$;

-- Non-superadmins cannot decide; any superadmin can, and a same decision is idempotent globally.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
do $$
begin
  begin
    perform public.decide_internal_alert_feedback('CALL-A', 'full_qa', 1, 'approved', null);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_FORBIDDEN' then raise; end if;
  end;
end
$$;
reset role;

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","email":"director.two@trypennie.com"}', false);
set role authenticated;
select public.decide_internal_alert_feedback('CALL-A', 'full_qa', 1, 'approved', null);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","email":"director.one@trypennie.com"}', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.decide_internal_alert_feedback('CALL-A', 'full_qa', 1, 'approved', null);
  if not (r->>'idempotent')::boolean then raise exception 'same approval was not idempotent: %', r; end if;
end
$$;
reset role;

-- A manager must compare both revision and current decision id.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
do $$
begin
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-A', 'full_qa', 1, null, true, 'coached', null,
      'The required disclosure was missed.', 'The manager coached the exact disclosure.', null);
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_STALE_REVIEW' then raise; end if;
  end;
end
$$;
reset role;

-- Editing approved feedback advances the revision and invalidates approval without changing the initial snapshot.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
select public.submit_internal_alert_feedback(
  'CALL-A', 'full_qa', 1,
  (select id from public.eavesly_alert_review_decisions where call_id = 'CALL-A'),
  true, 'follow_up_later', null,
  'The required disclosure was still missed.',
  'The manager scheduled a documented follow-up.', null);
reset role;

do $$
begin
  if (select review_revision from public.eavesly_alert_feedback where call_id = 'CALL-A') <> 2
    or (select action_taken from public.eavesly_alert_feedback where call_id = 'CALL-A') <> 'follow_up_later'
    or (select initial_manager_review->>'action_taken' from public.eavesly_alert_feedback where call_id = 'CALL-A') <> 'coached'
    or exists (select 1 from public.eavesly_alert_review_decisions where call_id = 'CALL-A' and feedback_revision = 2) then
    raise exception 'approved edit did not reopen review or preserve the original snapshot';
  end if;
end
$$;

-- Request changes follows current ownership, preserves original authorship, and notifies both sides through the thread.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
select public.submit_internal_alert_feedback(
  'CALL-B', 'warm_transfer', 0, null, false, null, 'wrong_context',
  null, null, 'The cited handoff happened in another call.');
reset role;
update public.agent_manager_mapping set manager_email = 'manager.two@trypennie.com'
where agent_email = 'agent-b@example.test';

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","email":"director.one@trypennie.com"}', false);
set role authenticated;
select public.decide_internal_alert_feedback(
  'CALL-B', 'warm_transfer', 1, 'changes_requested',
  'Please identify the call where the handoff occurred.');
reset role;

do $$
begin
  if (select count(*) from public.eavesly_alert_messages where call_id = 'CALL-B') <> 1
    or (select count(*) from public.eavesly_notifications
        where call_id = 'CALL-B' and recipient_email = 'manager.two@trypennie.com') <> 1
    or (select instructions from public.eavesly_alert_review_decisions where call_id = 'CALL-B')
       <> 'Please identify the call where the handoff occurred.' then
    raise exception 'request message/instructions/current-manager notification failed';
  end if;
end
$$;

-- Former owner cannot resubmit.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
do $$
begin
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-B', 'warm_transfer', 1,
      (select id from public.eavesly_alert_review_decisions where call_id = 'CALL-B'),
      false, null, 'wrong_context', null, null,
      'The cited handoff happened in another call.');
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_FORBIDDEN' then raise; end if;
  end;
end
$$;
reset role;

-- Comment-only/direct updates cannot clear requested changes.
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","email":"manager.two@trypennie.com"}', false);
set role authenticated;
update public.eavesly_alert_feedback set comment = 'Only a comment changed.' where call_id = 'CALL-B';
do $$
begin
  begin
    perform public.submit_internal_alert_feedback(
      'CALL-B', 'warm_transfer', 1,
      (select id from public.eavesly_alert_review_decisions where call_id = 'CALL-B'),
      false, null, 'wrong_context', null, null, ' short ');
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_INVALID_FEEDBACK' then raise; end if;
  end;
end
$$;

select public.submit_internal_alert_feedback(
  'CALL-B', 'warm_transfer', 1,
  (select id from public.eavesly_alert_review_decisions where call_id = 'CALL-B'),
  false, null, 'wrong_context', null, null,
  'The cited handoff happened in another call.');
reset role;

create temp table retry_before as
select reviewed_at, updated_at,
  (select count(*) from public.eavesly_alert_messages where call_id = 'CALL-B') message_count,
  (select count(*) from public.eavesly_notifications where call_id = 'CALL-B') notification_count
from public.eavesly_alert_feedback where call_id = 'CALL-B';
select pg_sleep(0.02);

-- Retrying the same resubmit retains timestamps and emits no duplicate message/notification.
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","email":"manager.two@trypennie.com"}', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.submit_internal_alert_feedback(
    'CALL-B', 'warm_transfer', 1,
    (select id from public.eavesly_alert_review_decisions where call_id = 'CALL-B'),
    false, null, 'wrong_context', null, null,
    'The cited handoff happened in another call.');
  if not (r->>'idempotent')::boolean then raise exception 'resubmit retry was not idempotent: %', r; end if;
end
$$;
reset role;

do $$
begin
  if exists (
      select 1 from public.eavesly_alert_feedback f cross join retry_before b
      where f.call_id = 'CALL-B' and (f.reviewed_at, f.updated_at) is distinct from (b.reviewed_at, b.updated_at)
    )
    or (select count(*) from public.eavesly_alert_messages where call_id = 'CALL-B')
       <> (select message_count from retry_before)
    or (select count(*) from public.eavesly_notifications where call_id = 'CALL-B')
       <> (select notification_count from retry_before)
    or (select manager_email from public.eavesly_alert_feedback where call_id = 'CALL-B')
       <> 'manager.two@trypennie.com'
    or (select initial_manager_review->>'manager_email' from public.eavesly_alert_feedback where call_id = 'CALL-B')
       <> 'manager.one@trypennie.com'
    or (select count(*) from public.eavesly_notifications
        where call_id = 'CALL-B' and recipient_email = 'director.one@trypennie.com') <> 1 then
    raise exception 'resubmit retry, transfer snapshot, or requester notification failed';
  end if;
end
$$;

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","email":"director.two@trypennie.com"}', false);
set role authenticated;
select public.decide_internal_alert_feedback('CALL-B', 'warm_transfer', 2, 'approved', null);
reset role;

-- Legacy approval requires a real superadmin acker, is stale after revision 1, and typed decisions win.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","email":"director.one@trypennie.com"}', false);
set role authenticated;
select public.decide_internal_alert_feedback(
  'CALL-LEGACY-TYPED', 'full_qa', 1, 'changes_requested',
  'Please add the missing details before approval.');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
select public.submit_internal_alert_feedback(
  'CALL-LEGACY-STALE', 'full_qa', 1,
  (select -id from public.eavesly_alert_acks where call_id = 'CALL-LEGACY-STALE'),
  true, 'coached', null,
  'The required statement was omitted.', 'The manager reviewed it with the agent.', null);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","email":"director.one@trypennie.com"}', false);
set role authenticated;
do $$
begin
  if (select current_decision_source from public.eavesly_alerts_with_feedback where call_id = 'CALL-LEGACY-GOD')
       <> 'legacy_superadmin_ack'
    or (select current_decision from public.eavesly_alerts_with_feedback where call_id = 'CALL-LEGACY-ORDINARY') is not null
    or (select current_decision_source from public.eavesly_alerts_with_feedback where call_id = 'CALL-LEGACY-TYPED')
       <> 'typed'
    or (select current_decision from public.eavesly_alerts_with_feedback where call_id = 'CALL-LEGACY-TYPED')
       <> 'changes_requested'
    or (select current_decision from public.eavesly_alerts_with_feedback where call_id = 'CALL-LEGACY-STALE') is not null
    or (select initial_manager_review->>'manager_email' from public.eavesly_alert_feedback
        where call_id = 'CALL-LEGACY-STALE') <> 'manager.one@trypennie.com'
    or (select initial_manager_review->>'action_taken' from public.eavesly_alert_feedback
        where call_id = 'CALL-LEGACY-STALE') <> 'coached' then
    raise exception 'legacy/typed/stale approval or historic snapshot projection failed';
  end if;
end
$$;
reset role;

-- New decision rows are visible only to the current manager or a superadmin.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
do $$
begin
  if exists (select 1 from public.eavesly_alert_review_decisions where call_id = 'CALL-B') then
    raise exception 'former manager retained decision access after transfer';
  end if;
end
$$;
reset role;

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","email":"manager.two@trypennie.com"}', false);
set role authenticated;
do $$
begin
  if (select count(*) from public.eavesly_alert_review_decisions where call_id = 'CALL-B') <> 2 then
    raise exception 'current manager cannot read decision history';
  end if;
end
$$;
reset role;

select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","email":"outsider@trypennie.com"}', false);
set role authenticated;
do $$
begin
  if exists (select 1 from public.eavesly_alert_review_decisions)
    or (select current_decision from public.eavesly_alerts_with_feedback where call_id = 'CALL-B') is not null
    or (select initial_manager_review from public.eavesly_alerts_with_feedback where call_id = 'CALL-B') is not null then
    raise exception 'decision or new structured fields leaked out of scope';
  end if;
end
$$;
reset role;

-- Existing excluded-module browser/service-role writers remain unchanged.
select set_config('request.jwt.claims',
  '{"sub":"77777777-7777-7777-7777-777777777777","email":"partner.writer@trypennie.com"}', false);
set role authenticated;
insert into public.eavesly_alert_feedback(
  call_id, module_name, manager_email, accurate, action_taken, comment
) values (
  'CALL-DISPOSITION', 'disposition_review', 'partner.writer@trypennie.com', true, null, 'legacy direct writer'
);
reset role;

set role service_role;
insert into public.eavesly_alert_feedback(
  call_id, module_name, manager_email, accurate, inaccuracy_reason, comment
) values (
  'CALL-ACHIEVE', 'achieve_welcome_call_qa', 'external.partner@example.test', false, 'other', null
);
reset role;

do $$
begin
  if (select count(*) from public.eavesly_alert_feedback
      where module_name in ('disposition_review', 'achieve_welcome_call_qa')) <> 2 then
    raise exception 'excluded direct writers changed behavior';
  end if;
end
$$;

-- Prepare a reviewed alert for the decision race.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}', false);
set role authenticated;
select public.submit_internal_alert_feedback(
  'CALL-DECISION-RACE', 'full_qa', 0, null, true, 'no_action_needed', null,
  'The warning was confirmed in the call.', 'No coaching was needed after review.', null);
reset role;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres

claims_manager='{"sub":"11111111-1111-1111-1111-111111111111","email":"manager.one@trypennie.com"}'
claims_director_one='{"sub":"33333333-3333-3333-3333-333333333333","email":"director.one@trypennie.com"}'
claims_director_two='{"sub":"44444444-4444-4444-4444-444444444444","email":"director.two@trypennie.com"}'

# Two first writers serialize on the module row. The second writer cannot turn
# an initial expected_revision=0 into an overwrite.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >"$tmp/first-writer.log" 2>&1 <<SQL &
select set_config('request.jwt.claims', '$claims_manager', false);
set role authenticated;
begin;
select public.submit_internal_alert_feedback(
  'CALL-RACE', 'full_qa', 0, null, true, 'coached', null,
  'The required script was not delivered.', 'The manager coached the complete script.', null);
select pg_sleep(2);
commit;
SQL
first_pid=$!
sleep 0.5
set +e
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >"$tmp/second-writer.log" 2>&1 <<SQL
select set_config('request.jwt.claims', '$claims_director_two', false);
set role authenticated;
select public.submit_internal_alert_feedback(
  'CALL-RACE', 'full_qa', 0, null, false, null, 'wrong_context',
  null, null, 'A competing reviewer supplied different feedback.');
SQL
second_status=$?
set -e
wait "$first_pid"
if [[ $second_status -eq 0 ]] || ! grep -q 'EAVESLY_STALE_REVIEW' "$tmp/second-writer.log"; then
  cat "$tmp/first-writer.log" "$tmp/second-writer.log" >&2
  echo 'two-first-writer race did not reject the stale writer' >&2
  exit 1
fi

# Approve and request-changes also serialize; one authoritative decision exists.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >"$tmp/first-decision.log" 2>&1 <<SQL &
select set_config('request.jwt.claims', '$claims_director_one', false);
set role authenticated;
begin;
select public.decide_internal_alert_feedback(
  'CALL-DECISION-RACE', 'full_qa', 1, 'approved', null);
select pg_sleep(2);
commit;
SQL
decision_pid=$!
sleep 0.5
set +e
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >"$tmp/second-decision.log" 2>&1 <<SQL
select set_config('request.jwt.claims', '$claims_director_two', false);
set role authenticated;
select public.decide_internal_alert_feedback(
  'CALL-DECISION-RACE', 'full_qa', 1, 'changes_requested',
  'Please revise this competing decision request.');
SQL
second_decision_status=$?
set -e
wait "$decision_pid"
if [[ $second_decision_status -eq 0 ]] || ! grep -q 'EAVESLY_DECISION_CONFLICT' "$tmp/second-decision.log"; then
  cat "$tmp/first-decision.log" "$tmp/second-decision.log" >&2
  echo 'approve/request race did not preserve first-wins behavior' >&2
  exit 1
fi

cat <<'SQL' | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
do $$
begin
  begin
    update public.eavesly_alert_review_decisions
    set instructions = 'A forbidden mutation.'
    where call_id = 'CALL-A';
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then
    if sqlerrm = 'TEST_EXPECTED_FAILURE_MISSING' or sqlerrm <> 'EAVESLY_DECISION_IMMUTABLE' then raise; end if;
  end;

  if (select count(*) from public.eavesly_alert_feedback where call_id = 'CALL-RACE') <> 1
    or (select manager_email from public.eavesly_alert_feedback where call_id = 'CALL-RACE')
       <> 'manager.one@trypennie.com'
    or (select count(*) from public.eavesly_alert_review_decisions where call_id = 'CALL-DECISION-RACE') <> 1
    or (select decision from public.eavesly_alert_review_decisions where call_id = 'CALL-DECISION-RACE') <> 'approved'
    or (select action_taken from public.eavesly_alert_feedback where call_id = 'CALL-DECISION-RACE') <> 'no_action_needed'
    or exists (select 1 from public.eavesly_alert_messages where call_id = 'CALL-DECISION-RACE') then
    raise exception 'race persistence assertions failed';
  end if;
end
$$;

select 'structured-manager-review.integration.check.sh: all assertions passed' as result;
SQL
