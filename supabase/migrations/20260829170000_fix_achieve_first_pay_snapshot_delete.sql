-- pg-safeupdate rejects DELETE without an explicit predicate in production.
-- Keep the transactionally replaced snapshot behavior while satisfying the guard.

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
