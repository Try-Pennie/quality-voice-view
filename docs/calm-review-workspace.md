# Calm review workspace — staging contract

Goal: managers can locate flagged evidence, give optional passage feedback, and make the required alert decision in a calm transcript-first workspace with less visual and interaction overhead.

Context: user approved the researched simplification after evidence-level feedback. Base `94b9bd6`; PR #130, `nmogil/transcript-first-review`. Preserve the Pennie brand and current evidence persistence contract.

In scope: in-place presentation/interaction changes to `FullQaRubricReview.tsx`, `AlertReviewDrawer.tsx`, `TranscriptView.tsx`, and the shared `AudioPlayer.tsx` only where needed for a bounded Full QA compact presentation; associated browser fixtures/tests and verification documentation. No file deletions.

Out of scope: database/API/permission changes, backfills, timestamps/provider processing, dependencies, global dashboard redesign, new review steps or auto-save, production and merge.

Done when:
1. Compact call header/player and restrained surfaces give more space to transcript/evidence; each claim groups its separate evidence occurrences without repeated global instructions or nested form framing. All claims remain reachable and comparable; no forced wizard.
2. Passage responses stay independently optional/unreviewed, and comments open only on explicit request (saved comments visible). Existing criterion opinions remain visible; advanced score editing is secondary rather than repeated primary UI.
3. Selecting evidence coordinates a visible current-evidence state across review/transcript without filling the free-text search input or unexpected playback. Verified Listen still safely seeks; unavailable timestamps/source links remain honest. Mobile return preserves the exact review location/draft/player.
4. The overall alert decision is accessible without traversing optional feedback; save rules, declined-alert explanation, optional coaching only for warranted alerts, revisions/approval locks, read-only roles and all existing review data remain unchanged.
5. Parent fresh browser/static/build/release checks pass; synthetic source-pinned screenshots are inspected; isolated staging is deployed and hosted playback/navigation plus synthetic save/reload are checked. PR and Slack handoff await Noah's approval before production.

Verification: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:browser:ci` (one worker; sole browser owner), `npm run check:release-preflight`, `npm run check:staging-build`; focused tests for optional comments, shared-quote distinct identities, search-vs-evidence highlight, full scorecard editing, visible decision/conditional explanation, keyboard/focus/draft behavior at 320/375/414/768px. Preserve existing assertions where interactions move; do not drop safety coverage.

Stop on backend/schema needs, invented source associations, production effects, unresolved material review defects, or unexpected shared-player regressions. Use the existing components and CSS; no new design system or animation library.
