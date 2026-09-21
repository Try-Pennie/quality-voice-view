-- Generated finding IDs do not make duplicate Full QA finding payloads distinct.
-- Keep genuinely different findings under the same criterion valid.
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create or replace function private.full_qa_validate_review(
  p_source jsonb, p_manifest jsonb, p_corrections jsonb, p_findings jsonb,
  p_escalation boolean, p_reason text, p_inaccuracy_reason text,
  p_action text, p_action_details text
) returns boolean language plpgsql immutable set search_path='' as $$
declare
  v_reason text := nullif(private.trim_internal_review_text(p_reason),'');
  v_action_details text := nullif(private.trim_internal_review_text(p_action_details),'');
  v_findings integer;
begin
  if p_source is null or p_manifest is null or p_corrections is null or p_findings is null or p_escalation is null
    or jsonb_typeof(p_corrections) is distinct from 'array' or jsonb_array_length(p_corrections)<>23
    or jsonb_typeof(p_findings) is distinct from 'array' or v_reason is null or char_length(v_reason) not between 12 and 4000 then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(p_corrections)) <> (select count(distinct c->>'criterion_key') from jsonb_array_elements(p_corrections)c)
    or exists (
      select 1 from jsonb_array_elements(p_corrections)c
      left join jsonb_array_elements(p_manifest)m on m->>'key'=c->>'criterion_key'
      where m is null or jsonb_typeof(c)<>'object' or (select count(*) from jsonb_object_keys(c))<>4
        or not (c ?& array['criterion_key','disposition','corrected_value','reason'])
        or c->>'criterion_key' is null or c->>'disposition' is null
        or c->>'disposition' not in ('confirmed','corrected','needs_context')
        or case c->>'disposition'
          when 'confirmed' then c->'corrected_value' is distinct from (p_source #> string_to_array(m->>'score_path','.')) or c->'reason'<>'null'::jsonb
          when 'corrected' then c->'corrected_value' is not distinct from (p_source #> string_to_array(m->>'score_path','.'))
            or not ((m->'domain') @> jsonb_build_array(c->'corrected_value'))
            or jsonb_typeof(c->'reason') is distinct from 'string' or char_length(private.trim_internal_review_text(c->>'reason')) not between 12 and 4000
          else c->'corrected_value'<>'null'::jsonb or jsonb_typeof(c->'reason') is distinct from 'string'
            or char_length(private.trim_internal_review_text(c->>'reason')) not between 12 and 4000 end
    ) then return false; end if;
  v_findings:=jsonb_array_length(p_findings);
  if (select count(distinct f->>'finding_id') from jsonb_array_elements(p_findings) f) <> v_findings then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(p_findings)f
    where jsonb_typeof(f)<>'object' or (select count(*) from jsonb_object_keys(f))<>5
      or not (f ?& array['finding_id','category','related_criteria','summary','evidence'])
      or coalesce(f->>'finding_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or f->>'finding_id' is null or f->>'category' is null
      or f->>'category' not in ('compliance','customer_experience','sales_process','program_expectations','severe_customer_mistreatment')
      or jsonb_typeof(f->'related_criteria') is distinct from 'array' or jsonb_array_length(f->'related_criteria')<1
      or (select count(*) from jsonb_array_elements_text(f->'related_criteria')) <> (select count(distinct x) from jsonb_array_elements_text(f->'related_criteria')x)
      or exists(select 1 from jsonb_array_elements_text(f->'related_criteria')x where not exists(select 1 from jsonb_array_elements(p_manifest)m where m->>'key'=x))
      or jsonb_typeof(f->'summary') is distinct from 'string' or char_length(private.trim_internal_review_text(f->>'summary')) not between 12 and 4000
      or jsonb_typeof(f->'evidence') is distinct from 'string' or char_length(private.trim_internal_review_text(f->>'evidence')) not between 12 and 4000
  ) then return false; end if;
  if (
    select count(*) <> count(distinct jsonb_build_object(
      'category', f->>'category',
      'related_criteria', (select jsonb_agg(value order by value) from jsonb_array_elements_text(f->'related_criteria')),
      'summary', lower(regexp_replace(private.trim_internal_review_text(f->>'summary'), '[[:space:]]+', ' ', 'g')),
      'evidence', lower(regexp_replace(private.trim_internal_review_text(f->>'evidence'), '[[:space:]]+', ' ', 'g'))
    ))
    from jsonb_array_elements(p_findings) f
  ) then return false; end if;
  if p_escalation and not (
    exists(select 1 from jsonb_array_elements(p_findings)f where f->>'category'='severe_customer_mistreatment')
    or (select count(distinct jsonb_build_object(
      'category', f->>'category',
      'related_criteria', (select jsonb_agg(value order by value) from jsonb_array_elements_text(f->'related_criteria')),
      'summary', lower(regexp_replace(private.trim_internal_review_text(f->>'summary'), '[[:space:]]+', ' ', 'g')),
      'evidence', lower(regexp_replace(private.trim_internal_review_text(f->>'evidence'), '[[:space:]]+', ' ', 'g'))
    )) from jsonb_array_elements(p_findings)f where f->>'category'='compliance')>=2
  ) then return false; end if;
  if (p_escalation and p_inaccuracy_reason is not null) or (not p_escalation and (p_inaccuracy_reason is null or p_inaccuracy_reason not in (
    'soft_inquiry_misclassified','wrong_context','evidence_misquoted','policy_does_not_apply','addressed_off_call','covered_not_verbatim','call_dropped_incomplete','other'))) then return false; end if;
  if (v_findings=0 and (p_action is not null or v_action_details is not null))
    or (v_findings>0 and (p_action is null or p_action not in ('coached','escalated','follow_up_later','no_action_needed')
      or v_action_details is null or char_length(v_action_details) not between 12 and 4000)) then return false; end if;
  return true;
end $$;
revoke all on function private.full_qa_validate_review(jsonb,jsonb,jsonb,jsonb,boolean,text,text,text,text) from public, anon, authenticated;
