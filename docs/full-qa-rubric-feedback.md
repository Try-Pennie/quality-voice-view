# Full QA rubric feedback and approved recurrence

Branch: `nmogil/full-qa-rubric-feedback`, based on reporting source `8c17aca` (original UI base `c23ba4f`). Final verified source and screenshot commit: `93d729f`.

## Manager and super-admin workflow

1. Open a Full QA alert. Inspect the original AI score/evidence beside the rubric's 23 categorical or boolean criteria. The full scoring policy is expandable.
2. Retain a judgment, correct it with a reason, or mark it **needs context**. Corrections never overwrite the AI result.
3. Record each distinct underlying finding once, separately from whether the alert escalation was justified. A dismissed escalation can retain real findings and coaching; deferred coaching stays in the outstanding queue.
4. Save a revision. The existing super-admin workflow approves that exact revision or requests changes. Read-only approval shows the saved human values and reasons, not just the AI values. Editing reopens approval.
5. Propose a criterion-rule change separately. A super-admin can accept it **for evaluation**, not publish it or change production scoring.
6. On the agent profile, approved current-revision findings count toward category recurrence. Pending, uncertain, disputed, and unmapped legacy rows remain separate.

## Integrity boundaries

- Three new tables: immutable prompt/rubric catalog, append-only reviewed-source revisions, and separate rule proposals. Authenticated users cannot directly read/write these tables; scoped RPCs own access. The generic feedback RPC cannot bypass Full QA validation.
- Prompt-stamped results resolve the exact catalog entry. Unstamped legacy calls are explicitly current-reference-only. An unknown stamped hash shows a field map, not an invented original rubric.
- Reviewed source and reference remain pinned across edits. The stale-context token covers both source JSON and rubric reference, so even a first save cannot silently switch to a newly added catalog version.
- One underlying assertion is one finding; overlapping failed criteria do not automatically become separate findings. Escalation requires two distinct compliance findings or explicit severe customer mistreatment. Ordinary low customer-experience scores do not imply severe mistreatment.
- Recurrence uses the actual call-start window; missing starts use a labeled alert-date fallback and unknown timing. An approved coached review's immutable **saved timestamp** is only a coaching-date proxy, not proof of when coaching occurred. Later edits do not move that original proxy.
- Unmapped or contradictory approved occurrence rows fail closed rather than disappearing from totals. Review links open the current call review and label the revision listed in the report; they do not claim to open an immutable historical page.

## Fresh verification

Parent checks, not just worker reports:

- `npm test -- --workers=1 --reporter=line`: **102 passed** at UI source `7708b89`.
- `npm run build`: passed, with the existing large-chunk warning.
- `npx tsc --noEmit -p tsconfig.app.json --lib es2021,dom,dom.iterable`: passed. Plain application TypeScript retains the known ES2020 `replaceAll` baseline issue.
- `npm run lint`: **45 errors / 6 warnings**, unchanged baseline; not represented as green.
- `bash supabase/migrations/full-qa-rubric-feedback.integration.check.sh`: all assertions passed in isolated PostgreSQL 17, including the final catalog-pinning fix `d947dcb`. No live database was used.
- After the final mobile check at `93d729f`, `npm test -- tests/full-qa-rubric-feedback.spec.ts --workers=1 --reporter=line`: **5 passed**.

Independent cross-family SQL and UI reviews approved the final changes. Two review findings were fixed with regressions: unmapped recurrence rows silently dropping from totals, and legacy rubric references changing across catalog revisions. Both were observed failing before their fixes, then passing afterward.

The browser suite uses synthetic intercepted API data. Database integration separately exercises real PostgreSQL functions, permissions, validation, snapshots, and approval/recurrence behavior. Neither establishes production acceptance or actual model quality.

## Commit-pinned screenshots

Freshly rendered at `93d729f`; synthetic data only, visually inspected:

- [Manager review / retained finding after dismissed escalation](qa-evidence/full-qa-rubric-feedback/manager-review.png)
- [Mobile rubric correction](qa-evidence/full-qa-rubric-feedback/manager-review-mobile.png)
- [Super-admin view of saved human corrections](qa-evidence/full-qa-rubric-feedback/super-admin-approval.png)
- [Approved versus uncounted recurrence](qa-evidence/full-qa-rubric-feedback/approved-recurrence.png)

## Not yet released or measured

This work is local and not deployed. The proposed migration is not applied to production. Backend prompt provenance is a separate dependency; old calls remain honestly labeled without it. Full QA is the first module, not all scoring modules.

No production prompt has changed and no paid model comparison has run. Candidate evaluation, human adjudication of the diagnostic pilot, Chris's missing example sheet, and production acceptance remain separate steps. Fewer alerts alone would not establish fewer false positives or acceptable false-negative performance.

Remote `main` advanced during this work to `d0dfd06` (PR #118, disposition-audit timeout). This branch was not merged/rebased onto that newer base; integration with it must be checked before release.
