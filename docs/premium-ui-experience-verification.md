# Premium UI experience — verification

## Scope and code pin

- Base: `588421d41f80bc7e2f227c946398a308b4d05f20` (merged performance PR #115).
- Verified final code: `a823e997a62f4b1146770b5223080441a0dae21a`.
- Later evidence-only commits add this report, raw measurements and screenshots; they do not change runtime code.
- No production deployment, database write, merge or backend Worker change was performed in this work.

## Delivered behavior

1. Routine pages no longer use the shared 600 ms rise animation. Useful control transitions and reduced-motion support remain.
2. Calls page/sort/filter URL state survives opening a call and Back. Numeric, in-memory scroll positions are restored after matching rows render, once per history entry per mount; background refetch does not yank the user back. Deliberate filter/sort/threshold changes still reset page one.
3. Agent selection is explicit, searchable and keyboard accessible. Selected historical agents absent from current options remain applied and removable.
4. Pending results reserve the last successful body/section height at the same viewport, with skeletons rather than previous-filter rows. Initial pending data reserves a modest viewport area. Next prefetch is intent-triggered, uses the same query identity/parser, fetches only one next page and does not toast on an unobserved speculative failure.
5. Compact mobile controls keep date, Filters and secondary actions reachable. At 320/375/414/768 px the date label stays one line, the first call appears above 650 px, and the page does not overflow horizontally. The bundled, licensed Inter fallback removes reliance on locally installed fonts. Green/yellow status text uses AA-passing deeper tokens across Calls, Review, Call Detail, Team, audit and admin surfaces; semantic fills are unchanged.
6. Non-Calls route modules are lazy-loaded with navigation outside Suspense. Error recovery does not remount healthy route children: Review's drawer URL, unsaved-note protection and keyboard queue position remain intact. A new migration removes only the unnecessary materialization of the summary's QA-joined rows; the original migration remains untouched.

Counts, business timezone/default windows, filter meanings, QA ordering, permissions and KPI formulas are preserved. No persisted stale-count cache or increased query timeout was introduced.

## Fresh checks

Run from this repository with dependencies installed:

| Check | Command | Result |
|---|---|---|
| Complete functional suite | `npm test -- --workers=1 --output=/tmp/eavesly-experience-final-all --reporter=list` | **91 passed, 3.7 min**, no retries, final code pin |
| Production build, journeys, chunk failure/recovery, auth, motion, fonts and contrast | `EXPERIENCE_REPORT=/tmp/eavesly-experience-after-final.json npx playwright test -c playwright.experience.config.ts` | **10 passed, 49.5 s**, including `npm run build`, final code pin |
| Real PostgreSQL behavior/security/performance | `bash supabase/migrations/ui-load-performance.integration.check.sh` | **All assertions passed**; final SQL was unchanged by later UI-only commits |
| Narrow route regressions | `npm test -- --workers=1 --grep 'server sort/filter\|browser Back and Forward\|table paging and J/K\|failed route chunk\|route loading\|same-route'` | **6 passed** after the route-state fix; also covered by the final full suite |
| Targeted ESLint | New/changed Calls, route-boundary, shell-test and benchmark files | Passed |
| Diff hygiene | `git diff --check origin/main..HEAD` | Passed |

Existing repository-wide blockers were not hidden or weakened:
- `npx tsc --noEmit -p tsconfig.app.json`: the same sole baseline error at `src/lib/achieve-feedback-overview.ts:490` (`replaceAll` requires ES2021; project target is ES2020).
- `npm run lint`: baseline **46 errors / 6 warnings**; final **45 errors / 6 warnings**. The remaining diagnostics are pre-existing; the modified Tailwind config no longer uses the flagged CommonJS import.
- Build succeeds but still warns that a chunk exceeds 500 kB. The initial Calls bundle is smaller, not eliminated.

The first concurrent baseline functional run was interrupted after 420 seconds with readiness failures; it is not counted as passing evidence. The first integrated full run found genuine Review history/keyboard regressions caused by keying the error boundary by pathname, plus a timing-dependent prefetch assertion. Those were corrected, the six relevant tests passed, and the complete final suite then passed. Final timing runs were serialized with worker runtimes idle.

## Controlled browser comparison

Five fresh Chromium contexts per revision; production Vite preview; 1440 × 1000; 4× CPU throttling; 10 Mbit/s download and 40 ms transport latency. Supabase HTTP responses use synthetic records with a fixed 180 ms delay. Both versions use the same benchmark harness. Next includes the same 300 ms hover/think time before clicking. Back exercises the app query cache.

The serial baseline served the preserved `588421d` production bundle. Its JavaScript SHA-256 was `e8a7be3e60b00ccd8d4fd40a7fbfe7eecdbc53b0ca93f0fe99c95c90310d8f80`, identical to the previously verified live release. `EXPERIENCE_SOURCE_COMMIT` records that source revision separately from the harness commit. The preliminary, contended baseline was replaced with the serial measurement in the raw artifact.

| Median observed browser journey | Before | After | Reduction |
|---|---:|---:|---:|
| Navigation → first rows plus paint opportunities | 3,140 ms | 2,288 ms | 27.1% |
| Navigation → rows with page entrance settled | 3,233 ms | 2,385 ms | 26.2% |
| Filter → matching rows | 647 ms | 583 ms | 9.9% |
| Next click → next rows | 682 ms | 434 ms | 36.4% |
| Back → rows | 1,369 ms | 312 ms | 77.2% |
| Initial browser script duration (CDP) | 799 ms | 676 ms | 15.4% |
| Back restored the same page | 0/5 | **5/5** | Correctness improvement |

Initial Calls resources, including shared dependencies actually requested:

| Bytes | Before | After |
|---|---:|---:|
| Decoded JavaScript | 1,670,416 | 816,322 |
| Transferred JavaScript, gzip + response headers | 460,566 | 232,984 |
| Transferred CSS | 15,681 | 16,162 |
| Transferred bundled font | 0 | 73,240 |
| **Total JS + CSS + font transfer** | **476,247** | **322,386** |

That is approximately **51% less decoded initial JavaScript**, **49% less JavaScript transfer**, and **32% less combined initial asset transfer even after adding the font**.

Raw samples: [before](performance/premium-ui-before.json) · [after](performance/premium-ui-after.json).

**Limits:** These are fixture-backed browser measurements, not real-user production latency, a field p75, or a promise about every device. Timing includes automation wait/action overhead. First rows uses DOM observation plus two animation frames; script duration is not a separate parse-only measurement. HTTP routing disables browser HTTP caching; the preview serves gzip and is not Cloudflare's CDN transport. No authenticated production browser session or hosted RUM destination was fabricated or added.

To rerun the candidate measurement, use the production-build command above. To reproduce a before/after comparison, build both source revisions and run the same benchmark/HTTP fixture against each, recording the source commit separately when serving a preserved build. Keep worker/browser/SQL workloads idle while collecting samples.

## PostgreSQL evidence

The disposable PostgreSQL 17 fixture contains 846,429 Calls, 496,959 QA rows and 69,204 window Calls, using representative wide rows, indexes, RLS, memory settings and planner settings. Assertions compare complete old/new JSONB values across 40 filter/agent/disposition/threshold combinations and the production-shaped corpus. They retain finite-bound checks, deterministic latest QA, QA-present KPI denominators, JS-compatible rounding, pitch rules, invoker security and authenticated-only execute grants.

Fresh parent verification medians:

| Query | Applied summary | Proposed summary |
|---|---:|---:|
| All | 482.043 ms | 355.892 ms |
| Rushed | 644.682 ms | 392.072 ms |
| Threshold | 398.115 ms | 349.155 ms |
| Compliance | 379.055 ms | 339.042 ms |
| One agent | 43.933 ms | 45.703 ms |
| Six-hour window | 154.877 ms | 133.634 ms |

Temp writes fell from **1,307 to 518 blocks**. The narrow agent case was slightly slower in this run; no universal speedup is claimed. The first candidate was rejected after its repeated rushed predicate produced a **4.7× regression**. The final query retains `windowed MATERIALIZED`, streams `joined`, and applies the predicate once; per-filter regression guards and plan checks passed.

[SQL diagnosis and rejected alternatives](premium-summary-diagnosis.md) · [fresh parent benchmark output](performance/premium-summary-postgres.txt).

Fresh connections are not cold OS-cache measurements. Reduced unnecessary temp work is established in the fixture; the original production timeout's complete cause and future cold-cache/concurrent-load reliability remain unproven. The migration is **proposed, not deployed**, and must be applied separately after approval—Cloudflare Pages does not apply Supabase migrations.

## Independent review and screenshots

The plan and final implementation received independent cross-family review. Correctness findings were fixed, including predicate duplication, healthy-page remounts, unlisted agent selection, scroll/refetch behavior and results geometry. The final reviewer approved `a823e99`; the subsequent full 91-test suite and 10 production-build checks passed on that exact code.

All screenshots contain synthetic data:
- [Desktop before](screenshots/premium-ui/calls-desktop-before-f7ceb07.png) / [desktop after](screenshots/premium-ui/calls-desktop-after-a823e99.png)
- [Mobile before](screenshots/premium-ui/calls-mobile-before-f7ceb07.png) / [mobile after](screenshots/premium-ui/calls-mobile-after-a823e99.png)

The before screenshot pin is a docs-only commit whose runtime source equals `588421d`. The after screenshots were captured from the production build of `a823e99` and visually inspected, including the one-line mobile date label. Existing page content and brand are retained; this is interaction/readability polish, not a wholesale redesign.
