# Achieve first-pay outcome ingress

Extend the existing daily Achieve Pipedream workflow. Snowflake remains the only place with Salesforce credentials; Supabase receives daily agent aggregates, never raw `ENROLLMENT__C` rows.

## 1. Add one native Snowflake query

Add **Snowflake — Execute Query** after the existing Snowflake step. Set the step key to `fetch_achieve_first_pay_outcomes` and use this exact SQL:

```sql
with population as (
  select *
  from AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.ENROLLMENT__C
  where SERVICER__C = 'Achieve'
    and STATUS__C <> 'Pre-Enrollment'
    and ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C is not null
    and to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) <= dateadd(day, -10, current_date())
    and nullif(trim(WELCOME_CALL_AGENT_EMAIL_AER__C), '') is not null
    and trim(WELCOME_CALL_AGENT_AER__C) <> 'Services Interface'
),
source_control as (
  -- Keep this on the pre-dedup population: it is the fan-out canary.
  select
    count(*)::integer as raw_rows,
    count(distinct ID)::integer as distinct_enrollments
  from population
),
deduped as (
  select *
  from population
  qualify row_number() over (
    partition by ID
    order by SYSTEMMODSTAMP desc nulls last, LASTMODIFIEDDATE desc nulls last
  ) = 1
),
aggregates as (
  select
    to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) as cohort_date,
    max(trim(WELCOME_CALL_AGENT_AER__C)) as agent_name,
    lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C)) as agent_email,
    count(*)::integer as n,
    count_if(CLIENT_DEPOSIT_FLAG__C = true)::integer as paid,
    count_if(CLIENT_DEPOSIT_FLAG__C = false)::integer as no_deposit,
    count_if(
      CLIENT_DEPOSIT_FLAG__C = false
      and TERMINATION_BEFORE_FIRST_PAY_FLAG__C = true
    )::integer as rescinded,
    count_if(
      CLIENT_DEPOSIT_FLAG__C = false
      and TERMINATION_BEFORE_FIRST_PAY_FLAG__C = false
    )::integer as never_paid
  from deduped
  group by
    to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C),
    lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C))
)
select
  current_date()::date as "source_as_of",
  cohort_date as "cohort_date",
  agent_name as "agent_name",
  agent_email as "agent_email",
  n as "n",
  paid as "paid",
  no_deposit as "no_deposit",
  rescinded as "rescinded",
  never_paid as "never_paid",
  count(*) over ()::integer as "source_aggregate_rows",
  sum(n) over ()::integer as "source_enrollments",
  source_control.raw_rows as "source_raw_rows",
  source_control.distinct_enrollments as "source_distinct_enrollments"
from aggregates
cross join source_control
order by cohort_date, agent_email;
```

This intentionally uses only `ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C` for cohort assignment and the Achieve AER welcome-agent fields. It deduplicates by Salesforce enrollment `ID` before aggregation, then reports raw and distinct source counts so the action rejects any upstream fan-out instead of publishing inflated z-scores. A false deposit flag is the failure population. Null deposit flags make `n != paid + no_deposit`; null termination flags on failed enrollments make `no_deposit != rescinded + never_paid`. Any source duplication or outcome reconciliation failure blocks the full replacement.

## 2. Add the validated Supabase action

Publish [`achieve-first-pay-outcomes-pipedream.js`](./achieve-first-pay-outcomes-pipedream.js) as the next action. Configure:

- **Snowflake enrollment aggregate rows:** `{{steps.fetch_achieve_first_pay_outcomes.$return_value}}`
- **Supabase project URL:** the existing project URL prop
- **Supabase service-role key:** reuse the workflow's existing secret prop; never use the anon key
- **Dry run:** `true` for activation, then `false`

The action validates dates, normalized emails, mature cohorts, unique daily agent keys, integer counts, `n = paid + no_deposit`, `no_deposit = rescinded + never_paid`, raw source rows equal distinct Salesforce enrollment IDs, and Snowflake's full-snapshot row/enrollment controls before calling `ingest_achieve_first_pay_outcome_snapshot`. The RPC repeats validation, rejects an older watermark, and replaces the complete snapshot transactionally.

## Reviewer enrollment-detail CSV

When an internal reviewer needs enrollment-level reconciliation, export a separate **mature trailing six-week** CSV directly from Snowflake. This is a static validation artifact; it does not change the weekly email body/chart and must not be persisted in Supabase.

```sql
with population as (
  select *
  from AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.ENROLLMENT__C
  where SERVICER__C = 'Achieve'
    and STATUS__C <> 'Pre-Enrollment'
    and ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C is not null
    and to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) between
      dateadd(day, -41, dateadd(day, -10, current_date()))
      and dateadd(day, -10, current_date())
    and nullif(trim(WELCOME_CALL_AGENT_EMAIL_AER__C), '') is not null
    and trim(WELCOME_CALL_AGENT_AER__C) <> 'Services Interface'
),
source_control as (
  select count(*)::integer as raw_rows, count(distinct ID)::integer as distinct_enrollments
  from population
),
deduped as (
  select *
  from population
  qualify row_number() over (
    partition by ID
    order by SYSTEMMODSTAMP desc nulls last, LASTMODIFIEDDATE desc nulls last
  ) = 1
)
select
  current_date()::date as source_as_of,
  dateadd(day, -10, current_date())::date as maturity_cutoff,
  sha2(ID, 256) as enrollment_key,
  to_date(ENROLLMENT_DATE_AER__C) as enrollment_date,
  to_date(TERMINATION_DATE__C) as termination_date,
  to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) as original_scheduled_first_pay_date,
  trim(WELCOME_CALL_AGENT_AER__C) as welcome_call_agent_name,
  lower(trim(WELCOME_CALL_AGENT_EMAIL_AER__C)) as welcome_call_agent_email,
  CLIENT_DEPOSIT_FLAG__C as client_deposit_flag,
  TERMINATION_BEFORE_FIRST_PAY_FLAG__C as termination_before_first_pay_flag,
  case
    when CLIENT_DEPOSIT_FLAG__C = true then 'paid'
    when CLIENT_DEPOSIT_FLAG__C = false and TERMINATION_BEFORE_FIRST_PAY_FLAG__C = true
      then 'rescinded_terminated_pre_pay'
    when CLIENT_DEPOSIT_FLAG__C = false and TERMINATION_BEFORE_FIRST_PAY_FLAG__C = false
      then 'never_paid_limbo'
    else 'unresolved'
  end as outcome,
  source_control.raw_rows as source_raw_rows,
  source_control.distinct_enrollments as source_distinct_enrollments
from deduped
cross join source_control
order by original_scheduled_first_pay_date, welcome_call_agent_email, enrollment_key;
```

Before sharing, require `source_raw_rows = source_distinct_enrollments = exported data rows`, escape spreadsheet-formula prefixes (`=`, `+`, `-`, `@`), and remove the two repeated source-control columns. Share only the SHA-256 enrollment key—never Salesforce IDs or customer names, emails, phones, or addresses. The approved columns are the three requested dates, welcome-call agent identity, deposit/termination flags, and derived outcome.

## Activation and operations

1. Apply `supabase/migrations/20260822120000_achieve_first_pay_outcomes.sql`.
2. Publish/configure the action above and run once with **Dry run** enabled.
3. Confirm `aggregateRows` and `enrollments` are plausible, `sourceRawRows = sourceDistinctEnrollments = enrollments`, and the source date is today in Snowflake.
4. Disable **Dry run** and run once.
5. Call `get_achieve_first_pay_outcomes` with service-role authorization and verify `source_as_of`, `refreshed_at`, the three periods, and `failures = rescinded + never_paid` on a sample.
6. Keep the existing daily workflow schedule. The existing Gmail Edge Function remains on its Monday schedule and sends the outcome section itself; do not add Pipedream email delivery.

A failed query, validation, or RPC leaves the prior complete snapshot intact. Alert on a stale `source_as_of` or `refreshed_at` in the report.

## Offline checks

```bash
node docs/integrations/achieve-first-pay-outcomes-pipedream.check.js
./supabase/migrations/achieve-first-pay-outcomes.integration.check.sh
```
