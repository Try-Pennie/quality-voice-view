-- Bounded Calls/Team reads. All RPCs run as the caller so existing grants and
-- RLS remain authoritative. The ordered covering index makes each deterministic
-- latest-QA lookup one bounded probe; the default first page performs 26 probes.

create index if not exists eavesly_transcription_qa_latest_idx
  on public.eavesly_transcription_qa (call_id, created_at desc nulls last, id desc)
  include (overall_score, compliance_rating, customer_satisfaction_likely, manager_escalation);

create or replace function public.eavesly_calls_page(
  p_start timestamptz,
  p_end timestamptz,
  p_agents text[],
  p_dispositions text[],
  p_quick_filter text,
  p_thresholds jsonb,
  p_sort text,
  p_desc boolean,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_direction text;
  v_order text;
  v_thresholds jsonb;
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_start > p_end
    or p_quick_filter is null
    or p_quick_filter not in ('all', 'escalations', 'compliance', 'threshold', 'rushed')
    or p_sort is null
    or p_sort not in ('time', 'agent', 'talk', 'score', 'compliance', 'csat')
    or p_desc is null
    or p_offset is null or p_offset < 0
    or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = 'P0001', message = 'EAVESLY_INVALID_CALLS_QUERY';
  end if;

  v_thresholds := case
    when jsonb_typeof(p_thresholds) = 'object' then p_thresholds
    else '{"overallScore":"needs_improvement","compliance":"fail","customerSat":"low"}'::jsonb
  end;
  v_direction := case when p_desc then 'desc' else 'asc' end;
  v_order := case p_sort
    when 'time' then format('c.started_at %s, c.id desc', v_direction)
    when 'agent' then format(
      'lower(coalesce(nullif(btrim(c.agent_full_name), ''''), regexp_replace(split_part(coalesce(c.agent_email, ''''), ''@'', 1), ''[._-]+'', '' '', ''g''))) collate "C" %s nulls last, c.started_at desc nulls last, c.id desc',
      v_direction)
    when 'talk' then format(
      'coalesce(c.talk_time, 0) %s, c.started_at desc nulls last, c.id desc',
      v_direction)
    when 'score' then format(
      '(case lower(qa.overall_score) when ''excellent'' then 5 when ''pass'' then 5 when ''high'' then 5 when ''good'' then 4 when ''medium'' then 4 when ''fair'' then 3 when ''needs_improvement'' then 3 when ''low'' then 3 when ''poor'' then 2 when ''fail'' then 2 else 0 end) %s, c.started_at desc nulls last, c.id desc',
      v_direction)
    when 'compliance' then format(
      '(case lower(qa.compliance_rating) when ''excellent'' then 5 when ''pass'' then 5 when ''high'' then 5 when ''good'' then 4 when ''medium'' then 4 when ''fair'' then 3 when ''needs_improvement'' then 3 when ''low'' then 3 when ''poor'' then 2 when ''fail'' then 2 else 0 end) %s, c.started_at desc nulls last, c.id desc',
      v_direction)
    else format(
      '(case lower(qa.customer_satisfaction_likely) when ''excellent'' then 5 when ''pass'' then 5 when ''high'' then 5 when ''good'' then 4 when ''medium'' then 4 when ''fair'' then 3 when ''needs_improvement'' then 3 when ''low'' then 3 when ''poor'' then 2 when ''fail'' then 2 else 0 end) %s, c.started_at desc nulls last, c.id desc',
      v_direction)
  end;

  execute format($query$
    with limited as (
      select jsonb_build_object(
        'id', c.id,
        'call_id', c.call_id,
        'agent_email', c.agent_email,
        'agent_full_name', c.agent_full_name,
        'started_at', c.started_at,
        'contact_phone', c.contact_phone,
        'talk_time', c.talk_time,
        'handle_time', c.handle_time,
        'disposition', c.disposition,
        'campaign_name', c.campaign_name,
        'qa', case when qa.call_id is null then null else jsonb_build_object(
          'call_id', qa.call_id,
          'overall_score', qa.overall_score,
          'compliance_rating', qa.compliance_rating,
          'customer_satisfaction_likely', qa.customer_satisfaction_likely,
          'manager_escalation', qa.manager_escalation
        ) end
      ) as row_json
      from public.eavesly_calls c
      left join lateral (
        select q.call_id, q.overall_score, q.compliance_rating,
          q.customer_satisfaction_likely, q.manager_escalation
        from public.eavesly_transcription_qa q
        where q.call_id = c.call_id
        order by q.created_at desc nulls last, q.id desc
        limit 1
      ) qa on true
      where c.started_at >= $1 and c.started_at <= $2
        and (coalesce(cardinality($3), 0) = 0 or c.agent_email = any($3))
        and (coalesce(cardinality($4), 0) = 0 or c.disposition = any($4))
        and case $5
          when 'all' then true
          when 'escalations' then qa.manager_escalation is true
          when 'compliance' then qa.compliance_rating = 'fail'
          when 'threshold' then
            qa.manager_escalation is true
            or qa.compliance_rating = ($6 ->> 'compliance')
            or (
              qa.overall_score = any(array['excellent','good','needs_improvement','poor'])
              and (
                not coalesce(($6 ->> 'overallScore') = any(array['excellent','good','needs_improvement','poor']), false)
                or array_position(array['excellent','good','needs_improvement','poor'], qa.overall_score)
                  >= array_position(array['excellent','good','needs_improvement','poor'], $6 ->> 'overallScore')
              )
            )
            or (
              qa.customer_satisfaction_likely = any(array['high','medium','low'])
              and (
                not coalesce(($6 ->> 'customerSat') = any(array['high','medium','low']), false)
                or array_position(array['high','medium','low'], qa.customer_satisfaction_likely)
                  >= array_position(array['high','medium','low'], $6 ->> 'customerSat')
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
      order by %s
      offset $7 limit ($8 + 1)
    ), numbered as (
      select row_json, row_number() over () as row_number
      from limited
    )
    select jsonb_build_object(
      'rows', coalesce(
        jsonb_agg(row_json order by row_number) filter (where row_number <= $8),
        '[]'::jsonb
      ),
      'has_more', count(*) > $8
    )
    from numbered
  $query$, v_order)
  into v_result
  using p_start, p_end, p_agents, p_dispositions, p_quick_filter, v_thresholds,
    p_offset, p_limit;

  return v_result;
end;
$$;

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
  if p_start is null or p_end is null or p_start > p_end
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
  ), joined as materialized (
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
      round(coalesce(sum(coalesce(talk_time, 0))::numeric / nullif(count(*), 0), 0)) as avg_talk_time,
      round(coalesce(sum(coalesce(handle_time, 0))::numeric / nullif(count(*), 0), 0)) as avg_handle_time,
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
    from (select distinct disposition from windowed where disposition is not null) d
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

create or replace function public.eavesly_active_call_agents(p_since timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_since is null then
    raise exception using errcode = 'P0001', message = 'EAVESLY_INVALID_CALLS_QUERY';
  end if;

  with latest as (
    select distinct on (c.agent_email)
      c.agent_email, c.agent_full_name
    from public.eavesly_calls c
    where c.started_at >= p_since
      and c.agent_email is not null
      and c.agent_full_name is not null
    order by c.agent_email, c.started_at desc nulls last, c.id desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'agent_email', agent_email,
      'agent_full_name', agent_full_name
    ) order by lower(agent_full_name) collate "C", agent_email collate "C"
  ), '[]'::jsonb)
  into v_result
  from latest;

  return v_result;
end;
$$;

create or replace function public.eavesly_team_pitch_risk(
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_caller text;
  v_god boolean;
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_start > p_end then
    raise exception using errcode = 'P0001', message = 'EAVESLY_INVALID_CALLS_QUERY';
  end if;

  v_caller := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_caller = '' then
    return '[]'::jsonb;
  end if;

  select exists (
    select 1
    from public.manager_coaching_prompts p
    where lower(p.manager_email) = v_caller and p.is_god_mode
  ) into v_god;

  with authorized as (
    select distinct c.agent_email
    from public.eavesly_calls c
    where v_god
      and c.agent_email is not null
      and c.started_at >= p_start and c.started_at <= p_end
    union
    select m.agent_email
    from public.agent_manager_mapping m
    where not v_god and lower(m.manager_email) = v_caller
  ), normalized as (
    select
      a.agent_email,
      c.id as call_row_id,
      c.talk_time,
      trim(regexp_replace(lower(coalesce(c.campaign_name, '')), '[^a-z0-9]+', ' ', 'g')) as campaign,
      trim(regexp_replace(lower(coalesce(c.disposition, '')), '[^a-z0-9]+', ' ', 'g')) as disposition
    from authorized a
    left join public.eavesly_calls c
      on c.agent_email = a.agent_email
      and c.started_at >= p_start and c.started_at <= p_end
  ), classified as (
    select *,
      call_row_id is not null
      and position('no show' in disposition) = 0
      and (
        position('cal com meeting' in concat(campaign, ' ', disposition)) > 0
        or position('call now requested' in concat(campaign, ' ', disposition)) > 0
      ) as is_pitch
    from normalized
  ), counts as (
    select
      agent_email,
      count(*) filter (where is_pitch) as pitch_call_count,
      count(*) filter (where is_pitch and talk_time > 0 and talk_time < 1800) as rushed_pitch_count
    from classified
    group by agent_email
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'agent_email', agent_email,
      'pitch_call_count', pitch_call_count,
      'rushed_pitch_count', rushed_pitch_count
    ) order by agent_email collate "C"
  ), '[]'::jsonb)
  into v_result
  from counts;

  return v_result;
end;
$$;

revoke execute on function public.eavesly_calls_page(
  timestamptz, timestamptz, text[], text[], text, jsonb, text, boolean, integer, integer
) from public, anon;
revoke execute on function public.eavesly_calls_summary(
  timestamptz, timestamptz, text[], text[], text, jsonb
) from public, anon;
revoke execute on function public.eavesly_active_call_agents(timestamptz)
  from public, anon;
revoke execute on function public.eavesly_team_pitch_risk(timestamptz, timestamptz)
  from public, anon;

grant execute on function public.eavesly_calls_page(
  timestamptz, timestamptz, text[], text[], text, jsonb, text, boolean, integer, integer
) to authenticated;
grant execute on function public.eavesly_calls_summary(
  timestamptz, timestamptz, text[], text[], text, jsonb
) to authenticated;
grant execute on function public.eavesly_active_call_agents(timestamptz)
  to authenticated;
grant execute on function public.eavesly_team_pitch_risk(timestamptz, timestamptz)
  to authenticated;
