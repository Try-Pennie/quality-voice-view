-- Mature Achieve first-pay outcomes, ingested as a complete daily aggregate
-- snapshot from Salesforce Snowflake. No raw Enrollment records or Snowflake
-- credentials are stored in Supabase.

create table public.achieve_first_pay_outcome_daily (
  cohort_date date not null,
  agent_email text not null,
  agent_name text not null,
  n integer not null check (n > 0),
  paid integer not null check (paid between 0 and n),
  no_deposit integer not null check (no_deposit between 0 and n),
  rescinded integer not null check (rescinded between 0 and no_deposit),
  never_paid integer not null check (never_paid between 0 and no_deposit),
  primary key (cohort_date, agent_email),
  constraint achieve_first_pay_outcome_email_check check (
    agent_email = lower(btrim(agent_email))
    and agent_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint achieve_first_pay_outcome_name_check check (agent_name = btrim(agent_name) and agent_name <> ''),
  constraint achieve_first_pay_outcome_deposit_reconciliation_check check (n = paid + no_deposit),
  constraint achieve_first_pay_outcome_failure_reconciliation_check check (no_deposit = rescinded + never_paid)
);

create table public.achieve_first_pay_outcome_snapshot (
  singleton boolean primary key default true check (singleton),
  source_as_of date not null,
  refreshed_at timestamptz not null,
  aggregate_rows integer not null check (aggregate_rows > 0),
  enrollments bigint not null check (enrollments > 0)
);

comment on table public.achieve_first_pay_outcome_daily is
  'Service-only daily Achieve agent aggregates for mature original scheduled first-draft cohorts; never raw Enrollment rows.';
comment on table public.achieve_first_pay_outcome_snapshot is
  'Freshness and source-as-of metadata for the transactionally replaced Achieve first-pay snapshot.';

alter table public.achieve_first_pay_outcome_daily enable row level security;
alter table public.achieve_first_pay_outcome_daily force row level security;
alter table public.achieve_first_pay_outcome_snapshot enable row level security;
alter table public.achieve_first_pay_outcome_snapshot force row level security;
revoke all on table public.achieve_first_pay_outcome_daily from public, anon, authenticated, service_role;
revoke all on table public.achieve_first_pay_outcome_snapshot from public, anon, authenticated, service_role;

create or replace function public.ingest_achieve_first_pay_outcome_snapshot(
  p_source_as_of date,
  p_expected_aggregate_rows integer,
  p_expected_enrollments bigint,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  parsed_date date;
  parsed_name text;
  parsed_email text;
  parsed_n integer;
  parsed_paid integer;
  parsed_no_deposit integer;
  parsed_rescinded integer;
  parsed_never_paid integer;
  actual_enrollments bigint := 0;
begin
  if p_source_as_of is null then
    raise exception using errcode = '22023', message = 'source_as_of is required';
  end if;
  if p_expected_aggregate_rows is null or p_expected_aggregate_rows <= 0
    or p_expected_enrollments is null or p_expected_enrollments <= 0 then
    raise exception using errcode = '22023', message = 'positive source control totals are required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = '22023', message = 'rows must be a non-empty JSON array';
  end if;
  if jsonb_array_length(p_rows) <> p_expected_aggregate_rows then
    raise exception using errcode = '22023', message = 'aggregate row count does not match source control';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('achieve_first_pay_outcome_snapshot', 0));
  if exists (
    select 1 from public.achieve_first_pay_outcome_snapshot
    where singleton and source_as_of > p_source_as_of
  ) then
    raise exception using errcode = '22023', message = 'source_as_of cannot move backwards';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(item) <> 'object'
      or not item ?& array['cohort_date', 'agent_name', 'agent_email', 'n', 'paid', 'no_deposit', 'rescinded', 'never_paid']
      or item - array['cohort_date', 'agent_name', 'agent_email', 'n', 'paid', 'no_deposit', 'rescinded', 'never_paid'] <> '{}'::jsonb
      or jsonb_typeof(item->'cohort_date') <> 'string'
      or jsonb_typeof(item->'agent_name') <> 'string'
      or jsonb_typeof(item->'agent_email') <> 'string'
      or jsonb_typeof(item->'n') <> 'number'
      or jsonb_typeof(item->'paid') <> 'number'
      or jsonb_typeof(item->'no_deposit') <> 'number'
      or jsonb_typeof(item->'rescinded') <> 'number'
      or jsonb_typeof(item->'never_paid') <> 'number'
      or item->>'cohort_date' !~ '^\d{4}-\d{2}-\d{2}$'
      or item->>'n' !~ '^\d{1,9}$'
      or item->>'paid' !~ '^\d{1,9}$'
      or item->>'no_deposit' !~ '^\d{1,9}$'
      or item->>'rescinded' !~ '^\d{1,9}$'
      or item->>'never_paid' !~ '^\d{1,9}$' then
      raise exception using errcode = '22023', message = 'invalid aggregate row shape';
    end if;

    begin
      parsed_date := (item->>'cohort_date')::date;
      parsed_n := (item->>'n')::integer;
      parsed_paid := (item->>'paid')::integer;
      parsed_no_deposit := (item->>'no_deposit')::integer;
      parsed_rescinded := (item->>'rescinded')::integer;
      parsed_never_paid := (item->>'never_paid')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid aggregate row value';
    end;
    parsed_name := btrim(item->>'agent_name');
    parsed_email := lower(btrim(item->>'agent_email'));

    if parsed_name = ''
      or parsed_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or parsed_date > p_source_as_of - 10
      or parsed_n <= 0
      or parsed_paid < 0 or parsed_paid > parsed_n
      or parsed_no_deposit < 0 or parsed_no_deposit > parsed_n
      or parsed_rescinded < 0 or parsed_never_paid < 0
      or parsed_n <> parsed_paid + parsed_no_deposit
      or parsed_no_deposit <> parsed_rescinded + parsed_never_paid then
      raise exception using errcode = '23514', message = 'aggregate row violates first-pay outcome invariants';
    end if;
    actual_enrollments := actual_enrollments + parsed_n;
  end loop;

  if actual_enrollments <> p_expected_enrollments then
    raise exception using errcode = '22023', message = 'enrollment count does not match source control';
  end if;
  if (
    select count(*) <> count(distinct (value->>'cohort_date', lower(btrim(value->>'agent_email'))))
    from jsonb_array_elements(p_rows)
  ) then
    raise exception using errcode = '22023', message = 'duplicate cohort and agent rows are not allowed';
  end if;

  delete from public.achieve_first_pay_outcome_daily where true;

  insert into public.achieve_first_pay_outcome_daily (
    cohort_date, agent_name, agent_email, n, paid, no_deposit, rescinded, never_paid
  )
  select
    (value->>'cohort_date')::date,
    btrim(value->>'agent_name'),
    lower(btrim(value->>'agent_email')),
    (value->>'n')::integer,
    (value->>'paid')::integer,
    (value->>'no_deposit')::integer,
    (value->>'rescinded')::integer,
    (value->>'never_paid')::integer
  from jsonb_array_elements(p_rows);

  insert into public.achieve_first_pay_outcome_snapshot (
    singleton, source_as_of, refreshed_at, aggregate_rows, enrollments
  )
  select true, p_source_as_of, statement_timestamp(), count(*)::integer, sum(n)
  from public.achieve_first_pay_outcome_daily
  on conflict (singleton) do update set
    source_as_of = excluded.source_as_of,
    refreshed_at = excluded.refreshed_at,
    aggregate_rows = excluded.aggregate_rows,
    enrollments = excluded.enrollments;

  return jsonb_build_object(
    'source_as_of', p_source_as_of,
    'aggregate_rows', (select count(*) from public.achieve_first_pay_outcome_daily),
    'enrollments', (select sum(n) from public.achieve_first_pay_outcome_daily)
  );
end
$$;

comment on function public.ingest_achieve_first_pay_outcome_snapshot(date, integer, bigint, jsonb) is
  'Service-role-only atomic replacement of a validated, mature Achieve daily aggregate snapshot.';

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
windows(period_order, period_key, start_date, end_date) as (
  select 1, 'all_time'::text, null::date, maturity_cutoff from snapshot
  union all
  select 2, 'mature_4_weeks', maturity_cutoff - 27, maturity_cutoff from snapshot
  union all
  select 3, 'mature_6_weeks', maturity_cutoff - 41, maturity_cutoff from snapshot
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
  left join metrics m on m.period_key = w.period_key
  left join ranks r on r.period_key = m.period_key and r.agent_email = m.agent_email
  group by w.period_order, w.period_key, w.start_date, w.end_date
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
  'Service-only all-time and mature trailing 4/6-week first-pay screening using weekly leave-one-agent-out roster expectations.';

revoke all on function public.ingest_achieve_first_pay_outcome_snapshot(date, integer, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_achieve_first_pay_outcome_snapshot(date, integer, bigint, jsonb) to service_role;
revoke all on function public.get_achieve_first_pay_outcomes() from public, anon, authenticated;
grant execute on function public.get_achieve_first_pay_outcomes() to service_role;
