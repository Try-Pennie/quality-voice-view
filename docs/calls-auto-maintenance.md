# Calls automatic maintenance

## Goal contract

**Goal:** Keep recent QA pages eligible for index-only reads and refresh Calls/QA planner statistics before tens of thousands of changes accumulate.

**Context:** Follow-up to [PR #116 production maintenance](https://github.com/Try-Pennie/quality-voice-view/pull/116#issuecomment-5663698522). Manual maintenance reduced sampled QA heap fetches from 2,157 to 2. Wide-window SQL observations changed from 8.73 s before maintenance to 2.35 s afterward, then 0.55 s on a warm repeat. Those individual observations are not a controlled speedup or latency guarantee.

**In scope:** One new migration setting three table storage parameters; extend the existing disposable PostgreSQL 17 integration check; document thresholds, operational limits and reversal.

**Out of scope:** UI/query/KPI changes, new indexes or caches, scheduled jobs, global database settings, compute upgrades, further production maintenance, migration application or merge.

**Done when:**
1. QA insert-triggered vacuum and both tables' analyze become eligible at smaller change counts.
2. The real PostgreSQL daemon performs the expected maintenance in the isolated check.
3. Full five-filter RPC results, function definitions/security, table grants and RLS remain unchanged by the migration; reapplication is safe.
4. The existing SQL regression check passes and an independent review has no remaining blockers.

**Verify:** `bash -n supabase/migrations/ui-load-performance.integration.check.sh`; `bash supabase/migrations/ui-load-performance.integration.check.sh`; `git diff --check`. No browser code changes; this is a database-only PR.

**Stop:** After the focused migration, checks and review are ready for PR. Stop for approval before production writes, broader tuning, query changes or new infrastructure.

## Settings and rationale

Use PostgreSQL's existing autovacuum daemon, not an application scheduler:

| Table | Storage parameter | Current inherited | Proposed |
|---|---|---:|---:|
| `eavesly_transcription_qa` | `autovacuum_vacuum_insert_scale_factor` | 0.2 | 0.01 |
| `eavesly_transcription_qa` | `autovacuum_analyze_scale_factor` | 0.1 | 0.01 |
| `eavesly_calls` | `autovacuum_analyze_scale_factor` | 0.1 | 0.01 |

With the observed production defaults (insert base 1,000; analyze base 50) and approximately 497k QA / 846k Calls rows:

| Eligibility threshold | Before | After |
|---|---:|---:|
| QA inserted rows since vacuum | 100,400 | 5,970 |
| QA changes since analyze | 49,750 | 5,020 |
| Calls changes since analyze | 84,650 | 8,510 |

Thresholds scale with table size; they are not a schedule, a hard backlog cap, or a promise that execution starts immediately. Worker availability, locks, snapshots and I/O still matter. Only insertion-driven QA vacuum and statistics cadence change: dead-row/freeze thresholds, base thresholds, cost throttling and all global settings remain inherited. Calls does not need more insert-driven vacuum for its non-covering time index, so leave that setting alone.

These are conservative initial settings for the observed insert-heavy workload. More frequent background work trades I/O for fresher visibility/statistics; it does not remove the wide summary's per-call QA probes or guarantee cold-cache performance. Observe before tuning further.

References: [PostgreSQL 17 automatic vacuum settings](https://www.postgresql.org/docs/17/runtime-config-autovacuum.html) and [daemon eligibility formulas](https://www.postgresql.org/docs/17/routine-vacuuming.html#AUTOVACUUM).

## Application and observation

The migration only changes table metadata, with a short lock timeout; it runs no VACUUM/ANALYZE or data rewrite. Apply through the normal transactional migration path after approval. If a lock timeout occurs, allow the transaction to roll back and retry during a quieter period; do not raise the lock timeout to wait behind traffic.

After approved application, verify `pg_class.reloptions` and observe `pg_stat_user_tables` (`last_autovacuum`, `last_autoanalyze`, `n_ins_since_vacuum`, `n_mod_since_analyze`), QA heap-fetch counts, query latency and database I/O during ordinary ingestion. Allow enough inserts/changes to cross the thresholds before expecting a daemon run. Cloudflare deployment alone does not apply Supabase migrations.

Before this change, both tables had no per-table options. To reverse only these overrides after approval, use a transactional migration with a short lock timeout:

```sql
set local lock_timeout = '2s';
alter table public.eavesly_transcription_qa reset (
  autovacuum_vacuum_insert_scale_factor,
  autovacuum_analyze_scale_factor
);
alter table public.eavesly_calls reset (autovacuum_analyze_scale_factor);
```

This restores inheritance, not historical global values. Preserve unrelated table options if any are added later.

## Verification

Fresh parent PostgreSQL 17 check passed, including the final zero-counter guard:

```text
Table                      automatic vacuums  automatic analyzes  pending changes
 eavesly_calls                             0                   1                0
 eavesly_transcription_qa                  1                   1                0
maintenance: settings, reapplication, security, RPC parity and real daemon checks passed
ui-load-performance.integration.check.sh: all assertions passed
```

The existing 846,429 Calls / 496,959 QA fixture is reused. After its original regression/security/parity/benchmark checks finish, the test applies the new migration transactionally twice, checks the three parameters and 2-second lock timeout, and compares complete results across all five quick filters. It also checks function definitions/grants, table grants/RLS/policies, and preservation of an unrelated `fillfactor` option.

It then inserts 10,000 Calls and 6,500 QA rows, below the inherited thresholds but above the proposed ones. The real daemon must increment its maintenance counters **and** consume the batches (changes-since-analyze resets for both tables; QA inserts-since-vacuum resets). No manual vacuum/analyze occurs during that stage. Only the disposable container uses a 1-second launcher interval; production inherits its existing interval and cost throttling. The wait has 90 polls with 1-second sleeps plus query overhead, so extremely slow test hosts can fail rather than falsely pass.

`bash -n` and `git diff --check` passed. The documented reversal also passed in a separate disposable PostgreSQL 17 database: both tables returned to inherited maintenance settings and the unrelated `fillfactor=95` survived. Independent cross-family review found no blockers. No browser/build suite was rerun: no application, dependency, frontend configuration or UI files changed. This does not claim a new production latency measurement or guarantee that background work finishes on a fixed schedule.

**Not deployed:** no new production settings have been applied. The migration requires a transaction: `SET LOCAL` does not protect a raw autocommit `psql -f` run; use the normal transactional migration applier.
