-- Fix "Unknown" agent names on the Calls dashboard (regression since the
-- 2026-07-01 Regal ingestion cutover).
--
-- eavesly_calls used to get agent_full_name from the retired SFDC/Pipedream
-- sync. The Regal call_completed payload only carries agent_email, so every
-- row written since the cutover has agent_full_name = NULL and the dashboard
-- renders "Unknown".
--
-- This migration:
--   1. Creates agent_directory — the canonical email -> full-name map, seeded
--      from the latest non-null name observed per agent in eavesly_calls.
--   2. Backfills NULL agent_full_name on eavesly_calls from that directory
--      (~39k rows at time of writing).
--   3. Installs a trigger so future eavesly_calls writes resolve the name
--      from the directory automatically, and any writer that *does* provide
--      a name teaches the directory (e.g. if the Regal payload later adds one).
--
-- Names the directory doesn't know (agents hired after the cutover) stay NULL
-- in the data — the dashboard derives a display name from the email instead.
-- Keeping unknowns NULL (rather than storing derived guesses) means a future
-- real name source can fill them without fighting stored placeholders.

-- 1) Directory ---------------------------------------------------------------
create table if not exists public.agent_directory (
  agent_email     text primary key,          -- always lowercased
  agent_full_name text not null,
  updated_at      timestamptz not null default now()
);

comment on table public.agent_directory is
  'Canonical agent email -> full name map. Seeded from historical eavesly_calls; maintained by the eavesly_calls_resolve_agent_name trigger. Service-role only (RLS enabled, no policies).';

-- Internal table: only the service role (which bypasses RLS) reads/writes it.
alter table public.agent_directory enable row level security;
revoke all on public.agent_directory from anon, authenticated;

insert into public.agent_directory (agent_email, agent_full_name)
select distinct on (lower(agent_email)) lower(agent_email), agent_full_name
from public.eavesly_calls
where agent_email is not null
  and agent_full_name is not null
order by lower(agent_email), started_at desc
on conflict (agent_email) do nothing;

-- 2) Backfill ----------------------------------------------------------------
update public.eavesly_calls c
set agent_full_name = d.agent_full_name
from public.agent_directory d
where c.agent_full_name is null
  and c.agent_email is not null
  and d.agent_email = lower(c.agent_email);

-- 3) Trigger -----------------------------------------------------------------
-- BEFORE trigger so the resolved name lands in the same write. Defensive:
-- any resolution error returns NEW unchanged — a name lookup must never
-- block a call row from being written.
create or replace function public.eavesly_calls_resolve_agent_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agent_email is null then
    return new;
  end if;

  if new.agent_full_name is null then
    select d.agent_full_name
      into new.agent_full_name
    from public.agent_directory d
    where d.agent_email = lower(new.agent_email);
  else
    -- A writer supplied a real name — teach the directory.
    insert into public.agent_directory (agent_email, agent_full_name, updated_at)
    values (lower(new.agent_email), new.agent_full_name, now())
    on conflict (agent_email) do update
      set agent_full_name = excluded.agent_full_name,
          updated_at      = now()
      where agent_directory.agent_full_name is distinct from excluded.agent_full_name;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_eavesly_calls_resolve_agent_name on public.eavesly_calls;
create trigger trg_eavesly_calls_resolve_agent_name
  before insert or update on public.eavesly_calls
  for each row
  execute function public.eavesly_calls_resolve_agent_name();
