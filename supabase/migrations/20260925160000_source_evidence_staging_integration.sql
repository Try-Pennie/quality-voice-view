-- Source-linked six-rule evidence candidate adapter for isolated manager staging.
-- Candidate assessments remain unverified; only server-materialized source turns become evidence.
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create or replace function private.full_qa_jsonb_has_exact_keys(p_value jsonb, p_keys text[])
returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value) is distinct from 'object' then false else coalesce(
    (select count(*) from jsonb_object_keys(p_value))=cardinality(p_keys) and p_value ?& p_keys,
    false) end
$$;
revoke all on function private.full_qa_jsonb_has_exact_keys(jsonb,text[]) from public,anon,authenticated;

create or replace function private.full_qa_utf16_length(p_text text)
returns integer language sql immutable strict set search_path='' as $$
  select coalesce(sum(case when octet_length(character[1])=4 then 2 else 1 end),0)::integer
  from regexp_matches(p_text,'(?s)(.)','g') characters(character)
$$;
revoke all on function private.full_qa_utf16_length(text) from public,anon,authenticated;

create or replace function private.full_qa_source_candidate_valid(p_source jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare
  v_wrapper jsonb; v_candidate jsonb; v_metadata jsonb; v_index jsonb; v_transcript text; v_turns jsonb; v_findings jsonb;
  v_line text; v_raw_line text; v_raw_start integer:=0; v_raw_end integer; v_turn_index integer:=0; v_turn jsonb; v_match text[];
  v_finding jsonb; v_claim jsonb; v_occurrence jsonb; v_reviewed jsonb; v_turn_id text; v_resolved jsonb;
  v_previous_ordinal integer; v_seen_turns text[]; v_citations integer:=0;
begin
  if jsonb_typeof(p_source) is distinct from 'object' or not coalesce(p_source ? 'source_candidate',false) then return false; end if;
  v_wrapper:=p_source->'source_candidate';
  if not private.full_qa_jsonb_has_exact_keys(v_wrapper,array['candidate','transcript'])
    or jsonb_typeof(v_wrapper->'transcript') is distinct from 'string' then return false; end if;
  v_transcript:=v_wrapper->>'transcript';
  if char_length(v_transcript)<1 or char_length(v_transcript)>200000 then return false; end if;
  v_candidate:=v_wrapper->'candidate';
  if not private.full_qa_jsonb_has_exact_keys(v_candidate,array['metadata','source','findings']) then return false; end if;
  v_metadata:=v_candidate->'metadata'; v_index:=v_candidate->'source'; v_findings:=v_candidate->'findings';
  if not private.full_qa_jsonb_has_exact_keys(v_metadata,array['schema_version','index_version','prompt_version','prompt_sha256','rubric_version','model','provenance','prompt_role'])
    or v_metadata->>'schema_version' is distinct from 'full_qa_evidence_candidate_v1'
    or v_metadata->>'index_version' is distinct from 'full_qa_transcript_index_v1'
    or v_metadata->>'prompt_version' is distinct from 'full_qa_evidence_candidate_prompt_v1'
    or v_metadata->>'rubric_version' is distinct from 'full_qa_high_risk_subset_v1'
    or coalesce(v_metadata->>'prompt_sha256','') !~ '^[a-f0-9]{64}$'
    or v_metadata->>'provenance' is distinct from 'unverified_submission'
    or v_metadata->>'prompt_role' is distinct from 'contract_reference_not_execution_attestation'
    or not private.full_qa_jsonb_has_exact_keys(v_metadata->'model',array['provider','model_id','declared_by'])
    or jsonb_typeof(v_metadata#>'{model,provider}') is distinct from 'string'
    or char_length(btrim(v_metadata#>>'{model,provider}')) not between 1 and 200
    or jsonb_typeof(v_metadata#>'{model,model_id}') is distinct from 'string'
    or char_length(btrim(v_metadata#>>'{model,model_id}')) not between 1 and 500
    or v_metadata#>>'{model,declared_by}' is distinct from 'caller' then return false; end if;
  if not private.full_qa_jsonb_has_exact_keys(v_index,array['index_version','source_id','source_revision','source_fingerprint','transcript_sha256','offset_unit','raw_start','raw_end','turns'])
    or v_index->>'index_version' is distinct from 'full_qa_transcript_index_v1'
    or jsonb_typeof(v_index->'source_id') is distinct from 'string' or char_length(btrim(v_index->>'source_id')) not between 1 and 500
    or jsonb_typeof(v_index->'source_revision') is distinct from 'string' or char_length(btrim(v_index->>'source_revision')) not between 1 and 500
    or coalesce(v_index->>'source_fingerprint','') !~ '^[a-f0-9]{64}$'
    or coalesce(v_index->>'transcript_sha256','') !~ '^[a-f0-9]{64}$'
    or v_index->>'transcript_sha256' is distinct from encode(extensions.digest(convert_to(v_transcript,'UTF8'),'sha256'),'hex')
    or v_index->>'offset_unit' is distinct from 'utf16_code_unit'
    or jsonb_typeof(v_index->'raw_start') is distinct from 'number' or v_index->>'raw_start' is distinct from '0'
    or jsonb_typeof(v_index->'raw_end') is distinct from 'number'
    or v_index->>'raw_end' is distinct from private.full_qa_utf16_length(v_transcript)::text
    or jsonb_typeof(v_index->'turns') is distinct from 'array' or jsonb_array_length(v_index->'turns') not between 1 and 2000
    or jsonb_typeof(v_findings) is distinct from 'array' or jsonb_array_length(v_findings)>50 then return false; end if;
  v_turns:=v_index->'turns';

  -- Reconstruct every nonblank line so omitted source content and altered UTF-16 offsets fail closed.
  for v_line in select value from unnest(string_to_array(v_transcript,E'\n')) lines(value) loop
    v_raw_line:=case when right(v_line,1)=E'\r' then left(v_line,-1) else v_line end;
    v_raw_end:=v_raw_start+private.full_qa_utf16_length(v_raw_line);
    if btrim(v_raw_line,E' \t\n\r\f\v')<>'' then
      if v_turn_index>=jsonb_array_length(v_turns) then return false; end if;
      v_turn:=v_turns->v_turn_index;
      if not private.full_qa_jsonb_has_exact_keys(v_turn,array['ordinal','raw_start','raw_end','raw_text','text_start','text_end','text','speaker','turn_id'])
        or jsonb_typeof(v_turn->'ordinal') is distinct from 'number' or v_turn->>'ordinal' is distinct from v_turn_index::text
        or jsonb_typeof(v_turn->'raw_start') is distinct from 'number' or v_turn->>'raw_start' is distinct from v_raw_start::text
        or jsonb_typeof(v_turn->'raw_end') is distinct from 'number' or v_turn->>'raw_end' is distinct from v_raw_end::text
        or jsonb_typeof(v_turn->'raw_text') is distinct from 'string' or v_turn->>'raw_text' is distinct from v_raw_line
        or jsonb_typeof(v_turn->'text_start') is distinct from 'number' or jsonb_typeof(v_turn->'text_end') is distinct from 'number'
        or jsonb_typeof(v_turn->'text') is distinct from 'string'
        or v_turn->>'turn_id' is distinct from 'turn_v1_'||(v_index->>'source_fingerprint')||'_'||lpad(v_turn_index::text,6,'0')
        or not private.full_qa_jsonb_has_exact_keys(v_turn->'speaker',array['source_label','role','attribution_basis'])
        or jsonb_typeof(v_turn#>'{speaker,source_label}') is distinct from 'string'
        or coalesce(v_turn#>>'{speaker,role}' not in ('handling_agent','customer','transfer_agent','other'),true)
        or v_turn#>>'{speaker,attribution_basis}' is distinct from 'caller_supplied_not_identity_proof' then return false; end if;
      v_match:=regexp_match(v_raw_line,'^([[:space:]]*)\[([^]\r\n]+)\]([[:space:]]*):([[:space:]]*)(.+)$');
      if v_match is null or v_match[2] is distinct from v_turn#>>'{speaker,source_label}' or v_match[5] is distinct from v_turn->>'text'
        or v_turn->>'text_start' is distinct from (v_raw_start+private.full_qa_utf16_length(coalesce(v_match[1],''))+1
          +private.full_qa_utf16_length(v_match[2])+1+private.full_qa_utf16_length(coalesce(v_match[3],''))+1
          +private.full_qa_utf16_length(coalesce(v_match[4],'')))::text
        or v_turn->>'text_end' is distinct from (v_raw_start+private.full_qa_utf16_length(v_raw_line))::text then return false; end if;
      v_turn_index:=v_turn_index+1;
    end if;
    v_raw_start:=v_raw_start+private.full_qa_utf16_length(v_line)+1;
  end loop;
  if v_turn_index<>jsonb_array_length(v_turns) then return false; end if;

  if (select count(distinct finding->>'claim_id') from jsonb_array_elements(v_findings) finding)<>jsonb_array_length(v_findings)
    or exists(select 1 from jsonb_array_elements(v_findings) finding where coalesce(finding->>'claim_id','') !~ '^fqac1_[a-f0-9]{64}$')
    or (select count(distinct occurrence->>'evidence_id')
        from jsonb_array_elements(v_findings) finding cross join lateral jsonb_array_elements(finding->'evidence_occurrences') occurrence)
       <>(select count(*) from jsonb_array_elements(v_findings) finding cross join lateral jsonb_array_elements(finding->'evidence_occurrences') occurrence)
    or exists(select 1 from jsonb_array_elements(v_findings) finding cross join lateral jsonb_array_elements(finding->'evidence_occurrences') occurrence
      where coalesce(occurrence->>'evidence_id','') !~ '^fqae1_[a-f0-9]{64}$')
    or exists(select 1 from jsonb_array_elements(v_findings) finding
      group by finding#>>'{claim,finding_type}',finding#>>'{claim,rule_key}',
        jsonb_path_query_array(finding,'$.evidence_occurrences[*].supporting_turn_ids') having count(*)>1)
    then return false; end if;

  for v_finding in select value from jsonb_array_elements(v_findings) findings(value) loop
    if not private.full_qa_jsonb_has_exact_keys(v_finding,array['claim_id','claim','evidence_occurrences','reviewed_source'])
      or not private.full_qa_jsonb_has_exact_keys(v_finding->'claim',array['rule_key','finding_type','text','interpretation']) then return false; end if;
    v_claim:=v_finding->'claim';
    if coalesce(v_claim->>'rule_key' not in ('call_recording_disclosure','credit_pull_consent','outcome_guarantee','program_misrepresentation','negative_customer_treatment','unresolved_customer_confusion'),true)
      or coalesce(v_claim->>'finding_type' not in ('statement','omission'),true)
      or jsonb_typeof(v_claim->'text') is distinct from 'string' or char_length(v_claim->>'text') not between 1 and 2000
      or v_claim->>'text' is distinct from btrim(v_claim->>'text')
      or v_claim->>'interpretation' is distinct from 'unverified_ai_assessment_not_source_evidence'
      or jsonb_typeof(v_finding->'evidence_occurrences') is distinct from 'array' then return false; end if;
    if v_claim->>'finding_type'='statement' then
      if jsonb_array_length(v_finding->'evidence_occurrences') not between 1 and 20 or v_finding->'reviewed_source' is distinct from 'null'::jsonb then return false; end if;
    else
      if coalesce(v_claim->>'rule_key' not in ('call_recording_disclosure','credit_pull_consent'),true)
        or jsonb_array_length(v_finding->'evidence_occurrences')<>0 then return false; end if;
      v_reviewed:=v_finding->'reviewed_source';
      if not private.full_qa_jsonb_has_exact_keys(v_reviewed,array['source_fingerprint','transcript_sha256','raw_start','raw_end','interpretation'])
        or v_reviewed->>'source_fingerprint' is distinct from v_index->>'source_fingerprint'
        or v_reviewed->>'transcript_sha256' is distinct from v_index->>'transcript_sha256'
        or v_reviewed->>'raw_start' is distinct from '0' or v_reviewed->>'raw_end' is distinct from v_index->>'raw_end'
        or v_reviewed->>'interpretation' is distinct from 'ai_omission_hypothesis_scoped_to_supplied_source_not_proof_of_absence' then return false; end if;
    end if;
    v_previous_ordinal:=-1; v_seen_turns:=array[]::text[];
    for v_occurrence in select value from jsonb_array_elements(v_finding->'evidence_occurrences') occurrences(value) loop
      if not private.full_qa_jsonb_has_exact_keys(v_occurrence,array['evidence_id','supporting_turn_ids'])
        or jsonb_typeof(v_occurrence->'supporting_turn_ids') is distinct from 'array'
        or jsonb_array_length(v_occurrence->'supporting_turn_ids') not between 1 and 20 then return false; end if;
      for v_turn_id in select value from jsonb_array_elements_text(v_occurrence->'supporting_turn_ids') ids(value) loop
        v_citations:=v_citations+1;
        if v_citations>1000 or v_turn_id=any(v_seen_turns) then return false; end if;
        select value into v_resolved from jsonb_array_elements(v_turns) turns(value) where value->>'turn_id'=v_turn_id;
        if v_resolved is null or (v_resolved->>'ordinal')::integer<=v_previous_ordinal then return false; end if;
        v_previous_ordinal:=(v_resolved->>'ordinal')::integer; v_seen_turns:=array_append(v_seen_turns,v_turn_id);
      end loop;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end $$;
revoke all on function private.full_qa_source_candidate_valid(jsonb) from public,anon,authenticated;

-- Byte-for-byte legacy projection logic remains isolated from the candidate branch.
create or replace function private.full_qa_legacy_evidence_references(
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
revoke all on function private.full_qa_legacy_evidence_references(jsonb,jsonb,text) from public,anon,authenticated;

create or replace function private.full_qa_source_candidate_references(p_source jsonb,p_fingerprint text)
returns jsonb language sql immutable set search_path='' as $$
with candidate as (
  select p_source#>'{source_candidate,candidate}' value
), findings as (
  select finding, finding_order from candidate
  cross join lateral jsonb_array_elements(value->'findings') with ordinality f(finding,finding_order)
), projected_references as (
  select finding_order, occurrence_order, finding, occurrence, false omission
  from findings cross join lateral jsonb_array_elements(finding->'evidence_occurrences') with ordinality o(occurrence,occurrence_order)
  union all
  select finding_order, 1, finding, null::jsonb, true from findings where finding#>>'{claim,finding_type}'='omission'
), turns as (
  select turn from candidate cross join lateral jsonb_array_elements(value#>'{source,turns}') t(turn)
)
select coalesce(jsonb_agg(jsonb_build_object(
  'reference_id','fqae1|'||p_fingerprint||'|source_finding|'||(finding->>'claim_id')||'|'||case when omission then 'omission' else occurrence->>'evidence_id' end,
  'claim_kind','source_finding','claim_key',finding->>'claim_id',
  'claim_label',case finding#>>'{claim,rule_key}'
    when 'call_recording_disclosure' then 'Call recording disclosure'
    when 'credit_pull_consent' then 'Credit pull consent'
    when 'outcome_guarantee' then 'Outcome guarantee'
    when 'program_misrepresentation' then 'Program misrepresentation'
    when 'negative_customer_treatment' then 'Negative customer treatment'
    when 'unresolved_customer_confusion' then 'Unresolved customer confusion' end,
  'source_path','source_candidate.candidate.findings['||(finding_order-1)||'].'||case when omission then 'reviewed_source' else 'evidence_occurrences['||(occurrence_order-1)||']' end,
  'evidence_kind',case when omission then 'omission' else 'source_passages' end,
  'text',finding#>>'{claim,text}','speaker',null,'context',null,'process_step',finding#>>'{claim,rule_key}',
  'source_passages',case when omission then '[]'::jsonb else (
    select jsonb_agg(jsonb_build_object(
      'turn_id',turn->>'turn_id','ordinal',(turn->>'ordinal')::integer,
      'raw_start',(turn->>'raw_start')::integer,'raw_end',(turn->>'raw_end')::integer,
      'text_start',(turn->>'text_start')::integer,'text_end',(turn->>'text_end')::integer,
      'text',turn->>'text','speaker_source_label',turn#>>'{speaker,source_label}','speaker_role',turn#>>'{speaker,role}'
    ) order by turn_order)
    from jsonb_array_elements_text(occurrence->'supporting_turn_ids') with ordinality ids(turn_id,turn_order)
    join turns on turn->>'turn_id'=turn_id
  ) end
) order by finding_order,occurrence_order),'[]'::jsonb) from projected_references
$$;
revoke all on function private.full_qa_source_candidate_references(jsonb,text) from public,anon,authenticated;

-- Preserve this function's identity for existing compiled callers; branch only inside it.
create or replace function private.full_qa_evidence_references(
  p_source jsonb, p_manifest jsonb, p_fingerprint text
) returns jsonb language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_source)='object' and p_source ? 'source_candidate' then
    if not private.full_qa_source_candidate_valid(p_source) then
      raise exception using errcode='P0001',message='EAVESLY_INVALID_FULL_QA_SOURCE_CANDIDATE';
    end if;
    return private.full_qa_source_candidate_references(p_source,p_fingerprint);
  end if;
  return private.full_qa_legacy_evidence_references(p_source,p_manifest,p_fingerprint);
end $$;
revoke all on function private.full_qa_evidence_references(jsonb,jsonb,text) from public,anon,authenticated;

comment on function private.full_qa_source_candidate_valid(jsonb) is
  'Strict staging boundary for a materialized full_qa_evidence_candidate_v1 saved under result_json.source_candidate.';
