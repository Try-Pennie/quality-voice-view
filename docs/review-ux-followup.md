# Review UX follow-up

Follow-up to rubric-feedback source `e716aa4`, on `nmogil/review-ux-followup`.
Source commit: **`45f169c85ca77560650194134b8d924f0a50229d`**. Now included in the [premium-player staging release](premium-recording-player.md) and PR120 update. The original verification below is historical; production remains unchanged.

## Changes

| Before | After | Why |
| --- | --- | --- |
| `?` could leave an unsaved review without a warning | Global Help shortcut stays inactive while a modal is open; explicit close/Back guards remain | Protect drafts |
| Failed detail/audio loads had no in-place recovery | Inline Retry, handled playback errors, refreshed private URLs on alert and call pages | Recover without discarding work |
| Required text lengths and disabled actions were unclear | Accessible 12–4,000-character guidance, entered count, field-specific errors and request-instructions hint | Explain what remains to finish |
| Narrow summary columns and short seek rail on mobile | Stacked manager summary, compact metadata, full-width 44px-high seek control and named skip buttons | More usable reading/listening space |
| Transcript required two disclosures below the form | Pinned View transcript opens the existing context and focuses search; loading/error/empty states are also reached | Check evidence without losing the draft |

Retry testing also exposed a pre-existing concurrency hole: newly fetched alert metadata could update the revision/approval token under an older draft. Both tokens now remain pinned to the draft until an explicit reload. Stale submission preserves the draft and refreshes both metadata and context; reload waits for both. Legacy feedback without a structured snapshot retains its existing revision. Server policy and RPC contracts are unchanged.

## Verification

- `npm test -- --workers=1`: **144 passed (7.2m), exit 0**. Three additional screenshot/behavior checks passed (11.6s) after capture-only test edits.
- `npx tsc --noEmit -p tsconfig.app.json --target ES2021 --lib ES2021,DOM,DOM.Iterable`: passed.
- ESLint on changed components/helpers/tests: passed except the existing `CallDetailPage.tsx` `no-explicit-any` error (line 115), independently reproduced on base (line 114). No suppressions or rule changes.
- `npm run build`: passed (14.81s); existing bundle-size/Browserslist warnings remain. Build only, not deployment.
- `npm run check:staging-build` on an offline archive of staging `091d06d` plus this source diff: passed, including unsafe-config rejection and production/staging bundle isolation. The real staging worktree was not modified.
- `git diff --check`: passed. Synthetic desktop/mobile screenshots inspected; layout/overflow/focus assertions cover 320, 375, 414, 768, and 1440px.
- Recording tests exercise native playback, seek, rejected playback, expired-URL refresh, retry failure/recovery and an actual 66-minute silent WAV. Draft locks have two demonstrated failing-before/passing-after tests for peer review and approval changes.

Tests use synthetic Supabase HTTP fixtures and actual range-served WAV media, not customer data or patched media methods. They prove client behavior, not a fresh hosted RLS/RPC execution. No hosted review/approval/proposal writes or production operations were performed.

Independent read-only Pi Claude Opus review: final source approved, no blockers. The parent reproduced both optimistic-lock failures before fixing them, then verified rejection, draft retention, and explicit reload for newer review and approval states.

## Evidence

Synthetic screenshots are stored under [`qa-evidence/review-ux-45f169c/`](qa-evidence/review-ux-45f169c/), tied to the source commit above:
- [Manager mobile recording](qa-evidence/review-ux-45f169c/manager-recording-320.png)
- [Kris mobile summary](qa-evidence/review-ux-45f169c/kris-summary-375.png)
- [Direct transcript access](qa-evidence/review-ux-45f169c/direct-transcript-375.png)
- [Recording recovery](qa-evidence/review-ux-45f169c/recording-error-retry.png)
- [Manager validation](qa-evidence/review-ux-45f169c/manager-text-guidance.png)
- [Kris request-changes guidance](qa-evidence/review-ux-45f169c/kris-change-guidance.png)

Existing customer-backed staging screenshots remain private and are not part of this branch.

## Boundaries

No auth, SQL, scoring, eligibility, approval policy, source-provenance, dependency, or backend changes. Correct/Incorrect-only responses, explicit coaching issues, all 23 criteria, saved evidence, top recording, and persistent actions remain.

The restricted preview now includes this follow-up, opening motion and the premium player; see the linked current release for native checks and deployment identity. Production merge/deploy still requires Noah's approval.
