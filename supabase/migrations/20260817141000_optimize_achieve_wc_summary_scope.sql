-- Keep ordinary-QA aggregation on the Achieve module index before applying
-- the shared JSON grading predicate. Without this explicit planner-visible
-- scope, the SECURITY DEFINER predicate forces a scan of every module row.

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
    where module_result.module_name = 'achieve_welcome_call_qa'
      and private.achieve_is_ordinary_graded_qa(
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
    where module_result.module_name = 'achieve_welcome_call_qa'
      and private.achieve_is_ordinary_graded_qa(
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
