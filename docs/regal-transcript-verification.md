# Regal transcript button verification

Code snapshot: `1dcffec`, based on `main` at `9af30dc`.

- Restores a prominent **View Regal transcript** external-link button in the recording header of Full QA, standalone alert, and disposition reviews, plus call detail actions.
- Reuses the saved transcript URL, opens in a new tab with `noopener noreferrer`, and stays hidden when no URL exists. Existing in-app transcript navigation remains unchanged.
- No backend, database, auth, scoring, or dependency changes.

## Checks

- `npx playwright test tests/regal-transcript.spec.ts tests/manager-review.spec.ts tests/full-qa-rubric-feedback.spec.ts tests/unified-review-ux.spec.ts` — **47 passed**.
- The eight new tests cover Full QA, standalone alerts, call detail, and disposition audit with/without URLs. They check keyboard-opened popups, exact saved destinations, mobile and desktop viewport visibility, 44px targets, no writes, and no browser exceptions.
- `npm run build` — passed; existing bundle-size and Browserslist warnings remain.
- `npx eslint tests/regal-transcript.spec.ts src/components/alerts/AlertReviewDrawer.tsx src/components/alerts/DispositionAuditDrawer.tsx` — no errors; existing disposition `useEffect` dependency warning remains.
- `npm run lint` — existing baseline: 45 errors and 6 warnings, including the unchanged call-detail `any`.
- Independent read-only Pi review (Anthropic Claude Opus 4.8) inspected the diff, detail-query hydration, accessibility, and tests: no blocking findings. Parent reran the browser checks above.

## Commit-pinned screenshots

Synthetic fixtures only; no customer data or live Regal access.

| Surface | Screenshot |
| --- | --- |
| Full QA, mobile | [390px](screenshots/regal-transcript/1dcffec/review-mobile.png) |
| Full QA, desktop | [1440px](screenshots/regal-transcript/1dcffec/review-desktop.png) |
| Call details, mobile | [390px](screenshots/regal-transcript/1dcffec/call-detail-mobile.png) |
| Disposition review, mobile | [390px](screenshots/regal-transcript/1dcffec/disposition-mobile.png) |

Live Regal authentication and transcript availability were not tested; browser destinations are intercepted with synthetic HTML. This evidence establishes Eavesly navigation behavior, not Regal access permissions.
