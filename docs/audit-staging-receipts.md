# Audit remediation: staging receipts — 2026-09-21

PR: https://github.com/Try-Pennie/quality-voice-view/pull/128

## Destination and preservation

Only the existing Supabase sandbox `xuvveqaizlletsqvwpgx` and Pages branch `rubric-staging` were changed. Test at https://rubric-staging.eavesly.pages.dev/login using the existing private preview password. The PR records the latest immutable Pages URL and source commit; ordinary automated PR previews are **not** this isolated sandbox.

Native password checks passed for Manager/Kris, switching roles and a rejected wrong password. Both roles passed real audio/transcript early/middle/late playback, highlight/pause/manual scroll, and mobile checks (125 verified playback links). Hosted Team metrics and ordinary-manager shared-link scope passed. Native attempts to insert `is_god_mode=true` as an ordinary authenticated manager were rejected with 403, with prompt rows unchanged.

Eleven protected call/review/message tables and Auth user count were hashed/read back before and after staging operations: unchanged. Customer-backed screenshots, credentials, sessions, raw migration histories and before/after hashes remain private, never committed. CI screenshots use synthetic fixtures only.

## Explicit migration receipts

These are native Management API-assigned **staging** versions, not canonical source filenames or a repaired production ledger. Statement SHA-256 hashes below cover the exact ledger statement array joined by a newline. Do not rename shared migrations to staging timestamps, mark unrelated history applied/reverted, or bulk-push the directory.

| Staging version | Applied artifact | Statement SHA-256 |
| --- | --- | --- |
| `20260921204621` | Existing `20260920200000_protect_manager_role_on_insert.sql` | `a7e2456f2de9833020a2fdab6640a284f91060166110380a35a6c485a6e1cd07` |
| `20260921211148` | `audit_staging_reviewable_metrics_contract`: reviewed prerequisite indexes, metrics RPC/MV and final indexed two-minute refresh | `e9f37e58d4b7a108cb0bc9c2cb106405d5d52a2c172062ad7208b0cacf08eb9e` |
| `20260921212601` | `20260921210000_reject_duplicate_normalized_full_qa_findings.sql` | `db38da90b1286e2ec2aec4f9880db85a78e1baae7033963d0bce4c86d94007d1` |
| `20260921213705` | Missing staging prerequisite `20260830120000_achieve_termination_enrollment_activity.sql` | `eb234720af18caffb7acbeec33b9dec0c226f32d9124a7dabd40aecdc8507ec3` |
| `20260921215145` | `20260921211000_achieve_report_reliability.sql` | `492ad8d7313df25b4622aa3507895a508017e575269909e468e8ed73c98cc3ec` |

The metrics prerequisite is a stage-only transaction composed from checked-in `20260921124725`, `20260921124740`, `20260921100000`, `20260921125014` and `20260921125540`; its private manifest records each source hash. This catches staging up directly to the final indexed contract without replaying unrelated historical operations. The source and current live duplicate-validator bodies were compared before release; the production original matched the checked-in original exactly in a read-only check. Re-check at actual production rollout.

## Edge Functions and external isolation

Deployed staging-only `achieve-weekly-report`, `achieve-first-pay-sync`, and `achieve-portal`, each version **1 / ACTIVE**, from runtime source through `7b3a02b`. Native custom authentication remains enabled (`verify_jwt=false` is intentional; the handlers authenticate their dedicated secret/password themselves).

- Staging environment; external I/O and Slack flags explicitly false. No Google, Snowflake or Slack credentials.
- Weekly/sync unauthenticated calls: **401**. Authenticated malformed action: **400**. All valid scheduled/test/preview/monitor/refresh actions: **503 `external_io_disabled`** before external I/O or claims.
- Send/sync/notification claim counts unchanged; **zero HTTP cron jobs and zero Achieve Vault secrets**.
- New monitoring RPCs and claim table deny anonymous/authenticated access; service-role monitor detects the missing snapshot.
- Portal password rejected without authentication and accepted with the private staging password. The management report fails closed because this sandbox has no outcome/termination snapshots. Financial aggregates were not fabricated, production data was not imported, and no email was sent. Local synthetic contracts cover report success, stale/mixed snapshots, deadlines and ambiguous delivery.

## Remaining approval gates

No production write/deploy, merge, email, Slack or Snowflake operation occurred. The existing production role-policy fix still needs explicit application; historical migration drift remains deliberately BLOCKED. Dedicated Slack webhook, independent watchdog, live non-sending production probes, owner-approved required-check settings and user staging acceptance are outstanding production/merge gates. See [audit-release-runbook.md](audit-release-runbook.md).

Final test status is reported in the PR and its required-to-be-reviewed CI run; a hosted smoke test is not proof of Gmail delivery, production load or future reliability.
