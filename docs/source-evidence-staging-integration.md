# Source-linked evidence — manager staging integration

Goal: managers can review the tested evidence-contract output in the actual isolated staging application, jump to exact cited transcript passages, give independent evidence feedback, and save/reload it.

Context: backend PR89 validated a six-rule synthetic evidence candidate but did not connect it to the manager UI. This work connects that contract to PR130's transcript-first review flow at `rubric-staging.eavesly.pages.dev`, Supabase sandbox `xuvveqaizlletsqvwpgx`.

In scope: narrow source-contract adapter, immutable evidence/source persistence using existing scoped review RPCs, exact source navigation, explicit omission presentation, synthetic staging examples derived from actual validated model output, regression tests and isolated deployment.

Out of scope: production deploy/merge, reprocessing customer calls, replacing full QA scoring with the six-rule experiment, guessed audio timestamps, backfill, overwriting existing staging reviews, automatic learning, unrelated design/dependency work.

Done when:
1. New clearly labeled synthetic candidate examples are reachable in the existing staging queue and show source-linked passages (including interrupted speech) without invented quotes or timestamps.
2. Each saved claim/occurrence retains its own optional feedback; omissions are reviewable assessments with explicit scope and no fabricated Listen target. Existing legacy review behavior remains unchanged.
3. Exact source/revision checks prevent stale or forged evidence feedback and navigation; authorization/revision/approval safeguards remain intact.
4. Fresh local browser/SQL/type/lint/build checks pass, followed by native hosted synthetic save/reload and desktop/mobile navigation verification. Preserve all unrelated existing staging source/review records.
5. Pinned source, deployment receipt, limitations and test links are handed off to Noah in Slack for staging acceptance; no production changes.

Verify: `npm run typecheck`, `npm run lint`, `npm run build`, focused Playwright followed by `npm run test:browser:ci`, Full QA PostgreSQL integration, `npm run check:release-preflight`, `npm run check:staging-build`, guarded `npm run deploy:staging`, hosted native Auth and dedicated synthetic saves with before/after protection checks.

Stop for unavailable isolated staging credentials, a required production write/customer provider request, ambiguous source/claim associations, or failing security/persistence verification. No guessed mappings or silently weakened checks.

## Live staging — 2026-09-25

**This integration is now in the manager-facing staging application**, not just the private backend validator. Use the existing preview password at https://rubric-staging.eavesly.pages.dev/login, choose Manager, then open:

- [Mixed findings](https://rubric-staging.eavesly.pages.dev/dashboard/alerts/DEMO-SOURCE-EVIDENCE-20260925-MIXED/full_qa?status=all): an interrupted guarantee, a separate guarantee, and a missing-disclosure assessment. Contains two saved test revisions; all responses remain editable.
- [Repeated wording](https://rubric-staging.eavesly.pages.dev/dashboard/alerts/DEMO-SOURCE-EVIDENCE-20260925-REPEATED/full_qa?status=all): an untouched review; navigation selects the cited agent statement, not the customer's similar words.
- [Missing disclosure](https://rubric-staging.eavesly.pages.dev/dashboard/alerts/DEMO-SOURCE-EVIDENCE-20260925-OMISSION/full_qa?status=all): an untouched scoped-omission review, with no fabricated passage or Listen target.

Search the queue for **Source-linked evidence** to find all three. These are new synthetic examples; existing calls and saved reviews were not rewritten.

### What to test

1. Select **Find exact source turns**. An interrupted statement highlights both exact turns while preserving the customer's interruption.
2. Mark evidence Correct, Incorrect or Partly correct independently. Comments are optional; untouched evidence remains unreviewed.
3. Judge the overall alert, save, reload, and clear/change a response. No coaching point is required.
4. Try the mobile Transcript/Review switch and Back to evidence. Kris can view saved evidence and omission responses without editing them.

The candidate covers six rules, not the full scorecard. Legacy scorecards, rubric proposals and criterion-mapped coaching are intentionally hidden for these candidate-only examples; overall verdict and optional follow-up remain. **Synthetic examples have no recording.** Candidate Listen stays unavailable until source-bound audio alignment is integrated; existing legacy recording navigation is unchanged. No production prompt/workflow consumes this candidate, and no automatic learning is enabled.

## Verification and deployment receipt

- Runtime source: `e50f43b1b953ed5588a5d78f00eb3b9cc5463a2f`, PR [#130](https://github.com/Try-Pennie/quality-voice-view/pull/130). Backend contract experiment remains separate, [eavesly #89](https://github.com/Try-Pennie/eavesly/pull/89).
- Parent-owned full Playwright run: **250 passed**, one worker, **15.8 minutes**. Focused candidate suite: **5 passed**. The implementation agent also ran the existing evidence-feedback suite: **2 passed**.
- Fresh TypeScript, ESLint, production-mode build, release preflight, staging-build isolation guards, and PostgreSQL 17 Full QA/recording integration assertions passed. Five existing Fast Refresh warnings remain.
- Combined synthetic example was generated through the actual existing gpt-4.1 gateway, then matched exactly against the isolated hosted validator. It contains two statement findings (turns `[2,4]` and `[6]`) plus a recording-disclosure omission. The other two examples use previously validated model-run-4 outputs; no customer call was reprocessed.
- Server migration applied only to `xuvveqaizlletsqvwpgx`, native ledger version **`20260925153531_source_evidence_staging_integration`**. Checked-in SQL SHA-256: `d9fd399a1924e4c1d0c658525f4544fe6babdf59e1f2de95b3ed8c1c74b43189`. All six deployed private function bodies match source; anon/authenticated cannot execute them directly. No new tables, public RPCs or auth grants.
- Guarded deployment installed locked dependencies and built staging from clean source. Immutable origin: https://216b82bb.eavesly.pages.dev/login. Both stable/immutable hosts serve `/assets/index-IhUai-VH.js`, SHA-256 **`18aba503c9f70eb45c4813c6e62c07cc1dcca1b0133fa025e50324eef0758484`**, matching the local artifact. Staging-only CSP, noindex, no-referrer, no-store and password exclusion verified.
- Native hosted manager checks (no mocked API responses): exact interrupted/repeated-word navigation; mixed labels, comment and omission response persisted; reload and clear persisted; saved without coaching; widths **320/375/414/768**; zero errors in the completed run. Exactly two test review revisions were written, only on the new MIXED synthetic call. Initial post-deploy login attempt timed out; a fresh diagnostic session and unchanged full hosted check subsequently passed. This is not counted as an initial clean pass.
- Native Kris session verified saved evidence/assessment responses, absent editing controls and zero mutations/errors.
- Before/after hashes confirm all 11 protected tables' pre-existing records and Auth user count unchanged. New synthetic examples are excluded explicitly from those comparison hashes; no existing examples were reseeded.
- Independent read-only review resolved exact-turn rendering, stale-selection, omission-labeling and input-coercion findings. Final review found no remaining blockers. Claude was unavailable due usage limits; completed review used a separate same-family OpenAI context, **not cross-family review**. Production still requires the outstanding cross-family/release gates.

Synthetic, source-pinned hosted captures: [desktop](screenshots/source-evidence-e50f43b/desktop.png), [375px mobile](screenshots/source-evidence-e50f43b/mobile-375.png). Both were visually inspected. Private credential/session artifacts and detailed receipts remain outside Git.

### Remaining limits / existing notices

Source hashes and offsets establish consistency with the supplied immutable transcript, not speaker identity, complete-call coverage, real-world truth or model execution provenance. Omission feedback concerns the supplied transcript only. No historical backfill was needed or performed.

Post-migration security advisor returned notices for existing objects, not the new private helpers: [security-definer views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [mutable search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anon-executable definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated definer RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS with no direct policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Existing scoped RPC access is retained; unrelated policies were not changed.

Locked dependency install reports 23 existing audit findings (1 low, 6 moderate, 15 high, 1 critical); no dependency changes were made. No PR merge or production deployment is authorized by this staging acceptance step.
