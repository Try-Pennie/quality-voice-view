# Premium recording player — restricted staging

Source: **`27cb979f704967e4192a0d92eeadfd9d152e5858`**, based on `19a89dd`, in `nmogil/review-ux-followup`. Release target: existing [PR120](https://github.com/Try-Pennie/quality-voice-view/pull/120), `nmogil/full-qa-rubric-feedback`.

**Live preview:** https://rubric-staging.eavesly.pages.dev/login — same private password and Manager/Kris selector. Preserve any unsaved work before refreshing an existing tab. Open a recorded call and press Play. The synthetic Kris approval example intentionally has no recording; choose a real recorded sample to try the player.

Restricted staging runtime: **`e7f3cf4726bf9eb9579569afb0f5753053eb0c31`**, immutable https://12b8f8c8.eavesly.pages.dev. Includes the earlier UX follow-up and pointer-opening motion (`1fd6721`, staging `275266d`). No production deployment or merge.

## What changed

| Before | After | Why |
| --- | --- | --- |
| Plain recording transport | Compact, rounded live-frequency bars using the actual playing audio | Visual feedback without invented waveform data |
| Browser-default seek appearance | Consistent progress rail, native range semantics and readable time value | Refined appearance without replacing keyboard/touch behavior |
| No distinction between analysis availability and playback | Honest ready/live/paused/buffering/audio-only states | Playback remains useful when visualization is unsupported |
| New visual row could move the mobile review body after loading | Matching loading/ready height | Prevent a 24px mobile layout jump |

The spectrum shows **current frequencies, not a full-recording waveform or a seekable waveform timeline**. The separate seek rail still navigates the whole recording. No microphone access, animation library, audio SDK, fake/demo bars, new dependencies, backend changes or browser full-file decoding.

Native Web Audio is created only on Play. The media element remains the streaming source; one graph belongs to one recording URL and closes on call change/unmount. Analysis updates the canvas at at most 30fps, outside React rendering. Pause, reduced motion and hidden tabs stop visual updates. Existing playback speed, 10-second skips, shortcuts, signed-URL retry, drafts and approval locks remain intact. Transport and seek targets remain 44px.

For recordings without CORS permission, use a **fresh native audio element**, without analysis. Disconnecting a permanently graph-routed element alone could otherwise silence playback. Unsupported Web Audio follows the same audio-only path. Browser autoplay policy may require another Play after a fallback. Recording errors retain the existing Retry action.

## Research

[ElevenLabs BarVisualizer](https://ui.elevenlabs.io/docs/components/bar-visualizer) illustrates real-time frequency bands, rather than a whole-recording waveform. [WaveSurfer's peaks guide](https://wavesurfer.xyz/docs/peaks/) explains that its default waveform path downloads and decodes the entire file; precomputed peaks avoid that cost. For long review calls, native streaming analysis is the smaller change. A full seekable waveform is deferred until precomputed peaks are a product requirement.

Platform references: [createMediaElementSource](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource), [media crossOrigin](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/crossOrigin). No third-party component code or dependency was installed.

## Fresh verification

- `npm test -- --workers=1`: **153 passed (7.9m), exit0** on final source. Includes all five opening-motion checks and sixteen recording checks.
- Native PCM audio drives real analyser pixels; silent audio stays low. Tests cover pause, reduced motion with continuing playback, no graph before Play, graph closure on switch/unmount, actual cross-origin CORS-allowed/denied HTTP servers, unavailable Web Audio, keyboard playback after fallback, media failure/retry, signed-URL renewal and pinned concurrent-review/approval locks.
- Native long-call fixture, both roles, desktop/mobile320/375/414/768/1440, 44px/full-width seek, body/footer layout, loading/empty/error states. Mobile loading-height regression demonstrated failing before and passing after.
- `npx tsc --noEmit -p tsconfig.app.json --target ES2021 --lib ES2021,DOM,DOM.Iterable`, changed-file ESLint and `git diff --check`: passed without suppressions.
- `npm run build`: passed (14.42s); existing bundle-size/Browserslist warnings remain. Actual staging typecheck, `npm run check:staging-build`, private stage-only build and password-exclusion assertion passed. The verified staging dist was deployed, not the normal production-client build.
- Independent read-only **Pi Anthropic Claude Opus** reviewer approved source, resource ownership, CORS fallback and the mobile-height follow-up; no blockers. Not Claude Code/Fable; reviewer did not run tests. Parent inspected native screenshots/video and ran verification.
- Hosted Chromium: four fresh/repeated native password logins, wrong-password denial, Manager/Kris switching, actual private recording playback/seek and **nonzero live analyser output**, pointer opening, draft protection, transcript focus320/375/1440, Kris disabled-action guidance; zero unexpected errors in the final run and zero saved review writes. Fresh before/after users/calls/feedback counts and exact feedback hash unchanged.
- Stable and immutable origins: HTTP200, stage-only CSP/media source, noindex, no-store and no-referrer verified. No Auth settings, policies, schema or production data changed.

Earlier verification attempts are not passes: one full suite was interrupted for the loading-height fix; an unrelated Calls timing failure under parallel build load passed unchanged in the final clean run. A broad status locator was scoped to the footer without weakening its text assertion. Native staging runs that immediately signed out while newly opened detail requests were still in flight recorded authorization denials; the final check awaited completed detail loading before sign-out and retained the zero-error assertion. No application auth change was made to hide those denials.

Not verified: physical iPhone/macOS Safari; dedicated stalled-network buffering or actual hidden-tab browser checks. Those paths were source-reviewed, not empirically claimed. Whole-repository lint debt is unchanged; only changed-file lint is claimed clean.

## Commit-pinned evidence

All committed images/video contain **synthetic local fixtures only**, pinned to source `27cb979`:

- [Live desktop](qa-evidence/premium-audio-27cb979/live-audio-desktop.png)
- [Live mobile](qa-evidence/premium-audio-27cb979/live-audio-mobile.png)
- [320px long-call layout](qa-evidence/premium-audio-27cb979/manager-recording-320.png)
- [Native playback video](qa-evidence/premium-audio-27cb979/native-spectrum-playback.webm) / [sampled filmstrip](qa-evidence/premium-audio-27cb979/native-spectrum-filmstrip.jpg)

Customer-backed hosted screenshots, recordings, native verification config and credentials remain private, outside Git and PR attachments. Existing [opening-motion evidence](review-opening-motion.md) and [UX follow-up evidence](review-ux-followup.md) retain their original source pins. Production rollout still requires Noah's approval.
