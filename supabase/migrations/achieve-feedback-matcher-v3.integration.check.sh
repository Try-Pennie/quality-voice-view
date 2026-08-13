#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260813120000_achieve_feedback_matcher_v3.sql"
container="achieve-matcher-v3-check-$RANDOM-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
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
create schema private;

create table public.eavesly_calls (
  call_id text primary key,
  contact_phone text,
  agent_email text,
  started_at timestamptz
);
create table public.eavesly_module_results (
  id bigint generated always as identity primary key,
  call_id text not null,
  module_name text not null,
  result_json jsonb not null default '{}'::jsonb
);
create table public.eavesly_transcription_qa (
  call_id text primary key,
  original_transcript text
);
create table public.agent_directory (
  agent_email text not null,
  agent_full_name text not null
);
create table public.achieve_agent_feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  lead_phone_raw text not null,
  achieve_agent_name text,
  accent boolean,
  background_noise boolean,
  connection_issues boolean,
  call_quality text,
  notes text,
  submitted_by text not null default '',
  submitted_at timestamptz not null,
  phone_normalized text,
  matched_call_id text,
  matched_at timestamptz,
  matched_eavesly_call_id text,
  call_match_status text not null default 'pending'
    check (call_match_status in ('pending', 'matched', 'unmatched', 'ambiguous')),
  call_match_confidence text check (call_match_confidence is null or call_match_confidence = 'high'),
  call_match_reason text,
  call_matched_at timestamptz,
  constraint achieve_agent_feedback_call_match_reason_check check (
    call_match_reason is null or call_match_reason in (
      'legacy_module_match', 'invalid_phone', 'submitter_missing',
      'submitter_not_found', 'submitter_ambiguous', 'no_call_in_window',
      'call_ambiguous', 'matched_phone_time_submitter'
    )
  )
);
alter table public.achieve_agent_feedback enable row level security;

insert into public.agent_directory(agent_email, agent_full_name)
values ('alice@example.test', 'Alice Smith');

insert into public.eavesly_calls(call_id, contact_phone, agent_email, started_at) values
  ('legacy', '999-999-9999', 'alice@example.test', '2026-01-02 11:00Z'),
  ('qa-a', '111-111-1111', 'alice@example.test', '2026-01-02 10:00Z'),
  ('qa-b', '111-111-1111', 'alice@example.test', '2026-01-02 11:00Z'),
  ('name-a', '222-222-2222', 'alice@example.test', '2026-01-02 10:00Z'),
  ('name-b', '222-222-2222', 'alice@example.test', '2026-01-02 11:00Z'),
  ('global', '333-333-3333', 'other@example.test', '2026-01-02 11:00Z'),
  ('audit-a', '444-444-4444', 'alice@example.test', '2026-01-02 10:00Z'),
  ('audit-b', '444-444-4444', 'alice@example.test', '2026-01-02 11:00Z'),
  ('amb-a', '555-555-5555', 'alice@example.test', '2026-01-02 10:00Z'),
  ('amb-b', '555-555-5555', 'alice@example.test', '2026-01-02 11:00Z'),
  ('single-name-a', '666-666-6666', 'alice@example.test', '2026-01-02 10:00Z'),
  ('single-name-b', '666-666-6666', 'alice@example.test', '2026-01-02 11:00Z'),
  ('historical', '888-888-8888', 'alice@example.test', '2026-01-02 11:00Z');

insert into public.eavesly_module_results(call_id, module_name, result_json) values
  ('legacy', 'achieve_welcome_call_qa', '{}'),
  ('qa-b', 'achieve_welcome_call_qa', '{}'),
  ('audit-b', 'achieve_welcome_call_qa', '{"backfill":{"audit_only":true}}'),
  ('historical', 'achieve_welcome_call_qa', '{}');

insert into public.eavesly_transcription_qa(call_id, original_transcript) values
  ('name-a', 'Another representative joined.'),
  ('name-b', 'Welcome. My name is Maria Lopez, and I will help today.'),
  ('single-name-a', 'Another representative joined.'),
  ('single-name-b', 'Welcome. My name is Maria, and I will help today.');

insert into public.achieve_agent_feedback(
  lead_phone_raw, achieve_agent_name, submitted_by, submitted_at, phone_normalized,
  matched_call_id, matched_at, matched_eavesly_call_id, call_match_status,
  call_match_confidence, call_match_reason, call_matched_at
) values
  ('9999999999', null, 'Alice Smith', '2026-01-02 12:00Z', '9999999999',
    'legacy', '2026-01-02 12:01Z', 'legacy', 'matched', 'high', 'legacy_module_match', '2026-01-02 12:01Z'),
  ('1111111111', null, 'Alice Smith', '2026-01-02 12:00Z', '1111111111',
    null, null, null, 'ambiguous', null, 'call_ambiguous', null),
  ('2222222222', 'Maria Lopez', 'Alice Smith', '2026-01-02 12:00Z', '2222222222',
    null, null, null, 'ambiguous', null, 'call_ambiguous', null),
  ('3333333333', null, 'Unknown Person', '2026-01-02 12:00Z', '3333333333',
    null, null, null, 'unmatched', null, 'submitter_not_found', null),
  ('#ERROR!', null, 'Alice Smith', '2026-01-02 12:00Z', null,
    null, null, null, 'unmatched', null, 'invalid_phone', null),
  ('4444444444', null, 'Alice Smith', '2026-01-02 12:00Z', '4444444444',
    null, null, null, 'ambiguous', null, 'call_ambiguous', null),
  ('5555555555', null, 'Alice Smith', '2026-01-02 12:00Z', '5555555555',
    null, null, null, 'ambiguous', null, 'call_ambiguous', null),
  ('6666666666', 'Maria', 'Alice Smith', '2026-01-02 12:00Z', '6666666666',
    null, null, null, 'ambiguous', null, 'call_ambiguous', null),
  ('8888888888', null, 'Alice Smith', '2026-01-02 12:00Z', '8888888888',
    null, null, 'historical', 'matched', null, 'matched_phone_time_submitter', null);
SQL
  cat "$migration"
  cat <<'SQL'

do $$
declare
  shadow jsonb;
  totals jsonb;
  matched integer;
  second_run integer;
begin
  select public.report_achieve_agent_feedback_matches_v3() into shadow;
  if shadow->>'candidate_rows' <> '7' or shadow->>'would_match' <> '4'
    or shadow->>'would_remain_unresolved' <> '3' then
    raise exception 'unexpected shadow report: %', shadow;
  end if;

  select public.match_achieve_agent_feedback() into matched;
  if matched <> 4 then raise exception 'expected 4 new associations, got %', matched; end if;

  if not exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '1111111111'
      and matched_call_id = 'qa-b'
      and call_match_provenance = 'inferred'
      and call_match_method = 'unique_qa_phone_time'
      and call_match_evidence->>'qa_candidate_count' = '1'
  ) then raise exception 'unique QA tier failed'; end if;

  if not exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '2222222222'
      and matched_eavesly_call_id = 'name-b'
      and matched_call_id is null
      and call_match_method = 'transcript_agent_name_phone_time'
  ) then raise exception 'transcript full-name tier failed'; end if;

  if not exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '3333333333'
      and matched_eavesly_call_id = 'global'
      and call_match_method = 'unique_phone_time_no_submitter'
  ) then raise exception 'submitter-not-found global tier failed'; end if;

  if exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '#ERROR!' and matched_eavesly_call_id is not null
  ) then raise exception 'invalid phone was broadly matched'; end if;

  if not exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '4444444444'
      and matched_eavesly_call_id = 'audit-b'
      and matched_call_id is null
      and call_match_evidence->>'qa_scope' = 'audit_only'
  ) then raise exception 'audit association contaminated ordinary match or was not retained'; end if;

  if exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '6666666666' and matched_eavesly_call_id is not null
  ) then raise exception 'one-token transcript name inferred an association'; end if;

  if not exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '9999999999'
      and call_match_provenance = 'deterministic'
      and call_match_confidence is null
  ) then raise exception 'drifted deterministic confidence was not repaired'; end if;

  if not exists (
    select 1 from public.achieve_agent_feedback
    where lead_phone_raw = '8888888888'
      and call_matched_at is not null
      and call_match_provenance = 'inferred'
      and call_match_confidence = 'high'
  ) then raise exception 'drifted inferred confidence or historical consistency was not repaired'; end if;

  select public.get_achieve_feedback_match_totals() into totals;
  if totals <> '{"unresolved":3,"true_qa_absent":2,"inferred_matched":2,"audit_qa_available":1,"deterministic_matched":1}'::jsonb then
    raise exception 'unexpected exact totals: %', totals;
  end if;

  if (select count(*) from public.list_achieve_feedback_exceptions('true_qa_absent', 200)) <> 2 then
    raise exception 'true-QA-absent list is not exact';
  end if;
  if (select count(*) from public.list_achieve_feedback_exceptions('unresolved', 200)) <> 3 then
    raise exception 'unresolved list is not exact';
  end if;

  select public.match_achieve_agent_feedback() into second_run;
  if second_run <> 0 then raise exception 'matcher is not sticky/idempotent: %', second_run; end if;
end
$$;

select 'achieve-feedback-matcher-v3.integration.check.sh: all assertions passed' as result;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
