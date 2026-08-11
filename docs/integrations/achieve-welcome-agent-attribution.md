# Achieve welcome-call agent attribution

The `/achieve` portal attributes each safely matchable QA result to the Achieve/FDR representative in the daily report:

```text
eavesly_module_results.sfdc_lead_id
  -> achieve_client_sfdc_map.sfdc_lead_id
  -> achieve_client_sfdc_map.client_id
  -> welcome_call_agent_log.client_id
  -> Achieve/FDR representative name and email
```

Internal Salesforce and Achieve client IDs remain server-side. Clients with more than one distinct representative email in report history remain unmatched rather than being guessed.

## Pipedream workflow

Keep the existing 7:30 AM America/New_York schedule. Add a native **Snowflake — Execute Query** action immediately before the welcome-call parser.

Set its step key to:

```text
fetch_achieve_client_sfdc_map
```

Use this SQL:

```sql
select
  trim(ID) as "sfdc_lead_id",
  trim(CLIENT_NO_A__C) as "client_id",
  to_varchar(
    LASTMODIFIEDDATE,
    'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'
  ) as "source_last_modified_at"
from AIRBYTE_SFDC_DATABASE.AIRBYTE_SFDC_SCHEMA.LEAD
where nullif(trim(CLIENT_NO_A__C), '') is not null;
```

Replace the existing parser with [`achieve-pipedream-parser.js`](./achieve-pipedream-parser.js). It reads:

```js
steps.fetch_achieve_client_sfdc_map.$return_value
```

The parser:

- preserves the existing Drive report validation and `ingest_welcome_call_agents` RPC;
- validates and deduplicates the Snowflake crosswalk by Salesforce Lead ID;
- blocks before writes if fewer than 90% of report clients have a Snowflake mapping;
- upserts `achieve_client_sfdc_map` in 1,000-row chunks;
- marks the Drive file processed only after both Supabase writes succeed;
- remains idempotent when a partially completed run is retried;
- exports and posts only redacted anomaly samples (no client IDs, names, or emails).

## Safe activation order

1. Apply migration `20260811151118_achieve_welcome_agent_attribution.sql`.
2. Run the updated Pipedream workflow with **Dry run** enabled.
3. Inspect `report.stats.bridge`, `report.anomalies`, and `report.bridgeResult`.
4. Run once with **Dry run** disabled and **Force reprocess** enabled.
5. Confirm `bridgeRowsAfter` and spot-check the portal RPC.
6. Deploy the updated `achieve-portal` Edge Function and frontend.
7. Return **Force reprocess** to false; keep the existing daily schedule.

Do not put Snowflake credentials in the parser. The preceding native Pipedream action owns the Snowflake connection, and the parser continues to use the existing secret Supabase service-role prop.

## Offline check

```bash
node docs/integrations/achieve-pipedream-parser.check.js
```
