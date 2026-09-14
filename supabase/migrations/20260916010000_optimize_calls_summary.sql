-- Representative PostgreSQL 17 fixture plans at the production-configured
-- work_mem showed that the joined MATERIALIZED CTE added avoidable temp writes.
-- Keep the shared window materialized for window totals/options, but stream the
-- filtered latest-QA rows into the KPI aggregate so each filter runs once.

create or replace function public.eavesly_calls_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_agents text[],
  p_dispositions text[],
  p_quick_filter text,
  p_thresholds jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_thresholds jsonb;
  v_result jsonb;
begin
  if p_start is null or p_end is null
    or not isfinite(p_start) or not isfinite(p_end) or p_start > p_end
    or p_quick_filter is null
    or p_quick_filter not in ('all', 'escalations', 'compliance', 'threshold', 'rushed') then
    raise exception using errcode = 'P0001', message = 'EAVESLY_INVALID_CALLS_QUERY';
  end if;

  v_thresholds := case
    when jsonb_typeof(p_thresholds) = 'object' then p_thresholds
    else '{"overallScore":"needs_improvement","compliance":"fail","customerSat":"low"}'::jsonb
  end;

  with windowed as materialized (
    select c.call_id, c.disposition, c.campaign_name, c.talk_time, c.handle_time
    from public.eavesly_calls c
    where c.started_at >= p_start and c.started_at <= p_end
      and (coalesce(cardinality(p_agents), 0) = 0 or c.agent_email = any(p_agents))
  ), joined as (
    select c.*, qa.qa_id, qa.overall_score, qa.compliance_rating,
      qa.customer_satisfaction_likely, qa.manager_escalation
    from windowed c
    left join lateral (
      select q.id as qa_id, q.overall_score, q.compliance_rating,
        q.customer_satisfaction_likely, q.manager_escalation
      from public.eavesly_transcription_qa q
      where q.call_id = c.call_id
      order by q.created_at desc nulls last, q.id desc
      limit 1
    ) qa on true
  ), filtered as (
    select *
    from joined c
    where (coalesce(cardinality(p_dispositions), 0) = 0 or c.disposition = any(p_dispositions))
      and case p_quick_filter
        when 'all' then true
        when 'escalations' then c.manager_escalation is true
        when 'compliance' then c.compliance_rating = 'fail'
        when 'threshold' then
          c.manager_escalation is true
          or c.compliance_rating = (v_thresholds ->> 'compliance')
          or (
            c.overall_score = any(array['excellent','good','needs_improvement','poor'])
            and (
              not coalesce((v_thresholds ->> 'overallScore') = any(array['excellent','good','needs_improvement','poor']), false)
              or array_position(array['excellent','good','needs_improvement','poor'], c.overall_score)
                >= array_position(array['excellent','good','needs_improvement','poor'], v_thresholds ->> 'overallScore')
            )
          )
          or (
            c.customer_satisfaction_likely = any(array['high','medium','low'])
            and (
              not coalesce((v_thresholds ->> 'customerSat') = any(array['high','medium','low']), false)
              or array_position(array['high','medium','low'], c.customer_satisfaction_likely)
                >= array_position(array['high','medium','low'], v_thresholds ->> 'customerSat')
            )
          )
        else
          position('no show' in trim(regexp_replace(lower(coalesce(c.disposition, '')), '[^a-z0-9]+', ' ', 'g'))) = 0
          and (
            position('cal com meeting' in concat(
              trim(regexp_replace(lower(coalesce(c.campaign_name, '')), '[^a-z0-9]+', ' ', 'g')),
              ' ', trim(regexp_replace(lower(coalesce(c.disposition, '')), '[^a-z0-9]+', ' ', 'g'))
            )) > 0
            or position('call now requested' in concat(
              trim(regexp_replace(lower(coalesce(c.campaign_name, '')), '[^a-z0-9]+', ' ', 'g')),
              ' ', trim(regexp_replace(lower(coalesce(c.disposition, '')), '[^a-z0-9]+', ' ', 'g'))
            )) > 0
          )
          and c.talk_time > 0 and c.talk_time < 1800
      end
  ), metrics as (
    select
      count(*) as total_calls,
      count(*) filter (where
        manager_escalation is true
        or compliance_rating = 'fail'
        or overall_score in ('poor', 'needs_improvement')
        or customer_satisfaction_likely = 'low'
      ) as calls_requiring_attention,
      floor(coalesce(sum(coalesce(talk_time, 0))::numeric / nullif(count(*), 0), 0) + 0.5) as avg_talk_time,
      floor(coalesce(sum(coalesce(handle_time, 0))::numeric / nullif(count(*), 0), 0) + 0.5) as avg_handle_time,
      case when count(qa_id) = 0 then 0 else
        round(100.0 * count(*) filter (where compliance_rating = 'pass') / count(qa_id))
      end as compliance_pass_rate,
      case when count(qa_id) = 0 then 0 else
        round(100.0 * count(*) filter (where customer_satisfaction_likely = 'high') / count(qa_id))
      end as high_sat_rate
    from filtered
  ), window_metrics as (
    select count(*) as window_calls
    from windowed
  ), disposition_options as (
    select coalesce(jsonb_agg(disposition order by disposition collate "C"), '[]'::jsonb) as dispositions
    from (select distinct disposition from windowed where disposition is not null and disposition <> '') d
  )
  select jsonb_build_object(
    'total_calls', m.total_calls,
    'window_calls', w.window_calls,
    'calls_requiring_attention', m.calls_requiring_attention,
    'avg_talk_time', m.avg_talk_time,
    'avg_handle_time', m.avg_handle_time,
    'compliance_pass_rate', m.compliance_pass_rate,
    'high_sat_rate', m.high_sat_rate,
    'dispositions', d.dispositions
  )
  into v_result
  from metrics m cross join window_metrics w cross join disposition_options d;

  return v_result;
end;
$$;

revoke execute on function public.eavesly_calls_summary(
  timestamptz, timestamptz, text[], text[], text, jsonb
) from public, anon;
grant execute on function public.eavesly_calls_summary(
  timestamptz, timestamptz, text[], text[], text, jsonb
) to authenticated;
