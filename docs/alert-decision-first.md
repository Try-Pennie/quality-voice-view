# Phase 1 — decide the alert without reconstructing the call

Goal: managers can save a Full QA alert decision after listening, without reconstructing findings or recording coaching that has not happened.

Context: the manager-friction Slack threads (D090MK4FA7Q/1790029608.504679 and C07LZAKL72P/1789949832.748159) describe blocked saves and mixed right/wrong claims bundled into a single assessment. Phase 1 unblocks completion; Phase 2 will provide a transcript-first workspace and more granular claim review.

In scope: Full QA form, draft validation, existing review RPC validator and revision constraint, behavioral browser and real PostgreSQL checks. Optional feedback on an overall agreement captures mixed reasons without forcing a corrected score. Existing explicit findings and corrections remain supported.

Out of scope: transcript layout, upstream AI prompt/scoring changes, other alert modules, dependency upgrades, automatic agent notifications, production writes, merge before Noah reviews the PR.

Done when:
- Agree alone saves with zero explicit score confirmations, findings, or coaching actions.
- Disagree plus a brief explanation saves; reason categorization is optional.
- Missing/unreviewed AI scores do not block an alert-level decision or become human labels.
- Optional explicit corrections/findings/actions remain validated and saved; old revisions stay readable; reviewed does not imply coached.
- Failure retention, source/revision locks, authorization, and approval behavior remain intact.

Verify: `npm run typecheck`, `npm run lint`, `npm run build`, focused Playwright tests followed by `npm run test:browser:ci`, `npm run test:postgres:ci`, and other CI-equivalent checks. Capture synthetic, commit-pinned screenshots. Inspect the complete diff and obtain independent review.

Stop: open the tested PR and request Noah's review. No merge or production migration before approval. Phase 2 starts only after the approved Phase 1 merge. Merging frontend code alone does not apply the required Supabase migration.

## Verification — implementation `faee8242e79789e47e55e9de64cb3b8f297c912f`

- `npm run typecheck`: passed.
- `npm run lint`: 0 errors, 5 existing Fast Refresh warnings.
- `npm run build`: passed (existing large-chunk/Browserslist notices).
- Focused Playwright review/history checks: 45 passed.
- `npm run test:browser:ci`: **214 passed**, 1 worker, no retries, 10.8 minutes. Fresh process with no simultaneous Docker runs or source edits.
- `npm run test:postgres:ci`: passed on real PostgreSQL 17. Includes actual RPC saves for empty/sparse corrections, zero/single findings, optional categories/actions, missing scores, invalid payloads, replay idempotency, scoped authorization, sparse approval → guarded edit → pending approval, and unlinked call-level coaching.
- `npm run test:achieve:ci`, `npm run check:release-preflight`, `npm run check:staging-build`: passed.

The first broad run had obsolete required-field expectations, which were updated to assert the new behavior. One failure's trace showed `ERR_NETWORK_CHANGED` for app assets during parallel Docker tests. A subsequent clean run was interrupted after 152 passing tests; it is not counted as complete. The final 214-test pass above supersedes those incomplete/failed runs.

### Synthetic screenshots

Captured during the complete browser run at the implementation commit above; inspected at desktop 1280×720 and mobile 375×812. No real customer data.

- [Desktop: agreement alone enables Save](qa-evidence/alert-decision-first/faee824/agree-desktop.png)
- [Mobile: decision and persistent Save](qa-evidence/alert-decision-first/faee824/agree-mobile.png)

### Noah's staging feedback — section order (`473f0a0`)

Moved the alert verdict below the evidence/score review, immediately above **Coaching issues (optional)**. This is a JSX reorder only: save requirements, state, navigation targets, and the read-only view are unchanged.

- Typecheck and build passed; lint: 0 errors, 5 existing warnings.
- Fresh focused Playwright run: **33 passed**, 1 worker, no retries. Includes desktop/mobile section-order assertions, agree/disagree saves, footer navigation, stale drafts, and optional coaching.
- Commit-pinned synthetic screenshots: [desktop](qa-evidence/alert-decision-first/473f0a0/agree-desktop.png), [mobile](qa-evidence/alert-decision-first/473f0a0/agree-mobile.png).
- Inspected the complete reorder diff and both screenshots. No backend changes or new migration needed; broad PR review/merge gates below remain unchanged.

### Partly correct — follow-up contract

Goal: managers can distinguish mixed feedback from fully correct or incorrect assessments for each flagged criterion. Noah chose **each flagged item** and **unselected by default**.

In scope: add `partially_correct` with a brief explanation (12–4000 characters), no replacement score, and no implied coaching/finding. Preserve it in saved manager and approver views. Clear/switch responses safely. The overall alert verdict remains separate.

Out of scope: default confirmations, overall partial verdict, model/prompt changes, recurrence inference, Phase 2 layout, production rollout or merge.

Done when mixed feedback round-trips, invalid payloads fail at the server/parser, empty feedback stays optional, and approval does not turn partial feedback into a confirmed finding. Verify via `npm run typecheck`, `npm run lint`, `npm run build`, focused/full Playwright, and `npm run test:postgres:ci`; inspect desktop/mobile screenshots and obtain independent review. Stop before production or merge; update PR/staging only after checks.

The additional migration is `20260922140000_full_qa_partially_correct_feedback.sql`, after the decision-first migration. It replaces only the private validator; public RPCs and grants stay unchanged.

Implementation: `d661422`, followed by review fixes in `688cdaa`. Fresh focused checks: 5 browser tests passed (save/failure/reopen/approval, switching/clearing, Unicode boundaries and malformed saved data); real PostgreSQL 17 integration assertions passed, including round-trip of 4,000 Unicode code points and rejection of invalid mixed-feedback payloads. Full CI-equivalent checks are tracked in the PR receipt.

Synthetic screenshots pinned to `688cdaa`: [desktop](qa-evidence/alert-decision-first/688cdaa/partly-correct-1280.png), [mobile](qa-evidence/alert-decision-first/688cdaa/partly-correct-375.png).

Independent same-family Pi/Sol review identified inconsistent rollout instructions and a UTF-16/PostgreSQL character-count mismatch. Both were addressed with explicit migration sequencing and shared code-point counts plus regression coverage. Pi/Claude could not start because extra usage was exhausted; no account switch or Claude Code fallback was used. Cross-family review remains outstanding.

### Independent review

A separate-context Pi/Sol reviewer traced the client, private validator, existing public RPC, approvals and recurrence. Findings addressed:

1. Optional reason categories can now be cleared.
2. Call-level coaching remains allowed without findings, per the user's requirement. Recurrence copy now explicitly describes **approved coaching linked to the same category**, not the absence of any coaching. Real SQL checks prove an approved unlinked coached review persists without inventing category occurrences or coaching proxies.
3. Added sparse review approval/resubmission regression coverage.

The reviewer accepted that resolution with no remaining blocker. This is same-family review, not cross-family evidence: Pi/Claude was blocked by account extra-usage exhaustion. Noah was DMed for approval to use the verified Claude Code account; that fallback has not been started.

### Production boundary

Read-only inspection of `miikotqnovnixpeqtqnd` confirmed the named corrections constraint still requires exactly 23 responses and the validator still enforces the finding threshold. Duplicate-finding rejection and the public submit RPC are present. No production writes were performed.

The required migrations, in order, are `20260922040000_full_qa_alert_decision_first.sql` and `20260922140000_full_qa_partially_correct_feedback.sql`. Obtain rollout approval, apply both through the approved database process, then merge/deploy the frontend. Applying only the first migration leaves all Partly correct saves unsupported. Do not blanket-push unrelated historical migrations. Existing RPC authorization, grants and immutable source/revision behavior are unchanged. Production end-to-end behavior is **not verified** until the approved rollout.
