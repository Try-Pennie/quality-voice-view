#!/usr/bin/env bash
# Real PostgreSQL 17 check; Docker only, never connects to Supabase.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migrations="$repo_root/supabase/migrations"
container="disposition-audit-check-$RANDOM-$$"
trap 'docker rm -fv "$container" >/dev/null 2>&1 || true' EXIT

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:17-alpine \
  -c random_page_cost=1.1 -c jit=off >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres >/dev/null

{
  cat <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create table auth.users (id uuid primary key, email text not null);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
grant usage on schema public, auth to authenticated, service_role;
create table public.eavesly_module_results (
  id bigint generated always as identity primary key,
  created_at timestamptz not null, alert_sent_at timestamptz,
  call_id text not null, module_name text not null, violation_type text,
  has_violation boolean not null default true, alert_sent boolean not null default true,
  agent_email text not null, contact_name text, contact_phone text,
  recording_link text, transcript_url text, call_summary text, sfdc_lead_id text,
  processing_time_ms integer, result_json jsonb,
  unique (call_id, module_name)
);
-- Existing production indexes: don't give the baseline a test-only date index.
create index idx_module_results_call_id on public.eavesly_module_results(call_id);
create index idx_module_results_violations on public.eavesly_module_results(has_violation, module_name)
  where has_violation = true;
create index idx_module_results_agent_created on public.eavesly_module_results(agent_email, created_at desc)
  where has_violation = true;
create table public.agent_manager_mapping (agent_email text primary key, manager_email text not null);
create table public.manager_coaching_prompts (manager_email text primary key, is_god_mode boolean not null default false);
create table public.eavesly_calls (call_id text primary key, talk_time integer);
create table public.eavesly_dispositions (name text, conversation_happened text, ai_only boolean, active boolean);
SQL
  # Apply the real view definitions and their dependencies, in production order.
  for file in 20260427120000_eavesly_alert_feedback.sql \
              20260429190000_eavesly_alert_thread.sql \
              20260430180000_eavesly_notifications.sql \
              20260527150000_add_inaccuracy_reasons.sql \
              20260820165000_add_talk_time_to_disposition_audit.sql \
              20260911120000_structured_manager_review.sql; do
    cat "$migrations/$file"
  done
  cat <<'SQL'
-- Similar cardinality to the incident: 59,079 older results + 4,984 in range.
-- Unique timestamps make offset-page comparisons deterministic.
insert into public.eavesly_module_results(call_id, module_name, agent_email, created_at, result_json)
select 'call-' || g, 'disposition_review', 'agent-' || (g % 10) || '@example.test',
  case when g <= 59079 then '2026-06-01Z'::timestamptz else '2026-08-20Z'::timestamptz end
    + g * interval '1 second',
  jsonb_build_object('conversation_happened', 'yes',
    'current_disposition', '1.5 - Not Interested > END CAMPAIGNS',
    'suggested_disposition', (array[
      '1.2 - Interested > No Call Scheduled', '1.3 - Interested > Call Scheduled',
      '1.3A - First Call Completed - Interested', '1.3B - Turnbull Pending',
      '1.4 - Converted/Won > END CAMPAIGNS'])[1 + g % 5], 'confidence', 0.95)
from generate_series(1, 64063) g;

-- In-range near misses must stay excluded, including absent JSON fields.
insert into public.eavesly_module_results(call_id, module_name, agent_email, created_at,
  alert_sent, has_violation, result_json)
select 'excluded-' || g, case when g % 7 = 0 then 'full_qa' else 'disposition_review' end,
  'agent-0@example.test', '2026-09-01Z'::timestamptz + g * interval '1 second',
  g % 7 <> 1, g % 7 <> 2,
  case when g % 7 = 3 then '{}'::jsonb else jsonb_build_object(
    'conversation_happened', case when g % 7 = 4 then 'no' else 'yes' end,
    'current_disposition', case when g % 7 = 5 then 'different' else '1.5 - Not Interested > END CAMPAIGNS' end,
    'suggested_disposition', case when g % 7 = 6 then 'different' else '1.2 - Interested > No Call Scheduled' end)
  end
from generate_series(1, 7000) g;
insert into public.eavesly_calls select call_id, id % 600 from public.eavesly_module_results where id % 11 <> 0;
insert into public.eavesly_alert_feedback(call_id, module_name, manager_email, accurate, action_taken)
select call_id, module_name, 'manager@example.test', true, 'coached'
from public.eavesly_module_results where id > 59079 and id <= 64063 and id % 3 = 0;
analyze;

-- Use the current browser column projection rather than maintaining a copy.
SQL
  python3 - "$repo_root/src/lib/disposition-audit-queries.ts" <<'PY'
import re, sys
source = open(sys.argv[1]).read()
block = re.search(r'const AUDIT_LIST_COLUMNS = \[(.*?)\]\.join', source, re.S)
assert block, 'Cannot find browser list projection'
columns = ','.join(re.findall(r"'([a-z_]+)'", block[1]))
print(f"create temp view browser_audit as select {columns} from public.eavesly_disposition_audit;")
PY
  cat <<'SQL'
grant select on browser_audit to authenticated;
create temp table checks (name text, query text, before_rows jsonb, before_plan jsonb);
insert into checks(name, query)
select name, 'select * from browser_audit where alert_created_at >= ''2026-08-15T04:00:00Z'''
  || ' and alert_created_at <= ''2026-09-14T03:59:59.999Z''' || extra
from (values
  ('first page', ' order by alert_created_at desc limit 1000 offset 0'),
  ('second page', ' order by alert_created_at desc limit 1000 offset 1000'),
  ('last page', ' order by alert_created_at desc limit 1000 offset 4000'),
  ('all rows', ' order by alert_created_at desc'),
  ('category', ' and audit_category = ''ended_live_lead'' order by alert_created_at desc limit 1000'),
  ('manager', ' and agent_email in (''agent-0@example.test'', ''agent-1@example.test'') order by alert_created_at desc limit 1000'),
  ('empty', ' and agent_email = ''missing@example.test'' order by alert_created_at desc limit 1000')
) cases(name, extra);
insert into checks(name, query) values
  ('drawer', 'select * from public.eavesly_disposition_audit where call_id = ''call-64063'' and module_name = ''disposition_review''');
grant select, update on checks to authenticated;
set role authenticated;
do $$
declare c record; rows jsonb; plan jsonb;
begin
  for c in select * from checks loop
    execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || c.query || ') t' into rows;
    execute 'explain (analyze, buffers, format json) ' || c.query into plan;
    update checks set before_rows = rows, before_plan = plan where name = c.name;
  end loop;
  if (select jsonb_array_length(before_rows) from checks where name = 'all rows') <> 4984
    or (select jsonb_array_length(before_rows) from checks where name = 'first page') <> 1000
    or (select jsonb_array_length(before_rows) from checks where name = 'last page') <> 984
    or (select jsonb_array_length(before_rows) from checks where name = 'drawer') <> 1 then
    raise exception 'Fixture does not reproduce expected audit cardinality';
  end if;
end $$;
reset role;
SQL
  # SKIP_INDEX=1 must fail the plan assertion: this check detects the original regression.
  if [[ "${SKIP_INDEX:-0}" != 1 ]]; then
    cat "$migrations/20260918010000_index_disposition_audit.sql"
  fi
  cat <<'SQL'
set role authenticated;
set statement_timeout = '8s';
do $$
declare c record; rows jsonb; plan jsonb;
begin
  for c in select * from checks loop
    execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || c.query || ') t' into rows;
    if rows is distinct from c.before_rows then
      raise exception 'Results changed: %', c.name;
    end if;
    execute 'explain (analyze, buffers, format json) ' || c.query into plan;
    if c.name in ('first page', 'second page', 'last page', 'category') then
      if not jsonb_path_exists(plan, '$.**."Index Name" ? (@ == "eavesly_module_results_disposition_audit_created_idx")') then
        raise exception 'Missing audit index scan: %', c.name;
      end if;
      -- The shared review view has a per-row decision sort. Only reject a sort
      -- on the audit date, which forces all matched calls to join before LIMIT.
      if jsonb_path_exists(plan, '$.**."Sort Key"[*] ? (@ == "m.created_at DESC")') then
        raise exception 'Audit date still sorted before pagination: %', c.name;
      end if;
    end if;
    if c.name = 'drawer' and not jsonb_path_exists(plan,
      '$.** ? (@."Relation Name" == "eavesly_module_results" && @."Index Cond" like_regex "call_id = ''call-64063''")') then
      raise exception 'Drawer call_id must remain an index condition, not a heap filter';
    end if;
    raise notice '%: % rows, before % ms / after % ms', c.name, jsonb_array_length(rows),
      c.before_plan->0->>'Execution Time', plan->0->>'Execution Time';
  end loop;
end $$;
SQL
} | docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1

echo 'Disposition audit: result parity and indexed pagination checks passed'
