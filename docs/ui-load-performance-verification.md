# UI load performance — verification and review

Code/test commit: **`8cc4d46508eb8942a65f38304d9b1e7ced6b709f`**. Base: `704f3717099373f02dc701941e00d169691676ea` (`main`).

## What changed

- Calls first-page data: **one page RPC**, independent of summary and agent options (**three initial Calls data RPCs total**). In the production baseline, each observed list/QA sequence made **301 requests**, plus ~60 name-query requests. Authentication, notification polling, and other app-shell requests are not included in either comparison.
- One small distinct-active-agent response replaces call-table pagination for options.
- One server-scoped Team pitch-count response replaces per-call pagination (70 requests in the measured example).
- Full-window filters, counts, KPIs, score sorts and PDF export remain server-query based. The exported PDF previously silently stopped after 50 calls; it now includes the explicitly fetched filtered rows. No whole-window export fetch starts until the user clicks Export.
- Calls with multiple QA records consistently use the latest `created_at DESC NULLS LAST, id DESC` row. Old selection was unspecified, so some QA values/KPIs can correctly differ. Agent ordering uses deterministic database collation, not the browser's locale.

## Fresh checks

Executed in the worktree with its own lockfile-installed dependencies:

| Check | Result |
|---|---|
| `npm run build` | Passed; existing large-bundle/Browserslist warnings remain |
| `npm test -- --workers=1 --output=/tmp/eavesly-performance-release --reporter=list` | **74 passed**, no retries, 4.5 minutes |
| `bash supabase/migrations/ui-load-performance.integration.check.sh` | Passed on ephemeral PostgreSQL 17; actual migration applied |
| `npx eslint src/lib/calls-queries.ts src/lib/queries.ts src/pages/DashboardPage.tsx tests/calls-performance.spec.ts` | Passed |
| `git diff --check` | Passed |
| `npm run lint` | Existing repository failures remain: **46 errors, 6 warnings**, down from baseline 50 errors/6 warnings |
| `npx tsc --noEmit -p tsconfig.app.json` | Same baseline error: `src/lib/achieve-feedback-overview.ts:490` uses `replaceAll` against the ES2020 library target; no new errors |

The initial baseline browser run had one 5-second Review/Team readiness failure, which passed alone. Early post-change parallel verification also encountered readiness timeouts; an overlapping independent-review test runner then terminated the shared Vite server during a separate attempt. Those interrupted/failing runs are not counted as passing evidence. Runtime ownership was serialized; the complete final run above passed all 74 tests, with a separate output directory and no retries or altered assertions.

### Database behavior coverage

Tests exercise real SQL against representative tables, production-shaped indexes, authenticated/anon roles, calls/QA RLS and manager/prompt policies. They cover grants/invoker mode, manager/god/no-mapping/case-mismatch/missing-JWT scope, bounded page validation, finite dates, 1,005-row pagination/export order, latest-QA timestamp/ID ties, no-QA rows, KPI denominators and negative-half rounding, threshold behavior, no-show/pitch punctuation normalization and the 1,800-second boundary, active-name selection, and empty disposition handling.

Browser coverage includes independent rows while summary is blocked, first-page request count with a synthetic 70k-call window, warm page cache, filter/sort offset reset, ET/URL/threshold parameters, failed/malformed reads, empty state, >1,000-row PDF export, no partial PDF after failures or duplicate/shifted pages, Team aggregate requests, and desktop/mobile layout.

## Synthetic database benchmark (not production speedup)

70,000 synthetic calls and QA rows, five runs per query, ephemeral local PostgreSQL 17. Latest-QA index plus the **production-shaped** `started_at DESC NULLS LAST` index; no test-only `(started_at,id)` index.

| Query | Median | Five sorted runs (ms) |
|---|---:|---|
| Default time-desc first page | **12.762 ms** | 9.677, 10.636, 12.762, 14.774, 19.663 |
| Score-desc first page | **1,081.187 ms** | 988.188, 1,061.388, 1,081.187, 1,188.149, 1,249.091 |
| Whole-window summary | **761.463 ms** | 730.179, 739.543, 761.463, 771.758, 879.646 |

The default page plan scans **27 calls and makes 27 latest-QA index probes**, rather than joining every QA row in the window. This bounded-work claim applies to the default time sort. QA-based sorts must evaluate all matching calls to rank them; agent/talk sorts also process the selected window. Their **response size** is bounded, not necessarily their database work.

These are SQL execution timings, **not browser time-to-data, API latency or a before/after production speedup factor**. The [production baseline](ui-load-performance-baseline.md) remains the reference until an explicitly approved deployment is measured.

## Independent review

- Plan: independent cross-family review approved with required parity pins, recorded in [the plan](ui-load-performance-plan.md) before implementation.
- Code: independent cross-family reviewer inspected SQL/client/UI/tests, the parity follow-up, and the final filter-transition reset regression fix through `8cc4d46`, finding **no blocking correctness or security issues**.
- Accepted non-blocking limits: on-demand offset export may need retrying if live ingestion shifts page boundaries; non-default sorts can still scan the selected window. Added an explicit duplicate-page export failure test and the score-sort benchmark above in response.
- Repository-wide lint and the existing ES library mismatch were not papered over or repaired as unrelated work.

## Limits and approval gates

1. **No production migration, frontend deployment, or merge has occurred.** This PR requires the included RPC migration and index; do not publish the new client against a database missing them. Applying the index is a separate production operation requiring approval; ordinary index creation can block QA writes while it runs.
2. Whole-window exports use bounded offset requests, not a transactionally consistent snapshot. Inserts can cause the duplicate guard to request a retry. Deletes/updates between pages can also change membership without a snapshot. For exact point-in-time exports, use a server snapshot export as a follow-up. There is still a 100,000-row safety ceiling, reported explicitly rather than silently truncating.
3. This PR does **not** optimize the Review list SQL, coaching QA JSON batches, or the overall JS bundle. Those are separate measured follow-ups.
4. Production end-to-end improvement remains unverified pending approved deployment and an authenticated browser measurement. No production credentials were minted or browser sessions fabricated to obtain a benchmark.

## Repeatable post-approval browser measurement

Use the same account/role, agent scope, explicit ET date range, device/network, and deployed revision for each before/after sample. Do not shorten the reporting window to make a comparison look faster.

1. In browser DevTools, enable Network recording. Record Calls, Review and Team separately.
2. Cold case: clear the app's in-memory query cache with a full reload (do not change account scope); separately record browser HTTP-cache state. Measure navigation/filter-change → first usable rows and → all requested sections ready.
3. Warm case: revisit the identical route/filters within 60 seconds. Do not mix cold and warm durations in the same percentile.
4. Capture request count and transfer size alongside elapsed time. Expected Calls data requests: one `eavesly_calls_page`, one `eavesly_calls_summary`, one `eavesly_active_call_agents`; no whole-window `eavesly_calls`/`eavesly_transcription_qa` download on first navigation. Team pitch uses `eavesly_team_pitch_risk`.
5. Repeat at least five times per case, note sample count and report medians/tail values without treating request samples as independent page loads. Use the baseline log queries on comparable traffic windows for API-level comparison.

## Commit-pinned screenshots

Synthetic browser data only; captured by the passing suite at code commit `8cc4d46508eb8942a65f38304d9b1e7ced6b709f`. The later documentation commit only preserves these artifacts.

- [Desktop, 1440×1000](screenshots/ui-load-performance/calls-desktop-8cc4d46.png)
- [Mobile, 390×844](screenshots/ui-load-performance/calls-mobile-8cc4d46.png)
