# Indexed reviewable metrics recovery

## Goal and gates

Restore fresh Team metrics without repeated historical transcript reads, while preserving reviewability, latest-QA selection, every rollup field, and manager access. No paid compute upgrade, global timeout change, or new application cache/trigger pipeline.

Before resuming the five-minute schedule:

1. Both transcript membership indexes are valid and ready.
2. Production EXPLAIN uses index-only membership/latest-QA scans, not transcript-filtered heap scans.
3. Full local row equivalence and transcript update/delete tests pass.
4. Production rebuild and several refreshes finish comfortably below the interval, while interactive manager queries remain responsive.
5. Scheduled runs succeed with a bounded timeout. Stop and leave the serving snapshot intact if these gates fail.

## Disk I/O alert

Supabase's warning is about throughput/IOPS burst capacity, **not free disk space**. Exhausting that budget throttles the instance to baseline performance. The repeated 5–10-minute refresh scans are consistent with the alert and the observed `DataFileRead` waits. Pausing the job removed that sustained source of load; it does not establish the current remaining burst budget.

- [Supabase high Disk I/O guidance](https://supabase.com/docs/guides/troubleshooting/exhaust-disk-io)
- [Project Database Health / remaining budget](https://supabase.com/dashboard/project/miikotqnovnixpeqtqnd/observability/database)

No paid infrastructure change is made by this repair. Check the dashboard's budget/IO trend after recovery; consider capacity only if the optimized normal workload still exceeds baseline.

## Design

Two partial indexes store only usable transcript IDs. PostgreSQL automatically updates membership on inserts, transcript edits, and deletes. The refresh reads these keys instead of decompressing stored text/JSON:

- QA membership uses `id` and `original_transcript ~ '[^[:space:]]'`.
- Regal membership uses `regal_task_id`, `event_type='transcript_available'`, a JSON string guard, and the same nonblank regex.
- Membership is joined to the **latest QA id**, not any historical QA for the call. The existing covering latest-QA index also supplies the ratings.
- Conversation flag, ET day, Sunday/manager exclusions, alert workload, and RPC scope remain unchanged.

The replacement MV is populated beside the serving snapshot. Only after population/indexing succeeds does one transaction drop the old MV and rename the replacement. Existing RPCs/grants remain; PostgreSQL invalidates their cached relation plans. A short lock timeout aborts the swap rather than blocking interactive readers indefinitely.

## Production index build procedure

The management migration API wraps DDL in a transaction and rejects `CREATE INDEX CONCURRENTLY`. A plain index build on these populated source tables would block ingestion writes, so production uses one temporary pg_cron maintenance job at a time, executing a **single** concurrent-index statement outside a migration transaction.

Each job is scheduled for one specific upcoming GMT minute/day/month, retains the existing timeout, and is removed immediately after completion. Inspect `pg_stat_progress_create_index`, `cron.job_run_details`, and `pg_index.indisvalid/indisready`; do not blindly retry an invalid or running build. The ordinary `CREATE INDEX IF NOT EXISTS` migration then registers the completed definition and rejects invalid indexes. On empty/local databases it creates the index normally. Apply migration registrations serially: the management API assigns second-resolution versions, which can collide on simultaneous requests.

Operational preparation steps are recorded in the production migration ledger as `20260921124157_prepare_regal_transcript_index_build` and `20260921124355_prepare_qa_transcript_index_build`. These schedule-only operations are not a reason to recreate the temporary jobs on another deployment. Reconcile these operational ledger entries before a CLI-wide migration push, alongside the previously documented historical migration drift.

## Verification record

- `REVIEWABLE_BENCHMARK=1 bash supabase/migrations/reviewable-call-metrics.integration.check.sh`: PostgreSQL 17, full bidirectional row equivalence, cached RPC plan invalidation after MV replacement, latest retry becoming blank, late Regal transcript, JSON object rejection, QA transcript edits, source deletes, and scope/grants.
- Latest 20,000 TOAST-heavy synthetic check: old materialized-population SELECT 1.37s → indexed SELECT 0.108s; exact rows match. The test requires **both membership indexes and the covering latest-QA index** to appear as index-only scans. These are local SELECT timings, not production refresh timings.
- Regal concurrent build: 19.25s, valid/ready index of 7.35MB. QA concurrent build: 72.74s, valid/ready index of 11MB. Both temporary jobs were removed.
- Canonical production migrations: `20260921124725_qa_usable_transcript_index`, `20260921124740_regal_usable_transcript_index`, `20260921125014_indexed_reviewable_metrics`, and `20260921125540_resume_indexed_metrics_refresh`. Repository filenames match these versions.
- During QA build, manager metrics + pitch-risk query completed in 3.00s under the unchanged eight-second API budget.
- Production rebuilt successfully. The complete new plan uses all three index-only scans; no QA/Regal transcript-filtered sequential scan remains. Three real concurrent refreshes completed in **15.29s, 12.35s, and 12.39s**. Shared-buffer read counts are not physical-device/burst-budget measurements.
- Before/after production RPC aggregates for Aug 22–Sep 20 match: 1,949 rows, 69,520 total calls, 29,782 reviewable, 29,724 evaluated, 58 pending, zero invalid coverage rows. This is aggregate production evidence; the full-row equivalence proof is the local test above.
- Replacement MV owner is `postgres`, ACL remains NULL, actual default ACLs are absent, and authenticated users still lack private-schema usage.
- Manager metrics + pitch-risk completed in 4.42s immediately after a refresh, within the unchanged eight-second API budget. Cold/warm timings vary; do not generalize warm subsecond checks to every request.
- The job is re-enabled on its unchanged `*/5 * * * *` cadence with **two-minute** session timeout and 32MB work memory. This ops migration is verified by production read-back/scheduled runs, not the bare-PG integration fixture (which lacks pg_cron).
- Two consecutive scheduled runs succeeded: **13:00 UTC in 27.96s**, then **13:05 UTC in 26.77s**. Each left over four minutes idle before the next scheduled run; no back-to-back refresh backlog remains.
- After both scheduled runs, manager RPC verification returned 311 rows, zero outside-scope/invalid rows, and zero unauthorized-agent rows. These are authenticated-role database checks, not a claimed browser login.
- Fresh review integration, build, and committed-diff whitespace checks also passed. Investigate any refresh that trends toward two minutes; pause rather than repeatedly increasing its timeout.
