# Structured manager review schema checkpoint

Phase 1 adds the database contract for Pennie-internal Eavesly alerts only. It does not change UI/query/type files and does not apply the migration to production.

## Contract

- Internal feedback is submitted through `submit_internal_alert_feedback`; the database derives the authenticated Pennie actor and verifies current team ownership (or super-admin status).
- Real decisions require an action plus distinct 12–4000 character violation/action details. False alarms require a reason plus a 12–4000 character explanation. Client and database boundaries trim edge whitespace consistently. `disposition_review` and `achieve_welcome_call_qa` retain their existing direct-writer behavior.
- The feedback trigger owns reviewer identity, revision, review timestamp, and the immutable first-review snapshot. The snapshot contains feedback fields only—never call/customer data.
- `eavesly_alert_review_decisions` is append-only and permits one shared `approved` or `changes_requested` decision per feedback revision. Any configured super-admin may decide.
- A requested correction is copied to the existing alert thread. A current-manager resubmit advances the revision even when the feedback text is unchanged, and thread notifications reach the requesting admin without changing coaching state.
- The alert view keeps its existing columns in order and appends scoped structured-review/current-decision fields. Authenticated direct-table reads retain legacy columns but cannot bypass the view to read structured prose or snapshots. A negative `current_decision_id` denotes a revision-1 legacy super-admin acknowledgment made after the latest legacy feedback update; ordinary or stale acknowledgments never approve.

The migration must be reviewed and applied before any dependent UI is deployed. No zero-downtime or production rollout work is included in this checkpoint.

## Local verification

```sh
supabase/migrations/structured-manager-review.integration.check.sh
```

The check runs the production migration on PostgreSQL 17 with synthetic fixtures, JWT/auth shims, RLS roles, concurrent writers, and the existing message/notification triggers.
