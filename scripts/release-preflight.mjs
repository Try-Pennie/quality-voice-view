#!/usr/bin/env node
// Read-only. A successful contract check never authorizes db push or migration repair.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const projects = new Set(['miikotqnovnixpeqtqnd', 'xuvveqaizlletsqvwpgx']);
export const fingerprint = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');

export function compareMigrations(local, remote) {
  const problems = [];
  const localVersions = new Set();
  const remoteVersions = new Set();
  for (const migration of local) {
    if (localVersions.has(migration.version)) problems.push({ kind: 'duplicate-local-version', version: migration.version });
    localVersions.add(migration.version);
  }
  for (const migration of remote) {
    if (remoteVersions.has(migration.version)) problems.push({ kind: 'duplicate-remote-version', version: migration.version });
    remoteVersions.add(migration.version);
  }
  for (const migration of local) {
    const applied = remote.find((row) => row.version === migration.version);
    if (!applied) {
      const candidates = remote.filter((row) => row.name === migration.name);
      problems.push({
        kind: 'local-only', version: migration.version, name: migration.name,
        // Same name is evidence to inspect, never proof of equivalence.
        candidates: candidates.map((row) => ({ version: row.version, sameBody: row.hash === migration.hash })),
      });
    } else if (applied.hash !== migration.hash) {
      problems.push({ kind: 'body-mismatch', version: migration.version, name: migration.name });
    }
  }
  for (const migration of remote) {
    if (!localVersions.has(migration.version)) problems.push({ kind: 'remote-only', version: migration.version, name: migration.name });
  }
  return problems;
}

export async function localMigrations(directory = path.join(root, 'supabase/migrations')) {
  const names = (await readdir(directory)).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({
    version: name.slice(0, 14), name: name.slice(15, -4), hash: fingerprint(await readFile(path.join(directory, name), 'utf8')),
  })));
}

export function parseLedger(value) {
  if (!Array.isArray(value)) throw new Error('Invalid migration inventory response');
  return value.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.version !== 'string' || !/^\d{14}$/.test(row.version)
      || typeof row.name !== 'string' || typeof row.body !== 'string') throw new Error('Invalid migration inventory row');
    return { version: row.version, name: row.name, hash: fingerprint(row.body) };
  });
}

export async function readDatabase(project, token, query, request = fetch) {
  if (!projects.has(project)) throw new Error('Use the explicitly allowlisted production or isolated staging project');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required');
  const response = await request(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(30_000),
  });
  // API errors and SQL bodies may contain secrets: never echo their response text.
  if (!response.ok) throw new Error(`Read-only preflight request failed (HTTP ${response.status})`);
  return response.json();
}

const ledgerSql = "select version, coalesce(name, '') as name, coalesce(array_to_string(statements, E'\\n'), '') as body from supabase_migrations.schema_migrations order by version";
const contractsSql = `select
  exists (select 1 from pg_policies where schemaname='public' and tablename='manager_coaching_prompts'
    and cmd='INSERT' and policyname='Users can insert own prompt data'
    and with_check = '((manager_email = (auth.jwt() ->> ''email''::text)) AND (is_god_mode IS FALSE))')
  and (select relrowsecurity from pg_class where oid='public.manager_coaching_prompts'::regclass)
  and not exists (select 1 from pg_policies where schemaname='public' and tablename='manager_coaching_prompts'
    and cmd in ('INSERT','ALL') and permissive='PERMISSIVE' and roles && array['public','authenticated']::name[]
    and policyname <> 'Users can insert own prompt data') as role_insert_protected,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='team_daily_metrics'
    and 'reviewable_call_count'=any(p.proargnames)) as reviewable_metrics_available,
  (select count(*)=2 from pg_index i join pg_class c on c.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and i.indisvalid
    and c.relname in ('eavesly_qa_usable_transcript_idx','eavesly_regal_usable_transcript_idx')) as transcript_index_present`;

async function main() {
  const [project, ...extra] = process.argv.slice(2);
  if (!projects.has(project) || extra.length) throw new Error('Usage: node scripts/release-preflight.mjs <explicit-project-ref>');
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const local = await localMigrations();
  const remote = parseLedger(await readDatabase(project, token, ledgerSql));
  const contracts = await readDatabase(project, token, contractsSql);
  if (!Array.isArray(contracts) || contracts.length !== 1 || !contracts[0]
    || ['role_insert_protected', 'reviewable_metrics_available', 'transcript_index_present'].some((key) => typeof contracts[0][key] !== 'boolean')) {
    throw new Error('Invalid deployment contract response');
  }
  const drift = compareMigrations(local, remote);
  const blocked = drift.length > 0 || Object.values(contracts[0]).some((value) => value !== true);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), project, localCount: local.length, remoteCount: remote.length,
    contracts: contracts[0], drift, status: blocked ? 'BLOCKED' : 'INVENTORY_MATCHES',
    instruction: 'Read-only evidence only. Do not bulk push, repair, resend, or deploy automatically. Review explicit migration bodies and release runbook.' }, null, 2));
  if (blocked) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Release preflight failed; inventory could not be verified. No changes were made. Check project, credentials, API access and response shape privately.'); process.exitCode = 1; });
}
