# Trustworthy review workspace

## Goal contract

Goal: Pennie managers and executives can reconcile internal alert workload and clear daily review work from one date-consistent workspace.

Context: the existing Alerts queue, review drawer, team rollups, manager names, pagination, and URL filters already provide the required seams. This change gives those surfaces one internal-workload definition and explicit review states.

In scope:
- Count sent internal `(call, module)` alerts as received; separate human review outcomes, awaiting-manager work, and administrative system closures.
- Keep partner QA available only in an explicit god-mode workload while excluding it from ordinary Pennie counts for every viewer.
- Add clickable current-team manager counts to the existing Review inbox and use explicit awaiting-manager, awaiting-approval, coaching-due, reviewed, and all views.
- Use a 30-day ET default and carry explicit dates through primary navigation and drilldowns; clarify AI-evaluated calls and pitch-call heuristic labels.
- Cover manager/god populations, count reconciliation, pagination failure, dates, system closures, and mobile/desktop behavior through synthetic HTTP fixtures.

Out of scope: new forms or lifecycle fields, request-changes behavior, database changes, role expansion, production data, evaluator/prompt changes, dependency upgrades, deployment, and visual redesign.

Done when:
- Internal counts reconcile as `received = reviewed + awaiting manager + system closed` and `reviewed = real + false alarm`, without rendering zeroes after a failed read.
- Partner QA is absent from internal manager, executive, team, and agent populations, but remains reachable from a god-mode-only Partner QA workload.
- Manager count cells filter the same inbox, while current team ownership and the recorded reviewer remain explicitly distinct.
- Queue/date/AI/pitch labels match their actual semantics and the explicit ET range survives navigation and drawer history.
- Fresh tests, build, ES2021 app TypeScript, focused lint, whole-lint baseline comparison, and `git diff --check` are reported.

Verify with:
- `npm test`
- `npm run build`
- `npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable`
- focused `npx eslint` on changed TypeScript files, then `npm run lint`
- synthetic desktop/mobile Playwright screenshots

Stop conditions: a required data/schema or authorization decision, scope expansion into the review form/request-changes lifecycle, or the observable conditions above are met.
