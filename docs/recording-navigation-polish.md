# Recording navigation polish

## Goal and boundaries

Make cached recording timing easier to use in the alert review: one-click playback, a quiet active-transcript highlight, and honest text-only navigation when a quote has no audio match but its literal original text is available in the timing cache. Preserve manual scrolling and review drafts.

No new transcription, provider calls, database changes, automatic processing, production activation, dependencies, or guessed/fuzzy alignment. Staging only; update existing PR120, not its base or production.

## Acceptance checks

1. A verified passage starts real native playback from its timestamp in the click gesture; repeat clicks work. Wrong duration, missing metadata, failed media and changed recordings cannot start stale playback.
2. Only a verified transcript turn containing the current playing time is highlighted. Pause, buffering, gaps, end and recording changes clear it; playback never scrolls the transcript.
3. On cached calls, explicit saved quotes with a literal original-transcript match offer Find in transcript when no verified audio match exists. It opens context, fills search and focuses the match; unmatched/paraphrased notes gain no link.
4. Speaker-aware labels, one concise timing hint, consistent turn spacing, keyboard access, 44px targets and 375px layout work with reduced motion.
5. Focused media/navigation tests, full Playwright suite, TypeScript/build, independent review, and hosted Manager/Kris checks pass. Staging protected records stay unchanged; no provider requests.

## UX changes

| Before | After | Why |
| --- | --- | --- |
| Jump, then separately press Play | Play from here · timestamp | One action to hear the passage |
| No playback position in text | Subtle verified-turn highlight while playing | Keep context without forcing scroll |
| Unmatched audio quote has no navigation | Find in transcript, only for literal text matches | Useful without inventing a timestamp |
| Identical timestamp labels | Speaker and timestamp in accessible name | Distinguish controls |
| Tall linked headers, tight unlinked headers | Separate compact turn header and consistent passage treatment | Reduce visual irregularity while retaining touch targets |

## Local verification and review

- Frozen-source `npm test -- --workers=1 --reporter=line`: **182 passed**, 11.8 minutes, one Chromium worker, no retries. This includes all 29 recording/media tests.
- TypeScript (`npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable`), production build, changed-file ESLint and `git diff --check` passed. Existing build warnings concern bundle size and old Browserslist data.
- Claude Code Fable 5.1 independently reviewed the diff twice. Its scroll-on-rerender and non-seekable-media findings were fixed with real-browser regressions. Final code review: conditional staging approval, no remaining material source findings.
- Find intentionally reuses only original text already returned by the authorized timing cache. Calls without timing keep their existing lazy transcript search; there are no additional transcript fetches.
- Safari/CORS-resume behavior and production Twilio Range support remain unverified. Browser checks verify playback position, not by-ear agreement with the recording. These are not production-activation approval.

Commit-pinned synthetic screenshots and hosted staging verification are recorded in the QA evidence follow-up. Real-call screenshots and logs remain private.
