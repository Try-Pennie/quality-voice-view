-- Replace report-observation termination activity with deduplicated Snowflake
-- enrollment-date activity. Only per-agent aggregates are persisted.

create table public.achieve_termination_enrollment_activity_snapshot (
  singleton boolean primary key default true check (singleton),
  source_as_of date not null,
  refreshed_at timestamptz not null,
  aggregate_rows integer not null check (aggregate_rows > 0),
  enrollments bigint not null check (enrollments > 0)
);

create table public.achieve_termination_enrollment_activity (
  agent_email text primary key references public.achieve_agent_terminations(agent_email) on delete cascade,
  enrollments_post_termination integer not null check (enrollments_post_termination >= 0),
  latest_post_term_enrollment_on date,
  constraint achieve_termination_activity_reconciliation check (
    (enrollments_post_termination = 0 and latest_post_term_enrollment_on is null)
    or (enrollments_post_termination > 0 and latest_post_term_enrollment_on is not null)
  )
);

comment on table public.achieve_termination_enrollment_activity_snapshot is
  'Freshness metadata for deduplicated Snowflake enrollment-date termination monitoring.';
comment on table public.achieve_termination_enrollment_activity is
  'Per-agent counts and latest enrollment dates strictly after the effective termination date; no enrollment identifiers are stored.';

alter table public.achieve_termination_enrollment_activity_snapshot enable row level security;
alter table public.achieve_termination_enrollment_activity_snapshot force row level security;
alter table public.achieve_termination_enrollment_activity enable row level security;
alter table public.achieve_termination_enrollment_activity force row level security;
revoke all on table public.achieve_termination_enrollment_activity_snapshot from public, anon, authenticated;
revoke all on table public.achieve_termination_enrollment_activity from public, anon, authenticated;
grant select, insert, update on table public.achieve_termination_enrollment_activity_snapshot to service_role;
grant select, insert, update, delete on table public.achieve_termination_enrollment_activity to service_role;

create function public.ingest_achieve_termination_enrollment_activity(
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
  parsed_email text;
  parsed_enrollments integer;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('achieve_termination_enrollment_activity', 0));
  if exists (
    select 1 from public.achieve_termination_enrollment_activity_snapshot
    where singleton and source_as_of > p_source_as_of
  ) then
    raise exception using errcode = '22023', message = 'source_as_of cannot move backwards';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(item) <> 'object'
      or not item ?& array['enrollment_date', 'agent_email', 'enrollments']
      or item - array['enrollment_date', 'agent_email', 'enrollments'] <> '{}'::jsonb
      or jsonb_typeof(item->'enrollment_date') <> 'string'
      or jsonb_typeof(item->'agent_email') <> 'string'
      or jsonb_typeof(item->'enrollments') <> 'number'
      or item->>'enrollment_date' !~ '^\d{4}-\d{2}-\d{2}$'
      or item->>'enrollments' !~ '^\d{1,9}$' then
      raise exception using errcode = '22023', message = 'invalid termination enrollment row shape';
    end if;

    begin
      parsed_date := (item->>'enrollment_date')::date;
      parsed_enrollments := (item->>'enrollments')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid termination enrollment row value';
    end;
    parsed_email := lower(btrim(item->>'agent_email'));
    if parsed_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or parsed_date > p_source_as_of
      or parsed_enrollments <= 0 then
      raise exception using errcode = '23514', message = 'termination enrollment row violates invariants';
    end if;
    actual_enrollments := actual_enrollments + parsed_enrollments;
  end loop;

  if actual_enrollments <> p_expected_enrollments then
    raise exception using errcode = '22023', message = 'enrollment count does not match source control';
  end if;
  if (
    select count(*) <> count(distinct ((value->>'enrollment_date')::date, lower(btrim(value->>'agent_email'))))
    from jsonb_array_elements(p_rows)
  ) then
    raise exception using errcode = '22023', message = 'duplicate enrollment date and agent rows are not allowed';
  end if;

  delete from public.achieve_termination_enrollment_activity where true;

  with buckets as (
    select
      (value->>'enrollment_date')::date as enrollment_date,
      lower(btrim(value->>'agent_email')) as agent_email,
      (value->>'enrollments')::integer as enrollments
    from jsonb_array_elements(p_rows)
  )
  insert into public.achieve_termination_enrollment_activity (
    agent_email, enrollments_post_termination, latest_post_term_enrollment_on
  )
  select
    termination.agent_email,
    coalesce(sum(bucket.enrollments) filter (
      where bucket.enrollment_date > (termination.terminated_at at time zone 'America/New_York')::date
    ), 0)::integer,
    max(bucket.enrollment_date) filter (
      where bucket.enrollment_date > (termination.terminated_at at time zone 'America/New_York')::date
    )
  from public.achieve_agent_terminations termination
  left join buckets bucket on bucket.agent_email = termination.agent_email
  group by termination.agent_email;

  insert into public.achieve_termination_enrollment_activity_snapshot (
    singleton, source_as_of, refreshed_at, aggregate_rows, enrollments
  ) values (
    true, p_source_as_of, statement_timestamp(), p_expected_aggregate_rows, p_expected_enrollments
  )
  on conflict (singleton) do update set
    source_as_of = excluded.source_as_of,
    refreshed_at = excluded.refreshed_at,
    aggregate_rows = excluded.aggregate_rows,
    enrollments = excluded.enrollments;

  return jsonb_build_object(
    'source_as_of', p_source_as_of,
    'aggregate_rows', p_expected_aggregate_rows,
    'enrollments', p_expected_enrollments,
    'monitored_agents', (select count(*) from public.achieve_termination_enrollment_activity)
  );
end
$$;

comment on function public.ingest_achieve_termination_enrollment_activity(date, integer, bigint, jsonb) is
  'Service-only atomic replacement of post-termination enrollment-date aggregates derived from deduplicated Snowflake enrollments.';

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
        >= (p_end_at at time zone 'America/New_York')::date - 30
      and termination.terminated_at < p_end_at
  ) then
    return '[]'::jsonb;
  end if;
  if not exists (select 1 from public.achieve_termination_enrollment_activity_snapshot where singleton) then
    raise exception using errcode = '55000', message = 'termination enrollment activity snapshot is unavailable';
  end if;
  if exists (
    select 1
    from public.achieve_agent_terminations termination
    left join public.achieve_termination_enrollment_activity activity
      on activity.agent_email = termination.agent_email
    where (termination.terminated_at at time zone 'America/New_York')::date
        >= (p_end_at at time zone 'America/New_York')::date - 30
      and termination.terminated_at < p_end_at
      and activity.agent_email is null
  ) then
    raise exception using errcode = '55000', message = 'termination enrollment activity snapshot is incomplete';
  end if;

  with effective_terminations as materialized (
    select termination.*
    from public.achieve_agent_terminations termination
    where (termination.terminated_at at time zone 'America/New_York')::date
        >= (p_end_at at time zone 'America/New_York')::date - 30
      and termination.terminated_at < p_end_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'agent_name', termination.agent_name,
    'agent_email', termination.agent_email,
    'terminated_at', termination.terminated_at,
    'activity_source_as_of', snapshot.source_as_of,
    'latest_post_term_enrollment_on', activity.latest_post_term_enrollment_on,
    'enrollments_post_termination', coalesce(activity.enrollments_post_termination, 0)
  ) order by termination.agent_name, termination.agent_email), '[]'::jsonb)
  into result
  from effective_terminations termination
  cross join public.achieve_termination_enrollment_activity_snapshot snapshot
  left join public.achieve_termination_enrollment_activity activity
    on activity.agent_email = termination.agent_email
  where snapshot.singleton;

  return result;
end
$$;

comment on function public.list_achieve_agent_termination_monitoring(timestamptz) is
  'Service-only terminations from the prior 30 days with deduplicated enrollment counts and latest enrollment date strictly after termination.';

revoke execute on function public.ingest_achieve_termination_enrollment_activity(date, integer, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_achieve_termination_enrollment_activity(date, integer, bigint, jsonb)
  to service_role;
revoke execute on function public.list_achieve_agent_termination_monitoring(timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_achieve_agent_termination_monitoring(timestamptz)
  to service_role;
