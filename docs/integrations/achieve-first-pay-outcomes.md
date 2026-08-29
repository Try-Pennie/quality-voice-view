# Achieve first-pay outcome ingress

Snowflake remains the source of truth. The scheduled `achieve-first-pay-sync` Supabase Edge Function calls the Snowflake SQL API directly, validates the complete result, and sends only daily agent/cohort aggregates to the existing transactional `ingest_achieve_first_pay_outcome_snapshot` RPC. The Monday email and `/achieve` continue reading that Supabase snapshot.

The former Pipedream first-pay query/action is retired by this integration. Other Pipedream and call-feedback flows are unrelated and must remain enabled.

## Data and security boundary

The canonical query lives in [`supabase/functions/_shared/achieve-first-pay-outcomes.ts`](../../supabase/functions/_shared/achieve-first-pay-outcomes.ts). It:

- reads only `AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.ENROLLMENT__C`;
- filters mature Achieve cohorts and excludes system accounts;
- detects source fan-out with raw-row versus distinct enrollment-ID controls;
- deduplicates by enrollment `ID`, preferring the latest source version;
- returns only agent/cohort counts and source control totals;
- reconciles `n = paid + no_deposit` and `no_deposit = rescinded + never_paid`.

The Edge Function uses a five-minute `KEYPAIR_JWT`, polls asynchronous statements, retrieves every Snowflake result partition, and rejects missing, duplicate, stale, or unreconciled results before calling Supabase. Raw enrollment records, Salesforce IDs, and Snowflake credentials are never logged or persisted in Supabase.

## Required secrets

These project-level Supabase function secrets are required:

```text
SNOWFLAKE_ACCOUNT_URL
SNOWFLAKE_ACCOUNT_IDENTIFIER
SNOWFLAKE_USER
SNOWFLAKE_ROLE
SNOWFLAKE_WAREHOUSE
SNOWFLAKE_DATABASE
SNOWFLAKE_SCHEMA
SNOWFLAKE_PRIVATE_KEY
```

`ACHIEVE_WEEKLY_REPORT_SECRET` is also reused only to authenticate the cron request. Its matching Vault secret remains `achieve_weekly_report_secret`. Never place the private key in chat, source control, or a command that prints it.

The Snowflake user must have only its dedicated read role, `USAGE` on the selected warehouse/database/schema, and `SELECT` on `ENROLLMENT__C`.

## Weekly enrollment follow-through attachment

The Monday function creates `Achieve-WC-Agent-FirstPay-Data-YYYY-MM-DD.csv` directly from Snowflake and discards the in-memory rows after the Gmail request. It does not add enrollment rows or AFF Numbers to Supabase tables, Storage, logs, or the `/achieve` payload.

The seven Salesforce fields were verified on `ENROLLMENT__C`: `CLIENT_NO_AER__C`, `DATE_ENROLLED__C`, `TERMINATION_DATE_AER__C`, `CLIENT_DEPOSIT_FLAG__C`, `TERMINATION_BEFORE_FIRST_PAY_FLAG__C`, `ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C`, and `WELCOME_CALL_AGENT_EMAIL_AER__C`. The canonical full-history query is in [`achieve-first-pay-outcomes.ts`](../../supabase/functions/_shared/achieve-first-pay-outcomes.ts). It exactly applies Geoff's population rules:

- `SERVICER__C = 'Achieve'` and `STATUS__C <> 'Pre-Enrollment'`;
- welcome-call agent is present and is not `Services Interface`;
- original scheduled first draft is present;
- no domain, maturity, or date filter;
- latest source version per Salesforce enrollment `ID` wins.

The boundary requires one export row per distinct enrollment ID, one unique nonblank normalized AFF Number and valid WC agent email per row, complete SQL API partitions, today's Snowflake source date, and consistent repeated source controls. Source-version duplicates are allowed only before the deterministic ID deduplication. Validation is intentionally coupled to delivery: the function sends none of the report unless all three attachments are complete, rather than silently filtering a source row or sending a partial workbook. CSV output is UTF-8 with CRLF and this exact order:

```text
AFF Number,Enrollment Date,Termination Date,Client Deposit Flag,Termination Before First Pay Flag,Original Scheduled First Pay Date,WC Agent Email,Agent Rating,AI Flag
```

The service-only `get_achieve_first_pay_export_qa_rollups` RPC returns only sparse normalized AFF/client IDs and collapsed QA outcomes. A call is attributed only when its Salesforce lead and lead-to-client bridge each resolve to exactly one value. Ambiguous calls are omitted rather than guessed. Human ratings collapse to the worst recognized value (`Poor > Fair > Good`); ordinary non-audit AI QA collapses with `bool_or(has_violation)`. Unreviewed cells remain blank. Every CSV text cell escapes spreadsheet-formula prefixes.

The email body and portal remain aggregate-only. The third attachment contains AFF Number and WC agent email for the fixed approved Achieve recipients, so it must not be forwarded or copied to shared storage. The MIME builder requires exactly three attachments and rejects messages above 25 MB before Gmail is called.

## Activation and cutover

Do these in order so there is never more than one active writer:

1. Apply the existing snapshot/report migrations if they are not already present.
2. Deploy `achieve-first-pay-sync` with `--no-verify-jwt`; do not apply the new cron migration yet. The weekly function must not be deployed until `20260829160000_achieve_first_pay_enrollment_export_qa.sql` is also applied.
3. Invoke `{"action":"test"}` with `x-report-secret`. Confirm today's `source_as_of`, plausible totals, and `source_raw_rows = source_distinct_enrollments = enrollments`. Test mode does not write Supabase.
4. In the existing Pipedream workflow, disable only `fetch_achieve_first_pay_outcomes` and the immediately following **Achieve first-pay outcomes → Supabase** action. Leave the welcome-call report, attribution bridge, Google Sheet feedback, and every other step enabled.
5. Apply `20260829150000_achieve_first_pay_direct_sync.sql` and `20260829160000_achieve_first_pay_enrollment_export_qa.sql`. The first schedules `achieve_first_pay_outcome_sync` daily at `12:00 UTC` (7 AM EST / 8 AM EDT); the second adds only the service-only sparse QA RPC and no schedule or writer.
6. Invoke `{"action":"scheduled"}` once and verify the run ledger and snapshot freshness below, then deploy the updated weekly function.

The handler's daily primary-key claim prevents overlapping or duplicate writes. A failed query, validation, or RPC marks the run failed and leaves the prior complete snapshot intact.

## Operations

```sql
select run_date, status, started_at, finished_at, source_as_of,
       aggregate_rows, enrollments, error_code
from public.achieve_first_pay_outcome_sync_runs
order by run_date desc
limit 14;

select source_as_of, refreshed_at, aggregate_rows, enrollments
from public.achieve_first_pay_outcome_snapshot;

select jobname, schedule, active
from cron.job
where jobname = 'achieve_first_pay_outcome_sync';
```

A successful daily run has `status = 'succeeded'`, today's `source_as_of`, and positive reconciled totals. Investigate `failed` or stale rows before the Monday report. To retry the same day after fixing the cause, delete only that day's `failed` claim—or a `running` claim after confirming the invocation is no longer active—then invoke `{"action":"scheduled"}` again. Never delete a `succeeded` claim.

## Rollback

1. Unschedule only the direct writer:

   ```sql
   select cron.unschedule(jobid)
   from cron.job
   where jobname = 'achieve_first_pay_outcome_sync';
   ```

2. Re-enable the two retired first-pay Pipedream steps.
3. Confirm the next Pipedream run refreshes `achieve_first_pay_outcome_snapshot`.

Do not drop the snapshot tables/RPC: `/achieve` and the Monday email still read them. The weekly enrollment attachment continues to use the direct read-only Snowflake identity even if the aggregate writer rolls back to Pipedream. Do not delete or rotate Snowflake credentials as part of rollback.

## Offline checks

```bash
npx tsx supabase/functions/_shared/achieve-first-pay-outcomes.check.ts
npx tsx supabase/functions/_shared/achieve-first-pay-enrollment-export.check.ts
npx tsx supabase/functions/achieve-weekly-report/email.check.ts
node supabase/migrations/achieve-first-pay-direct-sync.check.js
node supabase/migrations/achieve-first-pay-enrollment-export.check.js
./supabase/migrations/achieve-first-pay-outcomes.integration.check.sh
./supabase/migrations/achieve-feedback-leadership-overview.integration.check.sh
```
