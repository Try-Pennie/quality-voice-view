-- Delivery ledger and Monday 9 AM ET trigger for the Achieve management report.
-- The Edge Function owns ET/DST validation and Gmail delivery; this cron only
-- invokes it during both UTC hours that can contain 9 AM Eastern.

create table if not exists public.achieve_weekly_report_sends (
  week_ending date primary key,
  status text not null check (status in ('sending', 'sent')),
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  gmail_message_id text,
  constraint achieve_weekly_report_send_state_check check (
    (status = 'sending' and sent_at is null and gmail_message_id is null)
    or
    (status = 'sent' and sent_at is not null and nullif(btrim(gmail_message_id), '') is not null)
  )
);

comment on table public.achieve_weekly_report_sends is
  'Service-only idempotency ledger for the Monday Achieve management email.';

alter table public.achieve_weekly_report_sends enable row level security;
alter table public.achieve_weekly_report_sends force row level security;
revoke all on table public.achieve_weekly_report_sends from public, anon, authenticated;
grant select, insert, update, delete on table public.achieve_weekly_report_sends to service_role;

create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'achieve_weekly_management_report';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end $$;

select cron.schedule(
  'achieve_weekly_management_report',
  '*/15 13,14 * * 1',
  $$
  select net.http_post(
    url := 'https://miikotqnovnixpeqtqnd.supabase.co/functions/v1/achieve-weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-report-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'achieve_weekly_report_secret'
      )
    ),
    body := '{"action":"scheduled"}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from vault.decrypted_secrets where name = 'achieve_weekly_report_secret'
  );
  $$
);
