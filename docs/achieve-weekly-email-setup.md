# Achieve weekly email setup (Google Workspace)

The report sends every Monday at 9:00 AM Eastern from a real Google Workspace mailbox through the Gmail API. The existing Google service account used by `achieve-feedback-sync` is reused with domain-wide delegation and the narrow `gmail.send` scope. The weekly function also uses the shared Snowflake key-pair identity to build Geoff's enrollment-level follow-through attachment in memory; it never stores that export in Supabase.

## 1. Choose the sender mailbox

Use a dedicated or existing role mailbox, for example `eavesly-reports@trypennie.com`.

- It must be a Google Workspace **user mailbox**, not only a Google Group.
- Keep the mailbox active; the service account impersonates it when sending.
- No mailbox password or app password is stored in Supabase.

## 2. Enable Gmail API and domain-wide delegation

In the Google Cloud project containing the service account named by the existing Supabase secret `GOOGLE_SA_EMAIL`:

1. Open **APIs & Services → Library**.
2. Enable **Gmail API**.
3. Open **IAM & Admin → Service Accounts**.
4. Select the service account used by `GOOGLE_SA_EMAIL`.
5. Under **Domain-wide delegation**, enable Google Workspace domain-wide delegation if it is not already enabled.
6. Save and copy the service account's numeric **OAuth 2 Client ID**. This is not the service-account email.

Google reference: [Control API access with domain-wide delegation](https://support.google.com/a/answer/162106).

## 3. Authorize the service account in Google Admin

Sign in to `admin.google.com` as a Workspace super administrator:

1. Open **Security → Access and data control → API controls**.
2. Select **Manage Domain Wide Delegation**.
3. Select **Add new**.
4. Enter the numeric OAuth Client ID copied above.
5. Enter exactly this OAuth scope:

   ```text
   https://www.googleapis.com/auth/gmail.send
   ```

6. Select **Authorize**.

Do not grant inbox-read, mailbox-modification, or broad Gmail scopes. The report only needs Gmail's send scope.

Google references: [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) and [`users.messages.send`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

## 4. Configure Supabase function secrets

The existing project-level `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, and eight `SNOWFLAKE_*` secrets are reused. Confirm their names exist without printing their values:

```sh
npx supabase secrets list --project-ref miikotqnovnixpeqtqnd
```

Create the remaining secrets in a temporary file outside the repository:

```sh
REPORT_SECRET="$(openssl rand -hex 32)"
cat >/tmp/achieve-weekly-email.env <<EOF
ACHIEVE_WEEKLY_REPORT_SECRET=$REPORT_SECRET
ACHIEVE_REPORT_RECIPIENTS=leader.one@trypennie.com,leader.two@trypennie.com
ACHIEVE_REPORT_CC=observer.one@trypennie.com,observer.two@trypennie.com
ACHIEVE_REPORT_TEST_RECIPIENT=internal.tester@trypennie.com
ACHIEVE_PORTAL_URL=https://YOUR-EAVESLY-HOST/achieve
GMAIL_SENDER=eavesly-reports@trypennie.com
EOF
chmod 600 /tmp/achieve-weekly-email.env

npx supabase secrets set \
  --project-ref miikotqnovnixpeqtqnd \
  --env-file /tmp/achieve-weekly-email.env
```

`ACHIEVE_REPORT_TEST_RECIPIENT` is the internal-only destination for `{"action":"test"}`. Test sends ignore the production To/Cc lists. The Snowflake secret names are `SNOWFLAKE_ACCOUNT_URL`, `SNOWFLAKE_ACCOUNT_IDENTIFIER`, `SNOWFLAKE_USER`, `SNOWFLAKE_ROLE`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`, and `SNOWFLAKE_PRIVATE_KEY`. Never paste the private key or any secret value into chat, tickets, logs, or source control.

Keep `REPORT_SECRET` available for the next step, then securely remove the temporary file:

```sh
rm /tmp/achieve-weekly-email.env
```

## 5. Add the matching Vault secret

In **Supabase Dashboard → Database → Vault**, create a secret with:

- **Name:** `achieve_weekly_report_secret`
- **Secret:** the exact value currently held in `$REPORT_SECRET`
- **Description:** `Authenticates the Achieve weekly report cron request`

The Vault value and `ACHIEVE_WEEKLY_REPORT_SECRET` must match. Vault authenticates the cron request; the Edge Function secret validates it.

After saving it, clear the shell variable:

```sh
unset REPORT_SECRET
```

## 6. Deploy the code

Follow the one-writer activation order in [`integrations/achieve-first-pay-outcomes.md`](./integrations/achieve-first-pay-outcomes.md): deploy and test `achieve-first-pay-sync`, disable only the old first-pay Pipedream steps, then apply the migration that enables its daily cron.

```sh
npx supabase functions deploy achieve-first-pay-sync \
  --project-ref miikotqnovnixpeqtqnd \
  --no-verify-jwt

# After the direct-sync test and Pipedream first-pay cutover:
npx supabase db push --project-ref miikotqnovnixpeqtqnd

npx supabase functions deploy achieve-portal \
  --project-ref miikotqnovnixpeqtqnd

npx supabase functions deploy achieve-weekly-report \
  --project-ref miikotqnovnixpeqtqnd \
  --no-verify-jwt

# The shared Google auth code is also used by the existing sheet sync.
npx supabase functions deploy achieve-feedback-sync \
  --project-ref miikotqnovnixpeqtqnd \
  --no-verify-jwt
```

Deploy the frontend through the repository's normal release process so `/achieve` can call the new `get_management_report` action.

The direct Snowflake sync runs daily at 12:00 UTC, before the Monday report window. The weekly-report migration separately invokes the email function every 15 minutes during both UTC hours that can contain 9 AM Eastern; the email function sends once and handles daylight-saving changes.

## 7. Send a real test

A test action sends the current completed-week report to the configured recipients without consuming the Monday delivery record:

```sh
read -rsp 'Weekly report secret: ' REPORT_SECRET && echo
curl --fail-with-body \
  --request POST \
  'https://miikotqnovnixpeqtqnd.supabase.co/functions/v1/achieve-weekly-report' \
  --header 'Content-Type: application/json' \
  --header "x-report-secret: $REPORT_SECRET" \
  --data '{"action":"test"}'
unset REPORT_SECRET
```

Expected response shape:

```json
{"ok":true,"mode":"test","week_ending":"YYYY-MM-DD","message_id":"..."}
```

Confirm that:

- the sender, To list, and Cc list match the configured allowlists;
- both HTML and plain-text content are present;
- the HTML uses inline literal styles and table-based trend tiles with no stylesheet, CSS variables, grid, or JavaScript;
- first-pay tiles show mature 2/4/6-week and all-time totals, and each `vs PP` value uses the immediately preceding same-length window;
- negative-review tiles use true non-overlapping 2/4/6-week predecessors and render unavailable comparisons as an em dash;
- High Risk Triangulation contains active agents on at least two Bottom 10 lists, or on mature six-week first-pay screening with z above 1.5;
- Bottom 10 Negative Reviews requires at least three Form reviews and ranks raw negative-review rate;
- Bottom 10 Intelligibility ranks Speech Clarity counts and shows Background Noise and Connection only as context;
- mature six-week first-pay screening shows the top ten plus roster and identifies its source-as-of date;
- Bottom 10 by First Pay Screening — Last 6 Months appears immediately after it, uses the trailing six calendar months through the same maturity cutoff, requires at least 10 mature enrollments per agent, and does not change High Risk Triangulation;
- termination rows show Last WC Activity and distinct Activity Post Term counts based on assignment `first_seen_on`;
- the management CSV contains all 2/4/6-week representative rows, report selectors, six-month and all-time first-pay metrics, intelligibility counts, and termination count/date fields;
- `achieve-first-pay-outcomes-*.csv` contains all-time plus mature 2/4/6-week and trailing six-month agent comparisons;
- the message has exactly three attachments and remains below the 25 MB fail-closed message limit;
- `Achieve-WC-Agent-FirstPay-Data-YYYY-MM-DD.csv` has Geoff's exact nine-column header, full Achieve-serviced history, all welcome-agent domains, CRLF rows, unique nonblank AFF Numbers, worst human rating, and any qualifying AI flag;
- the email body and portal contain no enrollment rows or AFF Numbers. The third attachment may contain AFF Number and WC agent email only for the fixed approved recipients; it is generated in memory and never persisted or logged by Eavesly.

## 8. Verify scheduling and delivery

Check the cron job:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'achieve_weekly_management_report';
```

Expected schedule: `*/15 13,14 * * 1`.

After Monday delivery, check the idempotency ledger:

```sql
select week_ending, status, started_at, sent_at
from public.achieve_weekly_report_sends
order by week_ending desc
limit 10;
```

A successful run has `status = 'sent'`. Gmail message IDs are retained for delivery troubleshooting but should not be copied into public logs.

## Troubleshooting

- `unauthorized_client`: domain-wide delegation is missing, the numeric client ID is wrong, or the `gmail.send` scope was not authorized.
- `unauthorized` from the Edge Function: the Vault and Edge Function report secrets differ.
- `not_configured`: one of the required Supabase secrets is absent or malformed.
- Gmail `403`: confirm the sender is an active Workspace user and the service account is authorized for `gmail.send`.
- No Monday request: confirm the Vault secret exists and inspect `cron.job_run_details` and `net._http_response` for the scheduled request.
- `weekly_report_failed` before Gmail: inspect the safe Edge Function error category and Snowflake source controls. The report intentionally sends nothing unless all three attachments are complete; a blank WC agent email, blank/duplicate AFF Number, incomplete partition, stale source date, or invalid QA rollup must be corrected and retried during the delivery hour rather than filtered or guessed.
