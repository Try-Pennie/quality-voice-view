# Structured review verification

Code snapshot: `f5a74f1` on `nmogil/structured-manager-review`, stacked on workspace base `0adf859`.

## Fresh checks

| Check | Result |
|---|---|
| `npm test -- --reporter=line` | 47 passed |
| `npx playwright test tests/review-history.spec.ts -g 'browser Back and Forward' --repeat-each=12 --reporter=line` | 12 passed |
| `supabase/migrations/structured-manager-review.integration.check.sh` | All assertions passed on disposable PostgreSQL 17 |
| `bash -n supabase/migrations/structured-manager-review.integration.check.sh` | Passed |
| `npm run build` | Passed; existing large-chunk/Browserslist warnings remain |
| `npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable` | Passed |
| `npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2021 --lib ES2021,DOM,DOM.Iterable --skipLibCheck tests/*.ts playwright.config.ts` | Passed |
| Full ESLint baseline comparison by file/rule/message/source line | Unchanged: 50 errors, 6 warnings; zero new findings |
| `git diff --check` | Passed |

Browser tests run the actual UI and Supabase client against synthetic intercepted HTTP. PostgreSQL tests separately exercise real migration/RPC/RLS behavior with synthetic users and auth shims. Neither is a production end-to-end rollout test.

## Independent review

Separate cross-family reviews covered schema/security/concurrency and UI/domain/query behavior. All findings were addressed and focused re-reviews cleared the changes:

- New violation/action fields and immutable snapshots cannot bypass the scoped view through authenticated direct-table SELECT; legacy columns and excluded writers remain usable.
- Tab/newline-only prose is rejected at the database boundary.
- Legacy admin acknowledgments must postdate the latest legacy feedback update. Retry handling uses the preserved original update timestamp and does not duplicate notifications.
- Both RPCs reject never-sent results.
- UI explicitly explains that updating an approved review requires new approval; returned-review counts match their drilldown predicate.
- Verdict toggles retain drafts but normalize inactive fields before strict parsing and RPC submission. Browser assertions inspect outgoing RPC fields and cover legacy combined notes.

Fresh testing also reproduced a cancelled Back/Forward navigation losing a draft (the URL restored, but the form remounted). Registering the guard before BrowserRouter prevents that transient routing. The original test failed 2 of 10 repeated runs before the fix; the implementation run and an independent fresh repeat each passed 12 of 12 after the fix, without sleeps or retry settings masking the failure.

Database integration additionally covers competing first writers, concurrent approve/request, request/resubmit/reapprove, optimistic-lock conflicts, unchanged-payload retry idempotency, immutable original review, current-manager transfer, actor spoofing, anonymous/wrong-team access, decision RLS/append-only behavior, and excluded-module/service-writer compatibility.

## Commit-pinned synthetic screenshots

Captured by the existing behavior tests after `f5a74f1` was committed; visually inspected. Drawer sections scroll independently on small screens, and the mobile follow-up test exercises reaching and saving the form.

- [Required real-issue details — desktop](./screenshots/structured-review-f5a74f1/structured-real-desktop.png)
- [Required real-issue details — mobile](./screenshots/structured-review-f5a74f1/structured-real-mobile.png)
- [Shared approval / request changes — desktop](./screenshots/structured-review-f5a74f1/admin-request-changes-desktop.png)

No production transcripts, customer data, staff metrics, or investigation results are included.

See [structured-manager-review-schema.md](./structured-manager-review-schema.md) for the workflow and coordinated database/client deployment prerequisite. Nothing has been merged, deployed, or applied to production.
