# Achieve reporting reliability hardening — September 21, 2026

## Scope and outcome

This isolated branch hardens the existing Achieve sync/report path without deploying, pushing, sending email, contacting Snowflake, posting Slack, or changing any remote.

- Weekly report loading now requires coherent outcome and termination snapshots for an accepted Snowflake UTC source date. Before the daily sync deadline at 12:15 UTC, coherent prior-day or current-day snapshots are accepted (so an early successful sync is not rejected); at and after the deadline, the current date is required. Missing, future, stale, mixed-date, malformed, and incomplete data fail before MIME preparation, claim creation, or Gmail.
- Termination monitoring now returns snapshot metadata even when the current 30-day row set is empty.
- Weekly and daily handlers compose request cancellation with a 110-second end-to-end deadline. Snowflake requests retain their 30-second dependency timeout and now compose it with the caller signal. Google token, Gmail, Supabase RPC, claim, and ledger writes receive the same caller deadline.
- The weekly cron request budget is conditionally changed from 30 to 120 seconds, below Supabase's 150-second response idle limit and above the measured 60.8-second send. The seven expensive report dashboards remain deliberately sequential.
- Delivery claims are acquired immediately before Gmail and are never automatically deleted. A timeout after Gmail starts is ambiguous; the claim remains `sending` for investigation rather than enabling a duplicate resend.

## Monitoring and Slack activation

`achieve_report_reliability_snapshot` reports only PII-free codes/dates/counts for:

- stale, missing, future, or mismatched daily snapshots (with prior-day/current-day acceptance before 12:15 UTC);
- daily sync or weekly delivery claims still active after five minutes;
- the latest Monday report still unsent after 10:15 AM Eastern.

The existing authorized weekly endpoint is reused for the monitor pass. On production only, its existing cron row is changed to every 15 minutes; the handler still builds/sends reports only during Monday's 9 AM Eastern hour. The migration does not create a cron row or contain a project URL, so the confirmed staging project (`xuvveqaizlletsqvwpgx`) remains without HTTP cron.

Slack remains **disabled** until the dedicated operations-channel webhook destination is verified. Production activation requires all of:

```text
DEPLOYMENT_ENVIRONMENT=production
ACHIEVE_EXTERNAL_IO_ENABLED=true
ACHIEVE_SLACK_ALERTS_ENABLED=true
ACHIEVE_SLACK_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
```

The webhook parser accepts only HTTPS `hooks.slack.com` or `hooks.slack-gov.com` `/services/` URLs. Payloads contain no secrets, customer data, recipients, Gmail IDs, or enrollment rows. Delivery is bounded to 10 seconds. A database claim limits an unchanged incident fingerprint to one Slack attempt per UTC hour; a Slack failure is retried in the next hour, not in a tight loop. Changed issue/date state gets a new fingerprint. No monitor path resends a report or deletes a sync/delivery claim.

For staging/auth-only checks, set `DEPLOYMENT_ENVIRONMENT=staging` and leave `ACHIEVE_EXTERNAL_IO_ENABLED` and both Slack settings unset. External I/O additionally requires `SUPABASE_URL` to equal the reserved production project URL (`https://miikotqnovnixpeqtqnd.supabase.co`), so a copied/mistyped production flag remains inert on staging (`xuvveqaizlletsqvwpgx`). Authenticated report, monitor, and sync commands then return `503 external_io_disabled` before Supabase client construction, Snowflake, Google, Gmail, Slack, claims, or snapshot writes. Do not copy the production Vault URL/job or configure a synthetic Slack recipient.

## Verification

Focused checks only; the frontend suite was intentionally not run.

```bash
npx tsx supabase/functions/_shared/achieve-deployment-safety.check.ts
npx tsx supabase/functions/_shared/achieve-management-report.check.ts
npx tsx supabase/functions/_shared/achieve-first-pay-outcomes.check.ts
npx tsx supabase/functions/achieve-weekly-report/monitoring.check.ts
node supabase/migrations/achieve-report-reliability.check.js
bash supabase/migrations/achieve-report-reliability.integration.check.sh
```

The tests exercise the exported report loader, exported send orchestration, recording Slack transport adapter, cancellation propagation, hourly dedupe, and the real migration/functions on disposable PostgreSQL 16.

## Limits and release boundary

No hosted Edge Function, production/staging database, Slack webhook, Snowflake query, Gmail API, or mailbox was exercised here. Production migration/function deployment and Slack destination activation remain approval-only. An accepted Gmail request followed by a lost response remains intentionally ambiguous and requires mailbox/ledger investigation; monitoring reports the stuck claim but does not decide delivery or recover it automatically.
