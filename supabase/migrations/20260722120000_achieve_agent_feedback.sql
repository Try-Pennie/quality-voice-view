-- Pennie agent feedback on Achieve welcome calls (PSAI: /achieve portal).
--
-- Pennie sales agents optionally rate the Achieve welcome-call rep after the
-- warm transfer via a Google Form ("Achieve Welcome Call 🚨" sheet). This table
-- mirrors those form rows so the /achieve portal can show them alongside the
-- automated welcome-call QA results. Populated by the achieve-feedback-sync
-- edge function (scheduled below); matched to calls by normalized phone number
-- + submission-time proximity, because the form captures no call id.
--
-- Service-role only (RLS enabled, no policies) — the browser reads this data
-- exclusively through the achieve-portal edge function, same as every other
-- Achieve table.

create table public.achieve_agent_feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  -- Raw form fields, as they appear in the sheet.
  lead_phone_raw text not null,
  achieve_agent_name text,
  accent boolean,
  background_noise boolean,
  connection_issues boolean,
  call_quality text,          -- 'Good' | 'Fair' | 'Poor' (kept as text: form may change)
  notes text,
  submitted_by text,          -- Pennie agent who filled the form
  submitted_at timestamptz not null,  -- form timestamp; verified to be UTC (see PR)

  -- Derived / matching fields.
  phone_normalized text,      -- last 10 digits, null when unparseable (e.g. '#ERROR!')
  matched_call_id text,       -- eavesly call_id of the matched Achieve welcome call
  matched_at timestamptz
);

comment on table public.achieve_agent_feedback is
  'Pennie agent form feedback about Achieve welcome-call reps, synced from the Achieve Welcome Call Google Sheet. Matched to eavesly calls by phone + time. Service-role only.';

-- Idempotent upsert key for the sheet sync (the sheet has no row ids; a
-- resubmission with identical phone/submitter/timestamp is the same row).
create unique index achieve_agent_feedback_dedup_idx
  on public.achieve_agent_feedback (submitted_at, lead_phone_raw, coalesce(submitted_by, ''));

create index achieve_agent_feedback_matched_call_idx
  on public.achieve_agent_feedback (matched_call_id);

alter table public.achieve_agent_feedback enable row level security;

-- Match unmatched feedback rows to Achieve welcome calls: same normalized
-- phone, call started within (submitted_at - 24h, submitted_at + 1h) — agents
-- submit during or shortly after the call (timestamps verified against
-- eavesly_calls.started_at) — nearest call start wins.
create or replace function public.match_achieve_agent_feedback()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with candidates as (
    select
      f.id as feedback_id,
      c.call_id,
      row_number() over (
        partition by f.id
        order by abs(extract(epoch from (f.submitted_at - c.started_at)))
      ) as rn
    from achieve_agent_feedback f
    join eavesly_module_results m
      on m.module_name = 'achieve_welcome_call_qa'
     and right(regexp_replace(coalesce(m.contact_phone, ''), '\D', '', 'g'), 10) = f.phone_normalized
    join eavesly_calls c
      on c.call_id = m.call_id
    where f.matched_call_id is null
      and f.phone_normalized is not null
      and c.started_at between f.submitted_at - interval '24 hours'
                           and f.submitted_at + interval '1 hour'
  )
  update achieve_agent_feedback f
  set matched_call_id = cand.call_id,
      matched_at = now()
  from candidates cand
  where cand.feedback_id = f.id
    and cand.rn = 1;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Service-role only, like the rest of the Achieve surface
-- (see 20260708194837_revoke_anon_rpc_execute).
revoke execute on function public.match_achieve_agent_feedback() from public, anon, authenticated;
grant execute on function public.match_achieve_agent_feedback() to service_role;

-- Schedule the sheet sync every 15 minutes. The cron job only fires once the
-- shared secret exists in Vault (setup: insert 'achieve_feedback_sync_secret'
-- into vault.secrets AND `supabase secrets set ACHIEVE_SYNC_SECRET=<same>`).
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'achieve_feedback_sync';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'achieve_feedback_sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://miikotqnovnixpeqtqnd.supabase.co/functions/v1/achieve-feedback-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'achieve_feedback_sync_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'achieve_feedback_sync_secret');
  $$
);
