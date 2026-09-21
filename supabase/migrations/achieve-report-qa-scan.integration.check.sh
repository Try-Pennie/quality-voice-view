#!/usr/bin/env bash
# Real PostgreSQL, isolated Docker only; no production credentials or connection.
set -euo pipefail
migrations="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container="achieve-report-check-$RANDOM-$$"
trap 'docker rm -fv "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
python3 - "$migrations" <<'PY' | docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1
from pathlib import Path
import sys
m = Path(sys.argv[1])
def function(file, name):
    text=(m/file).read_text()
    start=text.index('create or replace function '+name+'(')
    return text[start:text.index('$$;', start)+3]
print('''
create schema private;
create table public.eavesly_module_results (
  id bigint primary key, call_id text, module_name text, created_at timestamptz,
  has_violation boolean, result_json jsonb, sfdc_lead_id text
);
create table public.eavesly_calls (call_id text, sfdc_lead_id text);
create table public.achieve_client_sfdc_map (sfdc_lead_id text, client_id text);
create table public.welcome_call_agent_log (
  id bigint, client_id text, welcome_call_agent_name text, welcome_call_agent_email text, last_seen_on date
);
''')
source='20260816120000_achieve_wc_agent_summary_ai.sql'
print(function(source,'private.achieve_is_ordinary_graded_qa'))
print(function(source,'private.achieve_exact_call_agents'))
print(function('20260817141000_optimize_achieve_wc_summary_scope.sql','private.achieve_ordinary_qa_attributed')
      .replace('private.achieve_ordinary_qa_attributed(', 'private.achieve_ordinary_qa_attributed_including_terminated(', 1))
print('''
insert into eavesly_module_results
select i, 'call-'||i, case when i=6 then 'different_module' else 'achieve_welcome_call_qa' end,
  '2026-09-10 12:00Z'::timestamptz, i=2,
  case i when 3 then '{"grading_skipped":true}'::jsonb
    when 4 then '{"transcript_segment":{"used_full_transcript_fallback":true}}'::jsonb
    when 5 then '{"skip_reason":"competitor_transfer"}'::jsonb
    when 7 then '{"backfill":{"audit_only":true}}'::jsonb
    when 8 then null else '{}'::jsonb end,
  'lead-'||i
from generate_series(1,8) i;
insert into eavesly_calls select call_id, sfdc_lead_id from eavesly_module_results;
insert into achieve_client_sfdc_map select sfdc_lead_id, 'client-'||id from eavesly_module_results;
insert into welcome_call_agent_log
select id, 'client-'||id, 'Agent '||id, 'agent'||id||'@example.test', '2026-09-21'::date
from eavesly_module_results;
-- Identical normalized emails, blanks, conflicting identities, and latest-name ordering.
insert into welcome_call_agent_log values
  (99,' CLIENT-1 ','Latest Agent',' AGENT1@EXAMPLE.TEST ','2026-09-22'),
  (100,'client-1','Not an agent','   ','2026-09-23'),
  (101,'client-1','Not an agent',null,'2026-09-24'),
  (102,'client-2','Conflict','different@example.test','2026-09-22');
update eavesly_calls set sfdc_lead_id='conflicting-lead' where call_id='call-5';
insert into achieve_client_sfdc_map values ('lead-6','different-client');
update welcome_call_agent_log set welcome_call_agent_email='  ' where client_id='client-7';
update welcome_call_agent_log set welcome_call_agent_email=null where client_id='client-8';
create temp table before_exact as
select * from private.achieve_exact_call_agents(array['call-1','call-2','call-3','call-4','call-5','call-6','call-7','call-8','call-1','',null]);
create temp table before_fix as
select * from private.achieve_ordinary_qa_attributed_including_terminated('2026-09-07 04:00Z','2026-09-21 04:00Z');
begin;
''')
print((m/'20260921161230_achieve_report_qa_scan.sql').read_text())
print((m/'20260921162402_achieve_attribution_antijoin.sql').read_text())
print('''
commit;
do $$
begin
  if (select count(*) from before_fix) <> 1 then raise exception 'invalid baseline'; end if;
  if (select array_agg(call_id order by call_id) from before_exact) <> array['call-1','call-3','call-4'] then
    raise exception 'invalid identity baseline'; end if;
  if (select achieve_agent_name from before_exact where call_id='call-1') <> 'Latest Agent' then
    raise exception 'latest nonblank normalized identity not selected'; end if;
  if exists (
    (select * from before_exact except select * from private.achieve_exact_call_agents(array['call-1','call-2','call-3','call-4','call-5','call-6','call-7','call-8','call-1','',null]))
    union all
    (select * from private.achieve_exact_call_agents(array['call-1','call-2','call-3','call-4','call-5','call-6','call-7','call-8','call-1','',null]) except select * from before_exact)
  ) then raise exception 'identity resolution changed'; end if;
  if exists (select * from private.achieve_exact_call_agents(null)) then
    raise exception 'null requests must be empty'; end if;
  if exists (
    (select * from before_fix except select * from private.achieve_ordinary_qa_attributed_including_terminated('2026-09-07 04:00Z','2026-09-21 04:00Z'))
    union all
    (select * from private.achieve_ordinary_qa_attributed_including_terminated('2026-09-07 04:00Z','2026-09-21 04:00Z') except select * from before_fix)
  ) then raise exception 'attribution changed'; end if;
  if (select count(*) from private.achieve_ordinary_qa_attributed_including_terminated(null,null)) <> 1 then
    raise exception 'all-time exclusions changed'; end if;
  if exists (select * from private.achieve_ordinary_qa_attributed_including_terminated('2026-09-11 04:00Z',null)) then
    raise exception 'range boundary changed'; end if;
end $$;
-- DML must maintain membership in the predicate index.
update eavesly_module_results set result_json='{"grading_skipped":true}' where id=1;
update eavesly_module_results set result_json='{}' where id=3;
set enable_seqscan=off;
do $$
declare plan json;
begin
  if (select array_agg(module_result_id order by module_result_id)
    from private.achieve_ordinary_qa_attributed_including_terminated(null,null)) <> array[3]::bigint[] then
    raise exception 'indexed membership did not follow writes'; end if;
  execute $q$explain (format json) select id,call_id,created_at,has_violation from eavesly_module_results
    where module_name='achieve_welcome_call_qa' and private.achieve_is_ordinary_graded_qa(module_name,result_json)
    and created_at >= '2026-09-07 04:00Z'$q$ into plan;
  if plan::text not like '%eavesly_module_results_achieve_ordinary_created_idx%' then
    raise exception 'covering index not usable'; end if;
end $$;
select 'PASS: attribution parity, exclusions, dates, all-time, indexed writes and planner' as result;
''')
PY
