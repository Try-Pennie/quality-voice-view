# Review reporting follow-through

Source commit: `8c17aca4b0ea79c9a5384102699bacf5fe786fb7`, based on `c23ba4f64b374499b5b708d58642321cdc5d75e5`.

## Behavior

- Received heatmap drilldowns open all received states, with the exact agent, module, and date scope. An adjacent email substring is not the same agent.
- Internal **All-time outstanding** includes first reviews, requested corrections, deferred coaching, and (for super-admins) shared pending approval. It deliberately ignores the selected date range and disables date-scoped team rollups. Partner workloads do not inherit this lens.
- **Actual reviewer** counts use `feedback_by`, not the current team owner. Counts are latest human alert decisions within the **alert-received-date cohort**, not review-event history. Real/false counts concern alerts, not individual findings; system closures are excluded.
- All-time queries paginate. The 100,000-row safety ceiling produces an explicit error rather than displaying sampled totals.

No schema changes or production mutations are included in this slice. Full QA criterion corrections and finding-level recurrence are a separate dependent change.

## Verification

Implementation check: `npm test -- --reporter=line` — 97 passed.

Independent parent rerun at the source commit:

```sh
npm test -- tests/trustworthy-review.spec.ts tests/review-logic.spec.ts \
  --workers=1 --output=/tmp/eavesly-reporting-parent-check --reporter=line
npm run build
```

Results: **24 passed**, build passed (existing large-chunk warning). These browser tests use synthetic intercepted API responses; they do not establish live database authorization or production deployment.

Independent cross-family review: no correctness/security blockers. Reviewer also ran `npx tsc --noEmit -p tsconfig.app.json --lib es2021,dom,dom.iterable` successfully. Plain TypeScript retains the existing ES2020 `replaceAll` issue in `achieve-feedback-overview.ts`; full lint retains the baseline 45 errors / 6 warnings. Those unrelated checks were not weakened or described as green.

## Commit-pinned screenshots

Captured by the fresh parent browser run against the source commit above; visually inspected. All displayed people and calls are synthetic fixtures.

- [All-time outstanding](screenshots/review-reporting-8c17aca/all-time-outstanding.png)
- [Actual-reviewer summary](screenshots/review-reporting-8c17aca/actual-reviewer-summary.png)
- [Mobile review workspace](screenshots/review-reporting-8c17aca/review-workspace-mobile.png)

Work remains on its local review branch. Merge, deployment, and production acceptance require separate approval.
