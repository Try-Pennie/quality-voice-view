# Manager loading incident — 2026-09-21

## Goal and scope

Restore Review/Team loading before managers start work, preserve visibility rules and review data, and stop the full-history refresh from starving interactive queries. No frontend redesign, schema-column changes, global timeout increases, or changes to evaluation eligibility. Verify with real authenticated-role production queries and the PostgreSQL review integration suite. Do not resume the expensive refresh without a sustainable measured plan.

## Causes and containment

At 12:01 UTC, `refresh_agent_daily_metrics` was running back-to-back with repeated ten-minute timeouts and `IO / DataFileRead` waits. The last successful refresh finished at **07:59:52 UTC (03:59:52 ET)**. The screenshots showed `57014` timeouts on the alert view and `eavesly_team_pitch_risk`.

The emergency repair request authorized containment: disabled only the named metrics cron job and cancelled only its active `pg_cron` statement. Read-back confirmed `active=false` and zero active matching refreshes. The materialized metrics snapshot is retained, but **AI summary metrics are temporarily stale**. Review records and source-call ingestion were not changed.

After containment, date-range Review completed in 0.69s, super-admin pitch risk in 2.36s, manager Review in 0.27s, and manager metrics + pitch risk in 0.53s. These are database execution checks, not authenticated browser observations.

## Remaining Outstanding-query fixes

1. The feedback hash join discarded alert-index ordering, so the all-history queue evaluated all alerts before sorting/returning its first page. Replaced only this join with a correlated `LEFT JOIN LATERAL ... OFFSET 0`. It skips no rows and retains missing-feedback NULL behavior. Existing unique `(call_id,module_name)` index supplies the lookup. Applied production migration: `20260921121227_alert_queue_ordered_feedback`.
2. The visibility lateral was inlined, repeating `private.alert_visible_to` for every masked field and Outstanding filter. A second `OFFSET 0` keeps the same STABLE permission calculation once per alert. It does not broaden access or change column masks. Applied production migration: `20260921121807_alert_queue_access_once`. The full manager Outstanding projection now completes in 0.28s (211 rows), down from 7.42s with only the first fix. Both repository migration filenames match their applied versions.

Only the shared view's query plan changes. Columns, access helper, decision precedence, ownership, grants, and dependent views remain unchanged. Each migration uses `CREATE OR REPLACE VIEW` inside a transaction with a three-second lock timeout and ten-second statement timeout; no table rewrite or global configuration change.

## Verification

- `bash supabase/migrations/structured-manager-review.integration.check.sh`: passed on PostgreSQL 17 after both changes, including review edits, revision gating, typed/legacy decisions, authorization, and concurrent-write assertions.
- Fresh `npm run build` and `git diff --check`: passed; only the existing Browserslist and bundle-size warnings.
- Full-projection bidirectional `EXCEPT ALL` against the original view: identical for manager, super-admin, outsider, and missing-identity claims. Existing authenticated-role tests then exercise the final view.
- Independent cross-family review of both actual migrations and cumulative equivalence checks: no correctness/security blockers.
- Final production super-admin Outstanding pagination under the authenticated role: all **6,134 rows across seven pages**, with full application projection. Each page completed in **0.18–0.95s**, with an assertion against the actual eight-second API budget. The combined read-only check had a 20-second transaction budget; no API/global timeout was raised.
- Final manager Outstanding full projection: **211 rows in 0.28s**. Final metadata read-back: view options unchanged, authenticated SELECT allowed, anonymous SELECT denied, metrics cron inactive with zero matching active refreshes.
- After the first migration: full super-admin Outstanding first-page projection completed in 1.84s; index ordering preserved (no global top-N sort). View options remained NULL, authenticated SELECT remained allowed, anonymous SELECT remained denied.
- No frontend changes: no build deployment or new UI screenshots required. The authenticated browser/session is not available here; user confirmation remains necessary.

## Operational follow-up / rollback

The metrics job must remain paused during recovery. Do not treat a single successful refresh or a longer timeout as proof that a five- or ten-minute full-history scan is safe. Review/Calls remain backed by live source data; only materialized AI summaries are frozen. Sustainable refresh cost and resumption are **not resolved by this hotfix**.

If the view change needs rollback, recreate the original view body from `20260911120000_structured_manager_review.sql` under the same short lock/statement budgets; do not drop the view or alter grants. This would restore the previous timeout-prone plan, so investigate before doing so. Do not re-enable the metrics cron as part of a view rollback.
