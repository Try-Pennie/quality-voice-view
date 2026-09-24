#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260918020000_full_qa_rubric_feedback.sql"
duplicate_fix="$repo_root/supabase/migrations/20260921210000_reject_duplicate_normalized_full_qa_findings.sql"
decision_first="$repo_root/supabase/migrations/20260922040000_full_qa_alert_decision_first.sql"
partly_correct="$repo_root/supabase/migrations/20260922140000_full_qa_partially_correct_feedback.sql"
evidence_feedback="$repo_root/supabase/migrations/20260923120000_evidence_level_manager_feedback.sql"
container="full-qa-rubric-check-$RANDOM-$$"
tmp="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
# TCP excludes the temporary Unix-socket-only server used during initdb.
for _ in $(seq 1 30); do docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null

{
cat <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create schema extensions;
create table auth.users(id uuid primary key,email text not null);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.jwt(),auth.uid() to anon,authenticated,service_role;
create table public.eavesly_module_results(
 id bigint generated always as identity primary key,created_at timestamptz not null default now(),alert_sent_at timestamptz,
 call_id text not null,module_name text not null,violation_type text,has_violation boolean not null default true,alert_sent boolean not null default true,
 agent_email text not null,contact_name text,contact_phone text,recording_link text,transcript_url text,call_summary text,sfdc_lead_id text,
 processing_time_ms integer,result_json jsonb,unique(call_id,module_name));
alter table public.eavesly_module_results enable row level security;
create table public.eavesly_calls(id bigint generated always as identity primary key,call_id text unique,agent_email text,started_at timestamptz);
create table public.agent_manager_mapping(agent_email text primary key,manager_email text not null);
create table public.manager_coaching_prompts(manager_email text primary key,is_god_mode boolean not null default false);
SQL
cat "$repo_root/supabase/migrations/20260427120000_eavesly_alert_feedback.sql"
cat "$repo_root/supabase/migrations/20260429190000_eavesly_alert_thread.sql"
cat "$repo_root/supabase/migrations/20260430180000_eavesly_notifications.sql"
cat "$repo_root/supabase/migrations/20260527150000_add_inaccuracy_reasons.sql"
cat <<'SQL'
grant select on public.eavesly_module_results,public.eavesly_calls,public.agent_manager_mapping,public.manager_coaching_prompts,public.eavesly_alerts_with_feedback to authenticated;
grant select,insert,update,delete on public.eavesly_alert_feedback,public.eavesly_alert_messages,public.eavesly_alert_acks to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant all on public.eavesly_alert_feedback to service_role;
grant usage,select on all sequences in schema public to service_role;
revoke all on public.eavesly_module_results,public.eavesly_alert_feedback,public.eavesly_alerts_with_feedback from anon,public;
drop policy if exists "Enable read access for all users" on public.eavesly_alert_feedback;
create policy "Authenticated read access" on public.eavesly_alert_feedback for select to authenticated using(true);
insert into auth.users values
 ('11111111-1111-1111-1111-111111111111','manager@trypennie.com'),
 ('22222222-2222-2222-2222-222222222222','director@trypennie.com'),
 ('33333333-3333-3333-3333-333333333333','director.two@trypennie.com'),
 ('44444444-4444-4444-4444-444444444444','outsider@trypennie.com');
insert into public.manager_coaching_prompts values
 ('manager@trypennie.com',false),('director@trypennie.com',true),('director.two@trypennie.com',true),('outsider@trypennie.com',false);
insert into public.agent_manager_mapping values('agent@example.test','manager@trypennie.com'),('decision-agent@example.test','manager@trypennie.com');
create temporary table test_clock(anchor timestamptz not null);
insert into test_clock values(clock_timestamp());
create temporary table source_fixture(value jsonb);
insert into source_fixture values(jsonb_build_object(
 '_evaluation_provenance',jsonb_build_object('version',1,'module_name','full_qa','prompt_sha256','1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37','user_prompt_sha256',repeat('a',64),'transcript_sha256',repeat('b',64)),
 'compliance_scorecard',jsonb_build_object('call_recording_disclosure','pass','call_recording_disclosure_evidence','[]'::jsonb,'credit_pull_consent','fail','credit_pull_consent_evidence','[]'::jsonb,'social_security_verification','pass','social_security_verification_evidence','[]'::jsonb,'accurate_representations','fail','accurate_representations_violations','[]'::jsonb,'no_misleading_claims','pass','misleading_claims_violations','[]'::jsonb),
 'customer_experience_scorecard',jsonb_build_object('professional_tone','good','professional_tone_examples','[]'::jsonb,'active_listening','good','active_listening_examples','[]'::jsonb,'patience_empathy','fair','patience_empathy_examples','[]'::jsonb,'clear_communication','good','clear_communication_examples','[]'::jsonb,'customer_focused','good','customer_focused_examples','[]'::jsonb),
 'sales_process_scorecard',jsonb_build_object('step1_agenda_setting','complete','step1_location','opening','step2_credit_review','complete','step2_location','review','step3_agent_inputs','complete','step3_location','inputs','step4_paydown_projections','not_applicable','step4_location',null,'step5_offers_review','complete','step5_location','offers','step6_debt_resolution','partial','step6_location','closing'),
 'program_expectations_scorecard',jsonb_build_object('phase_impact_covered',true,'phase_impact_evidence','quote','phase_stabilization_covered',true,'phase_stabilization_evidence','quote','phase_recovery_covered',false,'phase_recovery_evidence','','phase_rebuild_covered',false,'phase_rebuild_evidence','','payments_point_covered',true,'payments_point_evidence','quote','creditor_calls_point_covered',false,'creditor_calls_point_evidence','','legal_action_point_covered',false,'legal_action_point_evidence','')));
insert into public.eavesly_module_results(call_id,module_name,violation_type,agent_email,created_at,result_json)
select x,'full_qa','manager_escalation','agent@example.test',anchor+delta,value
from source_fixture cross join test_clock cross join (values
 ('CALL-COACHED','-2 days'::interval),('CALL-AFTER','2 days'),('CALL-PENDING','-3 days'),
 ('CALL-MISSING','4 days'),('CALL-UNKNOWN','5 days'),('CALL-LEGACY','6 days'),('CALL-DISTINCT','7 days'),('CALL-STREAMLINED','7 days'))v(x,delta);
insert into public.eavesly_module_results(call_id,module_name,violation_type,agent_email,result_json)
select call_id,'full_qa','manager_escalation','decision-agent@example.test',value #- '{compliance_scorecard,credit_pull_consent}' from source_fixture cross join (values ('CALL-DECISION'),('CALL-PARTLY'),('CALL-EVIDENCE'),('CALL-EVIDENCE-OTHER'))calls(call_id);
update public.eavesly_module_results set result_json=jsonb_set(jsonb_set(jsonb_set(result_json,
  '{compliance_scorecard,credit_pull_consent_evidence}',
  '[{"quote":"The same saved words.","speaker":"handling agent","context":"Consent claim context."}]'::jsonb),
  '{compliance_scorecard,accurate_representations_violations}',
  '[{"quote":"The same saved words.","speaker":"handling agent","context":"Representation claim context."}]'::jsonb),
  '{call_overview}',jsonb_build_object('manager_review_reason','Review exact evidence associations.','manager_focus_areas',
    '[{"quote":"The same saved words.","speaker":"handling agent","context":"General focus without a saved claim."},{"quote":42,"context":{"not":"text"}}]'::jsonb))
where call_id in ('CALL-EVIDENCE','CALL-EVIDENCE-OTHER');
update public.eavesly_module_results set result_json=result_json||jsonb_build_object('other_source',true)
where call_id='CALL-EVIDENCE-OTHER';
update public.eavesly_module_results set result_json=jsonb_set(result_json,'{_evaluation_provenance,prompt_sha256}',to_jsonb(repeat('f',64))) where call_id='CALL-UNKNOWN';
update public.eavesly_module_results set result_json=result_json-'_evaluation_provenance' where call_id='CALL-LEGACY';
insert into public.eavesly_calls(call_id,agent_email,started_at)
select x,'agent@example.test',anchor+delta from test_clock cross join (values
 ('CALL-COACHED','-2 days'::interval),('CALL-AFTER','2 days'),('CALL-PENDING','-3 days'),
 ('CALL-UNKNOWN','5 days'),('CALL-LEGACY','6 days'),('CALL-DISTINCT','7 days'))v(x,delta);
insert into public.eavesly_alert_feedback(call_id,module_name,manager_email,accurate,inaccuracy_reason,comment)
values('CALL-LEGACY','full_qa','manager@trypennie.com',false,'wrong_context','Historic review without criterion mapping.');
SQL
cat "$repo_root/supabase/migrations/20260911120000_structured_manager_review.sql"
cat "$migration"
printf 'begin;\n'
cat "$duplicate_fix"
cat "$decision_first"
cat "$partly_correct"
cat "$evidence_feedback"
printf 'commit;\n'
cat <<'SQL'
-- Exact prompt bytes and immutable catalog contract.
do $$ declare body text; begin
 select prompt_text into body from public.eavesly_full_qa_rubric_catalog;
 if encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex')<>'1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37'
   or octet_length(body)<>31552 then raise exception 'catalog prompt bytes changed'; end if;
 if (select jsonb_array_length(criteria_manifest) from public.eavesly_full_qa_rubric_catalog)<>23 then raise exception 'manifest is not 23 criteria'; end if;
 begin update public.eavesly_full_qa_rubric_catalog set contract_version=2; raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_FULL_QA_IMMUTABLE' then raise; end if; end;
end $$;
-- Direct reads and the old generic RPC cannot bypass the Full QA seam.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ begin
 if has_table_privilege('authenticated','public.eavesly_full_qa_review_revisions','select') then raise exception 'sensitive table readable'; end if;
 begin perform public.submit_internal_alert_feedback('CALL-COACHED','full_qa',0,null,false,null,'wrong_context',null,null,'Old RPC must not write Full QA.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_FULL_QA_USE_STRUCTURED_RPC' then raise; end if; end;
end $$;
create temporary table context_cache(call_id text primary key,context jsonb);
insert into context_cache select x,public.get_full_qa_review_context(x) from (values('CALL-COACHED'),('CALL-AFTER'),('CALL-PENDING'),('CALL-MISSING'),('CALL-UNKNOWN'),('CALL-LEGACY'),('CALL-DISTINCT'),('CALL-STREAMLINED'))v(x);
do $$ begin
 if (select context->>'source_reference_kind' from context_cache where call_id='CALL-COACHED')<>'known' then raise exception 'known source missing'; end if;
 if (select context->>'source_reference_kind' from context_cache where call_id='CALL-LEGACY')<>'legacy_current_reference' then raise exception 'legacy label missing'; end if;
 if (select context->>'source_reference_kind' from context_cache where call_id='CALL-UNKNOWN')<>'unknown_hash'
   or (select context->>'criteria_reference_kind' from context_cache where call_id='CALL-UNKNOWN')<>'current_field_map_only'
   or (select context->'rubric_prompt_text' from context_cache where call_id='CALL-UNKNOWN')<>'null'::jsonb then raise exception 'unknown stamped hash silently fell back'; end if;
end $$;
-- Helper fixture: all original judgments confirmed. Findings remain an independent explicit list.
create temporary table review_fixture(call_id text primary key,corrections jsonb,fingerprint text);
insert into review_fixture
select c.call_id,jsonb_agg(jsonb_build_object('criterion_key',m->>'key','disposition',
 case when c.context->'source_result_json'#>string_to_array(m->>'score_path','.') is null then 'needs_context' else 'confirmed' end,
 'corrected_value',coalesce(c.context->'source_result_json'#>string_to_array(m->>'score_path','.'),'null'::jsonb),
 'reason',case when c.context->'source_result_json'#>string_to_array(m->>'score_path','.') is null then to_jsonb('Source field unavailable; more context is required.'::text) else 'null'::jsonb end)),c.context->>'source_fingerprint'
from context_cache c cross join lateral jsonb_array_elements(c.context->'criteria_manifest')m group by c.call_id,c.context;
-- Alert decisions use the real scoped RPC with no implied score labels or coaching.
do $$ declare ctx jsonb; fp text; result jsonb; saved jsonb; correction jsonb; finding jsonb; begin
 ctx:=public.get_full_qa_review_context('CALL-DECISION'); fp:=ctx->>'source_fingerprint';
 result:=public.submit_full_qa_review('CALL-DECISION',0,null,fp,'[]','[]',true,'',null,null,null);
 if (result->>'review_revision')::integer<>1 then raise exception 'decision-only review did not save'; end if;
 saved:=public.get_full_qa_review_context('CALL-DECISION')->'review';
 if saved->'corrections'<>'[]'::jsonb or saved->'findings'<>'[]'::jsonb or saved->'action_taken'<>'null'::jsonb
   or saved->>'escalation_reason'<>'' then raise exception 'decision-only review fabricated feedback'; end if;
 result:=public.submit_full_qa_review('CALL-DECISION',0,null,fp,'[]','[]',true,'',null,null,null);
 if result->>'idempotent'<>'true' then raise exception 'decision-only retry was not idempotent'; end if;
 begin perform public.submit_full_qa_review('CALL-DECISION',1,null,fp,'[]','[]',false,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-DECISION',1,null,fp,'[]','[]',true,repeat('x',4001),null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 -- A missing AI score is not a human confirmation, even through a direct RPC caller.
 correction:=jsonb_build_object('criterion_key','credit_pull_consent','disposition','confirmed','corrected_value',null,'reason',null);
 begin perform public.submit_full_qa_review('CALL-DECISION',1,null,fp,jsonb_build_array(correction),'[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 correction:=jsonb_build_object('criterion_key','accurate_representations','disposition','confirmed','corrected_value','fail','reason',null);
 begin perform public.submit_full_qa_review('CALL-DECISION',1,null,fp,jsonb_build_array(correction,correction),'[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 perform public.submit_full_qa_review('CALL-DECISION',1,null,fp,'[]','[]',false,'The customer gave consent earlier in the call.',null,null,null);
 saved:=public.get_full_qa_review_context('CALL-DECISION')->'review';
 if saved->>'escalation_justified'<>'false' or saved->'escalation_inaccuracy_reason'<>'null'::jsonb then raise exception 'explanation-only disagreement changed'; end if;
 finding:=jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000020','category','compliance',
  'related_criteria',jsonb_build_array('accurate_representations'),'summary','The outcome guarantee is misleading.','evidence','The agent guaranteed a debt-free date.');
 -- One issue is valid without coaching and without manufacturing a second issue.
 perform public.submit_full_qa_review('CALL-DECISION',2,null,fp,jsonb_build_array(correction),jsonb_build_array(finding),true,'The guarantee is wrong; the interest explanation was qualified.',null,null,null);
 saved:=public.get_full_qa_review_context('CALL-DECISION')->'review';
 if jsonb_array_length(saved->'corrections')<>1 or jsonb_array_length(saved->'findings')<>1 or saved->'action_taken'<>'null'::jsonb then raise exception 'optional single finding changed'; end if;
 begin perform public.submit_full_qa_review('CALL-DECISION',3,null,fp,'[]','[]',true,'',null,'coached',null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 -- A call-level follow-up does not require re-entering individual findings.
 perform public.submit_full_qa_review('CALL-DECISION',3,null,fp,'[]','[]',true,'',null,'follow_up_later','Discuss the call at the next scheduled one-to-one.');
 saved:=public.get_full_qa_review_context('CALL-DECISION')->'review';
 if saved->>'action_taken'<>'follow_up_later' or saved->'findings'<>'[]'::jsonb then raise exception 'call-level follow-up lost'; end if;
end $$;
-- Old detailed reviews and overview text still round-trip without truncating findings.
-- The bounded overview must save through the unchanged RPC without truncating the actual findings.
do $$ declare findings jsonb; overview text; saved jsonb; suffix text:='… See coaching issues for full details.'; begin
 findings:=jsonb_build_array(
  jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000010','category','compliance','related_criteria',jsonb_build_array('credit_pull_consent'),
   'summary','Credit was pulled without consent.'||repeat(' Detail.',400),'evidence','The customer refused permission before the credit pull.'),
  jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000011','category','compliance','related_criteria',jsonb_build_array('accurate_representations'),
   'summary','The agent guaranteed a debt-free date.'||repeat(' Context.',400),'evidence','The agent promised a guaranteed completion date.'));
 overview:=left((findings->0->>'summary')||E'\n\n'||(findings->1->>'summary'),4000-char_length(suffix))||suffix;
 perform public.submit_full_qa_review('CALL-STREAMLINED',0,null,fingerprint,corrections,findings,true,overview,null,
  'no_action_needed','Reviewed the issues; existing coaching already addresses both.')
 from review_fixture where call_id='CALL-STREAMLINED';
 saved:=public.get_full_qa_review_context('CALL-STREAMLINED')->'review';
 if saved->'findings' is distinct from findings or saved->>'escalation_reason' is distinct from overview
   or char_length(saved->>'escalation_reason')<>4000 then raise exception 'streamlined review lost issue details or overview'; end if;
end $$;
-- Dismiss the unnecessary escalation while retaining a confirmed finding and coaching action.
select public.submit_full_qa_review('CALL-COACHED',0,null,fingerprint,corrections,
 jsonb_build_array(jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000001','category','compliance','related_criteria',jsonb_build_array('credit_pull_consent'),'summary','Consent context requires manager coaching.','evidence','The synthetic call contains a distinct consent issue.')),
 false,'Escalation was unnecessary, but the consent issue is real.','wrong_context','coached','Reviewed the consent requirement with the representative.')
from review_fixture where call_id='CALL-COACHED';
-- Exact retry is safe.
do $$ declare r jsonb; begin
 select public.submit_full_qa_review('CALL-COACHED',0,null,fingerprint,corrections,
  jsonb_build_array(jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000001','category','compliance','related_criteria',jsonb_build_array('credit_pull_consent'),'summary','Consent context requires manager coaching.','evidence','The synthetic call contains a distinct consent issue.')),
  false,'Escalation was unnecessary, but the consent issue is real.','wrong_context','coached','Reviewed the consent requirement with the representative.') into r
 from review_fixture where call_id='CALL-COACHED';
 if not (r->>'idempotent')::boolean then raise exception 'retry was not idempotent'; end if;
 -- A changed false-escalation reason is not an exact replay.
 begin
  select public.submit_full_qa_review('CALL-COACHED',0,null,fingerprint,corrections,
   jsonb_build_array(jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000001','category','compliance','related_criteria',jsonb_build_array('credit_pull_consent'),'summary','Consent context requires manager coaching.','evidence','The synthetic call contains a distinct consent issue.')),
   false,'Escalation was unnecessary, but the consent issue is real.','other','coached','Reviewed the consent requirement with the representative.') into r
  from review_fixture where call_id='CALL-COACHED';
  raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_STALE_REVIEW' then raise; end if; end;
end $$;
-- SQL/JSON nulls and duplicate IDs cannot bypass validation.
do $$ declare corr jsonb; fp text; finding jsonb; begin
 select corrections,fingerprint into corr,fp from review_fixture where call_id='CALL-PENDING';
 finding:=jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000009','category','compliance','related_criteria',jsonb_build_array('credit_pull_consent'),'summary','A distinct consent finding is retained.','evidence','Synthetic consent evidence is available for review.');
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,null,corr,'[]',false,'Escalation is not justified after review.','other',null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,null,'[]',false,'Escalation is not justified after review.','other',null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,null,false,'Escalation is not justified after review.','other',null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,jsonb_build_array(finding||jsonb_build_object('category',null)),false,'Escalation is not justified after review.','other','coached','Coaching details exist for the retained finding.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,jsonb_build_array(finding,finding),true,'Duplicate IDs cannot manufacture an escalation threshold.',null,'coached','Coaching details exist for the retained finding.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,jsonb_build_array(
   finding,
   finding||jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000010','related_criteria',jsonb_build_array('credit_pull_consent'),'summary','  A DISTINCT consent finding  is retained. ','evidence','Synthetic consent evidence is available for review.')),
   true,'Generated IDs cannot make duplicate normalized findings distinct.',null,'coached','Coaching details exist for the retained finding.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,jsonb_build_array(finding),false,'short',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,jsonb_build_array(finding),false,'Escalation is not justified after review.','other',null,'Coaching details exist for the retained finding.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
end $$;
-- Two genuinely different findings may share a criterion and justify escalation.
do $$ declare corr jsonb; fp text; begin
 select corrections,fingerprint into corr,fp from review_fixture where call_id='CALL-DISTINCT';
 perform public.submit_full_qa_review('CALL-DISTINCT',0,null,fp,corr,jsonb_build_array(
   jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000011','category','compliance','related_criteria',jsonb_build_array('accurate_representations'),'summary','The agent guaranteed a debt-free completion date.','evidence','The guarantee appears in the closing offer discussion.'),
   jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000012','category','compliance','related_criteria',jsonb_build_array('accurate_representations'),'summary','The agent misstated the proposed monthly payment.','evidence','The quoted payment differs from the saved offer terms.')),
   true,'Two distinct compliance findings justify this escalation.',null,'coached','The manager coached both separate representation issues.');
end $$;
-- Needs-context is preserved, and stale source/revision tokens fail without changing data.
do $$ declare corr jsonb; fp text; begin
 select corrections,fingerprint into corr,fp from review_fixture where call_id='CALL-AFTER';
 corr:=jsonb_set(corr,'{1}',jsonb_build_object('criterion_key','credit_pull_consent','disposition','needs_context','corrected_value',null,'reason','Audio is unavailable, so consent cannot be confirmed.'));
 perform public.submit_full_qa_review('CALL-AFTER',0,null,fp,corr,
  jsonb_build_array(jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000002','category','compliance','related_criteria',jsonb_build_array('accurate_representations'),'summary','A distinct representation was inaccurate.','evidence','Synthetic evidence confirms the separate representation.')),
  false,'Only one issue was confirmed, so escalation is not justified.','evidence_misquoted','no_action_needed','Manager documented the issue for the next review.');
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,repeat('0',64),corr,'[]',false,'No escalation is justified after review.','other',null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_STALE_FULL_QA_SOURCE' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-AFTER',0,null,fp,corr,'[]',false,'No escalation is justified after review.','other',null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_STALE_REVIEW' then raise; end if; end;
 select corrections,fingerprint into corr,fp from review_fixture where call_id='CALL-PENDING';
 perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,
  jsonb_build_array(jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000003','category','compliance','related_criteria',jsonb_build_array('credit_pull_consent'),'summary','A pending consent finding needs approval.','evidence','Synthetic evidence supports manager review only.')),
  false,'Only one issue is retained, so escalation is not justified.','other','no_action_needed','The manager documented this pending finding for review.');
 select corrections,fingerprint into corr,fp from review_fixture where call_id='CALL-MISSING';
 perform public.submit_full_qa_review('CALL-MISSING',0,null,fp,corr,
  jsonb_build_array(jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000004','category','compliance','related_criteria',jsonb_build_array('credit_pull_consent'),'summary','A missing-time finding remains visible.','evidence','Synthetic evidence exists but call timing is absent.')),
  false,'Only one issue is retained, so escalation is not justified.','other','no_action_needed','The manager documented the issue without a call timestamp.');
end $$;
reset role;
-- Reviewed source/revision rows are immutable and later ingestion changes cannot replace displayed evidence.
do $$ begin
 begin update public.eavesly_full_qa_review_revisions set source_result_json='{}'; raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_FULL_QA_IMMUTABLE' then raise; end if; end;
 update public.eavesly_module_results set result_json=result_json||jsonb_build_object('late_ingestion_change',true) where call_id='CALL-COACHED';
end $$;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; original_fp text; begin
 ctx:=public.get_full_qa_review_context('CALL-COACHED');
 select fingerprint into original_fp from review_fixture where call_id='CALL-COACHED';
 if ctx->>'source_fingerprint'<>original_fp or ctx->'source_result_json' ? 'late_ingestion_change' then raise exception 'saved source snapshot was replaced'; end if;
end $$;
reset role;
-- Approve exact revision and confirm false escalation retains the finding.
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
select public.decide_internal_alert_feedback('CALL-COACHED','full_qa',1,'approved',null);
select public.decide_internal_alert_feedback('CALL-AFTER','full_qa',1,'approved',null);
reset role;
-- A later edit/reapproval must not erase the immutable original coaching proxy.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; begin
 ctx:=public.get_full_qa_review_context('CALL-COACHED');
 perform public.submit_full_qa_review('CALL-COACHED',1,1,ctx->>'source_fingerprint',ctx->'review'->'corrections',ctx->'review'->'findings',false,
  'Escalation remains unnecessary after a second review.','wrong_context','no_action_needed','The prior coaching record remains preserved in revision history.');
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
select public.decide_internal_alert_feedback('CALL-COACHED','full_qa',2,'approved',null);
do $$ declare rows jsonb; coached jsonb; after_row jsonb; anchor timestamptz:=clock_timestamp(); begin
 rows:=public.full_qa_finding_occurrences('agent@example.test',anchor-interval '30 days',anchor+interval '30 days');
 select x into coached from jsonb_array_elements(rows)x where x->>'call_id'='CALL-COACHED' and x->>'occurrence_kind'='finding';
 select x into after_row from jsonb_array_elements(rows)x where x->>'call_id'='CALL-AFTER' and x->>'occurrence_kind'='finding';
 if coached->>'confirmed'<>'true' or coached->>'action_taken'<>'no_action_needed' then raise exception 'approved false alert finding absent'; end if;
 if after_row->>'coaching_timing'<>'after_recorded_coached_review' or after_row->>'coaching_review_proxy_saved_at' is null then raise exception 'immutable coaching proxy was not retained'; end if;
 if not exists(select 1 from jsonb_array_elements(rows)x where x->>'call_id'='CALL-AFTER' and x->>'occurrence_kind'='needs_context' and x->>'confirmed'='false') then raise exception 'needs-context row hidden'; end if;
 if not exists(select 1 from jsonb_array_elements(rows)x where x->>'call_id'='CALL-LEGACY' and x->>'status'='legacy_unmapped') then raise exception 'legacy unmapped row hidden'; end if;
 if not exists(select 1 from jsonb_array_elements(rows)x where x->>'call_id'='CALL-PENDING' and x->>'status'='pending' and x->>'coaching_timing'='before_or_same_as_recorded_coached_review') then raise exception 'pending/before occurrence hidden'; end if;
 if not exists(select 1 from jsonb_array_elements(rows)x where x->>'call_id'='CALL-MISSING' and x->>'call_started_at' is null and x->>'coaching_timing'='unknown') then raise exception 'missing time was fabricated or hidden'; end if;
end $$;
reset role;
-- Establish a legacy reference before a new catalog exists.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
select public.submit_full_qa_review('CALL-LEGACY',1,null,fingerprint,corrections,'[]',false,
 'This legacy call has no confirmed escalation findings.','other',null,null)
from review_fixture where call_id='CALL-LEGACY';
reset role;
-- A later catalog version must not retarget a proposal or saved review reference.
insert into public.eavesly_full_qa_rubric_catalog(prompt_sha256,module_name,contract_version,prompt_text,criteria_manifest)
select encode(extensions.digest(convert_to(prompt_text||E'\nFuture candidate catalog fixture.','UTF8'),'sha256'),'hex'),module_name,2,
  prompt_text||E'\nFuture candidate catalog fixture.',jsonb_set(criteria_manifest,'{0,rule}',to_jsonb('Future rule must not leak into an older review proposal.'::text))
from public.eavesly_full_qa_rubric_catalog where contract_version=1;
-- Candidate proposal decision is one-time and never mutates either catalog entry.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; r jsonb; corr jsonb; fp text; begin
 ctx:=public.get_full_qa_review_context('CALL-LEGACY');
 if ctx->>'reference_prompt_sha256'<>'1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37' then raise exception 'legacy displayed reference moved'; end if;
 r:=public.submit_full_qa_review('CALL-LEGACY',2,null,ctx->>'source_fingerprint',ctx->'review'->'corrections','[]',false,
  'The legacy review remains tied to the displayed reference.','other',null,null);
 ctx:=public.get_full_qa_review_context('CALL-LEGACY');
 if ctx->>'reference_prompt_sha256'<>'1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37'
   or ctx->'review'->>'feedback_revision'<>'3' then raise exception 'legacy edit silently switched its rubric'; end if;
 -- An unsaved unknown-hash review cannot use a stale field map after the catalog changes.
 select corrections,fingerprint into corr,fp from review_fixture where call_id='CALL-UNKNOWN';
 begin perform public.submit_full_qa_review('CALL-UNKNOWN',0,null,fp,corr,'[]',false,
  'An obsolete reference must require an explicit reload.','other',null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_STALE_FULL_QA_SOURCE' then raise; end if; end;
end $$;
create temporary table proposal_cache as select public.propose_full_qa_rule('CALL-COACHED',2,'credit_pull_consent','Require explicit audio-context abstention when consent cannot be heard.','This prevents unavailable audio from becoming a confirmed failure.') result;
reset role;
do $$ begin
 if exists(select 1 from public.eavesly_full_qa_rule_proposals p where p.source_prompt_sha256<>'1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37'
   or p.source_current_criterion->>'rule' like 'Future rule%') then raise exception 'proposal was retargeted to a later catalog'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
do $$ declare pid bigint; first_result jsonb; retry jsonb; begin
 select (result->>'proposal_id')::bigint into pid from proposal_cache;
 first_result:=public.decide_full_qa_rule_proposal(pid,'pending','accepted_for_evaluation','Approved only for bounded candidate evaluation.');
 retry:=public.decide_full_qa_rule_proposal(pid,'pending','accepted_for_evaluation','Approved only for bounded candidate evaluation.');
 if (first_result->>'idempotent')::boolean or not (retry->>'idempotent')::boolean then raise exception 'proposal retry contract failed'; end if;
 begin perform public.decide_full_qa_rule_proposal(pid,'pending','rejected','A conflicting decision must never overwrite.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_RULE_PROPOSAL_DECISION_CONFLICT' then raise; end if; end;
end $$;
reset role;
do $$ begin
 if (select encode(extensions.digest(convert_to(prompt_text,'UTF8'),'sha256'),'hex') from public.eavesly_full_qa_rubric_catalog where contract_version=1)
   <> '1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37' then raise exception 'proposal mutated production prompt'; end if;
end $$;
-- Sparse review approval uses the same decision lock; call-level coaching is not category evidence.
insert into public.eavesly_calls(call_id,agent_email,started_at) values('CALL-DECISION','decision-agent@example.test',clock_timestamp()+interval '1 day');
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; begin
 ctx:=public.get_full_qa_review_context('CALL-DECISION');
 perform public.submit_full_qa_review('CALL-DECISION',4,null,ctx->>'source_fingerprint','[]','[]',true,'',null,null,null);
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
create temporary table decision_only_approval as select public.decide_internal_alert_feedback('CALL-DECISION','full_qa',5,'approved',null) result;
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; decision_id bigint; begin
 ctx:=public.get_full_qa_review_context('CALL-DECISION');
 select (result->>'decision_id')::bigint into decision_id from decision_only_approval;
 begin perform public.submit_full_qa_review('CALL-DECISION',5,null,ctx->>'source_fingerprint','[]','[]',true,'',null,'coached','Discussed the call with the agent in our one-to-one.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_STALE_REVIEW' then raise; end if; end;
 perform public.submit_full_qa_review('CALL-DECISION',5,decision_id,ctx->>'source_fingerprint','[]','[]',true,'',null,'coached','Discussed the call with the agent in our one-to-one.');
 if not exists(select 1 from public.eavesly_alerts_with_feedback where call_id='CALL-DECISION' and review_revision=6 and current_decision is null)
  then raise exception 'sparse review edit did not return to pending approval'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
update decision_only_approval set result=public.decide_internal_alert_feedback('CALL-DECISION','full_qa',6,'approved',null);
do $$ declare saved jsonb; begin
 saved:=public.get_full_qa_review_context('CALL-DECISION')->'review';
 if saved->>'action_taken'<>'coached' or saved->'findings'<>'[]'::jsonb then raise exception 'call-level coaching lost'; end if;
 if public.full_qa_finding_occurrences('decision-agent@example.test',clock_timestamp()-interval '30 days',clock_timestamp()+interval '30 days')<>'[]'::jsonb
  then raise exception 'call-level coaching invented category findings'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; decision_id bigint; finding jsonb; begin
 ctx:=public.get_full_qa_review_context('CALL-DECISION');
 select (result->>'decision_id')::bigint into decision_id from decision_only_approval;
 finding:=jsonb_build_object('finding_id','00000000-0000-4000-8000-000000000021','category','compliance',
  'related_criteria',jsonb_build_array('accurate_representations'),'summary','The outcome guarantee is misleading.','evidence','The agent guaranteed a debt-free date.');
 perform public.submit_full_qa_review('CALL-DECISION',6,decision_id,ctx->>'source_fingerprint','[]',jsonb_build_array(finding),true,'',null,null,null);
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
select public.decide_internal_alert_feedback('CALL-DECISION','full_qa',7,'approved',null);
do $$ declare rows jsonb; begin
 rows:=public.full_qa_finding_occurrences('decision-agent@example.test',clock_timestamp()-interval '30 days',clock_timestamp()+interval '30 days');
 if jsonb_array_length(rows)<>1 or rows->0->>'coaching_timing'<>'no_prior_recorded_coaching'
  or rows->0->'coaching_review_proxy_saved_at'<>'null'::jsonb then raise exception 'unlinked coaching was attributed to a category'; end if;
end $$;
reset role;
-- Partly correct is explicit mixed feedback, never a replacement score or a confirmed finding.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; correction jsonb; bad jsonb; saved jsonb; result jsonb; begin
 ctx:=public.get_full_qa_review_context('CALL-PARTLY');
 correction:=jsonb_build_object('criterion_key','accurate_representations','disposition','partially_correct','corrected_value',null,
  'reason',repeat('😀',4000));
 perform public.submit_full_qa_review('CALL-PARTLY',0,null,ctx->>'source_fingerprint',jsonb_build_array(correction),'[]',true,'',null,null,null);
 saved:=public.get_full_qa_review_context('CALL-PARTLY');
 if saved->'review'->'corrections' is distinct from jsonb_build_array(correction) or saved->'review'->'findings'<>'[]'::jsonb
  or saved->'review'->'action_taken'<>'null'::jsonb or saved->'source_result_json' is distinct from ctx->'source_result_json'
  then raise exception 'mixed feedback changed the score or manufactured coaching'; end if;
 result:=public.submit_full_qa_review('CALL-PARTLY',0,null,ctx->>'source_fingerprint',jsonb_build_array(correction),'[]',true,'',null,null,null);
 if result->>'idempotent'<>'true' then raise exception 'mixed feedback retry not idempotent'; end if;
 for bad in select value from jsonb_array_elements(jsonb_build_array(
   correction||jsonb_build_object('reason',''), correction||jsonb_build_object('reason',null),
   correction||jsonb_build_object('reason','short'), correction||jsonb_build_object('reason',repeat('x',4001)),
   correction||jsonb_build_object('reason',repeat('😀',6)), correction||jsonb_build_object('reason',repeat('😀',4001)),
   correction||jsonb_build_object('reason',123), correction||jsonb_build_object('corrected_value','pass'),
   correction||jsonb_build_object('corrected_value','fail'), correction||jsonb_build_object('criterion_key','not_a_criterion'),
   correction-'corrected_value', correction-'reason', correction||jsonb_build_object('disposition','unknown')))
 loop
  begin perform public.submit_full_qa_review('CALL-PARTLY',1,null,ctx->>'source_fingerprint',jsonb_build_array(bad),'[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 end loop;
 begin perform public.submit_full_qa_review('CALL-PARTLY',1,null,ctx->>'source_fingerprint',jsonb_build_array(correction,correction),'[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 if public.get_full_qa_review_context('CALL-PARTLY')->'review' is distinct from saved->'review' then raise exception 'invalid mixed feedback overwrote review'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
select public.decide_internal_alert_feedback('CALL-PARTLY','full_qa',1,'approved',null);
do $$ declare rows jsonb; begin
 rows:=public.full_qa_finding_occurrences('decision-agent@example.test',clock_timestamp()-interval '30 days',clock_timestamp()+interval '30 days');
 if exists(select 1 from jsonb_array_elements(rows)x where x->>'call_id'='CALL-PARTLY') then raise exception 'mixed feedback fabricated a recurrence or needs-context finding'; end if;
end $$;
reset role;
-- SQL projection stays byte-for-byte compatible with the client for malformed and scalar source shapes.
do $$ declare source jsonb; manifest jsonb; refs jsonb; item jsonb; begin
  source:=jsonb_build_object(
    'edge',jsonb_build_array(
      jsonb_build_object('quote',E'\n\t Quote \r','speaker',E'\tAgent\n','context',E'\n Context\t'),
      jsonb_build_object('quote',42,'context',jsonb_build_object('not','text')),true,jsonb_build_array(1),E' \t\n'),
    'scalar','Scalar note','null_value',null,'empty_array','[]'::jsonb,'empty_string',E' \t\n',
    'compliance_scorecard',jsonb_build_object('critical_red_flag_hits',jsonb_build_array(
      jsonb_build_object('red_flag',E'\n Scalar flag\t','evidence',jsonb_build_object('quote',E'\tFlag quote\n')))),
    'call_overview',jsonb_build_object('manager_focus_areas',null));
  manifest:=jsonb_build_array(
    jsonb_build_object('key','edge','label','Edge','evidence_path','edge'),
    jsonb_build_object('key','scalar','label','Scalar','evidence_path','scalar'),
    jsonb_build_object('key','null_value','label','Null','evidence_path','null_value'),
    jsonb_build_object('key','empty_array','label','Empty array','evidence_path','empty_array'),
    jsonb_build_object('key','empty_string','label','Empty string','evidence_path','empty_string'));
  refs:=private.full_qa_evidence_references(source,manifest,repeat('a',64));
  if jsonb_array_length(refs)<>10
    or exists(select 1 from jsonb_array_elements(refs) x where x->>'claim_kind'='general_focus') then
    raise exception 'JSON null manager focus emitted an evidence reference'; end if;
  select value into item from jsonb_array_elements(refs) where value->>'claim_key'='edge' and value->>'source_path'='edge[0]';
  if item->>'evidence_kind'<>'quote' or item->>'text'<>'Quote' or item->>'speaker'<>'Agent' or item->>'context'<>'Context' then
    raise exception 'evidence whitespace normalization diverged'; end if;
  if (select count(*) from jsonb_array_elements(refs) x where x->>'claim_key'='edge'
      and x->>'source_path' in ('edge[1]','edge[2]','edge[3]','edge[4]') and x->>'evidence_kind'='missing')<>4 then
    raise exception 'malformed array evidence lost its indexed provenance or was coerced to text'; end if;
  if not exists(select 1 from jsonb_array_elements(refs) x where x->>'claim_key'='scalar'
      and x->>'source_path'='scalar' and x->>'evidence_kind'='note' and x->>'text'='Scalar note')
    or not exists(select 1 from jsonb_array_elements(refs) x where x->>'claim_key'='null_value'
      and x->>'source_path'='null_value[missing]' and x->>'evidence_kind'='missing')
    or not exists(select 1 from jsonb_array_elements(refs) x where x->>'claim_key'='empty_array'
      and x->>'source_path'='empty_array[missing]' and x->>'evidence_kind'='missing')
    or not exists(select 1 from jsonb_array_elements(refs) x where x->>'claim_key'='empty_string'
      and x->>'source_path'='empty_string' and x->>'evidence_kind'='missing') then
    raise exception 'scalar or placeholder source paths diverged'; end if;
  if not exists(select 1 from jsonb_array_elements(refs) x where x->>'claim_kind'='critical_flag'
      and x->>'source_path'='compliance_scorecard.critical_red_flag_hits[0].evidence'
      and x->>'claim_label'='Scalar flag' and x->>'text'='Flag quote') then
    raise exception 'scalar critical evidence used a nonexistent array path'; end if;
end $$;
-- Evidence judgments stay bound to an exact readable occurrence + claim and survive legacy callers.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; other_ctx jsonb; consent_ref jsonb; representation_ref jsonb; general_ref jsonb; missing_ref jsonb; malformed_ref jsonb;
  feedback jsonb; normalized_feedback jsonb; saved jsonb; result jsonb; bad jsonb;
begin
  ctx:=public.get_full_qa_review_context('CALL-EVIDENCE');
  other_ctx:=public.get_full_qa_review_context('CALL-EVIDENCE-OTHER');
  select value into consent_ref from jsonb_array_elements(ctx->'evidence_references')
    where value->>'claim_kind'='criterion' and value->>'claim_key'='credit_pull_consent' and value->>'evidence_kind'='quote';
  select value into representation_ref from jsonb_array_elements(ctx->'evidence_references')
    where value->>'claim_kind'='criterion' and value->>'claim_key'='accurate_representations' and value->>'evidence_kind'='quote';
  select value into general_ref from jsonb_array_elements(ctx->'evidence_references')
    where value->>'claim_kind'='general_focus' and value->>'evidence_kind'='quote';
  select value into missing_ref from jsonb_array_elements(ctx->'evidence_references')
    where value->>'evidence_kind'='missing' limit 1;
  select value into malformed_ref from jsonb_array_elements(ctx->'evidence_references')
    where value->>'claim_kind'='general_focus' and value->>'claim_key'='1';
  if consent_ref->>'text'<>'The same saved words.' or representation_ref->>'text'<>'The same saved words.'
    or general_ref->>'text'<>'The same saved words.'
    or (select count(distinct value->>'reference_id') from jsonb_array_elements(jsonb_build_array(consent_ref,representation_ref,general_ref)))<>3
    or general_ref->>'claim_label'<>'General review focus (no specific claim saved)'
    or malformed_ref->>'evidence_kind'<>'missing' or malformed_ref->>'source_path'<>'call_overview.manager_focus_areas[1]' then
    raise exception 'identical evidence was merged or falsely associated'; end if;
  feedback:=jsonb_build_array(
    jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','correct','comment',null),
    jsonb_build_object('reference_id',representation_ref->>'reference_id','disposition','incorrect','comment','x'),
    jsonb_build_object('reference_id',general_ref->>'reference_id','disposition','partly_correct','comment','   '));
  normalized_feedback:=jsonb_build_array(feedback->0,feedback->1,
    jsonb_build_object('reference_id',general_ref->>'reference_id','disposition','partly_correct','comment',null));
  result:=public.submit_full_qa_review_with_evidence('CALL-EVIDENCE',0,null,ctx->>'source_fingerprint','[]',feedback,'[]',true,'',null,null,null);
  saved:=public.get_full_qa_review_context('CALL-EVIDENCE')->'review';
  if saved->'evidence_feedback' is distinct from normalized_feedback or saved->'corrections'<>'[]'::jsonb
    or saved->'findings'<>'[]'::jsonb then raise exception 'evidence feedback round trip failed'; end if;
  result:=public.submit_full_qa_review_with_evidence('CALL-EVIDENCE',0,null,ctx->>'source_fingerprint','[]',feedback,'[]',true,'',null,null,null);
  if result->>'idempotent'<>'true' then raise exception 'evidence feedback retry was not idempotent'; end if;
  begin perform public.submit_full_qa_review_with_evidence('CALL-EVIDENCE',1,null,ctx->>'source_fingerprint','[]',null,'[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_EVIDENCE_FEEDBACK' then raise; end if; end;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{}'::jsonb,'42'::jsonb,'[42]'::jsonb,
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','correct')),
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','correct','comment',null,'extra',true)),
    jsonb_build_array(jsonb_build_object('reference_id','fqae1|'||repeat('0',64)||'|criterion|credit_pull_consent|0','disposition','correct','comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',(select value->>'reference_id' from jsonb_array_elements(other_ctx->'evidence_references') where value->>'evidence_kind'<>'missing' limit 1),'disposition','correct','comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','correct','comment',null),jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','incorrect','comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','unknown','comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition',null,'comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',null,'disposition','correct','comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition',42,'comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','correct','comment',repeat('x',4001))),
    jsonb_build_array(jsonb_build_object('reference_id',consent_ref->>'reference_id','disposition','correct','comment',42)),
    jsonb_build_array(jsonb_build_object('reference_id',missing_ref->>'reference_id','disposition','correct','comment',null)),
    jsonb_build_array(jsonb_build_object('reference_id',malformed_ref->>'reference_id','disposition','incorrect','comment','Malformed placeholders are not evidence.'))
  )) loop
    begin perform public.submit_full_qa_review_with_evidence('CALL-EVIDENCE',1,null,ctx->>'source_fingerprint','[]',bad,'[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
    exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_EVIDENCE_FEEDBACK' then raise; end if; end;
  end loop;
  begin perform public.submit_full_qa_review_with_evidence('CALL-EVIDENCE',1,null,other_ctx->>'source_fingerprint','[]',feedback,'[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_STALE_FULL_QA_SOURCE' then raise; end if; end;
  -- The old RPC cannot erase evidence feedback when a stale open client saves a later revision.
  perform public.submit_full_qa_review('CALL-EVIDENCE',1,null,ctx->>'source_fingerprint','[]','[]',true,
    'Legacy client changed only the overall review note.',null,null,null);
  saved:=public.get_full_qa_review_context('CALL-EVIDENCE')->'review';
  if saved->'evidence_feedback' is distinct from normalized_feedback or saved->>'feedback_revision'<>'2'
    then raise exception 'legacy caller erased evidence feedback'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"director@trypennie.com"}',false);
set role authenticated;
create temporary table evidence_approval as select public.decide_internal_alert_feedback('CALL-EVIDENCE','full_qa',2,'approved',null) result;
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare ctx jsonb; begin
  ctx:=public.get_full_qa_review_context('CALL-EVIDENCE');
  begin perform public.submit_full_qa_review_with_evidence('CALL-EVIDENCE',2,null,ctx->>'source_fingerprint','[]',ctx->'review'->'evidence_feedback','[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_STALE_REVIEW' then raise; end if; end;
end $$;
reset role;
-- Out-of-scope actor cannot read recurrence or submit a decision-only review.
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","email":"outsider@trypennie.com"}',false);
set role authenticated;
do $$ declare anchor timestamptz:=clock_timestamp(); begin
 begin perform public.full_qa_finding_occurrences('agent@example.test',anchor-interval '30 days',anchor+interval '30 days'); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_FORBIDDEN' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-DECISION',4,null,repeat('0',64),'[]','[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_FORBIDDEN' then raise; end if; end;
 begin perform public.submit_full_qa_review_with_evidence('CALL-EVIDENCE',2,null,repeat('0',64),'[]','[]','[]',true,'',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_FORBIDDEN' then raise; end if; end;
end $$;
reset role;
select 'full-qa-rubric-feedback.integration.check.sh: all assertions passed' result;
SQL
cat "$repo_root/supabase/migrations/20260920120000_recording_word_timestamps.sql"
cat "$repo_root/supabase/tests/recording-word-timestamps.sql"
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
