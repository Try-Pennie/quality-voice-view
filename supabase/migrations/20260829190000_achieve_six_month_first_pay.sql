-- Add mature 2/4/6-week and trailing six-month organizational first-pay
-- totals with true, non-overlapping previous-period comparisons.

create or replace function public.get_achieve_first_pay_outcomes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with snapshot as (
  select source_as_of, refreshed_at, source_as_of - 10 as maturity_cutoff
  from public.achieve_first_pay_outcome_snapshot
  where singleton
),
windows(
  period_order, period_key, start_date, end_date, previous_start_date, previous_end_date
) as (
  select 1, 'all_time'::text, null::date, maturity_cutoff, null::date, null::date from snapshot
  union all
  select 2, 'mature_2_weeks', maturity_cutoff - 13, maturity_cutoff, maturity_cutoff - 27, maturity_cutoff - 14 from snapshot
  union all
  select 3, 'mature_4_weeks', maturity_cutoff - 27, maturity_cutoff, maturity_cutoff - 55, maturity_cutoff - 28 from snapshot
  union all
  select 4, 'mature_6_weeks', maturity_cutoff - 41, maturity_cutoff, maturity_cutoff - 83, maturity_cutoff - 42 from snapshot
  union all
  select 5, 'mature_6_months',
    (maturity_cutoff - interval '6 months' + interval '1 day')::date,
    maturity_cutoff,
    (maturity_cutoff - interval '12 months' + interval '1 day')::date,
    (maturity_cutoff - interval '6 months')::date
  from snapshot
),
organization as (
  select
    w.period_key,
    coalesce(sum(d.n) filter (
      where d.cohort_date <= w.end_date and (w.start_date is null or d.cohort_date >= w.start_date)
    ), 0)::bigint as n,
    coalesce(sum(d.paid) filter (
      where d.cohort_date <= w.end_date and (w.start_date is null or d.cohort_date >= w.start_date)
    ), 0)::bigint as paid,
    case when w.previous_start_date is not null and count(*) filter (
      where d.cohort_date between w.previous_start_date and w.previous_end_date
    ) > 0 then sum(d.n) filter (
      where d.cohort_date between w.previous_start_date and w.previous_end_date
    )::bigint end as previous_n,
    case when w.previous_start_date is not null and count(*) filter (
      where d.cohort_date between w.previous_start_date and w.previous_end_date
    ) > 0 then sum(d.paid) filter (
      where d.cohort_date between w.previous_start_date and w.previous_end_date
    )::bigint end as previous_paid
  from windows w
  left join public.achieve_first_pay_outcome_daily d
    on d.cohort_date <= w.end_date
   and (w.start_date is null or d.cohort_date >= w.previous_start_date)
  group by w.period_key, w.previous_start_date, w.previous_end_date
),
agent_week as (
  select
    w.period_order,
    w.period_key,
    w.start_date,
    w.end_date,
    d.agent_email,
    (array_agg(d.agent_name order by d.cohort_date desc))[1] as agent_name,
    date_trunc('week', d.cohort_date)::date as cohort_week,
    sum(d.n)::bigint as agent_n,
    sum(d.no_deposit)::bigint as agent_failures,
    sum(d.rescinded)::bigint as rescinded,
    sum(d.never_paid)::bigint as never_paid
  from windows w
  join public.achieve_first_pay_outcome_daily d
    on d.cohort_date <= w.end_date
   and (w.start_date is null or d.cohort_date >= w.start_date)
  group by w.period_order, w.period_key, w.start_date, w.end_date, d.agent_email, date_trunc('week', d.cohort_date)
),
week_totals as (
  select period_key, cohort_week, sum(agent_n) as roster_n, sum(agent_failures) as roster_failures
  from agent_week
  group by period_key, cohort_week
),
agent_totals as (
  select
    period_order, period_key, start_date, end_date, agent_email,
    (array_agg(agent_name order by cohort_week desc))[1] as agent_name,
    sum(agent_n) as n,
    sum(agent_failures) as failures,
    sum(rescinded) as rescinded,
    sum(never_paid) as never_paid
  from agent_week
  group by period_order, period_key, start_date, end_date, agent_email
),
expected as (
  select
    a.period_key,
    a.agent_email,
    sum(a.agent_n) as expected_n,
    sum(a.agent_failures) as actual_failures_for_z,
    sum(a.agent_n * ((t.roster_failures - a.agent_failures)::numeric / (t.roster_n - a.agent_n))) as expected_failures,
    sum(a.agent_n * (1 - ((t.roster_failures - a.agent_failures)::numeric / (t.roster_n - a.agent_n)))) as expected_successes,
    sum(a.agent_n * ((t.roster_failures - a.agent_failures)::numeric / (t.roster_n - a.agent_n))
      * (1 - ((t.roster_failures - a.agent_failures)::numeric / (t.roster_n - a.agent_n)))) as variance
  from agent_week a
  join week_totals t using (period_key, cohort_week)
  where t.roster_n > a.agent_n
  group by a.period_key, a.agent_email
),
metrics as (
  select
    a.*,
    e.expected_n,
    e.expected_failures,
    e.expected_successes,
    case when a.n > 0 then a.failures::numeric * 100 / a.n end as failure_rate,
    case when e.expected_n = a.n then e.expected_failures * 100 / e.expected_n end as expected_rate,
    case when e.expected_n = a.n then
      (e.actual_failures_for_z::numeric / e.expected_n - e.expected_failures / e.expected_n) * 100
    end as delta_pp,
    case when e.expected_n = a.n and e.variance > 0 then
      (e.actual_failures_for_z - e.expected_failures) / sqrt(e.variance)
    end as z,
    coalesce(
      e.expected_n = a.n and round(e.expected_failures, 4) >= 5 and round(e.expected_successes, 4) >= 5,
      false
    ) as sample_qualified
  from agent_totals a
  left join expected e using (period_key, agent_email)
),
ranks as (
  select period_key, agent_email,
    row_number() over (partition by period_key order by z desc, n desc, agent_email)::integer as rank
  from metrics
  where sample_qualified and z is not null
),
periods as (
  select
    w.period_order,
    jsonb_build_object(
      'key', w.period_key,
      'start_date', w.start_date,
      'end_date', w.end_date,
      'n', organization.n,
      'paid', organization.paid,
      'previous_start_date', w.previous_start_date,
      'previous_end_date', w.previous_end_date,
      'previous_n', organization.previous_n,
      'previous_paid', organization.previous_paid,
      'agents', coalesce(jsonb_agg(
        jsonb_build_object(
          'agent_name', m.agent_name,
          'agent_email', m.agent_email,
          'n', m.n,
          'failures', m.failures,
          'failure_rate', round(m.failure_rate, 4),
          'expected_failures', case when m.expected_n = m.n then round(m.expected_failures, 4) end,
          'expected_successes', case when m.expected_n = m.n then round(m.expected_successes, 4) end,
          'expected_rate', round(m.expected_rate, 4),
          'delta_pp', round(m.delta_pp, 4),
          'z', round(m.z, 4),
          'rescinded', m.rescinded,
          'never_paid', m.never_paid,
          'sample_qualified', m.sample_qualified,
          'rank', r.rank
        ) order by m.sample_qualified desc, m.z desc nulls last, m.n desc, m.agent_email
      ) filter (where m.agent_email is not null), '[]'::jsonb)
    ) as period
  from windows w
  join organization using (period_key)
  left join metrics m on m.period_key = w.period_key
  left join ranks r on r.period_key = m.period_key and r.agent_email = m.agent_email
  group by
    w.period_order, w.period_key, w.start_date, w.end_date,
    w.previous_start_date, w.previous_end_date,
    organization.n, organization.paid, organization.previous_n, organization.previous_paid
)
select jsonb_build_object(
  'source_as_of', s.source_as_of,
  'refreshed_at', s.refreshed_at,
  'maturity_cutoff', s.maturity_cutoff,
  'periods', coalesce((select jsonb_agg(period order by period_order) from periods), '[]'::jsonb)
)
from snapshot s
$$;

comment on function public.get_achieve_first_pay_outcomes() is
  'Service-only mature 2/4/6-week, trailing six-month, and all-time first-pay screening with true non-overlapping organizational comparisons.';
