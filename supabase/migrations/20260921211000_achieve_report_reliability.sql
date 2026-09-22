-- Fail-closed Achieve snapshot metadata, bounded weekly invocation, and PII-free
-- Slack-monitoring state. Staging has no weekly cron, so this migration never
-- creates an HTTP job or enables an external integration there.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.get_achieve_termination_monitoring_report(
  p_end_at timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select jsonb_build_object(
    'source_as_of', snapshot.source_as_of,
    'rows', public.list_achieve_agent_termination_monitoring(p_end_at)
  )
  from (select source_as_of from public.achieve_termination_enrollment_activity_snapshot where singleton) snapshot
$$;

comment on function public.get_achieve_termination_monitoring_report(timestamptz) is
  'Service-only termination monitoring rows with mandatory snapshot freshness metadata.';

revoke execute on function public.get_achieve_termination_monitoring_report(timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_achieve_termination_monitoring_report(timestamptz)
  to service_role;

create table public.achieve_reliability_alert_deliveries (
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  notification_hour timestamptz not null check (
    notification_hour = date_trunc('hour', notification_hour)
  ),
  claimed_at timestamptz not null default now(),
  primary key (fingerprint, notification_hour)
);

comment on table public.achieve_reliability_alert_deliveries is
  'Service-only hourly dedupe claims for PII-free Achieve Slack alerts; no recipient or customer data.';

alter table public.achieve_reliability_alert_deliveries enable row level security;
alter table public.achieve_reliability_alert_deliveries force row level security;
revoke all on table public.achieve_reliability_alert_deliveries from public, anon, authenticated;
grant select, insert on table public.achieve_reliability_alert_deliveries to service_role;

create function public.achieve_report_reliability_snapshot(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '5s'
as $$
declare
  expected_source date;
  current_source date;
  outcome_source date;
  termination_source date;
  local_date date;
  delivery_monday date;
  delivery_deadline timestamptz;
  expected_week_ending date;
  stuck_sync_claims bigint;
  stuck_delivery_claims bigint;
  issues jsonb := '[]'::jsonb;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'monitoring time is required';
  end if;

  -- Snowflake statements run in UTC. Before the daily 12:15 UTC deadline,
  -- yesterday remains the expected source date; afterward today is required.
  current_source := (p_now at time zone 'UTC')::date;
  expected_source := current_source
    - case when (p_now at time zone 'UTC')::time < time '12:15' then 1 else 0 end;
  select source_as_of into outcome_source
  from public.achieve_first_pay_outcome_snapshot where singleton;
  select source_as_of into termination_source
  from public.achieve_termination_enrollment_activity_snapshot where singleton;

  if outcome_source is null or outcome_source not in (expected_source, current_source) then
    issues := issues || jsonb_build_array('outcome_snapshot_not_current');
  end if;
  if termination_source is null or termination_source not in (expected_source, current_source) then
    issues := issues || jsonb_build_array('termination_snapshot_not_current');
  end if;
  if outcome_source is distinct from termination_source then
    issues := issues || jsonb_build_array('snapshot_source_mismatch');
  end if;

  select count(*) into stuck_sync_claims
  from public.achieve_first_pay_outcome_sync_runs
  where status = 'running' and started_at < p_now - interval '5 minutes';
  if stuck_sync_claims > 0 then
    issues := issues || jsonb_build_array('daily_sync_claim_stuck');
  end if;

  select count(*) into stuck_delivery_claims
  from public.achieve_weekly_report_sends
  where status = 'sending' and started_at < p_now - interval '5 minutes';
  if stuck_delivery_claims > 0 then
    issues := issues || jsonb_build_array('weekly_delivery_claim_stuck');
  end if;

  local_date := (p_now at time zone 'America/New_York')::date;
  delivery_monday := local_date - (extract(isodow from local_date)::integer - 1);
  delivery_deadline := (delivery_monday + time '10:15') at time zone 'America/New_York';
  if p_now < delivery_deadline then
    delivery_monday := delivery_monday - 7;
    delivery_deadline := (delivery_monday + time '10:15') at time zone 'America/New_York';
  end if;
  expected_week_ending := delivery_monday - 1;

  if not exists (
    select 1 from public.achieve_weekly_report_sends
    where week_ending = expected_week_ending and status = 'sent'
  ) then
    issues := issues || jsonb_build_array('weekly_delivery_overdue');
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(issues) = 0,
    'observed_at', p_now,
    'expected_source_as_of', expected_source,
    'outcome_source_as_of', outcome_source,
    'termination_source_as_of', termination_source,
    'expected_week_ending', expected_week_ending,
    'delivery_deadline', delivery_deadline,
    'stuck_sync_claims', stuck_sync_claims,
    'stuck_delivery_claims', stuck_delivery_claims,
    'issues', issues
  );
end
$$;

comment on function public.achieve_report_reliability_snapshot(timestamptz) is
  'PII-free deadline status for daily snapshots, weekly delivery, and ambiguous stuck claims; never resends or deletes.';

revoke execute on function public.achieve_report_reliability_snapshot(timestamptz)
  from public, anon, authenticated;
grant execute on function public.achieve_report_reliability_snapshot(timestamptz)
  to service_role;

do $$
declare
  weekly_job cron.job%rowtype;
  bounded_command text;
begin
  select * into weekly_job
  from cron.job
  where jobname = 'achieve_weekly_management_report';

  if found then
    if weekly_job.command !~ '/functions/v1/achieve-weekly-report'
      or weekly_job.command !~ '\{"action"\s*:\s*"scheduled"\}'
      or weekly_job.command !~ 'timeout_milliseconds\s*:=\s*(30000|120000)' then
      raise exception using
        errcode = '55000',
        message = 'unexpected achieve weekly cron template; refusing reliability rewrite';
    end if;

    bounded_command := regexp_replace(
      weekly_job.command,
      'timeout_milliseconds\s*:=\s*(30000|120000)',
      'timeout_milliseconds := 120000'
    );
    if bounded_command !~ 'timeout_milliseconds\s*:=\s*120000' then
      raise exception using errcode = '55000', message = 'weekly cron timeout rewrite failed';
    end if;

    -- Reuse the already-authorized production endpoint and Vault secret. The
    -- scheduled handler performs a cheap monitor pass every 15 minutes and
    -- only builds/sends the report during Monday's 9 AM ET hour.
    perform cron.alter_job(
      weekly_job.jobid,
      schedule := '*/15 * * * *',
      command := bounded_command
    );
  end if;
end
$$;

commit;
