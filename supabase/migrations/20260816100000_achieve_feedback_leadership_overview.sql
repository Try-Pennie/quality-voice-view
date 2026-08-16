-- Complete Pennie-agent Form aggregates for the Achieve leadership portal.
--
-- These RPCs intentionally read achieve_agent_feedback directly instead of
-- deriving Form metrics from the capped ordinary-QA call list. Representative
-- rollups include only unambiguous daily-report attribution. A known call with
-- missing or conflicting representative evidence stays in the explicit
-- representative-unavailable bucket rather than being guessed.

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
  with call_lead_candidates as (
    select
      calls.call_id,
      btrim(calls.sfdc_lead_id) as sfdc_lead_id
    from public.eavesly_calls as calls
    where nullif(btrim(calls.call_id), '') is not null
      and nullif(btrim(calls.sfdc_lead_id), '') is not null

    union

    select
      module_result.call_id,
      btrim(module_result.sfdc_lead_id) as sfdc_lead_id
    from public.eavesly_module_results as module_result
    where module_result.module_name = 'achieve_welcome_call_qa'
      and nullif(btrim(module_result.call_id), '') is not null
      and nullif(btrim(module_result.sfdc_lead_id), '') is not null
  ),
  unambiguous_call_leads as (
    select
      candidate.call_id,
      min(candidate.sfdc_lead_id) as sfdc_lead_id
    from call_lead_candidates as candidate
    group by candidate.call_id
    having count(distinct candidate.sfdc_lead_id) = 1
  ),
  unambiguous_clients as (
    select
      lower(btrim(log.client_id)) as normalized_client_id
    from public.welcome_call_agent_log as log
    group by lower(btrim(log.client_id))
    having count(distinct nullif(lower(btrim(log.welcome_call_agent_email)), '')) = 1
  ),
  latest_agents as (
    select distinct on (lower(btrim(log.client_id)))
      lower(btrim(log.client_id)) as normalized_client_id,
      nullif(btrim(log.welcome_call_agent_name), '') as achieve_agent_name,
      nullif(lower(btrim(log.welcome_call_agent_email)), '') as achieve_agent_email
    from public.welcome_call_agent_log as log
    where nullif(btrim(log.welcome_call_agent_name), '') is not null
      and nullif(btrim(log.welcome_call_agent_email), '') is not null
    order by lower(btrim(log.client_id)), log.last_seen_on desc, log.id desc
  ),
  filtered_feedback as (
    select feedback.*
    from public.achieve_agent_feedback as feedback
    where (p_start_at is null or feedback.submitted_at >= p_start_at)
      and (p_end_at is null or feedback.submitted_at < p_end_at)
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
    feedback.matched_eavesly_call_id is not null,
    feedback.call_match_reason,
    latest_agents.achieve_agent_name,
    latest_agents.achieve_agent_email
  from filtered_feedback as feedback
  left join unambiguous_call_leads as call_lead
    on call_lead.call_id = feedback.matched_eavesly_call_id
  left join public.achieve_client_sfdc_map as bridge
    on btrim(bridge.sfdc_lead_id) = call_lead.sfdc_lead_id
  left join unambiguous_clients as unambiguous_client
    on unambiguous_client.normalized_client_id = lower(btrim(bridge.client_id))
  left join latest_agents
    on latest_agents.normalized_client_id = unambiguous_client.normalized_client_id;
$$;

revoke execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
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
    raise exception using
      errcode = '22023',
      message = 'feedback start must precede end';
  end if;

  with feedback as (
    select *
    from private.achieve_agent_feedback_attributed(p_start_at, p_end_at)
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
      'agent_unavailable', count(*) filter (
        where feedback.call_associated and feedback.achieve_agent_email is null
      ),
      'unresolved', count(*) filter (where not feedback.call_associated)
    ),
    'unresolved_reasons', jsonb_build_object(
      'call_ambiguous', count(*) filter (
        where not feedback.call_associated and feedback.call_match_reason = 'call_ambiguous'
      ),
      'no_call_in_window', count(*) filter (
        where not feedback.call_associated and feedback.call_match_reason = 'no_call_in_window'
      ),
      'invalid_phone', count(*) filter (
        where not feedback.call_associated and feedback.call_match_reason = 'invalid_phone'
      ),
      'submitter_not_found', count(*) filter (
        where not feedback.call_associated and feedback.call_match_reason = 'submitter_not_found'
      ),
      'other', count(*) filter (
        where not feedback.call_associated
          and coalesce(feedback.call_match_reason, '') not in (
            'call_ambiguous',
            'no_call_in_window',
            'invalid_phone',
            'submitter_not_found'
          )
      )
    ),
    'distinct_exact_agents', count(distinct feedback.achieve_agent_email)
  )
  into overview
  from feedback;

  return overview;
end;
$$;

comment on function public.get_achieve_agent_feedback_overview(timestamptz, timestamptz) is
  'Service-only complete Form aggregate for the Achieve leadership portal. The end timestamp is exclusive.';

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
    raise exception using
      errcode = '22023',
      message = 'feedback start must precede end';
  end if;
  if p_limit < 1 or p_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'representative limit must be between 1 and 500';
  end if;
  if p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'representative offset must be nonnegative';
  end if;

  with feedback as (
    select *
    from private.achieve_agent_feedback_attributed(p_start_at, p_end_at)
    where achieve_agent_email is not null
  ),
  rollup as (
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
  page as (
    select rollup.*
    from rollup
    order by
      (
        rollup.total_submissions >= 5
        and (rollup.fair + rollup.poor)::numeric / rollup.total_submissions >= 0.25
      ) desc,
      (rollup.fair + rollup.poor)::numeric / rollup.total_submissions desc,
      rollup.total_submissions desc,
      rollup.achieve_agent_name,
      rollup.achieve_agent_email
    limit p_limit
    offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by
        (
          page.total_submissions >= 5
          and (page.fair + page.poor)::numeric / page.total_submissions >= 0.25
        ) desc,
        (page.fair + page.poor)::numeric / page.total_submissions desc,
        page.total_submissions desc,
        page.achieve_agent_name,
        page.achieve_agent_email
      )
      from page
    ), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'total', (select count(*) from rollup),
      'loaded', (select count(*) from page),
      'limit', p_limit,
      'offset', p_offset,
      'cap_reached', p_offset + (select count(*) from page) < (select count(*) from rollup)
    )
  )
  into result;

  return result;
end;
$$;

comment on function public.list_achieve_agent_feedback_by_rep(timestamptz, timestamptz, integer, integer) is
  'Service-only submission-level Form rollup by exact unambiguous Achieve representative attribution.';

revoke execute on function public.list_achieve_agent_feedback_by_rep(timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_achieve_agent_feedback_by_rep(timestamptz, timestamptz, integer, integer)
  to service_role;

-- Return both aggregates from one SQL statement so the strict browser
-- cross-checks compare values from one PostgreSQL MVCC snapshot. Two separate
-- PostgREST RPCs could otherwise observe a Form sync between their reads and
-- fail closed even though both individual payloads were valid.
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
      p_start_at,
      p_end_at,
      p_representative_limit,
      p_representative_offset
    )
  );
$$;

comment on function public.get_achieve_agent_feedback_dashboard(timestamptz, timestamptz, integer, integer) is
  'Service-only complete Form aggregate and representative rollup returned from one database snapshot.';

revoke execute on function public.get_achieve_agent_feedback_dashboard(timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_achieve_agent_feedback_dashboard(timestamptz, timestamptz, integer, integer)
  to service_role;
