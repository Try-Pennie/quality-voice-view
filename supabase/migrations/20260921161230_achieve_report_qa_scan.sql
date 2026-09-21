-- Weekly reports repeatedly scan ordinary Achieve QA across seven ranges.
-- Cover the shared immutable grading predicate so the report need not repeatedly
-- fetch/decompress result_json (including for its all-time range).
-- If achieve_is_ordinary_graded_qa changes, rebuild this index in that migration.
set local lock_timeout = '2s';
set local statement_timeout = '60s';

create index eavesly_module_results_achieve_ordinary_created_idx
  on public.eavesly_module_results (created_at, call_id)
  include (id, has_violation)
  where module_name = 'achieve_welcome_call_qa'
    and private.achieve_is_ordinary_graded_qa(module_name, result_json);

-- Materialize only the four columns consumed below, not the large QA JSON.
create or replace function private.achieve_ordinary_qa_attributed_including_terminated(
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
    select module_result.id, module_result.call_id, module_result.created_at, module_result.has_violation
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
