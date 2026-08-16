#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260816100000_achieve_feedback_leadership_overview.sql"
optimization="$repo_root/supabase/migrations/20260816101000_optimize_achieve_feedback_attribution_scope.sql"
container="achieve-feedback-overview-check-$RANDOM-$$"

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

create table public.achieve_agent_feedback (
  id bigint generated always as identity primary key,
  submitted_at timestamptz not null,
  call_quality text,
  accent boolean,
  background_noise boolean,
  connection_issues boolean,
  notes text,
  matched_eavesly_call_id text,
  call_match_reason text
);
create table public.eavesly_calls (
  call_id text,
  sfdc_lead_id text
);
create table public.eavesly_module_results (
  id bigint generated always as identity primary key,
  call_id text,
  module_name text,
  sfdc_lead_id text
);
create table public.achieve_client_sfdc_map (
  sfdc_lead_id text primary key,
  client_id text not null
);
create table public.welcome_call_agent_log (
  id bigint generated always as identity primary key,
  client_id text not null,
  welcome_call_agent_name text not null,
  welcome_call_agent_email text not null,
  last_seen_on date not null
);

insert into public.eavesly_calls(call_id, sfdc_lead_id) values
  ('CALL-A', 'LEAD-A'),
  ('CALL-B', 'LEAD-B'),
  ('CALL-CONFLICT', 'LEAD-D');

insert into public.eavesly_module_results(call_id, module_name, sfdc_lead_id) values
  ('CALL-C', 'achieve_welcome_call_qa', 'LEAD-C'),
  ('CALL-CONFLICT', 'achieve_welcome_call_qa', 'LEAD-E'),
  ('CALL-IGNORED', 'another_module', 'LEAD-A');

insert into public.achieve_client_sfdc_map(sfdc_lead_id, client_id) values
  ('LEAD-A', 'CLIENT-A'),
  ('LEAD-B', 'CLIENT-B'),
  ('LEAD-C', 'CLIENT-C'),
  ('LEAD-D', 'CLIENT-D'),
  ('LEAD-E', 'CLIENT-E');

insert into public.welcome_call_agent_log(
  client_id, welcome_call_agent_name, welcome_call_agent_email, last_seen_on
) values
  ('CLIENT-A', 'Representative A', 'REP-A@EXAMPLE.TEST', '2026-08-15'),
  ('CLIENT-B', 'Representative B1', 'rep-b1@example.test', '2026-08-15'),
  ('CLIENT-B', 'Representative B2', 'rep-b2@example.test', '2026-08-15'),
  ('CLIENT-C', 'Representative C', 'rep-c@example.test', '2026-08-15'),
  ('CLIENT-D', 'Representative D', 'rep-d@example.test', '2026-08-15'),
  ('CLIENT-E', 'Representative E', 'rep-e@example.test', '2026-08-15');

insert into public.achieve_agent_feedback(
  submitted_at, call_quality, accent, background_noise, connection_issues,
  notes, matched_eavesly_call_id, call_match_reason
) values
  ('2026-08-10 10:00Z', 'Good', false, false, false, 'note', 'CALL-A', 'legacy_module_match'),
  ('2026-08-11 10:00Z', 'Fair', false, true, false, null, 'CALL-A', 'matched_phone_time_submitter'),
  ('2026-08-12 10:00Z', 'Poor', true, false, false, null, 'CALL-B', 'matched_phone_time_submitter'),
  ('2026-08-13 10:00Z', 'Poor', true, false, false, null, null, 'call_ambiguous'),
  ('2026-08-14 10:00Z', 'Good', false, false, true, null, 'CALL-C', 'matched_unique_qa_phone_time'),
  ('2026-08-15 10:00Z', null, false, false, false, null, 'CALL-CONFLICT', 'matched_phone_time_submitter');
SQL
  cat "$migration"
  cat "$optimization"
  cat <<'SQL'

do $$
declare
  dashboard jsonb;
  overview jsonb;
  representatives jsonb;
  filtered jsonb;
begin
  select public.get_achieve_agent_feedback_dashboard() into dashboard;
  if dashboard->'overview'->'scope'->>'total_submissions' <> '6'
    or dashboard->'representatives'->'coverage'->>'total' <> '2' then
    raise exception 'combined dashboard RPC failed: %', dashboard;
  end if;

  select public.get_achieve_agent_feedback_overview() into overview;

  if overview->'scope'->>'total_submissions' <> '6' then
    raise exception 'unexpected total: %', overview;
  end if;
  if overview->'ratings' <> '{"fair":1,"good":2,"other":1,"poor":2}'::jsonb then
    raise exception 'unexpected ratings: %', overview->'ratings';
  end if;
  if overview->'flags' <> '{"accent":2,"with_notes":1,"background_noise":1,"connection_issues":1}'::jsonb then
    raise exception 'unexpected flags: %', overview->'flags';
  end if;
  if overview->'coverage' <> '{"unresolved":1,"call_associated":5,"agent_unavailable":2,"exact_agent_attributed":3}'::jsonb then
    raise exception 'unexpected coverage: %', overview->'coverage';
  end if;
  if overview->'unresolved_reasons' <> '{"other":0,"invalid_phone":0,"call_ambiguous":1,"no_call_in_window":0,"submitter_not_found":0}'::jsonb then
    raise exception 'unexpected unresolved reasons: %', overview->'unresolved_reasons';
  end if;
  if overview->>'distinct_exact_agents' <> '2' then
    raise exception 'unexpected distinct representative count: %', overview;
  end if;

  select public.list_achieve_agent_feedback_by_rep() into representatives;
  if representatives->'coverage'->>'total' <> '2'
    or representatives->'coverage'->>'loaded' <> '2'
    or jsonb_array_length(representatives->'rows') <> 2 then
    raise exception 'unexpected representative coverage: %', representatives;
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(representatives->'rows') as row
    where row->>'achieve_agent_email' = 'rep-a@example.test'
      and row->>'total_submissions' = '2'
      and row->>'good' = '1'
      and row->>'fair' = '1'
      and row->>'background_noise' = '1'
  ) then
    raise exception 'submission-level Representative A rollup missing: %', representatives;
  end if;
  if exists (
    select 1 from jsonb_array_elements(representatives->'rows') as row
    where row->>'achieve_agent_email' in ('rep-b1@example.test', 'rep-b2@example.test', 'rep-d@example.test', 'rep-e@example.test')
  ) then
    raise exception 'ambiguous representative attribution leaked: %', representatives;
  end if;

  select public.get_achieve_agent_feedback_overview(
    '2026-08-13 00:00Z'::timestamptz,
    '2026-08-15 00:00Z'::timestamptz
  ) into filtered;
  if filtered->'scope'->>'total_submissions' <> '2'
    or filtered->'coverage'->>'unresolved' <> '1'
    or filtered->'coverage'->>'exact_agent_attributed' <> '1' then
    raise exception 'exclusive date bounds failed: %', filtered;
  end if;
end
$$;

select 'achieve-feedback-leadership-overview.integration.check.sh: all assertions passed' as result;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
