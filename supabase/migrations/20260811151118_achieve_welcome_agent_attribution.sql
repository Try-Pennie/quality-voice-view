-- Attribute Achieve welcome-call QA rows to the Achieve/FDR representative who
-- handled the welcome call.
--
-- Eavesly stores Pennie's Salesforce Lead ID (00Q...) on module results. The
-- Achieve daily report stores Achieve's client ID (AFF...). Snowflake's LEAD
-- object owns the stable crosswalk: LEAD.ID -> LEAD.CLIENT_NO_A__C.
--
-- Pipedream populates both source tables during the existing daily Achieve
-- report sync. The partner-facing portal resolves agent identity through the
-- service-only RPC below; Salesforce and Achieve client IDs never leave the
-- server.

-- 1) Version the pre-existing Pipedream destination --------------------------
-- These objects were originally created out-of-band. Defining them here makes
-- fresh database rebuilds deterministic while preserving production data.
create table if not exists public.welcome_call_agent_log (
  id bigint generated always as identity primary key,
  client_id text not null,
  welcome_call_agent_name text not null,
  welcome_call_agent_email text not null,
  first_seen_on date not null,
  last_seen_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welcome_call_agent_log_client_email_uq
    unique (client_id, welcome_call_agent_email)
);

comment on table public.welcome_call_agent_log is
  'Achieve daily client-to-welcome-call-representative assignments, retained by client and representative email.';

create index if not exists welcome_call_agent_log_client_idx
  on public.welcome_call_agent_log (client_id);

create or replace view public.welcome_call_agent_current
with (security_invoker = true)
as
select distinct on (client_id)
  client_id,
  welcome_call_agent_name,
  welcome_call_agent_email,
  first_seen_on,
  last_seen_on
from public.welcome_call_agent_log
order by client_id, last_seen_on desc, id desc;

comment on view public.welcome_call_agent_current is
  'Latest Achieve welcome-call representative assignment per exact client ID.';

-- Pipedream sends validated chunks as [{ client_id,
-- welcome_call_agent_name, welcome_call_agent_email, report_date }]. Re-runs
-- update the observed date range without rewriting unchanged rows.
create or replace function public.ingest_welcome_call_agents(rows jsonb)
returns table (
  inserted bigint,
  updated bigint,
  unchanged bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count bigint;
  updated_count bigint;
  source_count bigint;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'rows must be a JSON array';
  end if;

  with parsed as (
    select
      nullif(btrim(item.value ->> 'client_id'), '') as client_id,
      btrim(coalesce(item.value ->> 'welcome_call_agent_name', '')) as agent_name,
      lower(nullif(btrim(item.value ->> 'welcome_call_agent_email'), '')) as agent_email,
      (item.value ->> 'report_date')::date as report_date,
      item.ordinality
    from jsonb_array_elements(rows) with ordinality as item(value, ordinality)
  ),
  source_rows as (
    select distinct on (client_id, agent_email)
      client_id,
      agent_name,
      agent_email,
      report_date
    from parsed
    where client_id is not null
      and agent_email is not null
      and report_date is not null
    order by client_id, agent_email, ordinality desc
  ),
  upserted as (
    insert into public.welcome_call_agent_log as target
      (client_id, welcome_call_agent_name, welcome_call_agent_email,
       first_seen_on, last_seen_on)
    select client_id, agent_name, agent_email, report_date, report_date
    from source_rows
    on conflict (client_id, welcome_call_agent_email) do update set
      welcome_call_agent_name = excluded.welcome_call_agent_name,
      first_seen_on = least(target.first_seen_on, excluded.first_seen_on),
      last_seen_on = greatest(target.last_seen_on, excluded.last_seen_on),
      updated_at = now()
    where target.welcome_call_agent_name is distinct from excluded.welcome_call_agent_name
       or target.first_seen_on > excluded.first_seen_on
       or target.last_seen_on < excluded.last_seen_on
    returning (xmax = 0) as is_insert
  )
  select
    count(*) filter (where is_insert),
    count(*) filter (where not is_insert),
    (select count(*) from source_rows)
  into inserted_count, updated_count, source_count
  from upserted;

  return query
  select
    inserted_count,
    updated_count,
    source_count - inserted_count - updated_count;
end;
$$;

comment on function public.ingest_welcome_call_agents(jsonb) is
  'Service-only idempotent ingestion of validated Achieve welcome-call representative report rows.';

-- 2) Snowflake ID bridge -----------------------------------------------------
create table if not exists public.achieve_client_sfdc_map (
  sfdc_lead_id text primary key,
  client_id text not null,
  source_last_modified_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint achieve_client_sfdc_map_lead_not_blank
    check (btrim(sfdc_lead_id) <> ''),
  constraint achieve_client_sfdc_map_client_not_blank
    check (btrim(client_id) <> '')
);

comment on table public.achieve_client_sfdc_map is
  'Service-only Snowflake crosswalk from Pennie Salesforce Lead ID to Achieve client ID. Populated by the daily Achieve Pipedream sync.';
comment on column public.achieve_client_sfdc_map.sfdc_lead_id is
  'AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.LEAD.ID.';
comment on column public.achieve_client_sfdc_map.client_id is
  'AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.LEAD.CLIENT_NO_A__C; joins welcome_call_agent_log.client_id.';

create index if not exists achieve_client_sfdc_map_client_idx
  on public.achieve_client_sfdc_map (client_id);

-- Both source and bridge tables are internal. The achieve-portal Edge Function
-- reads them with the service role and emits only the representative's name and
-- email through an explicit projection.
alter table public.welcome_call_agent_log enable row level security;
alter table public.achieve_client_sfdc_map enable row level security;

revoke all on table public.welcome_call_agent_log from anon, authenticated, public;
revoke all on table public.welcome_call_agent_current from anon, authenticated, public;
revoke all on table public.achieve_client_sfdc_map from anon, authenticated, public;
revoke all on sequence public.welcome_call_agent_log_id_seq from anon, authenticated, public;

grant select, insert, update, delete on table public.welcome_call_agent_log to service_role;
grant select on table public.welcome_call_agent_current to service_role;
grant select, insert, update, delete on table public.achieve_client_sfdc_map to service_role;
grant usage, select on sequence public.welcome_call_agent_log_id_seq to service_role;

revoke execute on function public.ingest_welcome_call_agents(jsonb)
  from anon, authenticated, public;
grant execute on function public.ingest_welcome_call_agents(jsonb)
  to service_role;

-- 3) Partner-safe lookup -----------------------------------------------------
-- Resolve only unambiguous client assignments. If a future daily report records
-- more than one distinct representative email for a client, attribution remains
-- null instead of assigning the latest representative to an older call.
--
-- Client IDs are normalized with lower(btrim(...)) at the cross-system seam.
-- Production checks found no whitespace and no normalization collisions in
-- either source, but normalization prevents harmless formatting drift from
-- silently turning every attribution into "Not matched".
create or replace function public.get_achieve_welcome_agents_for_leads(
  p_sfdc_lead_ids text[]
)
returns table (
  sfdc_lead_id text,
  achieve_agent_name text,
  achieve_agent_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested_bridge as (
    select
      bridge.sfdc_lead_id,
      lower(btrim(bridge.client_id)) as normalized_client_id
    from public.achieve_client_sfdc_map as bridge
    where bridge.sfdc_lead_id = any(p_sfdc_lead_ids)
  ),
  requested_clients as (
    select distinct requested_bridge.normalized_client_id
    from requested_bridge
  ),
  unambiguous_clients as (
    select lower(btrim(log.client_id)) as normalized_client_id
    from public.welcome_call_agent_log as log
    join requested_clients as requested
      on requested.normalized_client_id = lower(btrim(log.client_id))
    group by lower(btrim(log.client_id))
    having count(distinct lower(btrim(log.welcome_call_agent_email))) = 1
  ),
  latest_agents as (
    select distinct on (lower(btrim(log.client_id)))
      lower(btrim(log.client_id)) as normalized_client_id,
      log.welcome_call_agent_name,
      log.welcome_call_agent_email
    from public.welcome_call_agent_log as log
    join requested_clients as requested
      on requested.normalized_client_id = lower(btrim(log.client_id))
    order by lower(btrim(log.client_id)), log.last_seen_on desc, log.id desc
  )
  select
    requested_bridge.sfdc_lead_id,
    latest_agents.welcome_call_agent_name as achieve_agent_name,
    latest_agents.welcome_call_agent_email as achieve_agent_email
  from requested_bridge
  join unambiguous_clients
    on unambiguous_clients.normalized_client_id = requested_bridge.normalized_client_id
  join latest_agents
    on latest_agents.normalized_client_id = requested_bridge.normalized_client_id
  where btrim(latest_agents.welcome_call_agent_name) <> ''
    and btrim(latest_agents.welcome_call_agent_email) <> '';
$$;

comment on function public.get_achieve_welcome_agents_for_leads(text[]) is
  'Service-only lookup of unambiguous Achieve/FDR welcome-call representatives by Pennie Salesforce Lead ID.';

revoke execute on function public.get_achieve_welcome_agents_for_leads(text[])
  from anon, authenticated, public;
grant execute on function public.get_achieve_welcome_agents_for_leads(text[])
  to service_role;
