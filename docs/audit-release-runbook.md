# Audit fixes: staging acceptance and production release

## Scope and hard stops

This branch includes the previously local Achieve recovery (`db2de10`, `7125954`). A frontend Pages deployment does **not** deploy Supabase migrations or Edge Functions. Merge, production database changes, production deployment and actual email delivery remain separate approval gates.

Never run a blanket `supabase db push`, mark all old migrations applied/reverted, import raw production migration bodies into Git, or merge the Supabase staging branch into production. Historical bodies include unrelated operational/data/credential changes. Restoring obsolete reviewable-metrics definitions can reintroduce the loading incident.

## Read-only preflight

```sh
# Supply a locally managed access token via environment, never in command arguments/logs.
node scripts/release-preflight.mjs miikotqnovnixpeqtqnd
node scripts/release-preflight.mjs xuvveqaizlletsqvwpgx
node scripts/release-preflight.check.mjs
```

This uses only the Management API's `/database/query/read-only` endpoint. It checks inventory, exact normalized-body fingerprints, the restricted INSERT policy (including other permissive policies), required metric output and valid transcript indexes. Output contains metadata, not SQL or credentials. Names alone never prove equivalence. Whitespace/comment/transaction-wrapper differences can deliberately block the fingerprint check: inspect, do not assume equivalence.

The September 21 production baseline has **71 checked-in migrations and 123 live ledger entries: 41 local-only, 93 remote-only, 18 matching-version body differences**. This is historical drift, not 134 pending migrations. Some body differences are formatting/comments or deployment-only `SET LOCAL` budgets. The staging branch has a separate schema baseline and intentionally different access policies; it is not a canonical production migration history.

### Reconcile history without replaying it

1. Capture the full ledger privately, including statement bodies/hashes, and the current schema, grants, RLS, function definitions, indexes and cron definitions. Keep raw dumps outside Git: historical operational statements may contain credentials or customer data.
2. Compare each same-name/different-version candidate **by body and current effective schema**. Record local version, remote version, both hashes, semantic differences and any later superseding migration. A matching name or fingerprint is evidence, not permission to alter history.
3. Classify remote-only entries as schema changes to preserve, operational/data changes not to replay, or superseded changes. Do not recreate the two temporary transcript-index preparation cron jobs.
4. Choose and review a canonical schema baseline plus future migration chain, or a fully enumerated ledger/file reconciliation. Prove it in disposable PostgreSQL, including current grants and source contracts. Never copy production rows or secrets into a baseline.
5. Only after explicit production approval, perform the enumerated history-only repairs/file reconciliation. Re-read inventory and schema and prove no effective schema/data change. `migration repair` changes history only, not schema.

**Until that dedicated reconciliation is complete, bulk deployment stays blocked.** For this bounded release, an operator may apply only explicitly approved, reviewed new SQL artifacts through the native migration API, recording returned deployment versions and body hashes. That does not make the historical chain safe to replay.

Known recent candidates requiring reconciliation include:

| Checked-in version | Production version | Treatment |
| --- | --- | --- |
| `20260911120000` | `20260913142339` | Structured review; production adds transaction-local safety budgets. |
| `20260914010000` | `20260914014604` | Calls reads; production adds transaction-local safety budgets. |
| `20260916010000` | `20260914115553` | Calls summary; compare full body. |
| `20260917010000` | `20260914142124` | Auto-maintenance; compare full body. |
| `20260918010000` | `20260914174554` | Disposition index; production adds safety budgets. |
| `20260918020000` | `20260920185126` | Full QA; compare full body/current RPCs. |
| `20260920120000` | `20260920184240` | Recording timestamps; compare full body/current grants. |
| `20260920201000` | `20260920215729` | Alert index; comments/budgets differ. |
| `20260921100000` | `20260921022034` | Superseded transcript-reading metrics; **do not replay**. |
| `20260921101000` | `20260921023309` | Superseded ten-minute refresh budget; **do not replay**. |
| None | `20260921124157`, `20260921124355` | Temporary index-build scheduling; do not recreate jobs. |

`20260920200000_protect_manager_role_on_insert.sql` is genuinely missing from production—not an alias. It is the first production fix to approve. Separately compare elevated identities against the authorized roster; the audit did not establish whether anyone exploited the old INSERT path.

## Reproducible isolated staging artifact

Build this exact PR commit, not a stale independent staging application branch:

```sh
npm run check:staging-build
# Supply this branch's public anon key (not service_role) privately via environment.
VITE_STAGING_SUPABASE_URL=https://xuvveqaizlletsqvwpgx.supabase.co npm run deploy:staging
```

`deploy:staging` refuses main, detached or dirty checkouts and destination overrides, builds afresh, and hardcodes the existing Pages project/staging branch. `build:staging` keeps accepted recording timestamps enabled. The Vite seam rejects other project refs and privileged keys. The artifact validator rejects production bundles and adds staging-only network/media CSP, noindex, no-referrer and no-store. `check:staging-build` uses a synthetic key: **never deploy its output**. A normal `npm run build` still targets production and must not be deployed as staging. Existing automatic PR previews are not the isolated sandbox and must not be used for test saves.

Use the existing private password at https://rubric-staging.eavesly.pages.dev/login. No password, session token, service key or customer screenshot belongs in Git/PR comments. Preserve draft work before refreshing. Capture protected-table hashes and user count before and after native checks. Do not reseed existing examples or reviews. Keep third-party integrations and HTTP cron jobs disabled. Test delivery/failure behavior locally with synthetic adapters; do not send actual partner email from staging.

## Required merge/release checks

Require the stable CI check emitted by this PR in the UI main-branch ruleset; require the existing backend CI check on the backend repo, and at least one approving human review. These are repository settings, not effects of adding a workflow. Configure them only with repository-owner approval; do not describe the checks as required until settings are read back.

Before approving merge: full checks, cross-family review, pinned staging build and native role/browser/schema checks must pass. An ordinary Vite build is not evidence of lint, TypeScript, authorization, migration parity or email delivery.

## Approved production rollout order (not executed by this PR)

1. Approve the explicit artifact list and rollback/forward-fix procedure. Re-check current production drift and function versions; another release may have landed.
2. Apply and verify role protection. Review elevated identities separately; do not automatically revoke legitimate access.
3. Apply only the new duplicate-finding and Achieve reliability SQL after verifying dependencies/current bodies. Preserve all source data/reviews and reviewable metrics' indexed plan/two-minute refresh budget. Read back policies, RPC definitions, grants and cron budgets.
4. Deploy the reviewed Achieve Edge Functions and required configuration together. Keep scheduled delivery disabled until configuration and non-sending checks pass. Verify the recovery source and safety gates are present in the deployed bundle.
5. Deploy/merge the frontend only after dependent RPC contracts are live. Verify native manager and director scope/read flows.
6. Inspect the next expected sent-ledger entry and monitoring result after the delivery deadline. A successful `net.http_post` cron SQL invocation proves enqueueing, **not delivery**. Never delete a `sending` claim and resend automatically after an ambiguous provider response.

Rollback: restore the previous pinned Pages/Edge artifact only if it remains compatible with the newly applied database contracts. Prefer a forward fix for validation/security changes; do not re-open the role INSERT hole, restore obsolete metrics SQL, remove delivery claims or reverse historical migrations as a rollback shortcut.
