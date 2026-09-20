# Recording navigation polish — 2026-09-20

## Revision and deployment

- Frontend source: `7cd60efe5f64c536b2e9e7ddfce22eabec46e027` on PR120.
- Isolated staging equivalent: `9b4ab15` (same runtime source; staging auth seam preserved).
- Immutable release: https://e529df23.eavesly.pages.dev
- Review entry: https://rubric-staging.eavesly.pages.dev/login (existing private password, Manager/Kris selector).
- Stable sample path after login: `/dashboard/alerts/REAL-REVIEW-001/full_qa?range=outstanding&status=awaiting_manager`.

## Checks actually run

- `npm test -- --workers=1 --reporter=line`: **182 passed** in 11.8 minutes, no retries, frozen source. Includes **29 media/navigation checks**.
- Flag-off check: **1 passed**, zero timing RPC reads, ordinary native playback unchanged.
- TypeScript, production build, all changed source/test-file ESLint and `git diff --check`: passed.
- `npm run check:staging-build`: passed; final real staging build independently checked its isolated URL/anon key, absence of the production project/key, password login, restrictive staging-only CSP and noindex headers.
- Hosted Chromium: **Manager and Kris both passed**. Each saw 125 verified transcript playback buttons. Early, middle and late buttons started native audio in one click at the intended time. The active passage highlighted, pause cleared it, manual scrolling stayed put, and 375px/reduced-motion layout retained 44px controls without overflow. Zero browser errors, review writes or provider requests.
- Protected staging data: all 11 original table hashes/counts and Auth user count unchanged. The timing cache's full hash also stayed unchanged: exactly one ready row.

The real sample still has **zero verified QA audio links and zero literal QA Find links**. Its saved QA quotes do not qualify; the UI does not invent matches. Find/search/focus and preservation of drafts/manual scroll were verified with synthetic literal-match fixtures. Other calls are not eagerly transcribed or loaded.

## Screenshots

Both PNGs here are synthetic fixtures captured against the pinned source, safe for Git:

- `timestamp-play-desktop.png`: active passage and persistent player.
- `timestamp-play-mobile.png`: 375px layout, reduced motion, speaker header and full-size action.

Four real-call hosted screenshots and logs remain private, outside Git.

## Review and remaining limits

Claude Code Fable 5.1 independently reviewed the implementation. Two material findings—search scrolling on unrelated renders and seeking outside native seekable ranges—were fixed and regression-tested. The re-review found no remaining material source issue and conditionally approved staging pending the checks above.

These checks establish native playback position, not by-ear transcript agreement. Human listening at early/middle/late passages remains useful during staging review. Safari CORS-resume and production Twilio Range support are unverified. No production merge/deploy, database migration, provider call, new transcription cost, or automatic processing activation occurred. Backend PR88 remains draft with its existing activation gates closed.
