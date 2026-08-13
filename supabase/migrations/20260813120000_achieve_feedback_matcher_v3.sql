-- Achieve feedback matcher v3: auditable inferred associations and exact QA scopes.
--
-- Existing associations stay sticky. Only feedback with neither association is
-- reconsidered. Strong inferred tiers are evaluated in this order:
--   1. one exact Achieve QA call among same-agent/phone/window candidates;
--   2. one candidate whose full form-entered Achieve agent name occurs in the
--      transcript;
--   3. the existing unique same-agent/phone/window call rule;
--   4. for missing/unresolved submitters only, one global phone/window call.
-- Audit-only QA is evidence for association but can never populate the ordinary
-- matched_call_id field.

alter table public.achieve_agent_feedback
  add column call_match_provenance text,
  add column call_match_method text,
  add column call_match_evidence jsonb;

alter table public.achieve_agent_feedback
  drop constraint achieve_agent_feedback_call_match_reason_check,
  add constraint achieve_agent_feedback_call_match_reason_check
    check (
      call_match_reason is null or call_match_reason in (
        'legacy_module_match',
        'invalid_phone',
        'submitter_missing',
        'submitter_not_found',
        'submitter_ambiguous',
        'no_call_in_window',
        'call_ambiguous',
        'matched_phone_time_submitter',
        'matched_unique_qa_phone_time',
        'matched_transcript_agent_name',
        'matched_unique_phone_time_no_submitter'
      )
    ),
  add constraint achieve_agent_feedback_call_match_provenance_check
    check (call_match_provenance is null or call_match_provenance in ('deterministic', 'inferred')),
  add constraint achieve_agent_feedback_call_match_method_check
    check (
      call_match_method is null or call_match_method in (
        'legacy_module_association',
        'phone_time_submitter',
        'unique_qa_phone_time',
        'transcript_agent_name_phone_time',
        'unique_phone_time_no_submitter'
      )
    ),
  add constraint achieve_agent_feedback_call_match_evidence_check
    check (
      call_match_evidence is null or (
        jsonb_typeof(call_match_evidence) = 'object'
        and octet_length(call_match_evidence::text) <= 2048
        and (
          call_match_evidence - array[
            'matcher_version',
            'historical_association',
            'same_agent_phone_time_candidate_count',
            'qa_candidate_count',
            'transcript_name_candidate_count',
            'global_phone_time_candidate_count',
            'absolute_delta_seconds',
            'qa_scope'
          ]::text[]
        ) = '{}'::jsonb
        and (
          not (call_match_evidence ? 'qa_scope')
          or call_match_evidence->>'qa_scope' in ('ordinary', 'audit_only', 'absent')
        )
        and (
          not (call_match_evidence ? 'historical_association')
          or call_match_evidence->'historical_association' = 'true'::jsonb
        )
      )
    );

comment on column public.achieve_agent_feedback.call_match_provenance is
  'Whether the sticky call association is deterministic legacy history or a strong inferred association.';
comment on column public.achieve_agent_feedback.call_match_method is
  'Bounded matcher method used to establish the sticky call association.';
comment on column public.achieve_agent_feedback.call_match_evidence is
  'Bounded, non-PII matcher evidence: matcher version, aggregate candidate counts, selected QA scope, and timing delta.';

-- Preserve provenance for associations established before v3. The v2
-- phone/time/submitter matcher was inferred even though its output was treated
-- as matched for dashboard placement.
update public.achieve_agent_feedback
set call_match_provenance = case
      when call_match_reason = 'legacy_module_match' then 'deterministic'
      else 'inferred'
    end,
    call_match_method = case
      when call_match_reason = 'legacy_module_match' then 'legacy_module_association'
      else 'phone_time_submitter'
    end,
    call_match_evidence = jsonb_build_object(
      'matcher_version', case when call_match_reason = 'legacy_module_match' then 1 else 2 end,
      'historical_association', true
    )
where matched_eavesly_call_id is not null;

-- Defensive historical repair before validating cross-column constraints. The
-- v2 migration populated these fields, but this makes the hardening migration
-- safe if an older environment missed or partially applied that backfill.
update public.achieve_agent_feedback
set matched_eavesly_call_id = matched_call_id,
    call_match_status = 'matched',
    call_matched_at = coalesce(call_matched_at, matched_at, created_at),
    call_match_provenance = coalesce(call_match_provenance, 'deterministic'),
    call_match_method = coalesce(call_match_method, 'legacy_module_association'),
    call_match_evidence = coalesce(call_match_evidence, '{"matcher_version":1,"historical_association":true}'::jsonb)
where matched_call_id is not null
  and matched_eavesly_call_id is null;

update public.achieve_agent_feedback
set call_match_status = 'matched',
    call_matched_at = coalesce(call_matched_at, matched_at, created_at),
    call_match_provenance = coalesce(call_match_provenance, 'inferred'),
    call_match_method = coalesce(call_match_method, 'phone_time_submitter'),
    call_match_evidence = coalesce(call_match_evidence, '{"matcher_version":2,"historical_association":true}'::jsonb)
where matched_eavesly_call_id is not null;

-- Normalize confidence after provenance repair so drifted historical rows
-- satisfy the persisted deterministic-vs-inferred distinction. Unassociated
-- rows retain the v2-compatible nullable/high outcome semantics.
update public.achieve_agent_feedback
set call_match_confidence = case
      when call_match_provenance = 'deterministic' then null
      else 'high'
    end
where matched_eavesly_call_id is not null;

update public.achieve_agent_feedback
set call_match_provenance = null,
    call_match_method = null,
    call_matched_at = null
where matched_eavesly_call_id is null;

alter table public.achieve_agent_feedback
  add constraint achieve_agent_feedback_association_consistency_check
    check (
      (
        matched_eavesly_call_id is null
        and call_match_provenance is null
        and call_match_method is null
        and call_matched_at is null
      ) or (
        matched_eavesly_call_id is not null
        and call_match_status = 'matched'
        and call_match_provenance is not null
        and call_match_method is not null
        and call_match_evidence is not null
        and call_matched_at is not null
        and (
          (call_match_provenance = 'inferred' and call_match_confidence = 'high')
          or (call_match_provenance = 'deterministic' and call_match_confidence is null)
        )
      )
    ),
  add constraint achieve_agent_feedback_module_call_consistency_check
    check (matched_call_id is null or matched_call_id = matched_eavesly_call_id);

-- Internal decision surface shared by the dry-run report and the writer. It
-- returns only never-associated rows and never mutates data.
create or replace function private.achieve_agent_feedback_match_candidates_v3()
returns table (
  feedback_id bigint,
  selected_call_id text,
  call_match_status text,
  call_match_confidence text,
  call_match_reason text,
  call_match_provenance text,
  call_match_method text,
  call_match_evidence jsonb,
  has_ordinary_qa boolean,
  has_audit_qa boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_feedback as (
    select
      feedback.id,
      feedback.submitted_at,
      feedback.submitted_by,
      feedback.phone_normalized,
      lower(btrim(regexp_replace(coalesce(feedback.achieve_agent_name, ''), '[^[:alnum:]]+', ' ', 'g'))) as achieve_name_normalized
    from public.achieve_agent_feedback as feedback
    where feedback.matched_call_id is null
      and feedback.matched_eavesly_call_id is null
  ),
  name_resolution as (
    select
      feedback.*,
      coalesce(directory.agent_count, 0) as agent_count,
      directory.resolved_agent_email
    from target_feedback as feedback
    left join lateral (
      select
        count(distinct lower(agent.agent_email))::integer as agent_count,
        min(lower(agent.agent_email)) as resolved_agent_email
      from public.agent_directory as agent
      where feedback.submitted_by is not null
        and btrim(feedback.submitted_by) <> ''
        and lower(btrim(regexp_replace(agent.agent_full_name, '[^[:alnum:]]+', ' ', 'g')))
          = lower(btrim(regexp_replace(feedback.submitted_by, '[^[:alnum:]]+', ' ', 'g')))
    ) as directory on true
  ),
  same_agent_candidates as (
    select
      resolution.id as feedback_id,
      calls.call_id,
      calls.started_at,
      exists (
        select 1
        from public.eavesly_module_results as module_result
        where module_result.module_name = 'achieve_welcome_call_qa'
          and module_result.call_id = calls.call_id
          and not (module_result.result_json @> '{"backfill":{"audit_only":true}}'::jsonb)
      ) as has_ordinary_qa,
      exists (
        select 1
        from public.eavesly_module_results as module_result
        where module_result.module_name = 'achieve_welcome_call_qa'
          and module_result.call_id = calls.call_id
          and module_result.result_json @> '{"backfill":{"audit_only":true}}'::jsonb
      ) as has_audit_qa,
      cardinality(regexp_split_to_array(resolution.achieve_name_normalized, '[[:space:]]+')) >= 2
        and exists (
          select 1
          from public.eavesly_transcription_qa as transcript
          where transcript.call_id = calls.call_id
            and position(
              ' ' || resolution.achieve_name_normalized || ' '
              in ' ' || lower(btrim(regexp_replace(coalesce(transcript.original_transcript, ''), '[^[:alnum:]]+', ' ', 'g'))) || ' '
            ) > 0
        ) as transcript_has_full_achieve_name
    from name_resolution as resolution
    join public.eavesly_calls as calls
      on resolution.agent_count = 1
     and resolution.phone_normalized ~ '^[0-9]{10}$'
     and calls.contact_phone is not null
     and calls.agent_email is not null
     and calls.started_at is not null
     and lower(calls.agent_email) = resolution.resolved_agent_email
     and right(regexp_replace(calls.contact_phone, '\D', '', 'g'), 10) = resolution.phone_normalized
     and calls.started_at between resolution.submitted_at - interval '24 hours'
                              and resolution.submitted_at + interval '1 hour'
  ),
  same_agent_resolution as (
    select
      resolution.id as feedback_id,
      count(distinct candidate.call_id)::integer as candidate_count,
      min(candidate.call_id) filter (where candidate.call_id is not null) as unique_call_id,
      count(distinct candidate.call_id) filter (
        where candidate.has_ordinary_qa or candidate.has_audit_qa
      )::integer as qa_candidate_count,
      min(candidate.call_id) filter (
        where candidate.has_ordinary_qa or candidate.has_audit_qa
      ) as unique_qa_call_id,
      count(distinct candidate.call_id) filter (
        where candidate.transcript_has_full_achieve_name
      )::integer as transcript_name_candidate_count,
      min(candidate.call_id) filter (
        where candidate.transcript_has_full_achieve_name
      ) as unique_transcript_name_call_id
    from name_resolution as resolution
    left join same_agent_candidates as candidate on candidate.feedback_id = resolution.id
    group by resolution.id
  ),
  global_resolution as (
    select
      resolution.id as feedback_id,
      count(distinct calls.call_id)::integer as candidate_count,
      min(calls.call_id) as unique_call_id
    from name_resolution as resolution
    left join public.eavesly_calls as calls
      on resolution.phone_normalized ~ '^[0-9]{10}$'
     and calls.contact_phone is not null
     and calls.started_at is not null
     and right(regexp_replace(calls.contact_phone, '\D', '', 'g'), 10) = resolution.phone_normalized
     and calls.started_at between resolution.submitted_at - interval '24 hours'
                              and resolution.submitted_at + interval '1 hour'
    group by resolution.id
  ),
  selected as (
    select
      resolution.*,
      same_agent.candidate_count as same_agent_candidate_count,
      same_agent.qa_candidate_count,
      same_agent.transcript_name_candidate_count,
      global_calls.candidate_count as global_candidate_count,
      case
        when resolution.phone_normalized is null or resolution.phone_normalized !~ '^[0-9]{10}$' then null
        when resolution.agent_count = 1 and same_agent.qa_candidate_count = 1 then same_agent.unique_qa_call_id
        when resolution.agent_count = 1 and same_agent.transcript_name_candidate_count = 1 then same_agent.unique_transcript_name_call_id
        when resolution.agent_count = 1 and same_agent.candidate_count = 1 then same_agent.unique_call_id
        when (
          resolution.submitted_by is null or btrim(resolution.submitted_by) = '' or resolution.agent_count = 0
        ) and global_calls.candidate_count = 1 then global_calls.unique_call_id
        else null
      end as selected_call_id,
      case
        when resolution.agent_count = 1 and same_agent.qa_candidate_count = 1 then 'unique_qa_phone_time'
        when resolution.agent_count = 1 and same_agent.transcript_name_candidate_count = 1 then 'transcript_agent_name_phone_time'
        when resolution.agent_count = 1 and same_agent.candidate_count = 1 then 'phone_time_submitter'
        when (
          resolution.submitted_by is null or btrim(resolution.submitted_by) = '' or resolution.agent_count = 0
        ) and global_calls.candidate_count = 1 then 'unique_phone_time_no_submitter'
        else null
      end as selected_method
    from name_resolution as resolution
    join same_agent_resolution as same_agent on same_agent.feedback_id = resolution.id
    join global_resolution as global_calls on global_calls.feedback_id = resolution.id
  ),
  selected_with_scope as (
    select
      selected.*,
      coalesce(scope.has_ordinary_qa, false) as has_ordinary_qa,
      coalesce(scope.has_audit_qa, false) as has_audit_qa,
      scope.started_at as selected_started_at
    from selected
    left join lateral (
      select
        calls.started_at,
        exists (
          select 1 from public.eavesly_module_results as module_result
          where module_result.module_name = 'achieve_welcome_call_qa'
            and module_result.call_id = calls.call_id
            and not (module_result.result_json @> '{"backfill":{"audit_only":true}}'::jsonb)
        ) as has_ordinary_qa,
        exists (
          select 1 from public.eavesly_module_results as module_result
          where module_result.module_name = 'achieve_welcome_call_qa'
            and module_result.call_id = calls.call_id
            and module_result.result_json @> '{"backfill":{"audit_only":true}}'::jsonb
        ) as has_audit_qa
      from public.eavesly_calls as calls
      where calls.call_id = selected.selected_call_id
    ) as scope on true
  )
  select
    selected.id,
    selected.selected_call_id,
    case
      when selected.selected_call_id is not null then 'matched'
      when selected.phone_normalized is null or selected.phone_normalized !~ '^[0-9]{10}$' then 'unmatched'
      when selected.submitted_by is null or btrim(selected.submitted_by) = '' then 'unmatched'
      when selected.agent_count = 0 then 'unmatched'
      when selected.agent_count > 1 then 'ambiguous'
      when selected.same_agent_candidate_count = 0 then 'unmatched'
      else 'ambiguous'
    end,
    case when selected.selected_call_id is not null then 'high' else null end,
    case
      when selected.selected_method = 'unique_qa_phone_time' then 'matched_unique_qa_phone_time'
      when selected.selected_method = 'transcript_agent_name_phone_time' then 'matched_transcript_agent_name'
      when selected.selected_method = 'phone_time_submitter' then 'matched_phone_time_submitter'
      when selected.selected_method = 'unique_phone_time_no_submitter' then 'matched_unique_phone_time_no_submitter'
      when selected.phone_normalized is null or selected.phone_normalized !~ '^[0-9]{10}$' then 'invalid_phone'
      when selected.submitted_by is null or btrim(selected.submitted_by) = '' then 'submitter_missing'
      when selected.agent_count = 0 then 'submitter_not_found'
      when selected.agent_count > 1 then 'submitter_ambiguous'
      when selected.same_agent_candidate_count = 0 then 'no_call_in_window'
      else 'call_ambiguous'
    end,
    case when selected.selected_call_id is not null then 'inferred' else null end,
    selected.selected_method,
    jsonb_strip_nulls(jsonb_build_object(
      'matcher_version', 3,
      'same_agent_phone_time_candidate_count', selected.same_agent_candidate_count,
      'qa_candidate_count', selected.qa_candidate_count,
      'transcript_name_candidate_count', selected.transcript_name_candidate_count,
      'global_phone_time_candidate_count', selected.global_candidate_count,
      'absolute_delta_seconds', case
        when selected.selected_started_at is not null
          then round(abs(extract(epoch from (selected.submitted_at - selected.selected_started_at))))::bigint
        else null
      end,
      'qa_scope', case
        when selected.has_ordinary_qa then 'ordinary'
        when selected.has_audit_qa then 'audit_only'
        else 'absent'
      end
    )),
    selected.has_ordinary_qa,
    selected.has_audit_qa
  from selected_with_scope as selected
$$;

revoke execute on function private.achieve_agent_feedback_match_candidates_v3()
  from public, anon, authenticated;
grant execute on function private.achieve_agent_feedback_match_candidates_v3()
  to service_role;

-- Aggregate-only shadow report: safe to run before enabling writes and useful
-- for comparing method/status counts to validated historical cohorts.
create or replace function public.report_achieve_agent_feedback_matches_v3()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'candidate_rows', count(*),
    'would_match', count(*) filter (where decision.selected_call_id is not null),
    'would_remain_unresolved', count(*) filter (where decision.selected_call_id is null),
    'by_method', coalesce((
      select jsonb_object_agg(method_counts.call_match_method, method_counts.row_count)
      from (
        select coalesce(call_match_method, 'unresolved') as call_match_method, count(*) as row_count
        from private.achieve_agent_feedback_match_candidates_v3()
        group by coalesce(call_match_method, 'unresolved')
      ) as method_counts
    ), '{}'::jsonb),
    'audit_only_associations', count(*) filter (
      where decision.selected_call_id is not null
        and decision.has_audit_qa
        and not decision.has_ordinary_qa
    )
  )
  from private.achieve_agent_feedback_match_candidates_v3() as decision
$$;

revoke execute on function public.report_achieve_agent_feedback_matches_v3()
  from public, anon, authenticated;
grant execute on function public.report_achieve_agent_feedback_matches_v3()
  to service_role;

create or replace function public.match_achieve_agent_feedback()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_audit_only integer;
  v_unresolved integer;
begin
  -- Promote sticky associations only when an exact ordinary Achieve module row
  -- exists. An audit-only row can never populate matched_call_id.
  update public.achieve_agent_feedback as feedback
  set matched_call_id = feedback.matched_eavesly_call_id,
      matched_at = coalesce(feedback.matched_at, now())
  where feedback.matched_call_id is null
    and feedback.matched_eavesly_call_id is not null
    and exists (
      select 1
      from public.eavesly_module_results as module_result
      where module_result.module_name = 'achieve_welcome_call_qa'
        and module_result.call_id = feedback.matched_eavesly_call_id
        and not (module_result.result_json @> '{"backfill":{"audit_only":true}}'::jsonb)
    );

  with updated as (
    update public.achieve_agent_feedback as feedback
    set matched_eavesly_call_id = decision.selected_call_id,
        call_match_status = decision.call_match_status,
        call_match_confidence = decision.call_match_confidence,
        call_match_reason = decision.call_match_reason,
        call_match_provenance = decision.call_match_provenance,
        call_match_method = decision.call_match_method,
        call_match_evidence = decision.call_match_evidence,
        call_matched_at = case when decision.selected_call_id is not null then now() else null end,
        matched_call_id = case when decision.has_ordinary_qa then decision.selected_call_id else null end,
        matched_at = case when decision.has_ordinary_qa then now() else null end
    from private.achieve_agent_feedback_match_candidates_v3() as decision
    where feedback.id = decision.feedback_id
      and feedback.matched_call_id is null
      and feedback.matched_eavesly_call_id is null
    returning
      feedback.matched_eavesly_call_id,
      feedback.matched_call_id,
      feedback.call_match_status
  )
  select
    count(*) filter (where matched_eavesly_call_id is not null)::integer,
    count(*) filter (where matched_eavesly_call_id is not null and matched_call_id is null)::integer,
    count(*) filter (where matched_eavesly_call_id is null)::integer
  into v_count, v_audit_only, v_unresolved
  from updated;

  -- Aggregate-only operational evidence; no phone, name, transcript, or call ID.
  raise log 'achieve matcher v3: matched=%, nonordinary_or_absent=%, unresolved=%',
    coalesce(v_count, 0), coalesce(v_audit_only, 0), coalesce(v_unresolved, 0);

  return coalesce(v_count, 0);
end
$$;

comment on function public.match_achieve_agent_feedback() is
  'Idempotently promotes exact ordinary QA and applies matcher v3 only to never-associated feedback. Strong inferred matches remain visibly distinguished by provenance/method/evidence; audit-only QA never populates matched_call_id.';

revoke execute on function public.match_achieve_agent_feedback()
  from public, anon, authenticated;
grant execute on function public.match_achieve_agent_feedback()
  to service_role;

-- Exact category totals for the portal. Classification checks exact Achieve
-- module rows rather than treating every call association without
-- matched_call_id as QA-absent.
create or replace function public.get_achieve_feedback_match_totals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with classified as (
    select
      feedback.id,
      feedback.call_match_provenance,
      feedback.matched_eavesly_call_id,
      exists (
        select 1 from public.eavesly_module_results as module_result
        where module_result.module_name = 'achieve_welcome_call_qa'
          and module_result.call_id = feedback.matched_eavesly_call_id
          and not (module_result.result_json @> '{"backfill":{"audit_only":true}}'::jsonb)
      ) as has_ordinary_qa,
      exists (
        select 1 from public.eavesly_module_results as module_result
        where module_result.module_name = 'achieve_welcome_call_qa'
          and module_result.call_id = feedback.matched_eavesly_call_id
          and module_result.result_json @> '{"backfill":{"audit_only":true}}'::jsonb
      ) as has_audit_qa
    from public.achieve_agent_feedback as feedback
  )
  select jsonb_build_object(
    'deterministic_matched', count(*) filter (
      where matched_eavesly_call_id is not null and has_ordinary_qa
        and call_match_provenance = 'deterministic'
    ),
    'inferred_matched', count(*) filter (
      where matched_eavesly_call_id is not null and has_ordinary_qa
        and call_match_provenance = 'inferred'
    ),
    'audit_qa_available', count(*) filter (
      where matched_eavesly_call_id is not null and not has_ordinary_qa and has_audit_qa
    ),
    'true_qa_absent', count(*) filter (
      where matched_eavesly_call_id is not null and not has_ordinary_qa and not has_audit_qa
    ),
    'unresolved', count(*) filter (where matched_eavesly_call_id is null)
  )
  from classified
$$;

revoke execute on function public.get_achieve_feedback_match_totals()
  from public, anon, authenticated;
grant execute on function public.get_achieve_feedback_match_totals()
  to service_role;

-- Bounded category lists back the portal exception drawers without scanning or
-- transferring all feedback rows. Exact totals come from the aggregate RPC.
create or replace function public.list_achieve_feedback_exceptions(
  p_category text,
  p_limit integer default 200
)
returns setof public.achieve_agent_feedback
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_category not in ('true_qa_absent', 'unresolved') then
    raise exception using errcode = '22023', message = 'invalid feedback exception category';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'feedback exception limit must be between 1 and 200';
  end if;

  return query
  select feedback.*
  from public.achieve_agent_feedback as feedback
  where (
      p_category = 'unresolved'
      and feedback.matched_eavesly_call_id is null
    ) or (
      p_category = 'true_qa_absent'
      and feedback.matched_eavesly_call_id is not null
      and not exists (
        select 1 from public.eavesly_module_results as module_result
        where module_result.module_name = 'achieve_welcome_call_qa'
          and module_result.call_id = feedback.matched_eavesly_call_id
      )
    )
  order by feedback.submitted_at desc, feedback.id desc
  limit p_limit;
end
$$;

revoke execute on function public.list_achieve_feedback_exceptions(text, integer)
  from public, anon, authenticated;
grant execute on function public.list_achieve_feedback_exceptions(text, integer)
  to service_role;
