# Interrupted evidence + chat transcript verification

Source `2c36b7b`, base `bea432e`, PR #130. Staging only.

## Root cause and change

The reported quote was saved as one sentence but appeared across three handling-agent turns in the original, interrupted by customer acknowledgments. Existing timing already contained the complete quote. The previous source matcher only accepted a contiguous passage within one turn.

The shared source matcher now maps an exact quote across turns of its explicitly saved speaker, retaining all of that speaker's words and original character offsets. Interruptions stay visible. Unknown/unidentified speaker boundaries cannot be skipped; missing attribution retains single-turn matching only. Transcript navigation groups all fragments as one evidence occurrence. Audio still requires a unique contiguous match in the timed recording, normalized-source uniqueness, monotonic timestamps, and matching recording/transcript revision. No fuzzy matches, inferred timestamps, reprocessing, or data changes.

| Before | After | Why |
| --- | --- | --- |
| One left-aligned transcript column | Agent bubbles on right, contact on left; original labels and chronological DOM retained | Easier to distinguish speakers without relying only on color |
| Interrupted quote could not be located | Exact source fragments highlighted together with verified Listen when timing exists | Correct root cause without inventing audio alignment |

## Checks

- Typecheck, lint, build and diff check passed; existing lint/build warnings only.
- Full browser command: 243 passed / 2 failed. New Find-only test used an incorrect accessible group name; fixed to match its existing explicit label. Unmodified history test missed its instrumentation attribute once during the run.
- Fresh clean-process run of **interrupted-evidence, review-history, recording-placement: 38 passed**, including both failures and all timing/playback guards. No remaining reproduced failure; full command not rerun afterward.
- New coverage: exact three-fragment offsets, missing/wrong speaker, unknown-speaker barriers, repeated source/audio, preserved amounts/signs/negation, no skipped same-speaker words, non-monotonic timing, no audio interjection guessing, Find without timing, native Listen, one grouped occurrence, mobile draft return and agent-right/contact-left geometry at 1440/375/320px.
- Independent same-family Sol read-only review identified the unknown-speaker boundary; fixed and re-reviewed with no remaining blocker. No cross-family review claimed.
- Existing review/save schemas and rules unchanged. No migrations, backfills, provider jobs or production writes.

## Source-pinned synthetic screenshots

[Desktop](screenshots/chat-evidence-2c36b7b/chat-evidence-1440.png) · [Mobile](screenshots/chat-evidence-2c36b7b/chat-evidence-375.png)

Parent visually inspected both. Hosted verification of the reported staging call and deployment artifact is recorded in the PR receipt after deployment.
