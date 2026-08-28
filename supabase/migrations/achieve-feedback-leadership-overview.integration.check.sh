#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
base="$repo_root/supabase/migrations/20260816100000_achieve_feedback_leadership_overview.sql"
optimization="$repo_root/supabase/migrations/20260816101000_optimize_achieve_feedback_attribution_scope.sql"
detail="$repo_root/supabase/migrations/20260816110000_achieve_representative_feedback_detail.sql"
ai="$repo_root/supabase/migrations/20260816120000_achieve_wc_agent_summary_ai.sql"
summary_scope="$repo_root/supabase/migrations/20260817141000_optimize_achieve_wc_summary_scope.sql"
termination="$repo_root/supabase/migrations/20260824120000_achieve_agent_termination_tracking.sql"
termination_counts="$repo_root/supabase/migrations/20260827122000_achieve_report_termination_counts.sql"
container="achieve-feedback-overview-check-$RANDOM-$$"

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
create schema private;

create table public.achieve_agent_feedback (
  id bigint generated always as identity primary key,
  submitted_at timestamptz not null,
  call_quality text,
  accent boolean,
  background_noise boolean,
  connection_issues boolean,
  notes text,
  submitted_by text,
  matched_eavesly_call_id text,
  call_match_reason text
);
create table public.eavesly_calls (call_id text, sfdc_lead_id text);
create table public.eavesly_module_results (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  call_id text,
  module_name text,
  sfdc_lead_id text,
  has_violation boolean,
  result_json jsonb
);
-- No uniqueness here so the fixture can prove that conflicting bridge data
-- fails closed even though production currently constrains the lead key.
create table public.achieve_client_sfdc_map (sfdc_lead_id text, client_id text not null);
create table public.welcome_call_agent_log (
  id bigint generated always as identity primary key,
  client_id text not null,
  welcome_call_agent_name text not null,
  welcome_call_agent_email text not null,
  first_seen_on date not null,
  last_seen_on date not null
);

insert into public.eavesly_calls(call_id, sfdc_lead_id) values
  ('CALL-A', 'LEAD-A'), ('CALL-A2', 'LEAD-A2'), ('CALL-A3', 'LEAD-A3'),
  ('CALL-B', 'LEAD-B'),
  ('CALL-C', 'LEAD-C'), ('CALL-C2', 'LEAD-C2'),
  ('CALL-QA', 'LEAD-QA'),
  ('CALL-CONFLICT', 'LEAD-D'),
  ('CALL-BRIDGE', 'LEAD-F'),
  ('CALL-EXCLUDED', 'LEAD-QA');

insert into public.eavesly_module_results(
  created_at, call_id, module_name, sfdc_lead_id, has_violation, result_json
) values
  ('2026-08-10 09:00Z', 'CALL-A', 'achieve_welcome_call_qa', 'LEAD-A', false, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-11 09:00Z', 'CALL-A2', 'achieve_welcome_call_qa', 'LEAD-A2', false, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-11 11:00Z', 'CALL-A3', 'achieve_welcome_call_qa', 'LEAD-A3', true, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-12 09:00Z', 'CALL-C', 'achieve_welcome_call_qa', 'LEAD-C', true, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-13 09:00Z', 'CALL-C2', 'achieve_welcome_call_qa', 'LEAD-C2', true, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-14 09:00Z', 'CALL-QA', 'achieve_welcome_call_qa', 'LEAD-QA', false, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-15 09:00Z', 'CALL-B', 'achieve_welcome_call_qa', 'LEAD-B', true, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-16 09:00Z', 'CALL-CONFLICT', 'achieve_welcome_call_qa', 'LEAD-E', false, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-17 09:00Z', 'CALL-BRIDGE', 'achieve_welcome_call_qa', 'LEAD-F', false, '{"transcript_segment":{"start_line":0}}'),
  ('2026-08-18 09:00Z', 'CALL-EXCLUDED', 'achieve_welcome_call_qa', 'LEAD-QA', true, '{"backfill":{"audit_only":true},"transcript_segment":{"start_line":0}}'),
  ('2026-08-19 09:00Z', 'CALL-EXCLUDED', 'achieve_welcome_call_qa', 'LEAD-QA', true, '{"grading_skipped":true,"skip_reason":"no_transfer_leg"}'),
  ('2026-08-20 09:00Z', 'CALL-EXCLUDED', 'achieve_welcome_call_qa', 'LEAD-QA', true, '{"transcript_segment":{"used_full_transcript_fallback":true}}'),
  ('2026-08-21 09:00Z', 'CALL-EXCLUDED', 'achieve_welcome_call_qa', 'LEAD-QA', false, '{"skip_reason":"competitor_transfer","transcript_segment":{"start_line":0}}'),
  ('2026-08-22 09:00Z', 'CALL-EXCLUDED', 'another_module', 'LEAD-QA', true, '{}');

insert into public.achieve_client_sfdc_map(sfdc_lead_id, client_id) values
  ('LEAD-A', 'CLIENT-A'), ('LEAD-A2', 'CLIENT-A'), ('LEAD-A3', 'CLIENT-A'),
  ('LEAD-B', 'CLIENT-B'),
  ('LEAD-C', 'CLIENT-C'), ('LEAD-C2', 'CLIENT-C'),
  ('LEAD-QA', 'CLIENT-QA'),
  ('LEAD-D', 'CLIENT-D'), ('LEAD-E', 'CLIENT-E'),
  ('LEAD-F', 'CLIENT-F'), ('LEAD-F', 'CLIENT-F2');

insert into public.welcome_call_agent_log(
  client_id, welcome_call_agent_name, welcome_call_agent_email, first_seen_on, last_seen_on
) values
  ('CLIENT-A', 'Representative A', 'REP-A@EXAMPLE.TEST', '2026-08-10', '2026-08-15'),
  ('CLIENT-B', 'Representative B1', 'rep-b1@example.test', '2026-08-15', '2026-08-15'),
  ('CLIENT-B', 'Representative B2', 'rep-b2@example.test', '2026-08-15', '2026-08-15'),
  ('CLIENT-C', 'Representative C', 'rep-c@example.test', '2026-08-15', '2026-08-15'),
  ('CLIENT-QA', 'Representative QA', 'rep-qa@example.test', '2026-08-15', '2026-08-15'),
  ('CLIENT-D', 'Representative D', 'rep-d@example.test', '2026-08-15', '2026-08-15'),
  ('CLIENT-E', 'Representative E', 'rep-e@example.test', '2026-08-15', '2026-08-15'),
  ('CLIENT-F', 'Representative F', 'rep-f@example.test', '2026-08-15', '2026-08-15'),
  ('CLIENT-F2', 'Representative F2', 'rep-f2@example.test', '2026-08-15', '2026-08-15');

insert into public.achieve_agent_feedback(
  submitted_at, call_quality, accent, background_noise, connection_issues,
  notes, submitted_by, matched_eavesly_call_id, call_match_reason
) values
  ('2026-08-10 10:00Z', 'Good', false, false, false, 'Clear handoff.', 'Pennie Agent One', 'CALL-A', 'legacy_module_match'),
  ('2026-08-11 10:00Z', 'Fair', false, true, false, null, 'Pennie Agent Two', 'CALL-A', 'matched_phone_time_submitter'),
  ('2026-08-11 11:00Z', 'Good', false, false, false, null, 'Pennie Agent Two', 'CALL-A2', 'matched_phone_time_submitter'),
  ('2026-08-12 10:00Z', 'Poor', true, false, false, null, 'Pennie Agent Three', 'CALL-B', 'matched_phone_time_submitter'),
  ('2026-08-13 10:00Z', 'Poor', true, false, false, null, 'Pennie Agent Four', null, 'call_ambiguous'),
  ('2026-08-14 10:00Z', 'Good', false, false, true, null, 'Pennie Agent Five', 'CALL-C', 'matched_unique_qa_phone_time'),
  ('2026-08-14 11:00Z', 'Poor', false, false, false, 'Needs coaching.', 'Pennie Agent Five', 'CALL-C2', 'matched_unique_qa_phone_time'),
  ('2026-08-15 10:00Z', null, false, false, false, null, 'Pennie Agent Six', 'CALL-CONFLICT', 'matched_phone_time_submitter');
SQL
  cat "$base"
  cat "$optimization"
  cat "$detail"
  cat "$ai"
  cat "$summary_scope"
  cat "$termination"
  cat "$termination_counts"
  cat <<'SQL'

insert into public.achieve_agent_terminations(agent_email, agent_name, terminated_at) values
  ('rep-a@example.test', 'Representative A', '2026-08-11 10:30:00+00'),
  ('boundary@example.test', 'Boundary Representative', '2026-08-10 04:00:00+00');

insert into public.welcome_call_agent_log(
  client_id, welcome_call_agent_name, welcome_call_agent_email, first_seen_on, last_seen_on
) values
  ('CLIENT-POST', 'Representative A', 'rep-a@example.test', '2026-08-12', '2026-08-14'),
  ('SEEDED-A', 'Aliyu Adigun', 'aadigun@achieve.com', '2026-08-20', '2026-08-27'),
  ('SEEDED-D', 'Darios Desravines', 'ddesravines@achieve.com', '2026-08-20', '2026-08-27'),
  ('SEEDED-W', 'Wilma Hall', 'whall@achieve.com', '2026-08-20', '2026-08-27');

do $$
declare
  dashboard jsonb;
  overview jsonb;
  representatives jsonb;
  representative_detail jsonb;
  termination_monitoring jsonb;
begin
  if not private.achieve_is_ordinary_graded_qa(
      'achieve_welcome_call_qa',
      '{"transcript_segment":{"start_line":0}}'::jsonb
    )
    or private.achieve_is_ordinary_graded_qa(
      'achieve_welcome_call_qa',
      '{"grading_skipped":true}'::jsonb
    )
    or private.achieve_is_ordinary_graded_qa(
      'achieve_welcome_call_qa',
      '{"transcript_segment":{"used_full_transcript_fallback":true}}'::jsonb
    )
    or private.achieve_is_ordinary_graded_qa(
      'achieve_welcome_call_qa',
      '{"backfill":{"audit_only":true}}'::jsonb
    )
    or private.achieve_is_ordinary_graded_qa(
      'achieve_welcome_call_qa',
      '{"skip_reason":"competitor_transfer"}'::jsonb
    )
    or private.achieve_is_ordinary_graded_qa('another_module', '{}'::jsonb) then
    raise exception 'shared ordinary-grade predicate failed';
  end if;

  select public.get_achieve_agent_feedback_dashboard() into dashboard;
  overview := dashboard->'overview';
  representatives := dashboard->'representatives';

  if overview->'scope'->>'total_submissions' <> '7'
    or overview->'ratings' <> '{"fair":1,"good":2,"other":1,"poor":3}'::jsonb then
    raise exception 'Form denominator changed: %', overview;
  end if;
  if overview->'coverage' <> '{"unresolved":1,"call_associated":6,"agent_unavailable":2,"exact_agent_attributed":4}'::jsonb then
    raise exception 'Form attribution reconciliation failed: %', overview->'coverage';
  end if;
  if overview->'qa'->'coverage' <> '{"all_graded":8,"agent_unavailable":3,"exact_agent_attributed":5}'::jsonb then
    raise exception 'ordinary QA exclusions or attribution failed: %', overview->'qa'->'coverage';
  end if;
  if overview->'qa'->'outcomes' <> '{"pass":3,"flagged":2}'::jsonb then
    raise exception 'attributed QA outcome reconciliation failed: %', overview->'qa'->'outcomes';
  end if;
  if overview->'qa'->'alignment' <> '{"ai_only":1,"both_clear":0,"human_only":1,"both_concern":1,"overlap_calls":3}'::jsonb then
    raise exception 'call-level worst-rating alignment failed: %', overview->'qa'->'alignment';
  end if;
  if overview->>'distinct_exact_agents' <> '2'
    or overview->'qa'->>'distinct_exact_agents' <> '3'
    or overview->>'distinct_any_agents' <> '3' then
    raise exception 'distinct representative reconciliation failed: %', overview;
  end if;

  if representatives->'coverage'->>'total' <> '3'
    or representatives->'coverage'->>'loaded' <> '3' then
    raise exception 'union representative coverage failed: %', representatives;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(representatives->'rows') as row
    where row->>'achieve_agent_email' = 'rep-a@example.test'
      and row->>'total_submissions' = '2'
      and row->>'ai_total' = '2'
      and row->>'ai_pass' = '2'
      and row->>'overlap_calls' = '1'
      and row->>'both_clear' = '0'
      and row->>'human_only' = '1'
  ) then
    raise exception 'Representative A rollup missing: %', representatives;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(representatives->'rows') as row
    where row->>'achieve_agent_email' = 'rep-qa@example.test'
      and row->>'total_submissions' = '0'
      and row->>'ai_total' = '1'
      and row->>'ai_pass' = '1'
      and row->'latest_submitted_at' = 'null'::jsonb
  ) then
    raise exception 'QA-only representative missing: %', representatives;
  end if;
  if exists (
    select 1 from jsonb_array_elements(representatives->'rows') as row
    where row->>'achieve_agent_email' in (
      'rep-b1@example.test', 'rep-b2@example.test', 'rep-d@example.test',
      'rep-e@example.test', 'rep-f@example.test', 'rep-f2@example.test'
    )
  ) then
    raise exception 'ambiguous attribution leaked: %', representatives;
  end if;

  select public.list_achieve_agent_feedback_for_rep(' REP-A@EXAMPLE.TEST ') into representative_detail;
  if representative_detail->'coverage'->>'total' <> '2'
    or representative_detail->'qa_coverage'->>'total' <> '2'
    or jsonb_array_length(representative_detail->'qa_rows') <> 2 then
    raise exception 'representative detail coverage failed: %', representative_detail;
  end if;
  if representative_detail->'rows'->1->>'notes' <> 'Clear handoff.' then
    raise exception 'full Form notes unavailable: %', representative_detail;
  end if;
  if representative_detail->'qa_rows'->0->>'outcome' <> 'pass'
    or not (representative_detail->'qa_rows'->0 ? 'module_result_id') then
    raise exception 'QA summary projection failed: %', representative_detail;
  end if;
  if representative_detail::text ~ 'CALL-|LEAD-|CLIENT-|lead_phone|sfdc' then
    raise exception 'internal call identifiers leaked into representative detail: %', representative_detail;
  end if;

  if public.list_achieve_agent_termination_monitoring('2026-08-01 00:00:00+00') <> '[]'::jsonb then
    raise exception 'future terminations leaked into monitoring';
  end if;
  if public.list_achieve_agent_termination_monitoring('2026-08-20 00:00:00+00') <> '[]'::jsonb then
    raise exception 'terminations outside the reporting week leaked into monitoring';
  end if;
  select public.list_achieve_agent_termination_monitoring('2026-08-12 00:00:00+00') into termination_monitoring;
  if not exists (
    select 1 from jsonb_array_elements(termination_monitoring) as row
    where row->>'agent_email' = 'rep-a@example.test'
      and row->>'activity_post_termination' = '0'
  ) then
    raise exception 'pre-termination first-seen activity was counted after termination: %', termination_monitoring;
  end if;
  select public.list_achieve_agent_termination_monitoring('2026-08-16 04:00:00+00') into termination_monitoring;
  if not exists (
    select 1 from jsonb_array_elements(termination_monitoring) as row
    where row->>'agent_email' = 'rep-a@example.test'
      and row->>'activity_post_termination' = '1'
      and row->>'last_activity_on' = '2026-08-15'
  ) then
    raise exception 'distinct first-seen post-termination monitoring failed: %', termination_monitoring;
  end if;
  select public.list_achieve_agent_termination_monitoring('2026-08-17 13:00:00+00') into termination_monitoring;
  if not exists (
    select 1 from jsonb_array_elements(termination_monitoring) as row
    where row->>'agent_email' = 'boundary@example.test'
  ) then
    raise exception 'prior Monday Eastern boundary was excluded: %', termination_monitoring;
  end if;
  select public.list_achieve_agent_termination_monitoring('2026-08-28 04:00:00+00') into termination_monitoring;
  if exists (
    select 1 from jsonb_array_elements(termination_monitoring) as row
    where row->>'agent_email' in ('aadigun@achieve.com', 'ddesravines@achieve.com', 'whall@achieve.com')
      and row->>'activity_post_termination' <> '0'
  ) then
    raise exception 'seeded agents counted activity first seen before termination: %', termination_monitoring;
  end if;

  if has_function_privilege('anon', 'private.achieve_is_ordinary_graded_qa(text,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'private.achieve_is_ordinary_graded_qa(text,jsonb)', 'execute')
    or has_function_privilege('anon', 'private.achieve_ordinary_qa_attributed(timestamptz,timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'public.get_achieve_agent_feedback_dashboard(timestamptz,timestamptz,integer,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.list_achieve_agent_feedback_for_rep(text,integer,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.list_achieve_agent_termination_monitoring(timestamptz)', 'execute')
    or has_table_privilege('authenticated', 'public.achieve_agent_terminations', 'select')
    or not has_function_privilege('service_role', 'private.achieve_is_ordinary_graded_qa(text,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'private.achieve_ordinary_qa_attributed(timestamptz,timestamptz)', 'execute') then
    raise exception 'WC Agent Summary privileges are unsafe';
  end if;
end
$$;

select 'achieve-feedback-leadership-overview.integration.check.sh: all assertions passed' as result;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
