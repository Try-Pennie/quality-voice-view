# Evidence-level manager feedback — staging scope

Goal: managers can independently confirm, dispute or partially agree with each saved evidence/claim pair, with an optional comment, while completing an alert without reviewing every passage or writing coaching points.

Context: follow-up to PR #130, base `5eaf043`. Criterion-level corrections cannot capture mixed responses to multiple passages. Existing immutable source snapshots/review revisions and scoped RPCs should be reused.

In scope: additive evidence feedback persistence, scoped context/save RPC updates and server validation, precise source-bound evidence references, compact per-passage controls and read-only saved responses, synthetic browser/SQL regression tests, isolated staging migration and UI deployment.

Out of scope: production/merge, historical backfills or rewritten manager opinions, call reprocessing, provider/timestamp generation, unrelated schema/security work, dependency upgrades, automatic model training or prompt deployment.

Done when:
1. A manager can mark two pieces of evidence differently and optionally comment, save, reload and see each exact response; skipped evidence remains unreviewed. Overall decision/coaching stay independent.
2. Feedback identifies both original evidence and claim association within its exact source version; identical words supporting different claims never share an answer by accident. Missing links are explicit, not inferred. Notes are not falsely represented as transcript quotes.
3. Server rejects fabricated/cross-source/duplicate references and invalid answers; authorization, revision/approval locks, idempotency and legacy review preservation remain intact. Old clients must not erase new evidence feedback.
4. Parent-owned SQL integration and browser checks pass (mixed labels, optional comments, skip/clear, duplicates, legacy reviews, source changes, permissions, failed saves, desktop/mobile/keyboard).
5. Reviewed, pinned build and necessary migration are deployed only to isolated staging `xuvveqaizlletsqvwpgx`; Noah receives staging/PR links for approval before production.

Verify: focused browser and PostgreSQL checks, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:browser:ci`, release/staging guards, then hosted staging smoke with no writes to real customer reviews (synthetic staging fixture only if needed).

Stop for ambiguous evidence identity that requires invented associations, production credentials/impact, missing safe migration prerequisites, or material review defects. Preserve original reviews; schema migration is expected, historical reprocessing is not.

## Verification — 2026-09-24

- Parent-owned full Playwright suite: **239 passed**, single worker (14.6 minutes). Initial failures were outdated criterion-disclosure/evidence-occurrence selectors; updated assertions retain validation, playback safety, keyboard, focus, save and read-only coverage.
- Typecheck, lint (0 errors, 5 existing refresh warnings), production build, release preflight and isolated staging build guards passed. PostgreSQL 17 Full QA and recording timestamp integration assertions passed.
- Independent read-only review resolved projection parity, malformed JSON, post-save normalization and saved-response visibility findings. Final review found no remaining blockers. Claude review was unavailable because its quota was exhausted; the independent fallback used Sol, so this is **not cross-family review**. Cross-family review remains a production gate.
- Applied only the new migration to isolated staging, ledger version `20260924141216_evidence_level_manager_feedback`. Local SQL SHA-256: `14f87accf0b41a3c63c103ba3336acced6bbfe18a7763563217fdc93100561c8`. All seven deployed function bodies match local source; the legacy submit function is unchanged.
- Post-migration hashes verify all existing 5 review revisions, 4 feedback rows and 30 module-result rows unchanged. Existing revisions have empty evidence feedback, not invented opinions. Added one separate synthetic check call, `DEMO-EVIDENCE-FEEDBACK-20260924`; existing examples are not overwritten.
- Security advisor flags the new authenticated SECURITY DEFINER RPC as expected: it retains actor scope, role, source and revision checks; private helpers are not executable by API roles. See [advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Unrelated existing [security-definer views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), search-path and auth notices remain outside scope.
- No production changes, backfill, call reprocessing, provider requests or merge. Hosted deployment receipt follows separately.
