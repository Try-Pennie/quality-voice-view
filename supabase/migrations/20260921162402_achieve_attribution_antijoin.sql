-- Avoid joining two severely underestimated grouped CTEs (millions of candidate
-- pairs per report range). A latest nonblank agent is unambiguous exactly when
-- no different nonblank normalized email exists for that same client.
set local lock_timeout = '2s';

create or replace function private.achieve_exact_call_agents(p_call_ids text[])
returns table (call_id text, achieve_agent_name text, achieve_agent_email text)
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
  latest_agents as (
    select distinct on (lower(btrim(log.client_id)))
      lower(btrim(log.client_id)) as normalized_client_id,
      nullif(btrim(log.welcome_call_agent_name), '') as achieve_agent_name,
      lower(btrim(log.welcome_call_agent_email)) as achieve_agent_email
    from requested_clients as requested
    join public.welcome_call_agent_log as log
      on lower(btrim(log.client_id)) = requested.normalized_client_id
    where nullif(btrim(log.welcome_call_agent_email), '') is not null
      and not exists (
        select 1 from public.welcome_call_agent_log as conflicting
        where lower(btrim(conflicting.client_id)) = lower(btrim(log.client_id))
          and nullif(lower(btrim(conflicting.welcome_call_agent_email)), '') is not null
          and lower(btrim(conflicting.welcome_call_agent_email)) <> lower(btrim(log.welcome_call_agent_email))
      )
    order by lower(btrim(log.client_id)), log.last_seen_on desc, log.id desc
  )
  select
    bridge.call_id,
    coalesce(agent.achieve_agent_name, agent.achieve_agent_email),
    agent.achieve_agent_email
  from unambiguous_bridges as bridge
  join latest_agents as agent
    on agent.normalized_client_id = bridge.normalized_client_id;
$$;
