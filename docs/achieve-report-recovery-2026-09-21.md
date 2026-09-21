# Achieve weekly report recovery — September 21, 2026

## Outcome and scope

Noah approved production repair, preview validation, and one send for week ending **2026-09-20**. Gmail accepted the message and the ledger recorded `sent` at **2026-09-21 16:33:24.967Z (12:33 PM Eastern)**. The September 14 missed report was not resent. Existing To/Cc lists and report calculations were preserved. Both daily sync and Monday report cron jobs remain active.

Working branch: `nmogil/achieve-report-recovery`, based on `c5ced2c` (`origin/main`). No merge or push was performed in this session.

## Diagnosed causes and changes

- Scheduled report failed all four September 21 delivery-hour attempts with `dashboard_query_failed` and database statement timeouts. Last successful ledger entry before recovery was September 7.
- Achieve QA used a non-leading module predicate on `(call_id,module_name)` and filtered dates after fetching rows. A two-week QA scan took **5,587 ms**, fetching 7,892 buffers; the full two-week dashboard took **12,080 ms**, above the default eight-second REST limit.
- Added a covering partial index on the exact immutable ordinary-QA predicate and narrowed the helper's materialized projection to its four consumed columns. The same QA scan became an **index-only scan taking 10.4 ms**. Rebuild this index if its predicate function changes.
- The attribution helper's final join underestimated both grouped relations, comparing **5,874,621 pairs** for the six-week range. Replacing the equivalent grouped-uniqueness join with an anti-conflict check reduced the examined query from **1,564 ms to 170 ms** without changing identity rules.
- Shared-load variability still put some full dashboard calls near eight seconds. Added **function-scoped** budgets: dashboard 30 seconds, once-daily first-pay snapshot ingestion 60 seconds. No global/role timeout changes.
- Today's first-pay sync independently failed `ingest_failed` at 12:00Z, with a matching database timeout. Archived its failed-run metadata locally, removed only that exact failed claim, and retried the existing scheduled sync. Recovery succeeded: **source 2026-09-21, 14,559 mature enrollments, 8,544 aggregate rows**.
- Added authenticated no-send `preview` and explicit current-week `send` actions. Fixed recipients, strict request parsing, week matching, and existing unique send claims remain enforced.

The affected SQL existed before the recent September changes; no direct schema/code regression from those changes was established. Increased workload/cache pressure may have exposed the pre-existing costs.

## Important deployment boundary

**Do not blindly redeploy all current-main report dependencies.** Production had not activated the August 30 post-termination-enrollment feature (`59c227f` and migration `20260830120000`). Production monitoring still uses the earlier seven-day assignment-activity contract. Activating the 30-day enrollment contract is a separate coordinated release, not part of this incident.

The recovery deployment overlays only the changed `achieve-weekly-report/index.ts` onto the downloaded pre-incident production function dependencies. Its email, management-report, enrollment-export, and Google-auth modules match the `c6d8cd2` source after TypeScript/whitespace normalization; the downloaded first-pay module uses the same older contract (with transpiled class-field differences). No first-pay-sync code was redeployed. The initial current-main bundle was replaced with this isolated production-baseline bundle before any email was sent.

Reproduction: prepare a temporary deployment tree from the existing production download (or verify historical `c6d8cd2` dependencies against production), overlay this branch's weekly-report entrypoint, and deploy only `achieve-weekly-report` with its existing custom-secret authentication (`--no-verify-jwt`). Do not activate the unrelated termination migration as an incidental step.

Applied migration ledger versions exactly match the three committed filenames:

- `20260921161230_achieve_report_qa_scan.sql`
- `20260921162402_achieve_attribution_antijoin.sql`
- `20260921162659_achieve_reporting_rpc_budgets.sql`

## Verification

- `bash supabase/migrations/achieve-report-qa-scan.integration.check.sh` — PASS against isolated PostgreSQL 17. Original/new attribution parity, blank/null/case/space/conflicting identities, latest valid name, exclusion/date rules, all-time behavior, index membership on updates, planner index usability.
- Live full-history attribution symmetric `EXCEPT`: **4,542 old / 4,542 new / zero differences**.
- Live two-week, six-week, and all-time dashboards matched pre-fix JSON exactly after removing only `generated_at`.
- `npx tsx supabase/functions/achieve-weekly-report/live.check.ts` with protected process environment — PASS against the final deployed artifact: authentication, unknown-field rejection, stale-week rejection, uncached no-send preview, three attachments.
- Existing `email.check.ts`, `achieve-management-report.check.ts`, `achieve-first-pay-enrollment-export.check.ts`, and `achieve-first-pay-outcomes.check.ts` — PASS.
- `npm run build` — PASS (existing large-chunk warning).
- `npm run lint` — existing repository failures: 45 errors / 6 warnings; no unrelated lint cleanup attempted.
- Deno 2.9 typecheck — four errors also reproduced on the unchanged base: Error.name override, private-key Uint8Array typing, and two outcome-period key inference errors. Runtime bundling and real HTTP checks passed; do not describe whole-repository typecheck/lint as clean.
- Independent Pi/Claude Opus review: no blocking correctness/security findings in the entrypoint, both SQL optimizations, or scoped timeout migration. Operational notes: bounded index-build write lock, immutable-predicate rebuild coupling, high-value preview secret, and seven sequential range loads remain relevant.
- Final preview completed in 47.1 seconds; actual send completed in 60.8 seconds, below the cron request's 120-second budget. This verifies current operation, not a guarantee against future load growth.

## Email/data inspection

Inspected the complete decoded MIME, HTML screenshot, plain text, portal link, recipient headers, and parsed CSVs in a mode-0700 local temporary directory. No raw enrollment data, credentials, Gmail message IDs, or report-secret values are committed here.

- Subject: week ending September 20; source date September 21; maturity cutoff September 11.
- Three attachments, approximately **2.69 MB** total MIME, below the 25 MB ceiling.
- Management CSV: **206 rows**, exact rating/AI/alignment totals and completed-period boundaries.
- Outcomes CSV: **653 rows**, per-agent totals reconcile exactly to each organization's period totals; all source dates current.
- Enrollment CSV: **15,700 rows**, nine expected columns, unique/nonblank AFF numbers, valid emails and flag/rating domains.
- Enrollment export has 14,560 mature records versus 14,559 outcome records: the only difference is the single Automated Underwriting record intentionally retained by the full follow-through export and excluded by outcome screening. All other agent counts reconcile.
- Four-week totals: **288 reviews / 35 negative / 1,607 AI QA**. Six-week: **423 reviews / 68 negative / 2,456 AI QA**.
- All-time mature first-pay: **14,559 / 11,322 paid**; 2-week **866 / 660**; 4-week **1,748 / 1,369**; 6-week **2,373 / 1,874**; 6-month **5,076 / 4,045**.
- Desktop HTML: complete tables, no invalid numbers, correct portal URL, no browser errors. The existing wide-table template overflows a 390px browser viewport; mobile/Gmail-client responsive rendering is **not verified** and was not redesigned in this backend recovery. No actual mailbox inbox-delivery/read verification was attempted; Gmail acceptance plus the sent ledger are confirmed.

## Unrelated advisor findings

Post-change security advisor found no newly introduced objects with changed access. Existing findings remain outside this incident: three [security-definer views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [mutable function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [public/signed-in definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), and [Postgres security updates](https://supabase.com/docs/guides/platform/upgrading). Service-only tables also have informational [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
