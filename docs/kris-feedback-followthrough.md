# Kris feedback: clearer reviews and less dashboard clutter

Application source: `e4000dd` (reporting `162febc`, review form `cd3cc1e`), test follow-up `cd42206`, final navigation simplification `a5eb5b6` (reporting `181702b`). **Live restricted staging:** https://rubric-staging.eavesly.pages.dev/login — same password. Runtime `dace722006158245f696e3922008215e18420597`, immutable https://7f8c9126.eavesly.pages.dev. Production rollout still requires Noah's approval.

## Changes

| Before | After | Why |
| --- | --- | --- |
| Follow-up appeared only after adding issues, above the verdict | Permanent **Follow-up with the rep** section after the verdict, with separate action and next-steps fields | Managers can find the information Kris expects; no invented issue or action is required |
| Navigation badge used a different date scope from all-time Review | Remove the redundant badge and its extra query; retain scoped Review-page counts and notification bell | Prevents another misleading17-versus25 comparison |
| Queue headline could differ from broad summary without an explanation | Visible all-time / ET-period controls and **Showing X of Y in this queue** | Filters and date scope are explicit; count clicks clear the relevant local filters |
| Returned work could be mistaken for inaccurate AI alerts | **Changes requested by Kris** queue, with actual requester attribution in the review | Returned instructions are distinct from historical manager verdicts |
| Wide AI-metric tables obscured alert outcomes | Default sortable **Received / Warranted / Unnecessary / Awaiting / Review coverage** | Managers and Kris can compare reviewed outcomes without treating pending work as false alerts |
| Overdue work required scanning individual alerts | **Manager response times** in all-time outstanding | Non-overlapping 24/48/72-hour buckets link to the exact matching first-review queue |
| Repeated headings and implementation terminology | Shorter labels, plain-language recovery, optional AI charts/themes/metrics on demand | Less text without hiding required fields, errors, evidence or source uncertainty |
| Generic approval displayed an unused instructions form | **Request changes** explicitly opens it; typed instructions block approval | One consistent approval interaction across alert types |

## Semantics preserved
- Warranted/unnecessary are **manager verdicts**, not Kris approval, verified model accuracy, individual findings or unique calls. One alert is `(call, alert type)`.
- Reporting dates refer to alerts received in the selected ET period. Counts reflect current saved decisions, not frozen historical snapshots. The default remains the existing 30-day period.
- First-review target is the existing **24 elapsed hours since the alert**, not business hours. Exactly24h remains within target. Invalid/future dates are explicitly unknown. Returned reviews, system closures and deferred coaching are not first-review backlog.
- Outstanding ownership is current manager; Team's manager grouping is ownership at period end. A Team manager selection filters representatives rather than claiming its counts equal the current-owner queue.
- AI coaching themes are sampled, unverified suggestions. Detailed metrics remain available on demand; low-value attention badges, top-agent lines and repeated per-column help were removed from the manager table.
- All23 criteria, source/version uncertainty, score-change reasons, separate issue evidence and follow-up, revision/decision locks and unsaved-draft protection remain. No rubric threshold, save contract, permissions, schema, model training or notification-channel change.
- Full-width recording visualization and opening motion are unchanged.

## Verification
- New behavior tests cover period/count scope, exact age boundaries including DST/future dates, aging drilldowns/reload/mobile, manager sorting/ownership, actual chart sizing in disclosures, rep coverage/drilldown, follow-up navigation/save/Kris display, legitimate no-follow-up saves, and returned instructions during a detail500.
- Fresh isolated PostgreSQL FullQA and structured-review integration checks passed (native database contracts, not HTTP fixtures).
- App ES2021 TypeScript, changed-file ESLint and builds passed. Six pre-existing `any` lint violations in `alert-queries.ts` remain; baseline/current output was compared rather than suppressed. Existing chunk-size/Browserslist warnings remain.
- Claude Code **Fable5.1** performed read-only plan/source reviews and a final recheck. Findings were fixed; no source blockers remain. This is source review, not reviewer-run browser verification.
- Full combined suite: **161 passed14.1m**, reporting **102 passed8.6m**. After the final nav-only deletion: fresh **39 combined /30 reporting focused checks** passed, including dates, desktop/mobile nav and draft safeguards; TypeScript/lint/build isolation passed. Full suites were not rerun after that deletion.
- Hosted native check: repeated password login/wrong-password denial/both roles, actual recording/seek/live spectrum, draft/transcript/motion preserved. A new synthetic case completed manager save → Kris request changes → in-app notification after refresh → resubmit → approval of revision2. Final read-only reload verifies both roles see the saved result and Team/aging views work; zero final browser errors/writes. Existing staging records/hashes and users unchanged; exactly one synthetic call, one feedback, two revisions and two decisions added.
- Initial workflow harness accidentally blocked the existing read-only Team pitch-risk RPC; its explicit read allowlist was corrected and final-state/reporting checks rerun without repeating mutations. No application change was needed.
- Stable and immutable hosts returned200 with staging-only CSP/noindex/no-store/no-referrer; password and production client absent from actual stage bundle. HTTP-fixture tests alone do not prove hosted authorization.

## Synthetic visual evidence
Captured from source `e4000dd`, synthetic fixtures only:
- [Follow-up desktop](qa-evidence/kris-feedback-e4000dd/followup-1440.png)
- [Follow-up mobile](qa-evidence/kris-feedback-e4000dd/followup-375.png)
Final navigation/reporting screenshots from source `a5eb5b6`:
- [Representative outcomes](qa-evidence/kris-navigation-a5eb5b6/rep-outcomes-desktop.png)
- [Team outcomes mobile](qa-evidence/kris-navigation-a5eb5b6/team-outcomes-mobile.png)
- [Manager aging desktop](qa-evidence/kris-navigation-a5eb5b6/manager-aging-desktop.png)
- [Manager aging mobile](qa-evidence/kris-feedback-e4000dd/manager-aging-mobile.png)

Actual customer-backed staging screenshots, credentials and manager-linked production diagnostics remain private.

## Remaining work with Kris
1. Test the separate follow-up field, Team outcome drilldowns and Manager response times in restricted staging.
2. Supply the date range used in the production comparison. A separate bounded read-only window reconciled received/reviewed/awaiting counts; it does not reproduce an unknown demonstration range.
3. Independently calibrate a stratified sample of manager-warranted and manager-unnecessary calls before changing scoring. Aggregate reviewer differences alone do not prove model or manager error.
4. Physical Safari/device testing is not verified. No production deployment or merge is implied by staging approval.
5. The stacked PR120 will need an approved base sync before merge: read-only merge simulation identifies AgentProfilePage's recurrence insertion and the fixture options signature as conflicts. The tested/deployed combined tree preserves both features. No merge/rebase/force-push was performed to bypass the approval gate.
