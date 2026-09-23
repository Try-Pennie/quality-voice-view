# One list of Eavesly flags

Goal: a manager sees what Eavesly flagged, the supporting passage, and its transcript/audio jump together, without reconciling separate passages and score sections.

Context: follow-up to PR #130 staging at `341848b`. Preserve the transcript-first workspace and Pennie visual system.

In scope: consolidate Full QA evidence presentation in `FullQaRubricReview.tsx`, minimal local evidence projection if needed, browser regression checks, synthetic screenshots, existing PR and isolated staging.

Out of scope: scoring or saved review requirements, schema/backend changes, timestamp generation/matching, new processing, dependencies, production or merging.

Done when:
1. One primary “What Eavesly flagged” list replaces the two competing sections; each available failure label stays with its supporting evidence and existing jump action.
2. Saved criterion evidence and explicit critical-red-flag associations are honored. Call-level passages without a saved association are not assigned to a failure by guesswork; no saved quote/context is silently lost.
3. Optional score feedback and the complete scorecard remain reachable; saved responses, dirty/error states, approval locks and save payloads are unchanged.
4. Desktop/mobile, keyboard, unavailable timestamps, duplicate/unlinked evidence, and decision-only save work in browser checks, with synthetic source-pinned screenshots.
5. Tested build is on isolated staging for Noah; PR stays unmerged and production unchanged.

Verify: focused Full QA/recording/workspace browser checks; `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:browser:ci`, release/staging guards, and hosted no-write playback/draft verification. Stop for ambiguous evidence that would require invented relationships, changed review contracts, or production impact.

| Before | After | Why |
| --- | --- | --- |
| Flagged passages and score concerns in separate sections | One list pairing saved issue labels with evidence and navigation | Managers should not reconstruct the relationship |
| Repeated evidence and form-heavy framing | Shared evidence presentation; optional responses secondary | Put the review task ahead of data entry |

## Review and source-pinned evidence

Application source: `7935c18` (follow-up base `341848b`). Screenshots are from the parent-owned browser run at that source; all call content is synthetic:

- [Desktop: unified flag and transcript](qa-evidence/consolidated-review-flags/7935c18/consolidated-flags-desktop.png)
- [Mobile: unified review list](qa-evidence/consolidated-review-flags/7935c18/consolidated-flags-mobile.png)

Exact quote/speaker/process-step identity may share a display location, but distinct saved contexts retain their source labels. Critical labels stay on their exact supporting quote, not the whole criterion or neighboring quotes. Unassociated passages are explicitly labeled; no heuristic failure assignment is introduced.

Separate-context Pi/Sol static review caught an ambiguous multi-quote label, lost duplicate contexts/provenance, and an incomplete test manifest. All were fixed and re-reviewed with no remaining actionable findings. Parent-owned focused checks passed (five cases), including the new multi-quote association regression and decision-only save. Desktop and mobile screenshots were visually inspected; the full suite exercises 320/375/414/768 widths and keyboard navigation.

A fresh cross-family Pi/Claude attempt failed before analysis because extra usage is exhausted. Cross-family review remains outstanding before production; no account switch or waiver assumed.

Final full-suite and hosted read-only staging receipts are recorded in PR #130. No review writes, backend changes, timestamp generation, production deployment or merge are part of this follow-up.
