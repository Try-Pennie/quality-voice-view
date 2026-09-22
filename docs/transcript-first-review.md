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
