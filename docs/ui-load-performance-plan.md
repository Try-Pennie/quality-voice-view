# UI load-time improvement plan

## Goal contract

**Goal:** show usable Calls rows without downloading the whole reporting window, and remove the observed bulk downloads for agent options and Team pitch-risk totals.

**Context:** production baseline in `ui-load-performance-baseline.md`: two Calls data-fetch sequences span ~21 seconds and make 301 requests each, plus ~60 agent-name requests. Team pitch-risk uses 70 sequential requests. Existing cache settings only help warm navigation.

**In scope:** Calls data queries/hooks/page, small authenticated Postgres read RPCs and one supporting latest-QA lookup index if justified, Team pitch-risk query, repeatable performance/behavior tests, baseline and review evidence.

**Out of scope:** review-queue redesign, review mutations/permissions, auth/RLS policy changes, caching infrastructure, new telemetry vendors, dependency upgrades, backend QA pipeline, production migrations/deployments. Investigating slow Review SQL is a subsequent slice; do not claim this PR fixes every slow request.

**Done when:**
1. Calls initial data uses three bounded RPC responses (visible rows + summary/options + agents); first 25 rows do not wait for summary/options. No entire-window calls/QA fan-out on initial navigation.
2. Date/agent/disposition/quick filters, six sorts, pagination, full-window KPIs and PDF export retain their semantics. Changing a filter cannot label old rows as new; loading/error/empty states remain distinct.
3. Agent options return one row per active agent; Team pitch-risk returns one aggregate row per authorized agent, not call rows.
4. Real PostgreSQL tests cover SQL behavior, authorization, >1,000 rows, duplicate QA, and pitch rules; browser tests cover pagination/filter/export/loading/errors and prove bounded initial requests. A synthetic ~70k-row benchmark and commit-pinned desktop/mobile screenshots are recorded.
5. Independent plan and code reviews are addressed; checks pass and a GitHub PR targets `Try-Pennie/quality-voice-view:main`.

**Verification:** `npm run build`; `npm run lint` (report pre-existing failures separately); `npm test`; a Docker/Postgres 17 integration check for this migration, including a repeatable 70k-row benchmark. Browser fixture timings are not production latency claims. Production improvement is unproven until an approved deployment and same-scope browser measurement.

**Stop conditions:** stop for any required permission/product change or production action; do not silently broaden the project. Keep the branch/worktree for review; never merge or deploy.

## Implementation

### 1. Bounded Calls reads

Add narrowly scoped, authenticated, **SECURITY INVOKER** RPCs for a Calls page and its summary. Preserve current Calls access: the live calls/QA RLS policies allow authenticated reads; do not change that to manager-only or use a SECURITY DEFINER bypass.

- Page RPC takes validated absolute date bounds, agent/disposition filters, quick filter and threshold parameters, sort/direction, offset and bounded page size. Return only the displayed call columns and compact QA, with `has_more`; default UI size 25. Use parameterized SQL/allowlisted sorting, deterministic tie-breaking, and no transcripts/QA JSON.
- Summary RPC returns filtered count/KPIs, unfiltered-in-agent/date-scope total and disposition options. Use the same filtering rules as the page, not page-local aggregates.
- Keep the page and summary queries independent. Represent unavailable summary values as loading/error, not zeros. Keep cache settings; cancellation/keys must prevent stale-filter results.
- Duplicate QA exists in production (217 duplicated call-ID groups): explicitly select the latest QA by `created_at DESC NULLS LAST, id DESC` consistently, never duplicate Calls/counts. The old map selected an unspecified row. Cover the tie/null/no-QA cases in SQL tests and document this deterministic correction.
- Preserve score rank, agent display-name fallback, ET boundaries, no-QA handling, fixed headline attention rules, and the current localStorage-derived quick-filter threshold semantics. Do not fix unrelated settings behavior.
- Fetch the whole filtered/sorted export only after Export is clicked, using bounded pages and the same filter/query semantics. Retain complete-export guarantees and show errors rather than silently truncating or reporting success.

### 2. Small agent-option result

Add a SECURITY INVOKER distinct-active-agent RPC over visible calls in the last 30 days, selecting the newest non-null name deterministically. The existing directory is god-mode-only: do **not** broaden its grants or substitute it for ordinary managers. Only small distinct results cross the network.

### 3. Team pitch-risk aggregate

Replace call downloads with one aggregate RPC. Enforce the same manager/god-mode scope server-side using the caller's JWT and existing mapping/prompt tables, without changing RLS or exposing out-of-scope counts. Preserve campaign/disposition normalization, `no show` exclusion, null/zero/negative talk-time behavior, and the strict under-1,800-second rushed cutoff. Keep the existing hook/Map interface for its consumers.

### 4. Verification and measurement

Use existing Playwright HTTP-fixture patterns (synthetic records, no production logins or mutations) and existing ephemeral Docker/Postgres testing conventions. Test the real migration against representative tables/RLS, including anon denial and out-of-scope Team calls. Compare legacy-equivalent and new query results where deterministic. Benchmark a deterministic 70k-call dataset; report DB timings separately from network/browser timing.

Preserve the production baseline and record request-count reduction; do not invent post-deploy results. Include manual authenticated cold/warm browser instructions for Calls/Review/Team and fixed ET range/role/scope. Capture desktop/mobile screenshots tied to the tested commit.

## Review gate

Reviewed by independent Pi/Claude Opus reviewer before implementation: **approved with required parity pins**, accepted below. After implementation, repeat independent review and fix consequential findings before opening the PR.

- Preserve KPI denominators: averages divide null-as-zero sums by all calls; compliance/high-CSAT divide by calls with any QA, even if grades are null. Use JS-equivalent rounding, not the Team MV formulas.
- Every sort ends with `started_at DESC, id DESC`; timestamp tie-breaking is independent of primary sort direction. Rank scores exactly: excellent/pass/high=5, good/medium=4, fair/needs_improvement/low=3, poor/fail=2, unknown/null=0.
- Active agents must have a non-null name within the last 30 days; preserve that inclusion rule. Agent ordering uses normalized display names with deterministic DB collation, which can differ slightly from browser-locale ordering.
- SQL pitch normalization must match the JS non-alphanumeric collapse, no-show exclusion, and 1,800-second boundary. Keep all pitch display columns in Calls rows.
- Explicitly revoke new RPC execution from PUBLIC/anon, grant authenticated. Drive Next from `has_more` before totals arrive; never show loading totals as zero.
- Baseline checks on unmodified main: build passes; lint has 50 errors/6 warnings; TypeScript has one pre-existing `replaceAll`/ES target error. Browser suite: 61 passed, one Team error-state timing failure; that test passed when rerun alone. These are tracked as baseline, not introduced failures.

### RPC contract for independent implementation

- `eavesly_calls_page(p_start, p_end, p_agents, p_dispositions, p_quick_filter, p_thresholds, p_sort, p_desc, p_offset, p_limit)` → JSON object `{ rows, has_more }`. `rows` contains existing dashboard call-list columns and compact `qa` (null or call_id + four grading fields + manager_escalation); page limit 25 normally, at most 1,000 for export.
- `eavesly_calls_summary(p_start, p_end, p_agents, p_dispositions, p_quick_filter, p_thresholds)` → `{ total_calls, window_calls, calls_requiring_attention, avg_talk_time, avg_handle_time, compliance_pass_rate, high_sat_rate, dispositions }`. Dispositions/window_calls ignore disposition/quick filters but respect dates/agents.
- `eavesly_active_call_agents(p_since)` → JSON array `{ agent_email, agent_full_name }`.
- `eavesly_team_pitch_risk(p_start, p_end)` → JSON array `{ agent_email, pitch_call_count, rushed_pitch_count }`; server resolves manager/god scope.
- Dates are timestamptz; arrays are text[]; `p_thresholds` is `{overallScore, compliance, customerSat}` matching the existing quick-filter setting. Defaults: needs_improvement/fail/low. Finite sort/quick-filter inputs are validated. JSON array/object responses avoid PostgREST set-returning row caps for these bounded/aggregated results.
