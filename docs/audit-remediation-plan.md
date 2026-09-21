# September 21 audit remediation

## Goal and release boundary

Make the audited review/reporting failure paths reject invalid data, keep useful review evidence available, and prevent releasing unverified code/database contracts. Open a reviewed PR and deploy the tested candidate to the existing isolated staging environment for Noah's acceptance **before** merge.

Production remains read-only. No merge, production migration/history repair, production deployment, customer email, automatic resend, provider processing, reseed, or credential/policy expansion is authorized by this work. Existing worktrees and private staging samples/reviews must be preserved.

## Implementation slices

1. **Review correctness:** reject normalized duplicate findings on client and RPC; use Eastern business-day recurrence bounds; isolate private-media failures; connect threshold settings to filtering; derive selected manager from current roster.
2. **Achieve reliability:** preserve today's recovery commits; enforce fresh/coherent snapshots; bound report execution and align scheduler timeout; detect overdue delivery/stale snapshots/stuck claims without unsafe resend; retain preview/correction safeguards.
3. **Release safety:** make typecheck/lint/build/browser/SQL checks reproducible in CI; read-only migration inventory/preflight with body evidence; stage the already-merged role protection and verify it. Do not blindly replay historical migrations.
4. **Acceptance:** independent review, fresh integrated tests, isolated staging deployment and native auth/browser/database checks; publish PR with commit-pinned evidence, rollback and explicit production rollout order.

## Done when

- Every audited code defect has a regression check through its real caller-facing seam.
- Integrated typecheck, lint, build, browser suite and affected PostgreSQL/Edge checks pass without hidden retries or disabled safety rules.
- PR preserves recovery and new changes; migration drift and production-required actions are explicit, not falsely marked applied.
- Staging serves the pinned candidate, contacts only the isolated database, preserves existing samples/reviews and cannot send partner email.
- Noah receives the PR, staging URL, test evidence and remaining production approval gates.

## Verification

Use existing `npm test -- --workers=1`, `npm run build`, `npm run lint`, application TypeScript and migration integration runners. Add focused failure tests for each changed behavior. Run production metadata reads only; use disposable PostgreSQL for adversarial authorization/SQL tests. Verify stage build asset identity, production-key exclusion, native login/roles, selected UI behavior and protected table hashes.

Stop for missing production authority, unknown migration equivalence, unsafe staging integrations or new product-policy decisions. Do not conceal a failing default check with a diagnostic rerun. Full production behavior and external mailbox delivery require a separate approved rollout.
