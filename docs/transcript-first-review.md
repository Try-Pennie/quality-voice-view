# Phase 2 — transcript-first Full QA review

Goal: managers can listen to the call, inspect its transcript, and compare Eavesly's flags without opening buried disclosure panels or losing their review draft.

Context: Phase 1 shipped as `c1dfa97` (PR #129). Noah approved a transcript-first workspace with persistent audio, evidence navigation, and a compact decision panel. Slack thread C07LZAKL72P/1789949832.748159 requests direct Regal transcript access and clearer individual assessments; D090MK4FA7Q/1790029608.504679 describes blocked saves. Keep Phase 1 requirements unchanged. The old temporary reference screenshot is no longer available; follow the agreed layout and existing Pennie design system rather than inventing its details.

Design basis: preserve the locked Pennie/PP Mori light theme (`.impeccable.md`), existing Tailwind tokens and compact high-frequency interaction style. The structure changes, not the brand. [Regal's call-review guidance](https://support.regal.ai/hc/en-us/articles/17259619778331-Reviewing-Call-Recordings-Transcripts) emphasizes reading alongside audio and searching/jumping to a moment; [Gong's call-content guidance](https://help.gong.io/docs/explore-call-content) similarly separates speaker-attributed transcript navigation from review content. Borrow that spatial clarity, not new playback claims: literal search is available without timings, audio seeks require existing verified timing, and scrolling stays under the manager's control.

In scope: the existing internal Full QA review drawer, transcript view/navigation, compact Full QA assessment layout, and regression tests. Expected production edits: `AlertReviewDrawer.tsx`, `AlertTranscript.tsx`, `FullQaRubricReview.tsx`, and narrowly necessary `TranscriptView.tsx`/sheet layout styles. Independent review expanded this only to the existing call-detail hook/query: scope-gate the new eager transcript read/cache and deterministically choose the latest QA retry, rather than making the primary transcript pane fail on multiple rows. No file deletions. Reuse existing audio player, transcript parser/search, timing verification, form state, and responsive components.

Out of scope: backend/schema/prompt changes, splitting AI-generated paragraphs into new persisted claims, automatic feedback defaults, new required fields, other alert types' workflows, dependencies, global redesign, production deployment, merge before Noah's staging review.

Done when:
- Desktop Full QA opens with transcript visible and given more width than the independently scrollable review panel; audio and save/navigation remain reachable.
- Evidence navigation shows the matching transcript passage without fabricating timestamps or moving/clearing manager inputs; verified audio seeking retains its existing guards.
- Small screens offer accessible transcript/review switching with the same mounted draft and audio state; no horizontal overflow at 320/375/414/768 widths.
- Agree-alone and disagree-plus-explanation saves, optional partial feedback, conditional coaching, failure retention, revision/source locks, approvals, keyboard navigation, and other modules remain intact.
- Loading/error/missing transcript/recording states stay usable, scoped transcript reads are limited to the open call, and staging is verified without overwriting existing review fixtures.

Verify: `npm run typecheck`, `npm run lint`, `npm run build`; focused Playwright workspace/transcript/recording/form tests then `npm run test:browser:ci`; CI-equivalent SQL/preflight checks as appropriate. Inspect synthetic commit-pinned desktop/mobile screenshots and actual hosted staging behavior. Independent review in a separate context; surface any unavailable cross-family review rather than silently waiving it.

Stop: tested branch and separate PR, isolated staging deployment, Slack notification and Noah's review. No main merge or production changes. Escalate only if the design requires schema/authorization changes or cannot preserve existing review behavior.

## Verification — `9a589a5`

- Parent-owned fresh run: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:browser:ci`, `npm run test:postgres:ci`, `npm run test:achieve:ci`, `npm run check:release-preflight`, and `npm run check:staging-build` all passed.
- **229/229 browser tests passed**, one worker, no retries (12.4 minutes). PostgreSQL integration suites passed against disposable PostgreSQL 17; no live migrations are required for this phase.
- Focused workspace/motion check: **13/13 passed**. Earlier broad run had two stale motion-layout expectations (227 passed); both were updated to assert the enlarged desktop workspace and default mobile transcript, and the complete rerun above is green.
- Typecheck/build passed; lint: 0 errors / 5 existing Fast Refresh warnings. Existing Browserslist, bundle-size, Node experimental-type-transform and dependency-audit notices are not remediated by this UI work.
- Mobile omits the redundant workspace title/instruction header while keeping its named region and view buttons. Tests assert the first transcript turn is visible at 320/375/414/768 widths.

Synthetic captures at the verified source commit, visually inspected:
- [Desktop entry](qa-evidence/transcript-first-review/9a589a5/transcript-first-desktop-entry.png)
- [Mobile transcript](qa-evidence/transcript-first-review/9a589a5/transcript-first-mobile-transcript-375.png)
- [Mobile review](qa-evidence/transcript-first-review/9a589a5/transcript-first-mobile-review-375.png)
- [Literal evidence jump](qa-evidence/transcript-first-review/9a589a5/transcript-first-literal-match-375.png)

## Independent review

Separate-context Pi/Sol review identified eager transcript scope/cache isolation, duplicate QA selection, and focused-panel visibility across responsive changes. All three were corrected and covered by behavioral tests. Re-review of `0b8510d` and final delta through `9a589a5` found no remaining actionable issues. Parent inspected the production and test diff and executed the complete verification above independently.

Pi/Claude could not start because extra usage was exhausted; no account switch or Claude Code fallback was used. This is same-family independent review, not cross-family evidence. Cross-family review remains outstanding before a future production rollout unless Noah explicitly waives it for this phase.

Scope checks prevent the new eager UI path from reading off-team call transcripts and isolate its cache. They do **not** repair the pre-existing broad authenticated grants on raw call tables or make a claim about direct API authorization. That backend security debt is outside this UI-only change. Other alert modules retain their original layout/lazy transcript flow, now with the same supplied-scope guard; god-mode partner access is unchanged.
