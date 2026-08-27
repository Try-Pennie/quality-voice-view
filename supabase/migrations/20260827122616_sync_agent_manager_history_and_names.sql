-- Keep the effective-dated manager history in sync with the live snapshot.
-- The original history migration expected the upstream Regal sync to maintain
-- both tables, but that rewrite never landed; live assignments continued to
-- change while history stayed stale.

create or replace function public.sync_agent_manager_mapping_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_date date := (now() at time zone 'America/New_York')::date;
begin
  if tg_op = 'UPDATE'
    and new.agent_email = old.agent_email
    and new.manager_email is not distinct from old.manager_email
  then
    return new;
  end if;

  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    delete from public.agent_manager_mapping_history
    where agent_email = old.agent_email
      and to_date is null
      and from_date >= effective_date;

    update public.agent_manager_mapping_history
    set to_date = effective_date
    where agent_email = old.agent_email
      and to_date is null
      and from_date < effective_date;
  end if;

  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    delete from public.agent_manager_mapping_history
    where agent_email = new.agent_email
      and manager_email is distinct from new.manager_email
      and to_date is null
      and from_date >= effective_date;

    update public.agent_manager_mapping_history
    set to_date = effective_date
    where agent_email = new.agent_email
      and manager_email is distinct from new.manager_email
      and to_date is null
      and from_date < effective_date;

    insert into public.agent_manager_mapping_history
      (agent_email, manager_email, from_date, to_date, source)
    values
      (new.agent_email, new.manager_email, effective_date, null, 'agent_manager_mapping_trigger')
    on conflict (agent_email, manager_email, from_date) do update
      set to_date = null,
          source = excluded.source;

    return new;
  end if;

  return old;
end;
$$;

revoke execute on function public.sync_agent_manager_mapping_history()
  from public, anon, authenticated;

drop trigger if exists trg_sync_agent_manager_mapping_history
  on public.agent_manager_mapping;
create trigger trg_sync_agent_manager_mapping_history
after insert or update or delete on public.agent_manager_mapping
for each row execute function public.sync_agent_manager_mapping_history();

-- Reconcile today's effective snapshot immediately. Older history remains
-- untouched because the exact effective dates of the missed changes are unknown.
do $$
declare
  effective_date date := (now() at time zone 'America/New_York')::date;
begin
  delete from public.agent_manager_mapping_history h
  where h.to_date is null
    and h.from_date >= effective_date
    and not exists (
      select 1
      from public.agent_manager_mapping m
      where m.agent_email = h.agent_email
        and m.manager_email = h.manager_email
    );

  update public.agent_manager_mapping_history h
  set to_date = effective_date
  where h.to_date is null
    and h.from_date < effective_date
    and not exists (
      select 1
      from public.agent_manager_mapping m
      where m.agent_email = h.agent_email
        and m.manager_email = h.manager_email
    );

  insert into public.agent_manager_mapping_history
    (agent_email, manager_email, from_date, to_date, source)
  select
    m.agent_email,
    m.manager_email,
    effective_date,
    null,
    'agent_manager_mapping_reconcile'
  from public.agent_manager_mapping m
  where not exists (
    select 1
    from public.agent_manager_mapping_history h
    where h.agent_email = m.agent_email
      and h.manager_email = m.manager_email
      and h.to_date is null
  )
  on conflict (agent_email, manager_email, from_date) do update
    set to_date = null,
        source = excluded.source;
end;
$$;

-- God-mode users need canonical manager names for the all-team breakout.
-- Expose the existing directory through RLS instead of sampling thousands of
-- call rows and guessing from whichever names happen to fit under the row cap.
drop policy if exists "God mode users can read agent directory"
  on public.agent_directory;
create policy "God mode users can read agent directory"
on public.agent_directory
for select
to authenticated
using (
  exists (
    select 1
    from public.manager_coaching_prompts m
    where lower(m.manager_email) = lower(auth.jwt() ->> 'email')
      and m.is_god_mode = true
  )
);

grant select on public.agent_directory to authenticated;
