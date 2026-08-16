-- Bound Achieve feedback attribution work to calls referenced by the selected
-- Form period. The leadership dashboard previously grouped every Eavesly call
-- and Achieve module result twice per request, even though only a few hundred
-- associated feedback call IDs were relevant.

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
  requested_calls as (
    select distinct feedback.matched_eavesly_call_id as call_id
    from filtered_feedback as feedback
    where nullif(btrim(feedback.matched_eavesly_call_id), '') is not null
  ),
  call_lead_candidates as (
    select
      calls.call_id,
      btrim(calls.sfdc_lead_id) as sfdc_lead_id
    from requested_calls as requested
    join public.eavesly_calls as calls
      on calls.call_id = requested.call_id
    where nullif(btrim(calls.sfdc_lead_id), '') is not null

    union all

    select
      module_result.call_id,
      btrim(module_result.sfdc_lead_id) as sfdc_lead_id
    from requested_calls as requested
    join public.eavesly_module_results as module_result
      on module_result.call_id = requested.call_id
     and module_result.module_name = 'achieve_welcome_call_qa'
    where nullif(btrim(module_result.sfdc_lead_id), '') is not null
  ),
  unambiguous_call_leads as (
    select
      candidate.call_id,
      min(candidate.sfdc_lead_id) as sfdc_lead_id
    from call_lead_candidates as candidate
    group by candidate.call_id
    having count(distinct candidate.sfdc_lead_id) = 1
  ),
  requested_bridges as (
    select
      call_lead.call_id,
      lower(btrim(bridge.client_id)) as normalized_client_id
    from unambiguous_call_leads as call_lead
    join public.achieve_client_sfdc_map as bridge
      on btrim(bridge.sfdc_lead_id) = call_lead.sfdc_lead_id
  ),
  requested_clients as (
    select distinct bridge.normalized_client_id
    from requested_bridges as bridge
  ),
  unambiguous_clients as (
    select
      lower(btrim(log.client_id)) as normalized_client_id
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
      nullif(lower(btrim(log.welcome_call_agent_email)), '') as achieve_agent_email
    from requested_clients as requested
    join public.welcome_call_agent_log as log
      on lower(btrim(log.client_id)) = requested.normalized_client_id
    where nullif(btrim(log.welcome_call_agent_name), '') is not null
      and nullif(btrim(log.welcome_call_agent_email), '') is not null
    order by lower(btrim(log.client_id)), log.last_seen_on desc, log.id desc
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
  left join requested_bridges as bridge
    on bridge.call_id = feedback.matched_eavesly_call_id
  left join unambiguous_clients as unambiguous_client
    on unambiguous_client.normalized_client_id = bridge.normalized_client_id
  left join latest_agents
    on latest_agents.normalized_client_id = unambiguous_client.normalized_client_id;
$$;

revoke execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.achieve_agent_feedback_attributed(timestamptz, timestamptz)
  to service_role;
