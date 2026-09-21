#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260921211000_achieve_report_reliability.sql"
container="achieve-report-reliability-check-$RANDOM-$$"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
# TCP excludes the temporary Unix-socket-only server used during initdb.
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null

{
  cat <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique not null,
  schedule text not null,
  command text not null,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true
);
create function cron.schedule(text, text, text) returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into cron.job(jobname, schedule, command) values ($1, $2, $3) returning jobid into new_id;
  return new_id;
end
$$;
create function cron.unschedule(bigint) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobid = $1;
  return found;
end
$$;
create function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
) returns void language plpgsql as $$
begin
  update cron.job j
  set schedule = coalesce($2, j.schedule),
      command = coalesce($3, j.command),
      database = coalesce($4, j.database),
      username = coalesce($5, j.username),
      active = coalesce($6, j.active)
  where j.jobid = $1;
  if not found then raise exception 'cron job % not found', $1; end if;
end
$$;

create table public.achieve_first_pay_outcome_snapshot (
  singleton boolean primary key check (singleton), source_as_of date not null
);
create table public.achieve_termination_enrollment_activity_snapshot (
  singleton boolean primary key check (singleton), source_as_of date not null
);
create table public.achieve_first_pay_outcome_sync_runs (
  run_date date primary key, status text not null, started_at timestamptz not null
);
create table public.achieve_weekly_report_sends (
  week_ending date primary key, status text not null, started_at timestamptz not null
);
create function public.list_achieve_agent_termination_monitoring(timestamptz)
returns jsonb language sql stable as $$ select '[]'::jsonb $$;

insert into cron.job(jobname, schedule, command) values (
  'achieve_weekly_management_report', '*/15 13,14 * * 1',
  'select net.http_post(url := ''https://miikotqnovnixpeqtqnd.supabase.co/functions/v1/achieve-weekly-report'', body := ''{"action":"scheduled"}''::jsonb, timeout_milliseconds := 30000);'
);
SQL
  cat "$migration"
  cat <<'SQL'

do $$
declare
  snapshot jsonb;
  wrapped jsonb;
begin
  if (select command from cron.job where jobname = 'achieve_weekly_management_report')
      not like '%timeout_milliseconds := 120000%' then
    raise exception 'weekly cron timeout was not raised to 120 seconds';
  end if;
  if (select schedule from cron.job where jobname = 'achieve_weekly_management_report') <> '*/15 * * * *'
    or (select count(*) from cron.job) <> 1 then
    raise exception 'existing production cron was not safely reused';
  end if;

  insert into public.achieve_first_pay_outcome_snapshot values (true, '2026-09-21');
  insert into public.achieve_termination_enrollment_activity_snapshot values (true, '2026-09-21');
  insert into public.achieve_weekly_report_sends values
    ('2026-09-13', 'sent', '2026-09-14 13:01:00+00'),
    ('2026-09-20', 'sent', '2026-09-21 13:01:00+00');

  snapshot := public.achieve_report_reliability_snapshot('2026-09-21 11:00:00+00');
  if not (snapshot->>'ok')::boolean then
    raise exception 'early current snapshots should be accepted: %', snapshot;
  end if;
  update public.achieve_first_pay_outcome_snapshot set source_as_of = '2026-09-20';
  update public.achieve_termination_enrollment_activity_snapshot set source_as_of = '2026-09-20';
  snapshot := public.achieve_report_reliability_snapshot('2026-09-21 11:00:00+00');
  if not (snapshot->>'ok')::boolean then
    raise exception 'yesterday snapshots should be accepted before deadline: %', snapshot;
  end if;
  snapshot := public.achieve_report_reliability_snapshot('2026-09-21 12:15:00+00');
  if not snapshot->'issues' ? 'outcome_snapshot_not_current'
    or not snapshot->'issues' ? 'termination_snapshot_not_current' then
    raise exception 'yesterday snapshots remained current at deadline: %', snapshot;
  end if;
  update public.achieve_first_pay_outcome_snapshot set source_as_of = '2026-09-22';
  update public.achieve_termination_enrollment_activity_snapshot set source_as_of = '2026-09-22';
  snapshot := public.achieve_report_reliability_snapshot('2026-09-21 11:00:00+00');
  if not snapshot->'issues' ? 'outcome_snapshot_not_current'
    or not snapshot->'issues' ? 'termination_snapshot_not_current' then
    raise exception 'future snapshots were accepted before deadline: %', snapshot;
  end if;
  update public.achieve_first_pay_outcome_snapshot set source_as_of = '2026-09-21';
  update public.achieve_termination_enrollment_activity_snapshot set source_as_of = '2026-09-21';

  snapshot := public.achieve_report_reliability_snapshot('2026-09-21 18:30:00+00');
  if not (snapshot->>'ok')::boolean or snapshot->'issues' <> '[]'::jsonb then
    raise exception 'healthy state did not pass: %', snapshot;
  end if;
  update public.achieve_termination_enrollment_activity_snapshot
  set source_as_of = '2026-09-20';
  snapshot := public.achieve_report_reliability_snapshot('2026-09-21 18:30:00+00');
  if (snapshot->>'ok')::boolean
    or not snapshot->'issues' ? 'termination_snapshot_not_current'
    or not snapshot->'issues' ? 'snapshot_source_mismatch' then
    raise exception 'stale/mixed snapshots were not detected: %', snapshot;
  end if;

  delete from public.achieve_weekly_report_sends;
  insert into public.achieve_weekly_report_sends values (
    '2026-09-20', 'sending', '2026-09-21 18:00:00+00'
  );
  insert into public.achieve_first_pay_outcome_sync_runs values (
    '2026-09-21', 'running', '2026-09-21 18:00:00+00'
  );
  snapshot := public.achieve_report_reliability_snapshot('2026-09-21 18:30:00+00');
  if not snapshot->'issues' ? 'weekly_delivery_overdue'
    or not snapshot->'issues' ? 'weekly_delivery_claim_stuck'
    or not snapshot->'issues' ? 'daily_sync_claim_stuck' then
    raise exception 'delivery/stuck claims were not detected: %', snapshot;
  end if;

  select public.get_achieve_termination_monitoring_report('2026-09-21 18:30:00+00') into wrapped;
  if wrapped->>'source_as_of' <> '2026-09-20' or wrapped->'rows' <> '[]'::jsonb then
    raise exception 'termination snapshot wrapper lost metadata: %', wrapped;
  end if;

  insert into public.achieve_reliability_alert_deliveries(fingerprint, notification_hour)
  values (repeat('a', 64), '2026-09-21 18:00:00+00');
  begin
    insert into public.achieve_reliability_alert_deliveries(fingerprint, notification_hour)
    values (repeat('a', 64), '2026-09-21 18:00:00+00');
    raise exception 'hourly alert dedupe accepted a duplicate claim';
  exception when unique_violation then
    null;
  end;

  if has_function_privilege('anon', 'public.achieve_report_reliability_snapshot(timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'public.get_achieve_termination_monitoring_report(timestamptz)', 'execute')
    or has_table_privilege('authenticated', 'public.achieve_reliability_alert_deliveries', 'select')
    or not has_function_privilege('service_role', 'public.achieve_report_reliability_snapshot(timestamptz)', 'execute') then
    raise exception 'reliability function privileges are unsafe';
  end if;
end
$$;

select 'achieve-report-reliability.integration.check.sh: all assertions passed' as result;
SQL
} | docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
