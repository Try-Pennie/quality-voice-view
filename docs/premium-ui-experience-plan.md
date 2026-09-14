# Eavesly experience polish — implementation plan

Base: `588421d` (`Try-Pennie/quality-voice-view`, merged PR #115). Target branch: `nmogil/premium-ui-experience`.

## Goal contract

**Goal:** Make the existing manager UI feel immediate, predictable, readable, and easy to scan without changing its data meaning.

**Context:** The prior release bounded Calls data transfer but left 600 ms page-entry motion, transient loading geometry, lost Calls page/sort return state, an ambiguous agent selector, an oversized mobile toolbar, missing bundled brand-fallback fonts, low-contrast green/yellow badges, eager route imports, and uncertain cold-summary execution cost.

**In scope:** Calls navigation/filter/loading behavior, the shared visual tokens and route-loading boundary, bounded browser measurements, and an evidence-backed SQL summary optimization if supported by representative plans. Preserve current routes, access controls, business timezone, default date windows, exports, and dashboard metrics.

**Out of scope:** Rebranding, replacing the component library, adding dashboards or metrics, changing KPI formulas or latest-QA selection, speculative caches/services, auth changes, production writes/deployment, merge, unrelated baseline lint/type fixes.

**Done when:**
1. Calls Back restores its page/sort/filters/scroll; deliberate filter/sort changes reset to page one. Agent multi-selection is explicit, searchable and keyboard accessible.
2. Calls loading/empty/error/results maintain coherent layout without mislabeling old-filter rows. Pagination prefetch is bounded to one next page and triggered by intent, not full-dataset download. Desktop and 320/375/414/768 px layouts remain usable, with mobile controls substantially more compact.
3. Routine pages no longer enter with a 600 ms rise. Shared fonts are actually bundled (use the existing Inter fallback under its open license, not unavailable proprietary fonts); status text meets WCAG AA; controls use existing brand tokens consistently.
4. Infrequent routes are separate production chunks with a stable loading shell and recoverable chunk errors. Before/after browser measurements cover first usable rows, filter-to-results, Next and Back under identical fixture/network conditions, alongside bundle transfer/parse scope. SQL diagnostics identify expensive work and preserve count/security parity in any proposed improvement.
5. Fresh integration/browser/build checks pass or pre-existing blockers are explicitly demonstrated, independent review is addressed, commit-pinned desktop/mobile screenshots and performance evidence accompany an open GitHub PR.

**Verification:** Existing Playwright HTTP-seam fixtures and full `npm test -- --workers=1`; `npm run build`; targeted ESLint; `npx tsc --noEmit -p tsconfig.app.json` with comparison to the existing `replaceAll`/ES target failure; PostgreSQL 17 Docker migration checks for any SQL changes; `git diff --check`; production-build browser traces and viewport screenshots. Database benchmark results and fixture-browser results are not claims of live-user speedup.

**Stop conditions:** A required choice changes data semantics or authorization; a SQL optimization cannot demonstrate parity or a useful improvement; production credentials/deployment become necessary; or the above done conditions are met. Report unresolved boundaries instead of widening scope.

## Workstreams and planned files

### A. Calls workflow and compact controls
- Own `src/pages/DashboardPage.tsx`, `src/components/dashboard/AgentFilter.tsx`, `src/hooks/use-queries.ts`, and Calls-focused tests.
- Parse page/sort from URL and preserve existing filter semantics; provide a precise return position without leaking customer information into storage/telemetry. Invalid persisted/URL values fall back safely.
- Replace the misleading native single-select/toggle combination with the installed popover plus search and explicit checkbox choices; retain clear/remove selections.
- Consolidate the mobile toolbar: date plus Filters summary; advanced filters/actions remain accessible. Desktop keeps the useful controls without an extra tower of buttons. Keep quick-filter meaning unchanged.
- Stabilize summary/status/table/pagination space; show genuine pending data rather than zero or previous-filter values. Do not delay already-ready results for animation.
- Intent-prefetch only the immediately next Calls page using the same query key/parser/cancellation boundary; avoid hover-prefetching full QA call detail or broad QA sorts unnecessarily.
- Add regressions for Back, direct links, filter reset, selection, compact viewports, pending transitions, prefetch bounds and failure behavior.

### B. Shared polish and initial-route delivery
- Own `src/App.tsx`, `src/index.css`, `tailwind.config.ts`, `src/lib/violation-styles.ts`, font assets/license, and isolated shell/visual tests. Add a minimal route loading/error component only if needed.
- Preserve Pennie beige/navy/blue and existing UI component ownership. Remove repeated decorative page-entry motion at its shared definition, preserving useful control affordances and reduced-motion support.
- Self-host licensed Inter fallback; adjust green/yellow text tokens to AA on their current badge backgrounds. No new font runtime or animation dependencies.
- Split infrequent page imports with native React lazy/Suspense, keep navigation chrome usable, preserve every route and access-control boundary, and provide retry/reload for failed chunk downloads without a reload loop.
- Measure initial-route production resources before/after, not merely a misleading smaller entry chunk with eager shared dependencies hidden elsewhere.

### C. Summary-query diagnosis and bounded optimization
- Own only a new Supabase migration, its PostgreSQL integration/benchmark check and a SQL diagnosis document. Never rewrite the already-applied migration.
- Start with available production facts: 69,204-window calls; approximately 846k Calls and 497k QA overall; authenticated SELECT-true RLS; 50 MB latest-QA index; 8-second API statement limit; initial combined smoke timeout, then isolated 6.88 s, then 0.69/0.66 s. Caching/IO is plausible, not established.
- Reproduce production-shaped data/index/RLS and wide rows in PostgreSQL 17; inspect plans/buffers. Compare cold-connection and warm execution honestly (a fresh connection is not a cold OS cache).
- Use the smallest demonstrated fix. Preserve full-window totals, all filter/threshold rules, deterministic latest-QA selection, invoker security, auth-only execute, and existing function contract. No persisted stale-count cache or higher timeout to conceal expensive work.
- Record index write/storage trade-offs if an index is justified. The migration is proposed for review only, not applied to production.

### D. Integration, measurement and review (parent)
- Own plan/verification docs, production-build browser benchmark harness/artifacts and integration resolutions after workers commit.
- Use native browser Performance APIs/Playwright for reproducible navigation, first-rows, filter, pagination and Back measurements. Document an authenticated-production measurement recipe without collecting PII or inventing sessions. A new hosted telemetry destination is not required for this PR.
- Integrate serialized commits, run the complete suite without shared runtime contention, capture screenshots pinned to the final code commit, and request independent cross-family review.

## Execution boundaries

Workers use separate Git worktrees. They must commit only their owned files and never push, merge, deploy, or use production writes. Each browser worker gets its own port and output directory; no agent may stop another agent's process. The parent alone owns the final integrated suite and PR. New SQL and route-loading changes receive independent correctness/security review.

## Existing verification limits

The baseline full-browser suite passed 74 tests in the prior work. Repository-wide lint and app TypeScript already contain unrelated failures; compare exact diagnostics rather than weakening checks. Signed-in production browser behavior is still not established by database-role smoke checks or static HTTP delivery checks. The planned browser benchmark uses explicit synthetic data and must remain labeled as such.
