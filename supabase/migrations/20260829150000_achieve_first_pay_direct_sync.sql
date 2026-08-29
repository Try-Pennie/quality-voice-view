-- Daily direct Snowflake SQL API trigger and service-only run ledger for the
-- Achieve first-pay aggregate snapshot. 12:00 UTC is 7 AM EST / 8 AM EDT,
-- before the Monday report window at 13:00/14:00 UTC.

create table public.achieve_first_pay_outcome_sync_runs (
  run_date date primary key,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_as_of date,
  aggregate_rows integer check (aggregate_rows > 0),
  enrollments bigint check (enrollments > 0),
  error_code text,
  constraint achieve_first_pay_outcome_sync_run_state_check check (
    (status = 'running'
      and finished_at is null
      and source_as_of is null
      and aggregate_rows is null
      and enrollments is null
      and error_code is null)
    or
    (status = 'succeeded'
      and finished_at is not null
      and source_as_of is not null
      and aggregate_rows is not null
      and enrollments is not null
      and error_code is null)
    or
    (status = 'failed'
      and finished_at is not null
      and source_as_of is null
      and aggregate_rows is null
      and enrollments is null
      and nullif(btrim(error_code), '') is not null)
  )
);

comment on table public.achieve_first_pay_outcome_sync_runs is
  'Service-only daily run status for the direct Snowflake first-pay aggregate sync; contains no raw enrollment data.';

alter table public.achieve_first_pay_outcome_sync_runs enable row level security;
alter table public.achieve_first_pay_outcome_sync_runs force row level security;
revoke all on table public.achieve_first_pay_outcome_sync_runs from public, anon, authenticated;
grant select, insert, update on table public.achieve_first_pay_outcome_sync_runs to service_role;

create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'achieve_first_pay_outcome_sync';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end $$;

select cron.schedule(
  'achieve_first_pay_outcome_sync',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://miikotqnovnixpeqtqnd.supabase.co/functions/v1/achieve-first-pay-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-report-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'achieve_weekly_report_secret'
      )
    ),
    body := '{"action":"scheduled"}'::jsonb,
    timeout_milliseconds := 120000
  )
  where exists (
    select 1 from vault.decrypted_secrets where name = 'achieve_weekly_report_secret'
  );
  $$
);
