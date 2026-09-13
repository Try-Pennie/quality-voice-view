# Queue-first Review UX

The Review route now leads with the selected ET period, role-aware queue selector, search, and **Review next**. Manager first reviews remain the default for managers; awaiting director approval remains the default for god-mode users. Existing `status`, date, sort, workload, manager, outcome, module, search, and drawer URL values remain unchanged.

Team workload and advanced filters are closed by default. Directors can drill into each current manager; managers retain their own compact totals and alert-type breakdown on demand. Workload drilldowns use the same current-period rows as the queue. Received remains manager reviewed + awaiting manager + system closed; corrections and coaching are independent overlapping work.

Missing, blank, `__unassigned__`, and literal `Unassigned` owner values share the presentation-only **Needs manager assignment** group. Other normalized email values remain separate. No assignment or authorization data is changed.

Below the desktop breakpoint, each queue row presents issue, status/next action, agent, contact, summary, and time without horizontal panning. The same row element continues to own opening, keyboard navigation, paging, and optional bulk selection.

The review drawer has one primary vertical scroll flow plus a compact fixed action footer. Manager feedback and evidence precede director actions; required review fields remain visible in the main flow; original history, technical details, and discussion are available on demand. A director editing their own review must save that revision before approving it.

## Review screenshots

These are real Chromium renders with synthetic `@example.test` fixtures, not live production data. Before/after queue captures use the same scenario, ET dates, and viewport: desktop 1440×900, mobile 375×844. Before code is identical to base `a33be83306da0709ed6c3e4405f50e023ab90c40`; after code is `9cd1c961d65826491f8c47635622f35773700898`. The expanded workload example uses a separate six-alert fixture at 1280px width.

| Screen | Before | After |
| --- | --- | --- |
| Director queue | [Before](screenshots/queue-first-9cd1c96/before-director-queue.png) | [After](screenshots/queue-first-9cd1c96/after-director-queue.png) |
| Manager mobile queue | [Before](screenshots/queue-first-9cd1c96/before-manager-queue-mobile.png) | [After](screenshots/queue-first-9cd1c96/after-manager-queue-mobile.png) |
| Director approval | — | [Manager explanation, evidence, fixed actions](screenshots/queue-first-9cd1c96/after-director-approval.png) |
| Manager review | — | [Required fields and fixed Save action](screenshots/queue-first-9cd1c96/after-manager-review-mobile.png) |
| Expanded workload | — | [Counts and queue drilldowns](screenshots/queue-first-9cd1c96/after-team-workload.png) |

Reproduce the after captures with `npx playwright test tests/review-screenshots.spec.ts tests/queue-first-review.spec.ts`. Tests write under ignored `test-results/`; the selected review images above are copied unchanged into this document's screenshot directory.

## Verification at `9cd1c96`

- `npm test -- --reporter=line`: **62 passed** (real browser UI and synthetic Supabase HTTP fixtures, not live RLS).
- Back/Forward draft protection and four-width mobile layout checks, each repeated 12 times: **24 passed**. An earlier full run while builds were also running timed out on the fourth page load in the mobile test; the isolated full and repeated runs above passed without changing the test or adding retries.
- Application TypeScript with `--lib ES2021,DOM,DOM.Iterable`, strict test TypeScript, and `npm run build`: **passed**. Plain application `tsc` retains the unrelated existing `achieve-feedback-overview.ts` ES2021-lib error. Build retains existing bundle-size/Browserslist warnings.
- ESLint: **50 errors / 6 warnings**, identical findings to base; no new findings. Repository-wide lint is not green.
- Independent review of the UI, ownership grouping, queue-count parity, approval eligibility, and draft safeguards: no remaining findings after fixes. Regression checks for count/filter parity, loading counts, and unchanged legacy self-review approval failed before the fixes and passed afterward.

This phase changes no migrations, database permissions, prompts, scoring, or dependencies. Opening the PR does not authorize a merge or production deployment.
