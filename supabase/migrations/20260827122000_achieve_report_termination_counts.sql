-- Count distinct clients first assigned on or after termination.

create or replace function public.list_achieve_agent_termination_monitoring(
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
    select 1 from public.achieve_agent_terminations termination
    where (termination.terminated_at at time zone 'America/New_York')::date
        >= (p_end_at at time zone 'America/New_York')::date - 7
      and termination.terminated_at < p_end_at
  ) then
    return '[]'::jsonb;
  end if;

  with effective_terminations as materialized (
    select termination.*
    from public.achieve_agent_terminations termination
    where (termination.terminated_at at time zone 'America/New_York')::date
        >= (p_end_at at time zone 'America/New_York')::date - 7
      and termination.terminated_at < p_end_at
  ),
  monitoring as (
    select
      termination.agent_name,
      termination.agent_email,
      termination.terminated_at,
      max(log.last_seen_on) filter (
        where log.last_seen_on <= (p_end_at at time zone 'America/New_York')::date
      ) as last_activity_on,
      count(distinct lower(btrim(log.client_id))) filter (
        where log.first_seen_on >= (termination.terminated_at at time zone 'America/New_York')::date
          and log.first_seen_on <= (p_end_at at time zone 'America/New_York')::date
      ) as activity_post_termination
    from effective_terminations termination
    left join public.welcome_call_agent_log log
      on lower(btrim(log.welcome_call_agent_email)) = termination.agent_email
    group by termination.agent_name, termination.agent_email, termination.terminated_at
  )
  select coalesce(jsonb_agg(to_jsonb(monitoring) order by monitoring.agent_name, monitoring.agent_email), '[]'::jsonb)
  into result
  from monitoring;

  return result;
end
$$;

comment on function public.list_achieve_agent_termination_monitoring(timestamptz) is
  'Service-only recent terminations by Eastern calendar date, with last WC activity and distinct clients first assigned on or after termination.';

revoke execute on function public.list_achieve_agent_termination_monitoring(timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_achieve_agent_termination_monitoring(timestamptz)
  to service_role;
