# Manager review friction — September 21, 2026

## Goal and scope

Managers should record confirmed issues and coaching once, while preserving the
assessment corrections and evidence needed to improve Eavesly.

The reported disabled Save button referred to a coaching issue's blank summary,
not the separate, completed “What happened?” field. The footer called the missing
field “summary” although its visible label was “What was the issue?”.
Kris's [forwarded manager feedback](https://pennieinternalteam.slack.com/archives/D090MK4FA7Q/p1790029608504679)
described checked assessments and three logged issues that still could not save.
The thread contained no replies.

This patch is limited to the Full QA manager-escalation review. Standalone
modules, partner QA, queue behavior, scoring policy, and model training are
unchanged. No database migration is needed. No production deployment or data
changes have been performed; deployment still requires approval.

## Changes

- A warranted alert no longer asks for a duplicate “What happened?” answer.
  Managers describe each distinct issue, retain or edit its evidence, and record
  the coaching/action taken.
- The existing overall review field is populated from the confirmed issue
  descriptions, not from AI evidence. Its overview is capped at 4,000 Unicode
  code points with an explicit full-details notice; complete issue descriptions
  remain stored individually.
- Unnecessary alerts still require a reason and explanation. Corrections still
  require the corrected result and rationale. No scores automatically create
  confirmed findings.
- Missing summary/evidence messages use the visible field names. “Continue
  review” focuses that exact textarea and centers it in the scroll area.
  Blank issue fields show the existing length guidance inline.
- Opening an older saved review does not mark it dirty or save a new revision.
  A real edit to a warranted review regenerates the overview; existing immutable
  database revisions are untouched.

## Verification

Base: `3f4f7e2` (the local `origin/main` reference at start).
Branch: `nmogil/reduce-full-qa-review-friction`.

- Red before fix: the three-issue regression reproduced the mismatched footer
  message before implementation.
- `npx playwright test tests/full-qa-review-friction.spec.ts
  tests/full-qa-rubric-feedback.spec.ts tests/kris-review-clarity.spec.ts
  tests/final-polish.spec.ts`: **36 passed**. Includes mobile/desktop,
  corrections, evidence reuse, failed-save draft retention, verdict switching,
  approval, stale-source protection, and saved-review reopening. A later rerun
  pinned to `9401a7e` passed 35/36, with the long dismissed-review/approval test
  (`full-qa-rubric-feedback.spec.ts:97`) reaching the suite's 30-second test
  timeout. That test then passed alone with the unchanged default timeout
  (**17.1 seconds**). Both outcomes are retained here rather than hiding the
  intermittent timeout with retries.
- `npm test`: **202 passed, 1 failed**. The failure at
  `tests/recording-placement.spec.ts:511` waits for “Retry recording” while the
  recording region remains loading. Reproduced independently on unchanged base
  `3f4f7e2`; not a green full-suite claim.
- `bash supabase/migrations/full-qa-rubric-feedback.integration.check.sh`:
  **passed** against local PostgreSQL 17, including the new assertion that a
  warranted review saves a bounded derived overview and complete long findings
  through the unchanged RPC. This is a real database check; browser tests use
  intercepted synthetic HTTP data, not production access.
- `npm run build`: **passed**, with the existing large-chunk warning.
- ESLint on all changed TypeScript/TSX files: **passed**.
- `npm run lint`: **45 errors, 6 warnings**, identical on unchanged base.
- `npx tsc --noEmit -p tsconfig.app.json`: **2 existing `replaceAll`/ES2020
  errors** in `achieve-feedback-overview.ts` and `recording-timestamps.ts`,
  reproduced on unchanged base.
- Independent cross-family review: no blocking correctness/security findings.
  The reviewer noted that blank issue fields are announced as invalid before
  typing; this intentionally exposes the save requirement without an alarming
  visual error state.

## Commit-pinned screenshots

Captured from implementation commit `9401a7e`, with synthetic data only:

- [Desktop: no duplicate explanation, Save enabled](qa-evidence/manager-review-friction/9401a7e/desktop-followup.png)
- [320px mobile follow-up](qa-evidence/manager-review-friction/9401a7e/mobile-followup.png)
- [375px mobile: exact missing issue field focused](qa-evidence/manager-review-friction/9401a7e/missing-issue-field.png)

No production calls were reviewed or changed as part of verification.
