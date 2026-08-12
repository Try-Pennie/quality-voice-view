-- PSAI-244: high-confidence Pennie feedback -> Eavesly call matching.
--
-- matched_call_id keeps its existing meaning: existing values are preserved,
-- and new values require an ordinary (non-audit) achieve_welcome_call_qa row.
-- The new matched_eavesly_call_id records the broader call match, including
-- calls whose
-- QA module row is missing. Matching requires one normalized submitter name in
-- agent_directory and exactly one call with the same agent email + normalized
-- phone in the existing (-24h, +1h) submission window.

alter table public.achieve_agent_feedback
  add column matched_eavesly_call_id text,
  add column call_match_status text not null default 'pending',
  add column call_match_confidence text,
  add column call_match_reason text,
  add column call_matched_at timestamptz,
  add constraint achieve_agent_feedback_call_match_status_check
    check (call_match_status in ('pending', 'matched', 'unmatched', 'ambiguous')),
  add constraint achieve_agent_feedback_call_match_confidence_check
    check (call_match_confidence is null or call_match_confidence = 'high'),
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
        'matched_phone_time_submitter'
      )
    );

comment on column public.achieve_agent_feedback.matched_eavesly_call_id is
  'Sticky association to any eavesly_calls.call_id: seeded from legacy module matches or established by high-confidence matching; unlike matched_call_id, does not require an ordinary Achieve QA module row.';
comment on column public.achieve_agent_feedback.call_match_status is
  'Call-only match outcome: pending, matched, unmatched, or ambiguous.';
comment on column public.achieve_agent_feedback.call_match_confidence is
  'Confidence recorded for a successful call-only match; currently high only.';
comment on column public.achieve_agent_feedback.call_match_reason is
  'Machine-readable reason for the call-only match outcome.';
comment on column public.achieve_agent_feedback.call_matched_at is
  'Time the sticky call-only association was recorded or seeded.';

create index achieve_agent_feedback_eavesly_call_idx
  on public.achieve_agent_feedback (matched_eavesly_call_id);

create index achieve_agent_feedback_call_match_status_idx
  on public.achieve_agent_feedback (call_match_status, submitted_at desc);

-- Support the exact matching predicates without scanning the calls table.
create index eavesly_calls_feedback_match_idx
  on public.eavesly_calls (
    right(regexp_replace(contact_phone, '\D', '', 'g'), 10),
    lower(agent_email),
    started_at
  )
  where contact_phone is not null
    and agent_email is not null
    and started_at is not null;

-- This is intentionally non-unique. The matcher counts distinct emails for a
-- normalized display name and rejects names shared by multiple agents.
create index agent_directory_normalized_full_name_idx
  on public.agent_directory (
    lower(btrim(regexp_replace(agent_full_name, '[^[:alnum:]]+', ' ', 'g')))
  );

-- Preserve every pre-migration Achieve module association. These rows were
-- matched under the legacy phone/time policy, so they seed the broader call ID
-- without claiming high confidence and are never reconsidered by the matcher.
update public.achieve_agent_feedback
set matched_eavesly_call_id = matched_call_id,
    call_match_status = 'matched',
    call_match_confidence = null,
    call_match_reason = 'legacy_module_match',
    call_matched_at = coalesce(matched_at, now())
where matched_call_id is not null;

create or replace function public.match_achieve_agent_feedback()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- A sticky call-only match may be promoted when its ordinary Achieve QA row
  -- arrives later. result_json is NOT NULL on eavesly_module_results (and the
  -- production table has no NULL rows), so NOT jsonb-containment is safe here.
  -- Audit-only module rows never populate matched_call_id.
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
        and not (
          module_result.result_json
            @> '{"backfill":{"audit_only":true}}'::jsonb
        )
    );

  -- High-confidence matching is only for feedback with no prior module or
  -- call-only association. Once selected, matched_eavesly_call_id is sticky:
  -- later calls cannot make the historical match ambiguous or detach it.
  with target_feedback as (
    select
      feedback.id,
      feedback.submitted_at,
      feedback.submitted_by,
      feedback.phone_normalized
    from public.achieve_agent_feedback as feedback
    where feedback.matched_call_id is null
      and feedback.matched_eavesly_call_id is null
  ),
  name_resolution as (
    select
      feedback.id,
      feedback.submitted_at,
      feedback.submitted_by,
      feedback.phone_normalized,
      count(distinct directory.agent_email) as agent_count,
      min(directory.agent_email) as resolved_agent_email
    from target_feedback as feedback
    left join public.agent_directory as directory
      on feedback.submitted_by is not null
     and btrim(feedback.submitted_by) <> ''
     and lower(btrim(regexp_replace(directory.agent_full_name, '[^[:alnum:]]+', ' ', 'g')))
       = lower(btrim(regexp_replace(feedback.submitted_by, '[^[:alnum:]]+', ' ', 'g')))
    group by
      feedback.id,
      feedback.submitted_at,
      feedback.submitted_by,
      feedback.phone_normalized
  ),
  call_resolution as (
    select
      resolution.id,
      resolution.submitted_by,
      resolution.phone_normalized,
      resolution.agent_count,
      count(distinct calls.call_id) as call_count,
      min(calls.call_id) as resolved_call_id
    from name_resolution as resolution
    left join public.eavesly_calls as calls
      on resolution.agent_count = 1
     and resolution.phone_normalized ~ '^[0-9]{10}$'
     and calls.contact_phone is not null
     and calls.agent_email is not null
     and calls.started_at is not null
     and lower(calls.agent_email) = lower(resolution.resolved_agent_email)
     and right(regexp_replace(calls.contact_phone, '\D', '', 'g'), 10)
       = resolution.phone_normalized
     and calls.started_at between resolution.submitted_at - interval '24 hours'
                              and resolution.submitted_at + interval '1 hour'
    group by
      resolution.id,
      resolution.submitted_by,
      resolution.phone_normalized,
      resolution.agent_count
  ),
  decisions as (
    select
      resolution.id,
      case
        when resolution.agent_count = 1 and resolution.call_count = 1
          then resolution.resolved_call_id
        else null
      end as matched_eavesly_call_id,
      case
        when resolution.agent_count = 1
         and resolution.call_count = 1
         and exists (
           select 1
           from public.eavesly_module_results as module_result
           where module_result.module_name = 'achieve_welcome_call_qa'
             and module_result.call_id = resolution.resolved_call_id
             and not (
               module_result.result_json
                 @> '{"backfill":{"audit_only":true}}'::jsonb
             )
         )
          then resolution.resolved_call_id
        else null
      end as matched_module_call_id,
      case
        when resolution.phone_normalized is null
          or resolution.phone_normalized !~ '^[0-9]{10}$' then 'unmatched'
        when resolution.submitted_by is null
          or btrim(resolution.submitted_by) = '' then 'unmatched'
        when resolution.agent_count = 0 then 'unmatched'
        when resolution.agent_count > 1 then 'ambiguous'
        when resolution.call_count = 0 then 'unmatched'
        when resolution.call_count > 1 then 'ambiguous'
        else 'matched'
      end as call_match_status,
      case
        when resolution.agent_count = 1 and resolution.call_count = 1 then 'high'
        else null
      end as call_match_confidence,
      case
        when resolution.phone_normalized is null
          or resolution.phone_normalized !~ '^[0-9]{10}$' then 'invalid_phone'
        when resolution.submitted_by is null
          or btrim(resolution.submitted_by) = '' then 'submitter_missing'
        when resolution.agent_count = 0 then 'submitter_not_found'
        when resolution.agent_count > 1 then 'submitter_ambiguous'
        when resolution.call_count = 0 then 'no_call_in_window'
        when resolution.call_count > 1 then 'call_ambiguous'
        else 'matched_phone_time_submitter'
      end as call_match_reason
    from call_resolution as resolution
  ),
  updated as (
    update public.achieve_agent_feedback as feedback
    set matched_eavesly_call_id = decisions.matched_eavesly_call_id,
        call_match_status = decisions.call_match_status,
        call_match_confidence = decisions.call_match_confidence,
        call_match_reason = decisions.call_match_reason,
        call_matched_at = case
          when decisions.matched_eavesly_call_id is not null then now()
          else null
        end,
        matched_call_id = decisions.matched_module_call_id,
        matched_at = case
          when decisions.matched_module_call_id is not null then now()
          else null
        end
    from decisions
    where feedback.id = decisions.id
    returning feedback.call_match_status
  )
  select count(*) filter (where call_match_status = 'matched')::integer
  into v_count
  from updated;

  return coalesce(v_count, 0);
end
$$;

comment on function public.match_achieve_agent_feedback() is
  'Promotes sticky call-only matches when normal QA arrives, then matches only never-associated feedback when phone, the -24h/+1h window, and one agent_directory display-name-to-call-agent-email resolution identify exactly one Eavesly call.';

revoke execute on function public.match_achieve_agent_feedback()
  from public, anon, authenticated;
grant execute on function public.match_achieve_agent_feedback()
  to service_role;
