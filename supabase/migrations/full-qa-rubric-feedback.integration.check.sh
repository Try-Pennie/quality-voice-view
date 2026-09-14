#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260918010000_full_qa_rubric_feedback.sql"
container="full-qa-rubric-check-$RANDOM-$$"
tmp="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$container" pg_isready -U postgres >/dev/null

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
insert into public.agent_manager_mapping values('agent@example.test','manager@trypennie.com');
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
 ('CALL-MISSING','4 days'),('CALL-UNKNOWN','5 days'),('CALL-LEGACY','6 days'))v(x,delta);
update public.eavesly_module_results set result_json=jsonb_set(result_json,'{_evaluation_provenance,prompt_sha256}',to_jsonb(repeat('f',64))) where call_id='CALL-UNKNOWN';
update public.eavesly_module_results set result_json=result_json-'_evaluation_provenance' where call_id='CALL-LEGACY';
insert into public.eavesly_calls(call_id,agent_email,started_at)
select x,'agent@example.test',anchor+delta from test_clock cross join (values
 ('CALL-COACHED','-2 days'::interval),('CALL-AFTER','2 days'),('CALL-PENDING','-3 days'),
 ('CALL-UNKNOWN','5 days'),('CALL-LEGACY','6 days'))v(x,delta);
insert into public.eavesly_alert_feedback(call_id,module_name,manager_email,accurate,inaccuracy_reason,comment)
values('CALL-LEGACY','full_qa','manager@trypennie.com',false,'wrong_context','Historic review without criterion mapping.');
SQL
cat "$repo_root/supabase/migrations/20260911120000_structured_manager_review.sql"
cat "$migration"
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
insert into context_cache select x,public.get_full_qa_review_context(x) from (values('CALL-COACHED'),('CALL-AFTER'),('CALL-PENDING'),('CALL-MISSING'),('CALL-UNKNOWN'),('CALL-LEGACY'))v(x);
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
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,jsonb_build_array(finding),false,'Escalation is not justified after review.',null,null,null); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
 begin perform public.submit_full_qa_review('CALL-PENDING',0,null,fp,corr,jsonb_build_array(finding),false,'Escalation is not justified after review.','other',null,'Coaching details exist for the retained finding.'); raise exception 'TEST_EXPECTED_FAILURE_MISSING'; exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_INVALID_FULL_QA_REVIEW' then raise; end if; end;
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
-- A later catalog version must not retarget a proposal away from its reviewed reference.
insert into public.eavesly_full_qa_rubric_catalog(prompt_sha256,module_name,contract_version,prompt_text,criteria_manifest)
select encode(extensions.digest(convert_to(prompt_text||E'\nFuture candidate catalog fixture.','UTF8'),'sha256'),'hex'),module_name,2,
  prompt_text||E'\nFuture candidate catalog fixture.',jsonb_set(criteria_manifest,'{0,rule}',to_jsonb('Future rule must not leak into an older review proposal.'::text))
from public.eavesly_full_qa_rubric_catalog where contract_version=1;
-- Candidate proposal decision is one-time and never mutates either catalog entry.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
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
-- Out-of-scope actor cannot read recurrence.
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","email":"outsider@trypennie.com"}',false);
set role authenticated;
do $$ declare anchor timestamptz:=clock_timestamp(); begin begin perform public.full_qa_finding_occurrences('agent@example.test',anchor-interval '30 days',anchor+interval '30 days'); raise exception 'TEST_EXPECTED_FAILURE_MISSING';
 exception when others then if sqlerrm='TEST_EXPECTED_FAILURE_MISSING' or sqlerrm<>'EAVESLY_FORBIDDEN' then raise; end if; end; end $$;
reset role;
select 'full-qa-rubric-feedback.integration.check.sh: all assertions passed' result;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
