# Structured manager review

This branch adds the database contract and dependent review UI for Pennie-internal Eavesly alerts only. The migration has not been applied to production. It is stacked on the trustworthy-workspace PR.

## User workflow

1. Managers choose real issue or false alarm and provide the required explanation. Real issues have separate “What happened?” and “What action did you take?” fields.
2. Reviewed alerts await shared approval by any configured super-admin. False alarms require approval too; approving a review does not complete deferred coaching.
3. A super-admin can request changes with instructions. The current team manager sees the returned review in Changes requested and can resubmit while retaining the original review snapshot.
4. Any edit of an approved review creates a new revision requiring approval. The form explains this before updating. Stale tabs retain drafts and refresh the current revision rather than silently overwriting it.

Changes requested is a subset of Reviewed, not another first-review backlog. Counts still reconcile as `received = reviewed + awaiting manager + system closed`.

## Contract

- Internal feedback is submitted through `submit_internal_alert_feedback`; the database derives the authenticated Pennie actor and verifies current team ownership (or super-admin status).
- Real decisions require an action plus distinct 12–4000 character violation/action details. False alarms require a reason plus a 12–4000 character explanation. Client and database boundaries trim edge whitespace consistently. `disposition_review` and `achieve_welcome_call_qa` retain their existing direct-writer behavior.
- The feedback trigger owns reviewer identity, revision, review timestamp, and the immutable first-review snapshot. The snapshot contains feedback fields only—never call/customer data.
- `eavesly_alert_review_decisions` is append-only and permits one shared `approved` or `changes_requested` decision per feedback revision. Any configured super-admin may decide.
- A requested correction is copied to the existing alert thread. A current-manager resubmit advances the revision even when the feedback text is unchanged, and thread notifications reach the requesting admin without changing coaching state.
- The alert view keeps its existing columns in order and appends scoped structured-review/current-decision fields. Authenticated direct-table reads retain legacy columns but cannot bypass the view to read structured prose or snapshots. A negative `current_decision_id` denotes a revision-1 legacy super-admin acknowledgment made after the latest legacy feedback update; ordinary or stale acknowledgments never approve.

## Deployment boundary

The migration must be reviewed and applied before this UI is deployed. It disables the old direct internal-feedback write path, so database and client rollout must be coordinated; old open clients can fail to save during that transition. This is not a zero-downtime compatibility release. No production rollout, migration application, merge, or deployment has been performed.

The new violation/action columns and immutable snapshot are scoped. Existing legacy read permissions (including the older comment column) are not comprehensively redesigned. Partner/disposition direct writers and service-role access remain compatible.

## Local verification

```sh
supabase/migrations/structured-manager-review.integration.check.sh
```

The check runs the production migration on PostgreSQL 17 with synthetic fixtures, JWT/auth shims, RLS roles, concurrent writers, and the existing message/notification triggers.
