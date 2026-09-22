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
