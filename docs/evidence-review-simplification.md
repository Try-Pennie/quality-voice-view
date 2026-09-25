# Evidence review simplification — staging plan

Goal: managers can understand a finding, inspect its exact evidence, and respond without reading technical explanations.

Context: PR130 source-linked synthetic examples are live; the review rail still repeats trial, provenance, occurrence and navigation explanations.

In scope: simplify candidate finding/evidence presentation in `FullQaRubricReview` and its transcript navigation control in `AlertReviewDrawer`; remove duplicate source captions in `AlertTranscript` and correct candidate guidance in `TranscriptView`; progressive disclosure for optional candidate follow-up; browser regression checks; pinned staging deployment.

Out of scope: changing response identity or validation, SQL/schema/API changes, production deployment/merge, customer-call reprocessing, historical backfill, new audio timestamps, full QA scoring replacement, unrelated legacy redesign.

Done when:
1. Candidate findings show a plain-language assessment, clickable supporting passages, and independent optional feedback; technical context is under Details.
2. Scoped missing-content assessments remain clearly scoped to the supplied transcript, without invented quotes or navigation.
3. The overall verdict stays visible; comments and follow-up stay optional; existing saved responses, editing and clear behavior survive.
4. Desktop/mobile, keyboard navigation, legacy feedback and save/reload checks pass, with inspected captures.
5. The verified commit is deployed only to staging and linked for acceptance.

Verify: `npm run typecheck`, `npm run lint`, `npm run build`, focused source-evidence and existing feedback Playwright tests, `npm run test:browser:ci`, release/staging guards, hosted native staging checks and screenshots. No persistence contract changes: reuse the existing SQL validation and source identities.

Stop for any production requirement, ambiguous evidence associations, failed save/navigation safety checks, or inability to verify the isolated staging destination.

## Proposed selective backfill — not executed

1. Approve this presentation first. New-call production integration still needs a reviewed full-rubric contract; the six-rule experiment is not a replacement.
2. Inventory open, unreviewed alerts in a bounded date range. Exclude any alert with review history, an active review/approval, or an unavailable source. Dry-run a manifest with source hashes and reasons for exclusion before writes.
3. Trial a small explicitly approved batch against existing saved transcripts. Reuse saved findings only where their exact passages and claim associations can be verified; otherwise produce a separately versioned analysis for comparison. Do not silently substitute new conclusions into the old alert.
4. Validate exact source/turn links, omissions and claim-to-evidence identity, then have a manager compare the sample. Source/recording alignment is a separate task: no audio jump without verified timing.
5. Any eventual promotion must recheck eligibility and source/review revision atomically, preserve original source and review history, and keep old responses attached to their original evidence. Skip conflicts. A tested rollback and explicit production approval are prerequisites.
6. Expand only after sample acceptance and an agreed coverage/error threshold. Leave reviewed history untouched; unsupported old alerts keep the honest existing experience.

This UI change itself requires **no backfill or migration**. No manager responses are reassigned and no new AI calls are required.

## Review notes

Independent static review caught three issues before staging: the quote button's accessible name hid its text; a collapsed optional follow-up could hide a required explanation; and the saved-transcript cue disappeared on mobile. All are fixed and covered by browser assertions. The final review found no remaining actionable issues. Claude was unavailable due usage limits; the completed review used a separate OpenAI context (same family), not a cross-family review. The latter remains a production gate.

The candidate plus existing evidence-feedback focused run passed **8/8**. The new follow-up check exercises select → collapse → Continue review → focused explanation → save/reload → clear. No SQL or API contracts changed.
