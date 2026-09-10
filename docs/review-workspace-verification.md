# Review workspace verification

Code snapshot: `1f0546ecf8039aa062867c6c342399bfcabe8da1`, based on `b746689`.

## Fresh checks

| Check | Result |
|---|---|
| `npm test -- --reporter=line` | 37 passed |
| `npm run build` | Passed; existing large-chunk/Browserslist warnings remain |
| `npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable` | Passed |
| `npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2021 --lib ES2021,DOM,DOM.Iterable --skipLibCheck tests/*.ts playwright.config.ts` | Passed |
| Full ESLint compared with the base by file/rule/message/source line | Unchanged: 50 errors, 6 warnings; zero new findings |
| `git diff --check` | Passed |

An earlier browser run had a localhost `ERR_NETWORK_CHANGED` while Vite modules loaded. The isolated test and a fresh full run passed without weakening assertions or adding retries.

Independent cross-family review covered the count cohort, partner isolation, role/date navigation, and synthetic test seams. Its three findings (actual Google callback destination, normalized manager drilldown, non-admin approval links) were fixed in this code snapshot, each with a browser regression test. Focused re-review cleared all three. Production OAuth redirect allowlist configuration remains an explicit deployment preflight, not a verified production change.

## Synthetic screenshots

Captured after the code commit, using the existing `Review workspace desktop and mobile screenshots use synthetic workload` Playwright case. The capture used port 4188 to avoid another local test server; the application and fixture were unchanged. Both images were visually inspected. No production data, transcripts, or staff metrics are included.

- [Desktop](./screenshots/review-workspace-1f0546e/review-workspace-desktop.png)
- [Mobile, 390px](./screenshots/review-workspace-1f0546e/review-workspace-mobile.png)

Mobile tables scroll horizontally inside their containers; the page itself has no horizontal overflow (asserted by the test).

## Boundaries

No database migration, production write, deployment, prompt change, or dependency upgrade is part of this branch. Shared admin decisions and required structured feedback belong to the follow-on PR. Model calibration remains gated on adjudicated examples and retained-violation checks described in [false-positive-calibration.md](./false-positive-calibration.md).
