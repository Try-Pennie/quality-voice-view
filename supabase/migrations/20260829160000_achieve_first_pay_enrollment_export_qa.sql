-- Sparse all-history QA rollups for the weekly enrollment attachment. The RPC
-- exposes only normalized AFF/client IDs plus collapsed review outcomes; raw
-- enrollment rows remain in Snowflake and are never stored in Supabase.

create function private.achieve_exact_call_clients(p_call_ids text[])
returns table (
  call_id text,
  normalized_client_id text
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
  )
  select candidate.call_id, min(candidate.normalized_client_id)
  from bridge_candidates as candidate
  group by candidate.call_id
  having count(distinct candidate.normalized_client_id) = 1;
$$;

revoke execute on function private.achieve_exact_call_clients(text[])
  from public, anon, authenticated;
grant execute on function private.achieve_exact_call_clients(text[])
  to service_role;

create function public.get_achieve_first_pay_export_qa_rollups()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with review_calls as materialized (
    select feedback.matched_eavesly_call_id as call_id
    from public.achieve_agent_feedback as feedback
    where nullif(btrim(feedback.matched_eavesly_call_id), '') is not null
      and lower(btrim(feedback.call_quality)) in ('good', 'fair', 'poor')

    union

    select module_result.call_id
    from public.eavesly_module_results as module_result
    where private.achieve_is_ordinary_graded_qa(
        module_result.module_name,
        module_result.result_json
      )
      and nullif(btrim(module_result.call_id), '') is not null
  ),
  exact_clients as materialized (
    select exact.*
    from private.achieve_exact_call_clients(coalesce((
      select array_agg(review.call_id) from review_calls as review
    ), array[]::text[])) as exact
  ),
  human_rollup as (
    select
      exact.normalized_client_id,
      max(case lower(btrim(feedback.call_quality))
        when 'good' then 1
        when 'fair' then 2
        when 'poor' then 3
      end) as worst_rating
    from public.achieve_agent_feedback as feedback
    join exact_clients as exact on exact.call_id = feedback.matched_eavesly_call_id
    where lower(btrim(feedback.call_quality)) in ('good', 'fair', 'poor')
    group by exact.normalized_client_id
  ),
  ai_rollup as (
    select
      exact.normalized_client_id,
      bool_or(module_result.has_violation is true) as ai_flagged
    from public.eavesly_module_results as module_result
    join exact_clients as exact on exact.call_id = module_result.call_id
    where private.achieve_is_ordinary_graded_qa(
      module_result.module_name,
      module_result.result_json
    )
    group by exact.normalized_client_id
  ),
  reviewed_clients as (
    select human.normalized_client_id from human_rollup as human
    union
    select ai.normalized_client_id from ai_rollup as ai
  ),
  rollup as (
    select
      client.normalized_client_id as client_id,
      case human.worst_rating
        when 1 then 'good'
        when 2 then 'fair'
        when 3 then 'poor'
        else null
      end as agent_rating,
      ai.normalized_client_id is not null as ai_reviewed,
      coalesce(ai.ai_flagged, false) as ai_flagged
    from reviewed_clients as client
    left join human_rollup as human using (normalized_client_id)
    left join ai_rollup as ai using (normalized_client_id)
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(rollup) order by rollup.client_id) from rollup
    ), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'rows', (select count(*) from rollup),
      'human_clients', (select count(*) from human_rollup),
      'ai_clients', (select count(*) from ai_rollup)
    )
  );
$$;

comment on function public.get_achieve_first_pay_export_qa_rollups() is
  'Service-only sparse AFF/client QA outcomes for the transient weekly Snowflake enrollment export.';

revoke execute on function public.get_achieve_first_pay_export_qa_rollups()
  from public, anon, authenticated;
grant execute on function public.get_achieve_first_pay_export_qa_rollups()
  to service_role;
