-- Service-only aggregate probe. This does not change cron jobs or report data.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

create function public.achieve_report_cron_healthy()
returns boolean
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select exists (
    select 1
    from cron.job job
    cross join lateral (
      select status, end_time
      from cron.job_run_details
      where jobid = job.jobid
      order by runid desc
      limit 1
    ) latest
    where job.jobname = 'achieve_weekly_management_report'
      and job.active
      and job.schedule = '*/15 * * * *'
      and latest.status = 'succeeded'
      and latest.end_time between now() - interval '30 minutes' and now()
  )
$$;

comment on function public.achieve_report_cron_healthy() is
  'Service-only weekly cron availability; successful enqueue does not prove HTTP or email delivery. External watchdog also probes the handler.';
revoke execute on function public.achieve_report_cron_healthy() from public, anon, authenticated;
grant execute on function public.achieve_report_cron_healthy() to service_role;
commit;
