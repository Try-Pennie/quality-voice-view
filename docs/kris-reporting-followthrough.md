# Kris reporting feedback

Source `162febc` plus final navigation cleanup `181702b` on PR119; also carried into PR120's combined review interface. Live restricted staging: https://rubric-staging.eavesly.pages.dev/login (same password), runtime `dace722`. Production merge/deployment requires Noah's approval.

## Changes
| Before | After | Why |
| --- | --- | --- |
| Nav badge mixed a30-day count with all-time Review | Remove the duplicate badge and its query | Scoped counts remain on Review; notification bell unchanged |
| Date lens buried in More filters | Visible all-time outstanding / selected ET period controls | Backlog and date-based reporting are distinct |
| Filtered queue headline differed from broad totals without context | Showing X of Y, with exact drilldowns | No silent discrepancy |
| Requested corrections looked like AI inaccuracy | Changes requested by Kris vs manager Warranted/Unnecessary verdicts | Different workflow and reporting meanings |
| Dense AI metrics dominated comparison | Compact representative outcome/coverage table, warranted-first sorting | Pending reviews cannot be mistaken for rejected alerts |
| Individual overdue rows only | All-time Manager response times with non-overlapping elapsed-hour buckets | Current owners can open exactly the overdue work counted |
| Charts and unverified themes always expanded | Detailed AI metrics/trends/themes on demand, explicitly AI-derived | Less clutter; active errors stay visible |

Team manager selection uses period-end ownership and filters representatives; it does not link historical counts to current-owner queue counts. Review aging uses the existing24 elapsed-hour target, not business hours. Exactly24h is within target; invalid/future dates remain unknown. Returned work, deferred coaching and administrative closures are not first-review backlog.

Warranted/unnecessary are current saved manager verdicts for sent `(call, alert type)` rows received in the selected ET window. They are not independently validated accuracy, Kris approval, criterion findings or unique-call counts. No scoring, SQL/schema, access-control or notification-channel changes.

## Evidence
- [Representative outcomes](qa-evidence/kris-navigation-181702b/rep-outcomes-desktop.png)
- [Team outcomes mobile](qa-evidence/kris-navigation-181702b/team-outcomes-mobile.png)
- [Manager response times](qa-evidence/kris-navigation-181702b/manager-aging-desktop.png)

Synthetic fixtures only, final navigation screenshots captured at source181702b. Focused38 checks passed; final5 reporting checks include actual Recharts sizing on disclosure, God-mode sort/mapping and exact drilldowns. App ES2021TS, changed-file lint and build passed; six pre-existing any violations in alert-queries have identical baseline output and are not suppressed. Fresh full release: **102 passed (8.6m), exit0**. The normal Playwright configuration was used with an isolated4188 port so the combined PR120 suite could run independently; assertions, timeouts and retries were unchanged. After the final nav-only deletion, fresh30focused tests plus TypeScript/lint passed; full102 was not rerun after that deletion. Final hosted Team/aging/nav views and native role/review workflow verified, existing customer/review records preserved. Fable5.1 rechecked the deletion with no blockers.

Actual Claude Code Fable5.1 provided independent read-only plan/source review and rechecked fixes; no remaining source blockers. Parent owns executable verification. No production rollout implied.

Remaining: reproduce Kris's exact production date range and independently calibrate a stratified sample before changing model behavior. Aggregate manager differences alone do not establish accuracy or error.
