-- Retain terminated representatives' history while excluding activity at or
-- after their effective termination from ordinary Achieve reporting. A
-- separate service-only RPC keeps post-termination Form and AI activity visible.

create table public.achieve_agent_terminations (
  agent_email text primary key,
  agent_name text not null,
  terminated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint achieve_agent_terminations_email_normalized check (
    agent_email = lower(btrim(agent_email))
    and length(agent_email) between 3 and 254
    and agent_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint achieve_agent_terminations_name_present check (nullif(btrim(agent_name), '') is not null)
);

alter table public.achieve_agent_terminations enable row level security;
alter table public.achieve_agent_terminations force row level security;
revoke all on table public.achieve_agent_terminations from public, anon, authenticated;
grant select, insert, update, delete on table public.achieve_agent_terminations to service_role;

insert into public.achieve_agent_terminations(agent_email, agent_name, terminated_at) values
  ('aadigun@achieve.com', 'Aliyu Adigun', '2026-08-24 04:00:00+00'),
  ('ddesravines@achieve.com', 'Darios Desravines', '2026-08-24 04:00:00+00'),
  ('whall@achieve.com', 'Wilma Hall', '2026-08-24 04:00:00+00');

alter function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  rename to achieve_agent_feedback_attributed_including_terminated;

create function private.achieve_agent_feedback_attributed(
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
  select attributed.*
  from private.achieve_agent_feedback_attributed_including_terminated(p_start_at, p_end_at) as attributed
  left join public.achieve_agent_terminations as termination
    on termination.agent_email = attributed.achieve_agent_email
  where termination.agent_email is null
    or attributed.submitted_at < termination.terminated_at;
$$;

revoke execute on function private.achieve_agent_feedback_attributed_including_terminated(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.achieve_agent_feedback_attributed_including_terminated(timestamptz, timestamptz)
  to service_role;
revoke execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  to service_role;

alter function private.achieve_ordinary_qa_attributed(timestamptz, timestamptz)
  rename to achieve_ordinary_qa_attributed_including_terminated;

create function private.achieve_ordinary_qa_attributed(
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
  select attributed.*
  from private.achieve_ordinary_qa_attributed_including_terminated(p_start_at, p_end_at) as attributed
  left join public.achieve_agent_terminations as termination
    on termination.agent_email = attributed.achieve_agent_email
  where termination.agent_email is null
    or attributed.graded_at < termination.terminated_at;
$$;

revoke execute on function private.achieve_ordinary_qa_attributed_including_terminated(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.achieve_ordinary_qa_attributed_including_terminated(timestamptz, timestamptz)
  to service_role;
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
  qa_all as materialized (
    select * from private.achieve_ordinary_qa_attributed_including_terminated(p_start_at, p_end_at)
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
        'all_graded', (select count(*) from all_qa) - ((select count(*) from qa_all) - (select count(*) from qa)),
        'exact_agent_attributed', (select count(*) from qa),
        'agent_unavailable', (select count(*) from all_qa) - (select count(*) from qa_all)
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

create function public.list_achieve_agent_termination_monitoring(
  p_end_at timestamptz default now()
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
  if p_end_at is null then
    raise exception using errcode = '22023', message = 'termination monitoring end is required';
  end if;
  if not exists (
    select 1 from public.achieve_agent_terminations as termination
    where termination.terminated_at < p_end_at
  ) then
    return '[]'::jsonb;
  end if;

  with effective_terminations as materialized (
    select termination.*
    from public.achieve_agent_terminations as termination
    where termination.terminated_at < p_end_at
  ),
  feedback as materialized (
    select attributed.*
    from private.achieve_agent_feedback_attributed_including_terminated(
      (select min(terminated_at) from effective_terminations),
      p_end_at
    ) as attributed
  ),
  qa as materialized (
    select attributed.*
    from private.achieve_ordinary_qa_attributed_including_terminated(
      (select min(terminated_at) from effective_terminations),
      p_end_at
    ) as attributed
  ),
  form_rollup as (
    select
      termination.agent_email,
      count(feedback.feedback_id) as post_termination_form_submissions,
      max(feedback.submitted_at) as latest_post_termination_form_at
    from effective_terminations as termination
    left join feedback
      on feedback.achieve_agent_email = termination.agent_email
     and feedback.submitted_at >= termination.terminated_at
    group by termination.agent_email
  ),
  qa_rollup as (
    select
      termination.agent_email,
      count(qa.module_result_id) as post_termination_ai_calls,
      max(qa.graded_at) as latest_post_termination_ai_at
    from effective_terminations as termination
    left join qa
      on qa.achieve_agent_email = termination.agent_email
     and qa.graded_at >= termination.terminated_at
    group by termination.agent_email
  ),
  monitoring as (
    select
      termination.agent_name,
      termination.agent_email,
      termination.terminated_at,
      form_rollup.post_termination_form_submissions,
      form_rollup.latest_post_termination_form_at,
      qa_rollup.post_termination_ai_calls,
      qa_rollup.latest_post_termination_ai_at
    from effective_terminations as termination
    join form_rollup using (agent_email)
    join qa_rollup using (agent_email)
  )
  select coalesce(jsonb_agg(to_jsonb(monitoring) order by monitoring.agent_name, monitoring.agent_email), '[]'::jsonb)
  into result
  from monitoring;

  return result;
end;
$$;

revoke execute on function public.list_achieve_agent_termination_monitoring(timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_achieve_agent_termination_monitoring(timestamptz)
  to service_role;
