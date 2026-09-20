# Speech visualizer and review contrast

Source: `b03d321` (spectrum/surfaces `ddd9298`), following `42ec34e`. Scope: the shared live spectrum and alert-review presentation only. No player-width, playback, rubric/validation, database, authorization, dependency or production changes.

| Location | Before | After | Why |
| --- | --- | --- | --- |
| `src/components/call-detail/AudioSpectrum.tsx:20` | 80Hz–8kHz across the canvas, including quiet upper telephone bands | 80Hz–4kHz across the same full width | Use the available space for speech, without inventing energy or changing playback |
| `src/components/alerts/AlertReviewDrawer.tsx:633,739` | White recording/header/body and faint beige dividers | Blue recording band; stronger, review-scoped structural borders | Separate the fixed controls from the scrolling review |
| `src/components/alerts/FullQaRubricReview.tsx:202,448,517` | Evidence and response on indistinguishable white surfaces | Warm evidence panel beside white response; clearer amber reason and blue saved-review panels | Distinguish model evidence, human input and saved decisions |
| `src/components/alerts/AlertReviewDrawer.tsx:633` | Weak textarea/select outlines, including playback speed and Kris instructions | Navy/60 outlines throughout the drawer | Clear input boundaries: independently calculated 4.30:1 on white and 3.68:1 against the blue recording band |

## Checks

- Real-browser regression: a native 3kHz PCM tone rendered at 78.7% of the canvas before the fix, failing the >88% assertion; the speech-range change passes. Genuine silence, pause, reduced motion, CORS/native fallback, graph cleanup, keyboard/seek/rate, retry and draft locks remain covered. The visualizer still shows current frequencies, **not** the recording timeline. Quiet bands and actual silence remain quiet.
- Contrast regression failed on the original white recording surface. The follow-up speed-control test failed at 2.09:1 on white; the final test composites actual browser colors and checks the outside blue background as well. Weakest recording-status text remains above 4.5:1; textarea boundaries above 3:1. These are targeted checks, not a whole-app WCAG certification.
- Final focused suite: `npm test -- --workers=1 --reporter=line tests/review-contrast.spec.ts tests/recording-placement.spec.ts` — **18 passed, 1.2m**. The prior complete run on `ddd9298` passed all170 in9.0m. Final complete run on `b03d321`: **170 passed, 8.8m, exit0**.
- Normal/staging builds, ES2021 application/staging TypeScript, changed-file ESLint and `git diff --check` passed. Repository-wide lint retains the pre-existing45errors/6warnings; no blanket lint pass is claimed. Staging build seam, real staging-only bundle, production-reference/key exclusion and preview-password exclusion passed.
- Actual Claude Code **Fable5.1**, high effort, independently reviewed source and desktop/mobile screenshots. Its input-outline and weakest-text coverage findings were fixed and re-reviewed: **Approve; no blockers**. No account switch, delegated writes or deployments. Physical Safari/iPhone and screen-reader speech are not verified.

## Commit-pinned visual evidence

Synthetic data only, captured from `b03d321`: [desktop review](qa-evidence/speech-contrast-b03d321/review-contrast-1440.png), [mobile review](qa-evidence/speech-contrast-b03d321/review-contrast-375.png), [focused input](qa-evidence/speech-contrast-b03d321/review-contrast-input.png), [live audio desktop](qa-evidence/speech-contrast-b03d321/live-audio-desktop.png), [live audio mobile](qa-evidence/speech-contrast-b03d321/live-audio-mobile.png). The audio screenshots use known 200/800Hz tones, so their upper frequencies are correctly quiet; the separate3kHz test proves upper-band placement. The [earlier white-surface image](qa-evidence/speech-contrast-b03d321/before-42ec34e.png) uses a recording-unavailable fixture and is not a player-height comparison.

## Release boundary

Live: **https://rubric-staging.eavesly.pages.dev/login**, same password and Manager/Kris selector. Runtime **`2b63779f801bdbaf7ffae63d73a720e0f3f9105c`**, immutable **https://9aa8f933.eavesly.pages.dev**. Save/discard drafts before refreshing.

Fresh native hosted checks passed: **203 staging-only requests, zero browser/HTTP errors, zero review writes**. Both roles, actual `REAL-REVIEW-001` playback at18:01, full-width926px spectrum in a1078px recording region, desktop/mobile layouts, keyboard/focus/draft safeguards and reduced motion checked. The review body remains370px at1366×768. Separate native password verification passed four logins, wrong-password denial, role switching and playback. Stable/immutable HTTP200 and staging-only CSP/noindex/no-store/no-referrer verified. Eleven application-table content hashes and Auth user count were unchanged. Customer-backed screenshots and credentials remain private. [Technical verification](qa-evidence/speech-contrast-b03d321/verification.json).

No staging Git push, reseed or migration. The existing PR119/base-sync approval gate still applies before merging PR120. No production deployment or merge is authorized by this polish pass.
