# Review opening motion

Source commit: `1fd67213b08b0e43ec0399b1d17dfe809cfe8549`, based on `f3784a6`. Now included in the [premium-player staging release](premium-recording-player.md) and PR120 update; the historical local verification below retains its source pin. Production unchanged.

The Full QA window previously disabled panel and overlay animations explicitly. Pointer entry now uses the existing Radix/Tailwind CSS animation: **220ms**, `cubic-bezier(0.16, 1, 0.3, 1)`, opacity0→1 and an8px lift. Desktop adds a restrained0.985→1 scale around the center; mobile remains full-size. The overlay fades over the same duration using the Pennie navy at40%, rather than a near-black abrupt dim.

| Before | After | Why |
| --- | --- | --- |
| Pointer-opened review appeared abruptly | Short fade/lift with subtle desktop scale | Continuous entrance without a dramatic zoom or bounce |
| Overlay snapped to black80% | Synchronized navy40% fade | Preserve context and the existing Pennie palette |
| All center openings were instant | Pointer/touch only; keyboard, direct links, reduced motion and next-call navigation remain instant | Preserve speed and accessibility |

No new animation library, per-frame JavaScript, timers, blur, staggered fields, layout animation or delayed data fetching. Existing form/draft/approval and audio behavior is unchanged. Close remains immediate: no retained hidden drafts, deferred navigation or focus-return delay. Generic side sheets are unchanged.

## Verification

- Fresh full suite: `npm test -- --workers=1` — **149 passed (7.5m), exit0**.
- Focused motion suite: **5 passed (22.1s)**; four new checks failed on the original instant implementation before the change. Existing keyboard/generic-sheet check also passed.
- App TypeScript: `npx tsc --noEmit -p tsconfig.app.json --target ES2021 --lib ES2021,DOM,DOM.Iterable` — passed.
- ESLint for all changed source/tests and `git diff --check` — passed, no suppressions.
- `npm run build` — passed (36.42s), with existing bundle-size/Browserslist warnings only.
- Independent read-only Pi Anthropic Claude Opus review — source approved, no blockers. Native screenshots/timeline assertions guard the actual compiled Tailwind timing, not just class-name intent.
- Parent inspected sampled desktop/mobile frames, settled layouts and a frame-by-frame strip from the unpaused browser video.

Motion tests use native Chromium CSS animations with synthetic Supabase HTTP fixtures. They sample the real animation timeline at0/22/110/219ms, verify opacity/position/scale/timing, then finish it and assert geometry. A separate unpaused video covers desktop pointer and touch-emulated mobile opening. Covered: reduced motion, keyboard Enter/Space, Review next, deep links, Back/Forward, slow details, rapid close/reopen, dirty cancel and J/K. No module or animation-method mocks.

Not verified: physical iPhone/macOS Safari. Video evidence demonstrates local behavior, not a promise of a particular frame rate on every device. Hosted pointer opening was subsequently verified in the linked staging release.

## Evidence

Source-pinned synthetic [evidence directory](qa-evidence/review-motion-1fd6721/):
- [Unpaused desktop and touch video](qa-evidence/review-motion-1fd6721/native-desktop-and-touch.webm)
- [Native opening filmstrip](qa-evidence/review-motion-1fd6721/native-entry-filmstrip.jpg)
- [Desktop at110ms](qa-evidence/review-motion-1fd6721/entry-1440-110ms.png)
- [Mobile at22ms](qa-evidence/review-motion-1fd6721/entry-375-22ms.png)
- [Settled desktop](qa-evidence/review-motion-1fd6721/settled-1440.png) / [mobile](qa-evidence/review-motion-1fd6721/settled-375.png)

Synthetic examples only; no customer recordings, real transcripts or staging credentials.
