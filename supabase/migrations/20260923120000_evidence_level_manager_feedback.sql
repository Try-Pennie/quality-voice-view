-- Optional manager judgments for exact Full QA evidence occurrence + claim pairs.
-- Existing revisions stay immutable. Legacy callers preserve the latest evidence feedback.
set local lock_timeout = '3s';
set local statement_timeout = '10s';

alter table public.eavesly_full_qa_review_revisions
  add column evidence_feedback jsonb not null default '[]'::jsonb;
alter table public.eavesly_full_qa_review_revisions
  add constraint eavesly_full_qa_review_evidence_feedback_array
  check (jsonb_typeof(evidence_feedback) = 'array') not valid;
alter table public.eavesly_full_qa_review_revisions
  validate constraint eavesly_full_qa_review_evidence_feedback_array;

create or replace function private.full_qa_trim_evidence_text(p_text text)
returns text language sql immutable strict set search_path='' as $$
  select btrim(p_text, ' '||chr(9)||chr(10)||chr(13)||chr(12)||chr(11))
$$;
revoke all on function private.full_qa_trim_evidence_text(text) from public,anon,authenticated;

create or replace function private.full_qa_evidence_references(
  p_source jsonb, p_manifest jsonb, p_fingerprint text
) returns jsonb language sql immutable set search_path='' as $$
with criterion_sources as (
  select criterion_order, criterion, p_source #> string_to_array(criterion->>'evidence_path','.') as raw_evidence
  from jsonb_array_elements(p_manifest) with ordinality as criteria(criterion, criterion_order)
), criterion_claims as (
  select 0 as kind_order, criterion_order::integer as claim_order, evidence_order::integer,
    evidence_order::integer as source_order, 'criterion'::text as claim_kind, criterion->>'key' as claim_key,
    criterion->>'label' as claim_label, criterion->>'evidence_path' as base_path, entries.value as evidence,
    case when jsonb_typeof(raw_evidence)='array' then jsonb_array_length(raw_evidence)>0 else false end as indexed,
    raw_evidence is null or jsonb_typeof(raw_evidence)='null'
      or case when jsonb_typeof(raw_evidence)='array' then jsonb_array_length(raw_evidence)=0 else false end as placeholder
  from criterion_sources
  cross join lateral jsonb_array_elements(case
    when jsonb_typeof(raw_evidence)='array' then
      case when jsonb_array_length(raw_evidence)>0 then raw_evidence else '[null]'::jsonb end
    when raw_evidence is null or jsonb_typeof(raw_evidence)='null' then '[null]'::jsonb
    else jsonb_build_array(raw_evidence) end
  ) with ordinality entries(value,evidence_order)
), critical_sources as (
  select flag_order, flag, flag->'evidence' as raw_evidence
  from jsonb_array_elements(case when jsonb_typeof(p_source#>'{compliance_scorecard,critical_red_flag_hits}')='array'
    then p_source#>'{compliance_scorecard,critical_red_flag_hits}' else '[]'::jsonb end)
    with ordinality flags(flag,flag_order)
), critical_claims as (
  select 1, flag_order::integer, evidence_order::integer, evidence_order::integer, 'critical_flag', (flag_order-1)::text,
    case when jsonb_typeof(flag->'red_flag')='string' then coalesce(nullif(private.full_qa_trim_evidence_text(flag->>'red_flag'),''),'Unlabeled critical flag') else 'Unlabeled critical flag' end,
    'compliance_scorecard.critical_red_flag_hits['||(flag_order-1)||'].evidence', entries.value,
    case when jsonb_typeof(raw_evidence)='array' then jsonb_array_length(raw_evidence)>0 else false end,
    raw_evidence is null or jsonb_typeof(raw_evidence)='null'
      or case when jsonb_typeof(raw_evidence)='array' then jsonb_array_length(raw_evidence)=0 else false end
  from critical_sources
  cross join lateral jsonb_array_elements(case
    when jsonb_typeof(raw_evidence)='array' then
      case when jsonb_array_length(raw_evidence)>0 then raw_evidence else '[null]'::jsonb end
    when raw_evidence is null or jsonb_typeof(raw_evidence)='null' then '[null]'::jsonb
    else jsonb_build_array(raw_evidence) end
  ) with ordinality entries(value,evidence_order)
), focus_sources as (
  select focus_order, evidence,
    jsonb_typeof(p_source#>'{call_overview,manager_focus_areas}')='array' as indexed
  from jsonb_array_elements(case
    when jsonb_typeof(p_source#>'{call_overview,manager_focus_areas}')='array' then p_source#>'{call_overview,manager_focus_areas}'
    when p_source#>'{call_overview,manager_focus_areas}' is null
      or jsonb_typeof(p_source#>'{call_overview,manager_focus_areas}')='null' then '[]'::jsonb
    else jsonb_build_array(p_source#>'{call_overview,manager_focus_areas}') end
  ) with ordinality focus(evidence,focus_order)
), focus_claims as (
  select 2, focus_order::integer, 1, focus_order::integer, 'general_focus', (focus_order-1)::text,
    'General review focus (no specific claim saved)', 'call_overview.manager_focus_areas', evidence, indexed, false
  from focus_sources
), claims as (
  select * from criterion_claims union all select * from critical_claims union all select * from focus_claims
), classified as (
  select *, case
      when jsonb_typeof(evidence)='object' and jsonb_typeof(evidence->'quote')='string'
        and nullif(private.full_qa_trim_evidence_text(evidence->>'quote'),'') is not null then 'quote'
      when jsonb_typeof(evidence)='string'
        and nullif(private.full_qa_trim_evidence_text(evidence#>>'{}'),'') is not null then 'note'
      when jsonb_typeof(evidence)='object' and jsonb_typeof(evidence->'context')='string'
        and nullif(private.full_qa_trim_evidence_text(evidence->>'context'),'') is not null then 'note'
      else 'missing' end as evidence_kind
  from claims
)
select coalesce(jsonb_agg(jsonb_build_object(
  'reference_id','fqae1|'||p_fingerprint||'|'||claim_kind||'|'||claim_key||'|'||(evidence_order-1),
  'claim_kind',claim_kind,'claim_key',claim_key,'claim_label',claim_label,
  'source_path',case when placeholder then base_path||'[missing]'
    when indexed then base_path||'['||(source_order-1)||']' else base_path end,
  'evidence_kind',evidence_kind,
  'text',case when evidence_kind='quote' then nullif(private.full_qa_trim_evidence_text(evidence->>'quote'),'')
    when jsonb_typeof(evidence)='string' then nullif(private.full_qa_trim_evidence_text(evidence#>>'{}'),'')
    when evidence_kind='note' then nullif(private.full_qa_trim_evidence_text(evidence->>'context'),'') end,
  'speaker',case when jsonb_typeof(evidence)='object' and jsonb_typeof(evidence->'speaker')='string'
    then nullif(private.full_qa_trim_evidence_text(evidence->>'speaker'),'') end,
  'context',case when evidence_kind='quote' and jsonb_typeof(evidence->'context')='string'
    then nullif(private.full_qa_trim_evidence_text(evidence->>'context'),'') end,
  'process_step',case when jsonb_typeof(evidence)='object' and jsonb_typeof(evidence->'process_step')='string'
    then nullif(private.full_qa_trim_evidence_text(evidence->>'process_step'),'') end
) order by kind_order,claim_order,evidence_order),'[]'::jsonb) from classified
$$;
revoke all on function private.full_qa_evidence_references(jsonb,jsonb,text) from public,anon,authenticated;

create or replace function private.full_qa_normalize_evidence_feedback(p_feedback jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'reference_id',item->>'reference_id','disposition',item->>'disposition',
    'comment',case when item->'comment'='null'::jsonb then null else nullif(private.trim_internal_review_text(item->>'comment'),'') end
  ) order by ordinality),'[]'::jsonb)
  from jsonb_array_elements(p_feedback) with ordinality feedback(item,ordinality)
$$;
revoke all on function private.full_qa_normalize_evidence_feedback(jsonb) from public,anon,authenticated;

create or replace function private.full_qa_validate_evidence_feedback(
  p_source jsonb, p_manifest jsonb, p_fingerprint text, p_feedback jsonb
) returns boolean language plpgsql immutable set search_path='' as $$
declare v_references jsonb;
begin
  if jsonb_typeof(p_feedback) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_feedback)>500 then return false; end if;
  if (select count(*) from jsonb_array_elements(p_feedback))
    <> (select count(distinct item->>'reference_id') from jsonb_array_elements(p_feedback) item) then return false; end if;
  v_references:=private.full_qa_evidence_references(p_source,p_manifest,p_fingerprint);
  if exists(
    select 1 from jsonb_array_elements(p_feedback) item
    left join jsonb_array_elements(v_references) reference on reference->>'reference_id'=item->>'reference_id'
    where case when jsonb_typeof(item)<>'object' then true else
      (select count(*) from jsonb_object_keys(item))<>3
      or not (item ?& array['reference_id','disposition','comment'])
      or jsonb_typeof(item->'reference_id') is distinct from 'string'
      or jsonb_typeof(item->'disposition') is distinct from 'string'
      or item->>'disposition' not in ('correct','incorrect','partly_correct')
      or reference is null or reference->>'evidence_kind'='missing'
      or not (item->'comment'='null'::jsonb or (jsonb_typeof(item->'comment')='string'
        and char_length(private.trim_internal_review_text(item->>'comment')) between 0 and 4000)) end
  ) then return false; end if;
  return true;
end $$;
revoke all on function private.full_qa_validate_evidence_feedback(jsonb,jsonb,text,jsonb) from public,anon,authenticated;

create or replace function private.full_qa_set_evidence_feedback()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_requested text; v_manifest jsonb; v_feedback jsonb;
begin
  v_requested:=nullif(current_setting('eavesly.full_qa_evidence_feedback',true),'');
  select c.criteria_manifest into v_manifest from public.eavesly_full_qa_rubric_catalog c
    where c.prompt_sha256=new.rubric_reference_prompt_sha256;
  if v_requested is not null then v_feedback:=v_requested::jsonb;
  else
    select r.evidence_feedback into v_feedback from public.eavesly_full_qa_review_revisions r
    where r.call_id=new.call_id and r.module_name=new.module_name and r.feedback_revision<new.feedback_revision
    order by r.feedback_revision desc limit 1;
    v_feedback:=coalesce(v_feedback,'[]'::jsonb);
  end if;
  if not private.full_qa_validate_evidence_feedback(new.source_result_json,v_manifest,new.source_fingerprint,v_feedback) then
    raise exception using errcode='P0001',message='EAVESLY_INVALID_FULL_QA_EVIDENCE_FEEDBACK';
  end if;
  new.evidence_feedback:=private.full_qa_normalize_evidence_feedback(v_feedback);
  return new;
end $$;
revoke all on function private.full_qa_set_evidence_feedback() from public,anon,authenticated;
create trigger eavesly_full_qa_review_evidence_feedback
before insert on public.eavesly_full_qa_review_revisions
for each row execute function private.full_qa_set_evidence_feedback();

create or replace function public.submit_full_qa_review_with_evidence(
  p_call_id text, p_expected_revision integer, p_expected_decision_id bigint,
  p_expected_source_fingerprint text, p_corrections jsonb, p_evidence_feedback jsonb,
  p_findings jsonb, p_escalation_justified boolean, p_escalation_reason text,
  p_inaccuracy_reason text, p_action text, p_action_details text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_feedback jsonb; v_result jsonb; v_saved jsonb;
begin
  v_context:=public.get_full_qa_review_context(p_call_id);
  if v_context->>'source_fingerprint' is distinct from p_expected_source_fingerprint then
    raise exception using errcode='P0001',message='EAVESLY_STALE_FULL_QA_SOURCE'; end if;
  if not private.full_qa_validate_evidence_feedback(v_context->'source_result_json',v_context->'criteria_manifest',
    p_expected_source_fingerprint,p_evidence_feedback) then
    raise exception using errcode='P0001',message='EAVESLY_INVALID_FULL_QA_EVIDENCE_FEEDBACK'; end if;
  v_feedback:=private.full_qa_normalize_evidence_feedback(p_evidence_feedback);
  perform set_config('eavesly.full_qa_evidence_feedback',v_feedback::text,true);
  v_result:=public.submit_full_qa_review(p_call_id,p_expected_revision,p_expected_decision_id,
    p_expected_source_fingerprint,p_corrections,p_findings,p_escalation_justified,p_escalation_reason,
    p_inaccuracy_reason,p_action,p_action_details);
  perform set_config('eavesly.full_qa_evidence_feedback','',true);
  if coalesce((v_result->>'idempotent')::boolean,false) then
    select r.evidence_feedback into v_saved from public.eavesly_full_qa_review_revisions r
    where r.call_id=p_call_id and r.module_name='full_qa' and r.feedback_revision=(v_result->>'review_revision')::integer;
    if v_saved is distinct from v_feedback then
      raise exception using errcode='P0001',message='EAVESLY_STALE_REVIEW'; end if;
  end if;
  return v_result;
end $$;
revoke all on function public.submit_full_qa_review_with_evidence(text,integer,bigint,text,jsonb,jsonb,jsonb,boolean,text,text,text,text) from public,anon;
grant execute on function public.submit_full_qa_review_with_evidence(text,integer,bigint,text,jsonb,jsonb,jsonb,boolean,text,text,text,text) to authenticated;

create or replace function public.get_full_qa_review_context(p_call_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor text:=private.internal_alert_actor_email(); v_result jsonb; v_feedback public.eavesly_alert_feedback%rowtype;
  v_review public.eavesly_full_qa_review_revisions%rowtype; v_hash text; v_catalog public.eavesly_full_qa_rubric_catalog%rowtype;
  v_kind text; v_proposals jsonb; v_fingerprint text;
begin
  if not private.alert_visible_to(v_actor,p_call_id,'full_qa') then raise exception using errcode='P0001',message='EAVESLY_FORBIDDEN'; end if;
  select m.result_json into v_result from public.eavesly_module_results m where m.call_id=p_call_id and m.module_name='full_qa' and m.alert_sent=true order by m.id limit 1;
  if not found then raise exception using errcode='P0001',message='EAVESLY_ALERT_NOT_FOUND'; end if;
  select f.* into v_feedback from public.eavesly_alert_feedback f where f.call_id=p_call_id and f.module_name='full_qa';
  if found then select r.* into v_review from public.eavesly_full_qa_review_revisions r where r.call_id=p_call_id and r.module_name='full_qa' and r.feedback_revision=v_feedback.review_revision;
    if found then v_result:=v_review.source_result_json; end if; end if;
  v_hash:=private.full_qa_prompt_hash(v_result);
  if v_review.call_id is not null then
    select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.prompt_sha256=v_review.rubric_reference_prompt_sha256;
    v_kind:=v_review.source_reference_kind;
  else
    select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.prompt_sha256=v_hash;
    if found then v_kind:='known';
    elsif v_hash is null then select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.module_name='full_qa' order by contract_version desc limit 1; v_kind:='legacy_current_reference';
    else select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.module_name='full_qa' order by contract_version desc limit 1; v_kind:='unknown_hash'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'criterion_key',p.criterion_key,'proposed_rule',p.proposed_rule,'why',p.why,
    'source_prompt_sha256',p.source_prompt_sha256,'source_current_criterion',p.source_current_criterion,'proposed_by',p.proposed_by,
    'proposed_at',p.proposed_at,'decision',p.decision,'decided_by',p.decided_by,'decided_at',p.decided_at,'decision_reason',p.decision_reason)
    order by p.proposed_at,p.id),'[]'::jsonb) into v_proposals from public.eavesly_full_qa_rule_proposals p where p.call_id=p_call_id and p.module_name='full_qa';
  v_fingerprint:=private.full_qa_fingerprint(jsonb_build_object('source',v_result,'rubric_reference',v_catalog.prompt_sha256));
  return jsonb_build_object('source_fingerprint',v_fingerprint,'source_result_json',v_result,
    'source_prompt_sha256',v_hash,'source_reference_kind',v_kind,'reference_prompt_sha256',v_catalog.prompt_sha256,
    'criteria_reference_kind',case when v_kind='known' then 'exact_evaluation_rubric' when v_kind='legacy_current_reference' then 'current_reference_only' else 'current_field_map_only' end,
    'rubric_prompt_text',case when v_kind='unknown_hash' then null else v_catalog.prompt_text end,
    'criteria_manifest',v_catalog.criteria_manifest,
    'evidence_references',private.full_qa_evidence_references(v_result,v_catalog.criteria_manifest,v_fingerprint),
    'review',case when v_review.call_id is null then null else jsonb_build_object(
      'feedback_revision',v_review.feedback_revision,'corrections',v_review.corrections,'evidence_feedback',v_review.evidence_feedback,'findings',v_review.findings,
      'escalation_justified',v_review.escalation_justified,'escalation_reason',v_review.escalation_reason,
      'escalation_inaccuracy_reason',v_review.escalation_inaccuracy_reason,
      'action_taken',v_review.action_taken,'action_details',v_review.action_details,'saved_by',v_review.saved_by,'saved_at',v_review.saved_at) end,
    'proposals',v_proposals);
end $$;

comment on column public.eavesly_full_qa_review_revisions.evidence_feedback is
  'Optional exact source-bound evidence occurrence + claim judgments; empty means untouched.';
comment on function public.submit_full_qa_review_with_evidence(text,integer,bigint,text,jsonb,jsonb,jsonb,boolean,text,text,text,text) is
  'Current Full QA review mutation. The legacy submit_full_qa_review RPC remains callable and preserves saved evidence feedback.';
