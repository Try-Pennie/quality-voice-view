# Achieve independent watchdog

Small Cloudflare Worker, independent of Supabase cron and Edge runtime. Every 15 minutes (`7,22,37,52` UTC minutes) it calls the **fixed production** weekly endpoint with `{"action":"monitor"}`. It never requests a report send, preview, refresh, or claim recovery. HTTP errors, timeout, redirects, malformed JSON, and unexpected success envelopes notify the approved Slack channel with static issue text only.

Production endpoint `monitor` checks the report snapshots/ledgers and the service-only `achieve_report_cron_healthy()` RPC. The latter checks the weekly job is active, has the expected schedule, and its latest enqueue succeeded within 30 minutes. It exposes no cron commands, headers, or secrets. The cron-health migration changes no jobs or report data and creates no staging cron.

## Secrets and activation

Deploy only with production approval, from a reviewed commit, using `cfp wrangler pennie -- ... --config operations/achieve-watchdog/wrangler.jsonc` (tested Wrangler 4.90.0). Never put secret values in argv, Git, logs, or documentation. Feed secrets through stdin using `secret bulk` or the secret manager. Required Worker secrets:

- `ACHIEVE_SLACK_BOT_TOKEN`: dedicated Eavesly Operations bot, `chat:write` only; invited to the private approved channel.
- `ACHIEVE_WEEKLY_REPORT_SECRET`: the existing production report credential, not a Supabase service-role key or management API token.
- `WATCHDOG_PROBE_SECRET`: independently generated random secret (at least 32 characters) for the manual probe.

The config pins the Cloudflare account, Worker name, channel, cron, and source file. For first activation, create the Worker with its secrets, enable the cron, and verify an expected failure notification **before** deploying the new weekly function. Then apply the additive cron-health SQL and deploy the reviewed Achieve functions with approved production gates and Slack config. Run the manual watchdog probe again and require `{ "status": "healthy" }`. Check the deployed cron inventory and an actual scheduled execution. Merging frontend code alone does not deploy this Worker or Supabase functions.

Manual probe: `POST /check`, `Authorization: Bearer <WATCHDOG_PROBE_SECRET>`. Other methods/paths and unauthorized requests return empty 404 without downstream calls. Healthy returns 200; an alerted failure, notification failure, or missing configuration returns 503. Do not use this probe as a public health page. For a safe local runtime check, omit Slack/report secrets, supply a synthetic probe secret, and expect authorized 503 `not_configured` and unauthorized 404, with no network I/O.

## Tests and limits

```sh
npm run test:achieve:ci
npm exec --yes --package=wrangler@4.90.0 --call 'node operations/achieve-watchdog/runtime.check.mjs'
bash supabase/migrations/achieve-report-reliability.integration.check.sh
npx --yes deno@2.9.6 check --node-modules-dir=none --frozen operations/achieve-watchdog/index.ts
cfp wrangler pennie -- deploy --dry-run --config operations/achieve-watchdog/wrangler.jsonc
```

- Internal report incidents are deduped hourly in Postgres. The stateless external watchdog repeats failed-path alerts every 15 minutes; this deliberately needs no shared database/storage during a Supabase outage. Add durable dedupe only if alert volume warrants it.
- Cloudflare/Slack outages or revoked bot credentials can prevent alerts; Worker logs record only safe statuses and fail the invocation when alert delivery fails. No tertiary watcher/automatic recovery is claimed.
- Healthy probes do not post Slack messages, so real Slack delivery is verified separately during rollout and after credential rotation.
- No monitoring action proves that recipients read their email. Ambiguous Gmail acceptance remains a manual mailbox/ledger investigation; never automatically resend.
- Pause through the Worker cron configuration if needed. Do not delete report claims, change the report secret, or disable production data/report gates as a monitoring rollback.
