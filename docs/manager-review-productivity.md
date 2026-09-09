# Manager review productivity

## Goal contract

Goal: managers can find overdue reviews, finish deferred coaching, and verify evidence without leaving the alert queue.

Context: `CLAUDE.md` names the queue as the product. `kris-feedback-2026-04-29.md` documents a 24-hour review expectation and a 30-day default. The current queue defaults to today, fetches only 500 rows, and offers no overdue or follow-up view. `help-content.ts` describes `follow_up_later` as unresolved, but the queue hides it with other reviewed alerts. The drawer links out to transcripts; full-QA evidence combines independent quotes, defeating transcript matching.

In scope:
1. Complete, paginated alert retrieval; a 30-day default; overdue (>24 elapsed hours, still awaiting first manager review) filter and age labels. Counts are explicitly limited to the selected date window.
2. Follow-up worklist based on the existing accurate review and `follow_up_later` action. Existing structured review edits resolve follow-ups; discussion/approval must not resolve them or fabricate a review.
3. Lazy inline transcript inspection, literal search and evidence navigation, supporting backend bracketed speaker labels and plain transcripts. Independent quotes match independently. No inferred audio timestamps or fuzzy claims that evidence was found.

Out of scope: backend evaluator changes, pending feedback-calibration/prompt-evaluation work, weekly action queue PR #38, migrations, notification channels, authorization changes, automatic coaching actions, merging or deploying.

Done when:
- All alerts in the selected window are available beyond the old 500/1000-row caps, with deterministic pagination and explicit failure rather than false inbox zero.
- Overdue and follow-up filters survive sharing/reload/drawer navigation, respect existing scope, and use distinct first-review versus director-approval semantics.
- Deferred coaching remains pending after comments/approval and leaves the follow-up queue only after a successful resolving review.
- Evidence/search navigation works in the real drawer and call-detail transcript, including absent evidence, empty/error/loading states, and keyboard/mobile use.
- Runnable checks and independent review are recorded; an unmerged PR is opened from the isolated worktree.

Verification: production build; TypeScript check; ESLint (baseline comparison); focused Node behavior checks; Playwright against the real app with synthetic Supabase HTTP responses (no production writes); commit-pinned desktop/mobile screenshots.

Stop conditions: completion criteria met, or an external credential/access/safety blocker requiring owner action. Do not change production or discard existing work.

## Baseline

Base: `99a5c9e` (`origin/main`). Existing worktrees are untouched.

- `npm run build`: passes.
- `npm run lint`: pre-existing 50 errors / 7 warnings.
- `npx tsc --noEmit -p tsconfig.app.json`: pre-existing ES2020 library error for `replaceAll` in `src/lib/achieve-feedback-overview.ts:490`.

## Product choices

A separate read-only review of both repositories corroborated these gaps. These are operational workflow improvements, not new product areas: no new evaluator, table, role, or external integration is introduced. Overdue review and deferred coaching are distinct: the former has no structured review after 24 hours; the latter is reviewed but the manager has explicitly deferred coaching. Director approval does not complete coaching.

Implementation also protects the surrounding flow: discussion no longer fabricates a completed review, keyboard save reads current form values, drawer navigation (including browser Back/Forward) guards unsaved work, and later fetches cannot overwrite a different alert. The table renders 50 rows at a time while navigation/search operate over the full fetched queue. Bulk approvals limit concurrent writes to ten and retain partial-success handling. The drawer's form has a bounded, scrollable height so evidence and save controls remain reachable on mobile.

## Verification and independent review

Commands from this worktree:

```sh
npm ci
npx playwright install chromium
npm test
npm run build
npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable
npm run lint
```

Tests exercise the actual React app, router, Supabase client query construction, and mutations against synthetic HTTP fixtures. External HTTPS/WebSocket traffic is intercepted. They do not prove production RLS/SQL execution; no production credentials, migrations, or live data writes were used. Unit-level checks cover elapsed-hour/DST boundaries, distinct review lifecycles, URL values, speaker parsing, literal matching, malformed quote data, and source offsets.

An independent Claude Opus review identified the browser-history draft-loss gap; the fix uses capture-phase `popstate` handling and existing BrowserRouter entry indices to restore a cancelled traversal without inserting/replacing history entries. Browser tests cover cancelled Back and Forward, accepted navigation, and subsequent history traversal.

Deliberate limits:
- Counts are bounded by the selected dates (30 days by default), not all-time backlog.
- At 100,000 retrieved alerts the UI fails closed with a request to narrow dates; the exact-cap case is conservatively rejected too.
- Literal evidence matching tolerates case/whitespace only. It does not claim to resolve prior-call context, fuzzy paraphrases, or audio timestamps. Structured quote text is used; evaluator offsets are not assumed to index this transcript.
- Draft guards cover drawer controls, browser history, and document unload. Drafts are not persisted to browser storage.
- Existing whole-repository lint errors and the ES2020 `replaceAll` type-library mismatch remain outside this feature scope. No compiler/lint checks were weakened.

Fresh final counts and commit-pinned screenshots are recorded below before PR creation.
