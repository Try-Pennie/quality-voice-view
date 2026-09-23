# Phase 2 follow-up: flag-to-audio navigation

## Goal contract

Goal: a manager can move from a saved flag to a clearly identified, reliable passage in the recording and original transcript without losing their review draft.

Context: UI PR #120 already supplied strict cached audio matching; backend PR Try-Pennie/eavesly#88 remains inactive. Phase 2 PR #130 preserved that UI, but the isolated sandbox has just one processed recording and its full evidence quotes did not qualify for audio jumps. A larger transcript alone is not enough.

In scope: reuse the existing cached staging recording, diagnose alignment locally without exposing customer text, improve deterministic evidence navigation and its presentation, test and deploy to isolated staging on PR #130.

Out of scope: new transcription/provider requests, backend activation, backfills, production changes, migrations, altered authoritative transcripts/QA, inferred timestamps, semantic/fuzzy matching, or automatic review saves. No customer examples in committed fixtures/screenshots.

Done when:
1. Eligible saved evidence offers a direct audio action with a timestamp and full-quote transcript highlighting; no cropped or partial-quote matching.
2. Missing, ambiguous, invalid, stale, or unsupported alignment never invents a timestamp; ordinary playback/review remains usable.
3. Native duration/seekability guards, original speaker boundaries, review drafts and mobile keyboard navigation are preserved.
4. Synthetic regression tests and parent-owned checks pass; independent review has no unresolved actionable findings.
5. The one existing processed call is verified read-only on isolated staging, with actual coverage and limitations reported.

Verify: focused `tests/recording-placement.spec.ts` and `tests/transcript-first-workspace.spec.ts`, complete `npm run test:browser:ci`, `npm run typecheck`, `npm run lint`, `npm run build`, isolated staging build/deploy checks; native hosted playback + passage highlighting without review writes. No schema changes means no new SQL contract.

Stop at ambiguous safety policy, a need for new external processing, missing environment identity, or production impact. Cross-family review remains required before production unless explicitly waived.

## Root cause and bounded change

The saved `call_overview.manager_focus_areas` quotes were not displayed by the criterion scorecards: their schema paths point at different evidence fields. Display the call-level excerpts in source order without inventing relationships to individual criteria. They remain visible when the scorecard is expanded or collapsed.

The existing processed sample also revealed the literal spelling difference `gonna` versus `going to`. Evidence-only matching now explicitly expands that token on both sides, and still requires:
- the entire saved quote appears literally once in the original transcript;
- the entire canonical word sequence appears once in both the original and the timed transcription;
- a single original speaker turn, at least four original words, monotonic word times, and the existing recording-reference/duration/seekability checks;
- the loaded/displayed transcript equals the timestamp cache’s original transcript before offering the combined Listen action.

The default transcript-turn matcher is unchanged. No synonyms, filler removal, partial matching, or guessed intervals were added. Original text, QA, timestamps, and reviewer decisions are never rewritten.

| Before | After | Why |
| --- | --- | --- |
| Call-level flag quotes absent from criterion cards | Explicit Flagged passages section | Managers can inspect the actual saved reasons without finding raw JSON |
| Full quote rejected solely by gonna/going-to spelling | Narrow whole-quote spelling mode for evidence actions | Uses existing timestamp data without dropping meaning-bearing words |
| Separate audio and text navigation | Listen action opens/highlights the full quote and starts up to 2 seconds earlier | One action provides listening context and passage location |
| Missing audio links have no explanation | No verified audio timestamp | No implication that all flags are aligned |

Privacy-safe sample analysis: 2 of 5 saved focus passages qualify; 3 remain unavailable. Across all 13 saved quote fields (10 unique), two unique quotes now qualify, versus zero before. Criterion-only evidence remains unmatched. The two linkable focus excerpts overlap in the same discussion: this is **not** proof of two independent violations or full-call alignment quality.

## Review and verification

Initial regression checks reproduced the missing call-level navigation and whole-quote spelling mismatch before implementation. Coverage includes literal/default rejection versus evidence-mode success, canonical duplicates, source-only variants, negation, amount changes, short phrases, cross-speaker rejection, preroll, keyboard/mobile highlights, draft retention, unavailable timing, duration mismatch, and unseekable media.

Separate-context Pi/Sol review found that combined navigation could play while the displayed transcript was unavailable or different. The loaded-transcript equality guard and delayed/divergent-transcript regression address this; final static re-review reports no remaining actionable findings. Old audio transport fixtures were aligned with their displayed transcript to exercise the stricter source contract.

A fresh Pi/Claude review attempt on the authorized primary profile failed before execution with exhausted extra usage; no account switch or Claude Code fallback was used. Cross-family review remains outstanding before production. 

### Source-pinned verification

Behavioral source: `2d6cc73cbb79c6f2e19ea35f20ef01f85c47bebf`.

- Parent-owned full browser suite: **232/232 passed**, one worker, 12.4 minutes; includes all 40 recording/workspace checks and all existing save/review flows.
- `npm run typecheck`, `npm run lint`, and `npm run build` passed (lint: zero errors, five existing Fast Refresh warnings).
- Release-preflight, staging-deployment guards, and isolated staging-build checks passed. The complete verification chain exited 0. No SQL or backend files changed.
- The first full run was intentionally stopped to address the independent review finding; it is not counted as a passing run. A focused retry exposed two old CORS fixtures with mismatched transcript data; those were corrected and both passed in the final full suite.

Synthetic screenshots from that full run, visually inspected by the parent:
- [Desktop flag + transcript](qa-evidence/flag-audio-navigation/2d6cc73/flag-listen-desktop.png)
- [Mobile flag](qa-evidence/flag-audio-navigation/2d6cc73/flag-listen-mobile.png)
- [Mobile highlighted transcript](qa-evidence/flag-audio-navigation/2d6cc73/flag-listen-transcript-mobile.png)

Hosted staging verification and immutable deployment receipt will be recorded on PR #130 after deploying this tested source. Screenshots here contain synthetic data only.
