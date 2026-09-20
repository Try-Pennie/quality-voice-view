# Recording timestamps — isolated staging proof

## Scope and review flow

This is **cached audio navigation, not production transcription activation**. The build flag `VITE_RECORDING_TIMESTAMPS=true` enables one scoped read when an internal alert opens. It never starts a transcription, sends customer data to a model, or writes a review. Default/production builds leave the flag off.

Open **View transcript**. A matching speaker turn has a **Play from here · m:ss** button that seeks and plays in one click. Its accessible name includes the saved speaker. The verified turn highlights only while playing within its own saved word interval; playback never scrolls the transcript. The same play buttons can appear beside saved QA quotes that meet the identical matching rules. Otherwise, a quote with a literal original-transcript match offers **Find in transcript**, which opens context and searches without starting audio.

- A phrase needs at least four words and one occurrence in both the original Regal transcript and Grok's timestamped words.
- No semantic/fuzzy matching or filler removal. Monetary signs, amounts and negation survive normalization.
- Labels are removed only by the existing conservative speaker parser; matching never crosses turns.
- Ambiguous, unavailable, invalid or mismatched recordings produce no audio link. A native-duration mismatch refuses playback from a timestamp. A click before metadata is ready asks the user to retry; it never queues surprise playback.
- Signing/refresh, ordinary playback, review drafts, keyboard shortcuts and other calls keep working. Going back to a call does not replay an old jump.

## Measured scope

The user approved **one** existing private staging recording for xAI processing on 2026-09-20. No bulk backfill or other real-call provider requests were performed.

The result contains 5,143 words over 2,799.987 seconds. Of 13 saved QA quote fields, three match Grok alone, but **zero match uniquely in both sources**. Their audio links therefore stay hidden; literal text matches can still offer transcript-only navigation. **125 of 521 original transcript turns** pass the stricter check. This proves useful turn-level navigation, not universal quote alignment or transcription accuracy. The estimated provider cost for this recording is about $0.078 at the published $0.10/audio-hour rate, not an invoice reconciliation.

Timing data is kept separately in `eavesly_recording_word_timestamps`. Authenticated users have no direct table privileges. The read RPC uses `internal_alert_actor_email` and `alert_visible_to`, excludes partner/disposition-only modules, requires `alert_sent`, and binds the result to the alert's current stored recording reference. Client parsing and a second reference check guard the playback boundary.

## Verification

Commands:

```sh
npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable
npm run build
npm test -- --workers=1 --reporter=line
VITE_RECORDING_TIMESTAMPS=false npm test -- tests/recording-placement.spec.ts --grep 'timing flag' --workers=1 --reporter=line
```

Browser checks cover one-click native playback, verified highlighting without scrolling, repeat clicks, literal transcript search/focus, late metadata without queued autoplay, return-to-prior-call state, cross-origin/native fallback, ambiguity in either transcript, invalid/stale data, server failure, duration mismatch, monetary signs/negation, mobile controls and flag-off zero-RPC behavior. Fixtures are synthetic. Hosted screenshots, transcripts, recording URLs and credentials stay private.

Actual staging SQL checks cover both reviewer roles, excluded/unknown calls, denial of direct table and anonymous access, duplicate claims, and invalid ready states. The existing 11 protected tables and Auth user count must match their pre-change hashes/counts; exactly one ready timing row is expected.

Supabase's [RLS-without-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [authenticated SECURITY DEFINER warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) are intentional for this private table/scoped RPC pair. Existing unrelated advisor findings remain out of scope.

Independent review: Claude Code Fable 5.1 approved the **cached staging UI** conditional on final-source tests and hosted verification. It did not approve backend activation. Runtime/test results and deployment identity are recorded in the PR follow-up.

## Gates still closed

- No production migration, merge, deployment or feature activation.
- No automatic timing backend deployed. Its separate backend branch is preparatory, with an at-most-once paid-send claim and a nonfatal workflow hook.
- Before automation: provision an isolated Worker with a gateway-scoped credential (never the broad operator token), bind its Workflow, verify scheduling on/off/failure paths, and approve activation.
- Before production: replay the final migration in a fresh representative database and review duplicate legacy transcript-row behavior. Isolated staging has no such duplicates; its RPC selects the latest row deterministically.
- Files over 25 MiB are intentionally not buffered by the Worker. They remain playable without timing. Chunking/streaming is not part of this proof.

Staging deploys must use the isolated staging build and CSP, with `VITE_RECORDING_TIMESTAMPS=true`; never push the isolated staging branch or deploy its ordinary production-mode artifact.
