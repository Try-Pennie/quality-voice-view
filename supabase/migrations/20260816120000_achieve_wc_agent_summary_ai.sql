-- Add ordinary Achieve welcome-call AI QA to the immutable Form dashboard.
-- Representative attribution is exact and fail-closed: one call lead, one
-- Achieve client bridge, and one normalized welcome-call agent email.

create or replace function private.achieve_is_ordinary_graded_qa(
  p_module_name text,
  p_result_json jsonb
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select
    p_module_name = 'achieve_welcome_call_qa'
    and p_result_json is not null
    and coalesce(p_result_json->'grading_skipped', 'false'::jsonb) = 'false'::jsonb
    and coalesce(p_result_json#>'{transcript_segment,used_full_transcript_fallback}', 'false'::jsonb) = 'false'::jsonb
    and p_result_json->>'skip_reason' is distinct from 'competitor_transfer'
    and not coalesce(p_result_json @> '{"backfill":{"audit_only":true}}'::jsonb, false);
$$;

revoke execute on function private.achieve_is_ordinary_graded_qa(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.achieve_is_ordinary_graded_qa(text, jsonb)
  to service_role;

create or replace function private.achieve_exact_call_agents(p_call_ids text[])
returns table (
  call_id text,
  achieve_agent_name text,
  achieve_agent_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested_calls as (
    select distinct requested.call_id
    from unnest(coalesce(p_call_ids, array[]::text[])) as requested(call_id)
    where nullif(btrim(requested.call_id), '') is not null
  ),
  call_lead_candidates as (
    select calls.call_id, btrim(calls.sfdc_lead_id) as sfdc_lead_id
    from requested_calls as requested
    join public.eavesly_calls as calls on calls.call_id = requested.call_id
    where nullif(btrim(calls.sfdc_lead_id), '') is not null

    union all

    select module_result.call_id, btrim(module_result.sfdc_lead_id) as sfdc_lead_id
    from requested_calls as requested
    join public.eavesly_module_results as module_result
      on module_result.call_id = requested.call_id
     and module_result.module_name = 'achieve_welcome_call_qa'
    where nullif(btrim(module_result.sfdc_lead_id), '') is not null
  ),
  unambiguous_call_leads as (
    select candidate.call_id, min(candidate.sfdc_lead_id) as sfdc_lead_id
    from call_lead_candidates as candidate
    group by candidate.call_id
    having count(distinct candidate.sfdc_lead_id) = 1
  ),
  bridge_candidates as (
    select
      call_lead.call_id,
      lower(btrim(bridge.client_id)) as normalized_client_id
    from unambiguous_call_leads as call_lead
    join public.achieve_client_sfdc_map as bridge
      on btrim(bridge.sfdc_lead_id) = call_lead.sfdc_lead_id
    where nullif(btrim(bridge.client_id), '') is not null
  ),
  unambiguous_bridges as (
    select candidate.call_id, min(candidate.normalized_client_id) as normalized_client_id
    from bridge_candidates as candidate
    group by candidate.call_id
    having count(distinct candidate.normalized_client_id) = 1
  ),
  requested_clients as (
    select distinct bridge.normalized_client_id
    from unambiguous_bridges as bridge
  ),
  unambiguous_clients as (
    select lower(btrim(log.client_id)) as normalized_client_id
    from requested_clients as requested
    join public.welcome_call_agent_log as log
      on lower(btrim(log.client_id)) = requested.normalized_client_id
    group by lower(btrim(log.client_id))
    having count(distinct nullif(lower(btrim(log.welcome_call_agent_email)), '')) = 1
  ),
  latest_agents as (
    select distinct on (lower(btrim(log.client_id)))
      lower(btrim(log.client_id)) as normalized_client_id,
      nullif(btrim(log.welcome_call_agent_name), '') as achieve_agent_name,
      lower(btrim(log.welcome_call_agent_email)) as achieve_agent_email
    from requested_clients as requested
    join public.welcome_call_agent_log as log
      on lower(btrim(log.client_id)) = requested.normalized_client_id
    where nullif(btrim(log.welcome_call_agent_email), '') is not null
    order by lower(btrim(log.client_id)), log.last_seen_on desc, log.id desc
  )
  select
    bridge.call_id,
    coalesce(agent.achieve_agent_name, agent.achieve_agent_email),
    agent.achieve_agent_email
  from unambiguous_bridges as bridge
  join unambiguous_clients as client
    on client.normalized_client_id = bridge.normalized_client_id
  join latest_agents as agent
    on agent.normalized_client_id = client.normalized_client_id;
$$;

revoke execute on function private.achieve_exact_call_agents(text[])
  from public, anon, authenticated;
grant execute on function private.achieve_exact_call_agents(text[])
  to service_role;

create or replace function private.achieve_agent_feedback_attributed(
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns table (
  feedback_id bigint,
  submitted_at timestamptz,
  rating text,
  accent boolean,
  background_noise boolean,
  connection_issues boolean,
  has_notes boolean,
  call_associated boolean,
  call_match_reason text,
  achieve_agent_name text,
  achieve_agent_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered_feedback as materialized (
    select feedback.*
    from public.achieve_agent_feedback as feedback
    where (p_start_at is null or feedback.submitted_at >= p_start_at)
      and (p_end_at is null or feedback.submitted_at < p_end_at)
  ),
  exact_agents as materialized (
    select agent.*
    from private.achieve_exact_call_agents(coalesce((
      select array_agg(distinct feedback.matched_eavesly_call_id)
      from filtered_feedback as feedback
      where nullif(btrim(feedback.matched_eavesly_call_id), '') is not null
    ), array[]::text[])) as agent
  )
  select
    feedback.id,
    feedback.submitted_at,
    case lower(btrim(feedback.call_quality))
      when 'good' then 'good'
      when 'fair' then 'fair'
      when 'poor' then 'poor'
      else 'other'
    end,
    feedback.accent is true,
    feedback.background_noise is true,
    feedback.connection_issues is true,
    nullif(btrim(feedback.notes), '') is not null,
    nullif(btrim(feedback.matched_eavesly_call_id), '') is not null,
    feedback.call_match_reason,
    agent.achieve_agent_name,
    agent.achieve_agent_email
  from filtered_feedback as feedback
  left join exact_agents as agent
    on agent.call_id = feedback.matched_eavesly_call_id;
$$;

revoke execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  to service_role;

create or replace function private.achieve_ordinary_qa_attributed(
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns table (
  module_result_id bigint,
  call_id text,
  graded_at timestamptz,
  ai_flagged boolean,
  achieve_agent_name text,
  achieve_agent_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with ordinary_qa as materialized (
    select module_result.*
    from public.eavesly_module_results as module_result
    where private.achieve_is_ordinary_graded_qa(
        module_result.module_name,
        module_result.result_json
      )
      and (p_start_at is null or module_result.created_at >= p_start_at)
      and (p_end_at is null or module_result.created_at < p_end_at)
  ),
  exact_agents as materialized (
    select agent.*
    from private.achieve_exact_call_agents(coalesce((
      select array_agg(distinct qa.call_id)
      from ordinary_qa as qa
      where nullif(btrim(qa.call_id), '') is not null
    ), array[]::text[])) as agent
  )
  select
    qa.id,
    qa.call_id,
    qa.created_at,
    qa.has_violation is true,
    agent.achieve_agent_name,
    agent.achieve_agent_email
  from ordinary_qa as qa
  join exact_agents as agent on agent.call_id = qa.call_id
  where agent.achieve_agent_email is not null;
$$;

revoke execute on function private.achieve_ordinary_qa_attributed(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.achieve_ordinary_qa_attributed(timestamptz, timestamptz)
  to service_role;

create or replace function public.get_achieve_agent_feedback_overview(
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  overview jsonb;
begin
  if p_start_at is not null and p_end_at is not null and p_start_at >= p_end_at then
    raise exception using errcode = '22023', message = 'feedback start must precede end';
  end if;

  with feedback as materialized (
    select * from private.achieve_agent_feedback_attributed(p_start_at, p_end_at)
  ),
  all_qa as materialized (
    select module_result.id
    from public.eavesly_module_results as module_result
    where private.achieve_is_ordinary_graded_qa(
        module_result.module_name,
        module_result.result_json
      )
      and (p_start_at is null or module_result.created_at >= p_start_at)
      and (p_end_at is null or module_result.created_at < p_end_at)
  ),
  qa as materialized (
    select * from private.achieve_ordinary_qa_attributed(p_start_at, p_end_at)
  ),
  recognized_human_calls as (
    select
      feedback.achieve_agent_email,
      form.matched_eavesly_call_id as call_id,
      bool_or(case feedback.rating
        when 'fair' then true
        when 'poor' then true
        else false
      end) as human_concern
    from feedback
    join public.achieve_agent_feedback as form on form.id = feedback.feedback_id
    where feedback.achieve_agent_email is not null
      and feedback.rating <> 'other'
      and nullif(btrim(form.matched_eavesly_call_id), '') is not null
    group by feedback.achieve_agent_email, form.matched_eavesly_call_id
  ),
  qa_calls as (
    select qa.achieve_agent_email, qa.call_id, bool_or(qa.ai_flagged) as ai_concern
    from qa
    group by qa.achieve_agent_email, qa.call_id
  ),
  alignment as materialized (
    select human.human_concern, qa.ai_concern
    from recognized_human_calls as human
    join qa_calls as qa
      on qa.achieve_agent_email = human.achieve_agent_email
     and qa.call_id = human.call_id
  ),
  any_agents as (
    select feedback.achieve_agent_email
    from feedback
    where feedback.achieve_agent_email is not null
    union
    select qa.achieve_agent_email from qa
  )
  select jsonb_build_object(
    'generated_at', now(),
    'scope', jsonb_build_object(
      'first_submitted_at', min(feedback.submitted_at),
      'last_submitted_at', max(feedback.submitted_at),
      'total_submissions', count(*)
    ),
    'ratings', jsonb_build_object(
      'good', count(*) filter (where feedback.rating = 'good'),
      'fair', count(*) filter (where feedback.rating = 'fair'),
      'poor', count(*) filter (where feedback.rating = 'poor'),
      'other', count(*) filter (where feedback.rating = 'other')
    ),
    'flags', jsonb_build_object(
      'accent', count(*) filter (where feedback.accent),
      'background_noise', count(*) filter (where feedback.background_noise),
      'connection_issues', count(*) filter (where feedback.connection_issues),
      'with_notes', count(*) filter (where feedback.has_notes)
    ),
    'coverage', jsonb_build_object(
      'call_associated', count(*) filter (where feedback.call_associated),
      'exact_agent_attributed', count(*) filter (where feedback.achieve_agent_email is not null),
      'agent_unavailable', count(*) filter (where feedback.call_associated and feedback.achieve_agent_email is null),
      'unresolved', count(*) filter (where not feedback.call_associated)
    ),
    'unresolved_reasons', jsonb_build_object(
      'call_ambiguous', count(*) filter (where not feedback.call_associated and feedback.call_match_reason = 'call_ambiguous'),
      'no_call_in_window', count(*) filter (where not feedback.call_associated and feedback.call_match_reason = 'no_call_in_window'),
      'invalid_phone', count(*) filter (where not feedback.call_associated and feedback.call_match_reason = 'invalid_phone'),
      'submitter_not_found', count(*) filter (where not feedback.call_associated and feedback.call_match_reason = 'submitter_not_found'),
      'other', count(*) filter (
        where not feedback.call_associated
          and coalesce(feedback.call_match_reason, '') not in ('call_ambiguous', 'no_call_in_window', 'invalid_phone', 'submitter_not_found')
      )
    ),
    'distinct_exact_agents', count(distinct feedback.achieve_agent_email),
    'distinct_any_agents', (select count(*) from any_agents),
    'qa', jsonb_build_object(
      'coverage', jsonb_build_object(
        'all_graded', (select count(*) from all_qa),
        'exact_agent_attributed', (select count(*) from qa),
        'agent_unavailable', (select count(*) from all_qa) - (select count(*) from qa)
      ),
      'outcomes', jsonb_build_object(
        'pass', (select count(*) from qa where not qa.ai_flagged),
        'flagged', (select count(*) from qa where qa.ai_flagged)
      ),
      'alignment', jsonb_build_object(
        'overlap_calls', (select count(*) from alignment),
        'both_clear', (select count(*) from alignment where not human_concern and not ai_concern),
        'both_concern', (select count(*) from alignment where human_concern and ai_concern),
        'human_only', (select count(*) from alignment where human_concern and not ai_concern),
        'ai_only', (select count(*) from alignment where not human_concern and ai_concern)
      ),
      'distinct_exact_agents', (select count(distinct qa.achieve_agent_email) from qa)
    )
  ) into overview
  from feedback;

  return overview;
end;
$$;

revoke execute on function public.get_achieve_agent_feedback_overview(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_achieve_agent_feedback_overview(timestamptz, timestamptz)
  to service_role;

create or replace function public.list_achieve_agent_feedback_by_rep(
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_start_at is not null and p_end_at is not null and p_start_at >= p_end_at then
    raise exception using errcode = '22023', message = 'feedback start must precede end';
  end if;
  if p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'representative limit must be between 1 and 500';
  end if;
  if p_offset < 0 then
    raise exception using errcode = '22023', message = 'representative offset must be nonnegative';
  end if;

  with feedback as materialized (
    select attributed.*, form.matched_eavesly_call_id
    from private.achieve_agent_feedback_attributed(p_start_at, p_end_at) as attributed
    join public.achieve_agent_feedback as form on form.id = attributed.feedback_id
    where attributed.achieve_agent_email is not null
  ),
  qa as materialized (
    select * from private.achieve_ordinary_qa_attributed(p_start_at, p_end_at)
  ),
  form_rollup as (
    select
      feedback.achieve_agent_email,
      max(feedback.achieve_agent_name) as achieve_agent_name,
      count(*) as total_submissions,
      count(*) filter (where feedback.rating = 'good') as good,
      count(*) filter (where feedback.rating = 'fair') as fair,
      count(*) filter (where feedback.rating = 'poor') as poor,
      count(*) filter (where feedback.rating = 'other') as other,
      count(*) filter (where feedback.accent) as accent,
      count(*) filter (where feedback.background_noise) as background_noise,
      count(*) filter (where feedback.connection_issues) as connection_issues,
      max(feedback.submitted_at) as latest_submitted_at
    from feedback
    group by feedback.achieve_agent_email
  ),
  qa_rollup as (
    select
      qa.achieve_agent_email,
      max(qa.achieve_agent_name) as achieve_agent_name,
      count(*) as ai_total,
      count(*) filter (where not qa.ai_flagged) as ai_pass,
      count(*) filter (where qa.ai_flagged) as ai_flagged,
      max(qa.graded_at) as latest_ai_graded_at
    from qa
    group by qa.achieve_agent_email
  ),
  recognized_human_calls as (
    select
      feedback.achieve_agent_email,
      feedback.matched_eavesly_call_id as call_id,
      bool_or(case feedback.rating
        when 'fair' then true
        when 'poor' then true
        else false
      end) as human_concern
    from feedback
    where feedback.rating <> 'other'
      and nullif(btrim(feedback.matched_eavesly_call_id), '') is not null
    group by feedback.achieve_agent_email, feedback.matched_eavesly_call_id
  ),
  qa_calls as (
    select qa.achieve_agent_email, qa.call_id, bool_or(qa.ai_flagged) as ai_concern
    from qa
    group by qa.achieve_agent_email, qa.call_id
  ),
  alignment_rollup as (
    select
      human.achieve_agent_email,
      count(*) as overlap_calls,
      count(*) filter (where not human.human_concern and not qa.ai_concern) as both_clear,
      count(*) filter (where human.human_concern and qa.ai_concern) as both_concern,
      count(*) filter (where human.human_concern and not qa.ai_concern) as human_only,
      count(*) filter (where not human.human_concern and qa.ai_concern) as ai_only
    from recognized_human_calls as human
    join qa_calls as qa
      on qa.achieve_agent_email = human.achieve_agent_email
     and qa.call_id = human.call_id
    group by human.achieve_agent_email
  ),
  agent_names as (
    select identity.achieve_agent_email, max(identity.achieve_agent_name) as achieve_agent_name
    from (
      select feedback.achieve_agent_email, feedback.achieve_agent_name from feedback
      union all
      select qa.achieve_agent_email, qa.achieve_agent_name from qa
    ) as identity
    group by identity.achieve_agent_email
  ),
  rollup as (
    select
      agent.achieve_agent_email,
      coalesce(agent.achieve_agent_name, agent.achieve_agent_email) as achieve_agent_name,
      coalesce(form.total_submissions, 0) as total_submissions,
      coalesce(form.good, 0) as good,
      coalesce(form.fair, 0) as fair,
      coalesce(form.poor, 0) as poor,
      coalesce(form.other, 0) as other,
      coalesce(form.accent, 0) as accent,
      coalesce(form.background_noise, 0) as background_noise,
      coalesce(form.connection_issues, 0) as connection_issues,
      form.latest_submitted_at,
      coalesce(qa_rollup.ai_total, 0) as ai_total,
      coalesce(qa_rollup.ai_pass, 0) as ai_pass,
      coalesce(qa_rollup.ai_flagged, 0) as ai_flagged,
      qa_rollup.latest_ai_graded_at,
      coalesce(alignment.overlap_calls, 0) as overlap_calls,
      coalesce(alignment.both_clear, 0) as both_clear,
      coalesce(alignment.both_concern, 0) as both_concern,
      coalesce(alignment.human_only, 0) as human_only,
      coalesce(alignment.ai_only, 0) as ai_only
    from agent_names as agent
    left join form_rollup as form using (achieve_agent_email)
    left join qa_rollup using (achieve_agent_email)
    left join alignment_rollup as alignment using (achieve_agent_email)
  ),
  page as (
    select rollup.*
    from rollup
    order by
      (rollup.total_submissions >= 5 and (rollup.fair + rollup.poor)::numeric / nullif(rollup.total_submissions, 0) >= 0.25) desc,
      coalesce((rollup.fair + rollup.poor)::numeric / nullif(rollup.total_submissions, 0), 0) desc,
      rollup.total_submissions desc,
      rollup.ai_total desc,
      rollup.achieve_agent_name,
      rollup.achieve_agent_email
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by
      (page.total_submissions >= 5 and (page.fair + page.poor)::numeric / nullif(page.total_submissions, 0) >= 0.25) desc,
      coalesce((page.fair + page.poor)::numeric / nullif(page.total_submissions, 0), 0) desc,
      page.total_submissions desc, page.ai_total desc, page.achieve_agent_name, page.achieve_agent_email
    ) from page), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'total', (select count(*) from rollup),
      'loaded', (select count(*) from page),
      'limit', p_limit,
      'offset', p_offset,
      'cap_reached', p_offset + (select count(*) from page) < (select count(*) from rollup)
    )
  ) into result;

  return result;
end;
$$;

revoke execute on function public.list_achieve_agent_feedback_by_rep(timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_achieve_agent_feedback_by_rep(timestamptz, timestamptz, integer, integer)
  to service_role;

create or replace function public.get_achieve_agent_feedback_dashboard(
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_representative_limit integer default 200,
  p_representative_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'overview', public.get_achieve_agent_feedback_overview(p_start_at, p_end_at),
    'representatives', public.list_achieve_agent_feedback_by_rep(
      p_start_at, p_end_at, p_representative_limit, p_representative_offset
    )
  );
$$;

revoke execute on function public.get_achieve_agent_feedback_dashboard(timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_achieve_agent_feedback_dashboard(timestamptz, timestamptz, integer, integer)
  to service_role;

create or replace function public.list_achieve_agent_feedback_for_rep(
  p_agent_email text,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_agent_email text := nullif(lower(btrim(p_agent_email)), '');
  result jsonb;
begin
  if normalized_agent_email is null
    or length(normalized_agent_email) > 254
    or normalized_agent_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'valid representative email is required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'feedback detail limit must be between 1 and 200';
  end if;
  if p_offset < 0 then
    raise exception using errcode = '22023', message = 'feedback detail offset must be nonnegative';
  end if;

  -- ponytail: this all-history detail path currently scales with complete Form
  -- and ordinary-QA history even though each response is capped at 200 rows.
  -- Replace it with a materialized per-call exact-attribution relation when
  -- measured history growth makes representative drawer latency unacceptable.
  with attributed as materialized (
    select attributed.*
    from private.achieve_agent_feedback_attributed(null, null) as attributed
    where attributed.achieve_agent_email = normalized_agent_email
  ),
  form_detail as (
    select
      attributed.feedback_id,
      attributed.submitted_at,
      attributed.rating,
      attributed.accent,
      attributed.background_noise,
      attributed.connection_issues,
      nullif(btrim(feedback.notes), '') as notes,
      nullif(btrim(feedback.submitted_by), '') as submitted_by
    from attributed
    join public.achieve_agent_feedback as feedback on feedback.id = attributed.feedback_id
  ),
  form_page as (
    select detail.* from form_detail as detail
    order by detail.submitted_at desc, detail.feedback_id desc
    limit p_limit offset p_offset
  ),
  qa_detail as materialized (
    select
      qa.module_result_id,
      qa.graded_at,
      case when qa.ai_flagged then 'flagged' else 'pass' end as outcome
    from private.achieve_ordinary_qa_attributed(null, null) as qa
    where qa.achieve_agent_email = normalized_agent_email
  ),
  qa_page as (
    select detail.* from qa_detail as detail
    order by detail.graded_at desc, detail.module_result_id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(form_page) order by form_page.submitted_at desc, form_page.feedback_id desc) from form_page), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'total', (select count(*) from form_detail),
      'loaded', (select count(*) from form_page),
      'limit', p_limit,
      'offset', p_offset,
      'cap_reached', p_offset + (select count(*) from form_page) < (select count(*) from form_detail)
    ),
    'qa_rows', coalesce((select jsonb_agg(to_jsonb(qa_page) order by qa_page.graded_at desc, qa_page.module_result_id desc) from qa_page), '[]'::jsonb),
    'qa_coverage', jsonb_build_object(
      'total', (select count(*) from qa_detail),
      'loaded', (select count(*) from qa_page),
      'limit', p_limit,
      'offset', p_offset,
      'cap_reached', p_offset + (select count(*) from qa_page) < (select count(*) from qa_detail)
    )
  ) into result;

  return result;
end;
$$;

revoke execute on function public.list_achieve_agent_feedback_for_rep(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_achieve_agent_feedback_for_rep(text, integer, integer)
  to service_role;
