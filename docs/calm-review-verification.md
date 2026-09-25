# Calm review workspace — staging verification

Application source: `5c8510db3ca5f5025a8c1b0977c87670a0ac05c6`, based on `94b9bd6fe3310d16709227d2d61d0846d02b80cf`, PR #130 (`nmogil/transcript-first-review`). Staging only; no merge or production authorization.

## Scope

Compact call chrome and Full QA audio transport; transcript-led split panes; quieter claim/evidence presentation; comments on request; independent transcript search and source-pinned selected evidence; mobile return to the same evidence occurrence; persistent Yes/No alert decision beside Save. Existing optional passage responses, validation, revision/role locks, provider/timestamp safety, and save contracts remain unchanged. No database migration, backfill, API changes, or new dependencies.

## Fresh parent checks

- `npm run typecheck`: passed.
- `npm run lint`: zero errors; five existing Fast Refresh warnings.
- `npm run build`: passed; existing Browserslist age and chunk-size warnings.
- `npm run check:release-preflight`: passed.
- `npm run check:staging-build`: passed, including restricted artifact headers and isolated endpoint checks.
- `git diff --check`: passed.
- `npm run test:browser:ci`: 240 passed, one failed due to a strict locator matching both desktop and hidden mobile header text. Updated that assertion to select visible text, without changing application code.
- `npm run test:browser:ci -- tests/unified-review-ux.spec.ts`: all four passed after the locator correction, including the formerly failing standalone-module save flow.
- `npm run test:browser:ci -- tests/transcript-first-workspace.spec.ts tests/evidence-level-feedback.spec.ts`: all 12 passed in a fresh process after the correction; screenshots regenerated. No remaining failing case; the whole 241-test command was not rerun after the test-only correction.

Coverage includes optional mixed passage feedback and clear/reload, save failures, mobile widths 320/375/414/768, keyboard navigation, search versus exact evidence identity, stale revisions, verified playback, native/CORS fallback, draft/player retention, and recovery to invalid decision details. Presentation-only changes do not require a new SQL harness run.

Independent read-only review found no unresolved defects. Reviewer was an independent same-family Sol session; an attempted Anthropic review was unavailable due to usage limits. This is not cross-family approval or authorization to merge/deploy production.

## Source-pinned synthetic captures

All captures use synthetic fixtures, not customer calls. Parent visually inspected desktop and mobile layouts.

- [Desktop, long saved reason and recording](screenshots/calm-review-5c8510d/desktop.png)
- [Mobile workspace](screenshots/calm-review-5c8510d/mobile.png)
- [Mobile selected evidence](screenshots/calm-review-5c8510d/mobile-selected-evidence.png)

Hosted deployment and save/playback verification are recorded in the subsequent PR staging receipt.
