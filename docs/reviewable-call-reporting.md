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

The PR includes the database migration for review. It has not been applied to production. Frontend reporting requires that migration; absent/invalid coverage is surfaced as an error rather than fabricated zeros. The existing private materialized-view refresh schedule remains in place, and raw transcripts are not exposed to the browser.
