# Manager feedback restoration — isolated staging

## Balance: coaching first, calibration optional

Restore the original **Topic / Purpose / Outcome** overview and the saved AI coaching groups (**Strengths, Areas for improvement, Specific coaching points, Training recommendations**). Keep staging's transcript-first workspace, verified timestamps, mobile tabs, sticky review action, source evidence and optional corrections.

Managers make one explicit overall agree/disagree decision. They do not have to confirm every score or type a reason just to agree. Leaving an AI score unchanged does **not** manufacture manager confirmation. AI suggestions are display-only: saving agreement does not record coaching, create findings or imply follow-up happened. This retains useful calibration data without making the manager label the entire call.

## Two-call close

The backend saves the exact earlier-call context used for scoring, including summary, CRM disposition, stage statuses and source QA row identity. Only strictly earlier calls for the same lead qualify; the newest assessment of each of at most five prior calls is inspected. A credit requires internally consistent structured AI completion, not a summary mentioning the step.

The UI separates completed here, completed earlier, outstanding and unknown stages. Prior completion is labelled **AI-assessed, not transcript-verified or manager-confirmed**. Current partial/re-attempted steps remain assessable. Malformed context, conflicting completion and unproven chronology fail closed. Recording disclosure, new credit-pull consent, identity checks and misleading claims are never waived. No fabricated prior-call audio links are offered.

Credit affects evaluation before scores/coaching are generated; the server also removes eligible previously completed steps from expected sections without rewriting raw current-call statuses, scores or escalation. The applicability field audits server removals; it can be null when the model already omitted the credited steps.

Historical saved assessments are not reprocessed. Missing historical context stays unavailable. The new prompt is not registered as an exact historical rubric in the sandbox; its UI correctly says the original rubric is unavailable for that stamped hash and the current field map is only a reference.

## Scope and review

- UI runtime: `f7d2595`, relative to `f3fb9e6`, branch `nmogil/transcript-first-review`, [PR #130](https://github.com/Try-Pennie/quality-voice-view/pull/130).
- Backend: `fdaf3b0`, relative to `9d9e485`, branch `nmogil/full-qa-source-evidence-staging`, [PR #89](https://github.com/Try-Pennie/eavesly/pull/89).
- Claude Code Opus 5.5 implementation and review through Herdr; independent GPT-5.6 Sol cross-family review approved the final runtime commits with no blockers. Review fixes cover source-table identity, chronology, consistent prior completion, valid current attempt lists and no inferred manager confirmation.
- The Pi Opus route was unavailable due to its usage limit; Claude Code Opus 5.5 was the verified fallback, not a silent model substitution.
- No production deployment, merge, backfill, new live ingestion or customer reprocessing. No database migration required.

## Verification

Parent-run checks (not only worker-reported):

- Backend typecheck and full Vitest suite: **940 tests / 84 files passed**.
- UI typecheck, lint (zero errors; five existing Fast Refresh warnings), release-preflight, PostgreSQL integration checks and Achieve checks passed.
- Isolated staging build passed. Final complete single-worker browser-suite result is recorded in the deployment receipt below.
- Real model checks used the final backend module, prompt and database history lookup against fictional examples. With prior context, stages 1–5 are credited; without it, the same follow-up is assessed for skipped stages. Both retain the current-call consent/misleading-claims failures and manager escalation. Process adherence remained `fair` in both examples; no score-improvement claim is made.
- Real staging DB lookup excluded an intentionally later same-lead sentinel call. Original sample/review tables and auth counts were fingerprinted before/after insertion and stayed unchanged.
- Native local browser against the actual sandbox: summary, coaching, prior context, no-history comparison, widths 320/375/414/768, no overflow or browser errors. Existing recording sample retained six verified Listen actions and seven honestly unavailable timestamps, full-quote highlighting, keyboard navigation and unsaved mobile drafts. No transcription was invoked.

Initial attempts are not counted as clean passes: an overlapping build invalidated one artifact check (serial rerun passed); a first seed transaction rolled back on a required timestamp (corrected inserts-only transaction passed); a browser harness initially waited for a hidden mobile panel (corrected navigation passed). A superseded browser run was interrupted before final guard fixes; only the complete final-source run counts.

## Test examples

Use the existing **Manager** preview login at <https://rubric-staging.eavesly.pages.dev/login>.

- [Two-call close](https://rubric-staging.eavesly.pages.dev/dashboard/alerts/DEMO-MANAGER-FEEDBACK-20260926-TWO-CALL/full_qa?status=all): prior stages 1–5 complete; current-call consent and misleading-claim concerns remain.
- [Same follow-up without history](https://rubric-staging.eavesly.pages.dev/dashboard/alerts/DEMO-MANAGER-FEEDBACK-20260926-NO-HISTORY/full_qa?status=all): comparison showing the missing stages without credit.

All new examples are fictional, labelled synthetic and have no recording. Their alert-dispatch metadata is explicitly simulated to enter the existing review queue; no Slack message was sent. The earlier-call and future-sentinel rows are test inputs, not additional review alerts. The backend evaluator generated these sandbox examples, but has **not** been deployed to live ingestion.

## Screenshots

Synthetic-data captures of runtime `f7d2595`, built in staging mode against the isolated sandbox:

- [Desktop summary](screenshots/manager-feedback-f7d2595/desktop-summary.png)
- [Desktop coaching](screenshots/manager-feedback-f7d2595/desktop-coaching.png)
- [Mobile summary](screenshots/manager-feedback-f7d2595/mobile-summary.png)

Real-recording screenshots and credentials stay outside Git.

## Deployment receipt

Pending final browser suite and isolated Pages deployment. No production endpoint is a deployment target.
