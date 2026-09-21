# Reviewable call reporting

## Scope

Make manager and representative AI comparisons reflect calls Eavesly could evaluate, without hiding eligible calls that have not received QA. Preserve total volume, manager access boundaries, reporting dates, and alert workloads. No changes to evaluation triggers, coaching-theme sampling, the Calls browser, or production deployment.

## Definitions

- **Reviewable calls:** `conversation_happened IS TRUE` and a nonblank transcript exists in the stored Regal `transcript_available` event or the latest legacy QA row. Whitespace-only text and non-string event values do not count. This is evidence of reviewability, not a new AI conversation classifier.
- **Total calls:** all calls in the existing reporting scope. Includes no-conversation, unknown-conversation, and missing-transcript calls. Shown below reviewable volume rather than used as the AI denominator.
- **AI-evaluated calls:** reviewable calls with a QA record. If retries created multiple QA rows, only the latest by `created_at`, then `id`, counts.
- **Not yet evaluated:** reviewable minus AI-evaluated. Includes pending and failed QA; the reporting data does not distinguish those states. A successful evaluation closes this gap without changing reviewability.
- **AI rates:** compliance uses reviewable calls graded pass/fail; CSAT uses reviewable calls rated high/medium/low; escalation uses AI-evaluated reviewable calls. Missing QA is not a pass, failure, or non-escalation.

There is no new talk-time threshold: the Full QA trigger accepts an available transcript. A usable legacy QA transcript is evidence, but QA success alone is not the eligibility rule. False/unknown conversation flags remain excluded even if a scorecard exists. Calls with no transcript are excluded from reviewable coverage but remain in total volume; this report does not diagnose why their transcripts are missing.

Manager and representative AI views sort by reviewable volume on entry. Existing `sort=call_count` links map to the new sort. Zero-QA agents are not labeled as AI failures or included in top-score comparisons; their alert workload is still actionable. Trends and profile/header volume use the same reviewable counts. Raw recent-call lists and separate coaching-theme samples keep their existing behavior.

## Verification

- `bash supabase/migrations/reviewable-call-metrics.integration.check.sh`: real PostgreSQL 17; applies the baseline and new migration, then checks eligibility, duplicate QA, pending-to-evaluated refresh, ET boundaries, alert-only agents, manager/god-mode scope, and RPC grants.
- `npx playwright test`: **192 passed**. Includes manager/agent aggregation, sorting, keyboard drilldown, mobile coverage, zero-QA state, and visible errors if the RPC lacks the new field.
- `npm run build` and `git diff --check`: **passed**.
- `npm run lint` and `npx tsc --noEmit -p tsconfig.app.json`: baseline failures below, unchanged.
- `npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable`: **passed** without changing the repository's compiler configuration.
- Independent cross-family review: **no correctness or security blockers**; reviewed eligibility, QA deduplication, RPC scope/grants, aggregation, and missing-data handling. Production-scale materialized-view refresh timing is not verified by the small local fixture.

The base commit `36cd2ef` already has 45 ESLint errors / 6 warnings and two TypeScript errors (`replaceAll` with an ES2020 lib in `achieve-feedback-overview.ts` and `recording-timestamps.ts`). These are outside this change; compare against the base rather than suppressing them.

## Screenshots

Captured with synthetic data by the three passing regression tests at code commit `90d34aafb9a43b3b5e25bd72f6dc62c83516383f`:

- [Manager table](screenshots/reviewable-calls/90d34aa/managers.png)
- [Mobile representative metrics](screenshots/reviewable-calls/90d34aa/mobile.png)

## Production follow-up (2026-09-21)

The frontend deployed after PR #123 merged, before the database migration was applied. That made Team fail visibly on the missing `reviewable_call_count` field. With explicit approval, the corrected migration was applied to production as `20260921022034_reviewable_call_metrics`, and the PostgREST schema cache was reloaded.

The initial full-history attempts could not finish within the migration budget. Two plan changes preserve the results while avoiding unnecessary work:

- Materialize the narrow `call_population` once, so ten aggregate filters do not each re-read/decompress transcripts.
- Select latest QA **IDs only** in one indexed pass, then bulk-join scores. Production read-only `EXPLAIN` confirms index-only latest-ID selection and sequential/hash joins, replacing per-call probes and UUID-ordered heap scans.

The migration's ten-minute timeout and 32 MB work memory are transaction-local, not permanent database settings. This corrects the migration before its first successful production application. An environment that previously applied an older body must explicitly reconcile/reapply it; migration trackers do not rerun changed files automatically.

Fresh checks:

- `bash supabase/migrations/reviewable-call-metrics.integration.check.sh`: passed, including equal-time QA retries and NULL timestamps.
- `REVIEWABLE_BENCHMARK=1 bash supabase/migrations/reviewable-call-metrics.integration.check.sh`: 20,000 TOAST-heavy synthetic calls; exact bidirectional `EXCEPT` equivalence. The bulk query without the population barrier took 11.70s; with it, 1.12s. This measures the SELECT, not production refresh wall time.
- Separate local comparison against PR #123's original full view: identical fixture output, checked with `EXCEPT` in both directions.
- Production date window Aug 22–Sep 20: 1,949 daily rows; 69,520 total calls; 29,782 reviewable; 29,724 evaluated; 58 not yet evaluated; zero invalid coverage rows. The one-call reduction from the old total is exactly one duplicate QA join row; raw call volume matches.
- Production team RPC returned those same totals with the user's claims. A regular manager returned 311 daily rows, zero outside-scope rows, and zero rows from an unauthorized agent RPC. Anonymous execution and direct access to raw events/private reporting remain denied.

The first scheduled refresh after deployment hit the same two-minute default. Migration `20260921023309_reviewable_metrics_refresh_budget` gives only this cron session a ten-minute timeout and 32 MB work memory. The job remains enabled with its existing `*/5 * * * *` schedule; no global database setting or access grant changes. Configuration read-back passed; completion of the next scheduled refresh must be verified separately from initial population.

The advisor's [signed-in SECURITY DEFINER warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) is expected for these scoped RPCs; the access checks above verify the intended boundary. Unrelated advisory findings were not changed.
