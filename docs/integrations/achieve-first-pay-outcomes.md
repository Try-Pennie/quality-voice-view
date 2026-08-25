# Achieve first-pay outcome ingress

Extend the existing daily Achieve Pipedream workflow. Snowflake remains the only place with Salesforce credentials; Supabase receives daily agent aggregates, never raw `ENROLLMENT__C` rows.

## 1. Add one native Snowflake query

Add **Snowflake — Execute Query** after the existing Snowflake step. Set the step key to `fetch_achieve_first_pay_outcomes` and use this exact SQL:

```sql
with aggregates as (
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
  from AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.ENROLLMENT__C
  where SERVICER__C = 'Achieve'
    and STATUS__C <> 'Pre-Enrollment'
    and ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C is not null
    and to_date(ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C) <= dateadd(day, -10, current_date())
    and nullif(trim(WELCOME_CALL_AGENT_EMAIL_AER__C), '') is not null
    and trim(WELCOME_CALL_AGENT_AER__C) <> 'Services Interface'
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
  sum(n) over ()::integer as "source_enrollments"
from aggregates
order by cohort_date, agent_email;
```

This intentionally uses only `ORIGINAL_SCHEDULED_FIRST_DRAFT_DATE__C` for cohort assignment and the Achieve AER welcome-agent fields. A false deposit flag is the failure population. Null deposit flags make `n != paid + no_deposit`; null termination flags on failed enrollments make `no_deposit != rescinded + never_paid`. Either condition blocks the full replacement.

## 2. Add the validated Supabase action

Publish [`achieve-first-pay-outcomes-pipedream.js`](./achieve-first-pay-outcomes-pipedream.js) as the next action. Configure:

- **Snowflake enrollment aggregate rows:** `{{steps.fetch_achieve_first_pay_outcomes.$return_value}}`
- **Supabase project URL:** the existing project URL prop
- **Supabase service-role key:** reuse the workflow's existing secret prop; never use the anon key
- **Dry run:** `true` for activation, then `false`

The action validates dates, normalized emails, mature cohorts, unique daily agent keys, integer counts, `n = paid + no_deposit`, `no_deposit = rescinded + never_paid`, and Snowflake's full-snapshot row/enrollment controls before calling `ingest_achieve_first_pay_outcome_snapshot`. The RPC repeats validation, rejects an older watermark, and replaces the complete snapshot transactionally.

## Activation and operations

1. Apply `supabase/migrations/20260822120000_achieve_first_pay_outcomes.sql`.
2. Publish/configure the action above and run once with **Dry run** enabled.
3. Confirm `aggregateRows` and `enrollments` are plausible and the source date is today in Snowflake.
4. Disable **Dry run** and run once.
5. Call `get_achieve_first_pay_outcomes` with service-role authorization and verify `source_as_of`, `refreshed_at`, the three periods, and `failures = rescinded + never_paid` on a sample.
6. Keep the existing daily workflow schedule. The existing Gmail Edge Function remains on its Monday schedule and sends the outcome section itself; do not add Pipedream email delivery.

A failed query, validation, or RPC leaves the prior complete snapshot intact. Alert on a stale `source_as_of` or `refreshed_at` in the report.

## Offline checks

```bash
node docs/integrations/achieve-first-pay-outcomes-pipedream.check.js
./supabase/migrations/achieve-first-pay-outcomes.integration.check.sh
```
