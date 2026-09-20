# Recording timestamps — isolated staging proof

## Scope and review flow

This is **cached audio navigation, not production transcription activation**. The build flag `VITE_RECORDING_TIMESTAMPS=true` enables one scoped read when an internal alert opens. It never starts a transcription, sends customer data to a model, or writes a review. Default/production builds leave the flag off.

Open **Transcript and call summary → Inspect transcript context**. A matching speaker turn has a **Jump to m:ss** button. It moves the existing player without auto-playing; press Play to listen. If already playing, playback continues from the chosen time. The same links can appear beside saved QA evidence when it meets the identical matching rules.

- A phrase needs at least four words and one occurrence in both the original Regal transcript and Grok's timestamped words.
- No semantic/fuzzy matching or filler removal. Monetary signs, amounts and negation survive normalization.
- Labels are removed only by the existing conservative speaker parser; matching never crosses turns.
- Ambiguous, unavailable, invalid or mismatched recordings produce no jump link. A native-duration mismatch refuses the seek.
- Signing/refresh, ordinary playback, review drafts, keyboard shortcuts and other calls keep working. Going back to a call does not replay an old jump.

## Measured scope

The user approved **one** existing private staging recording for xAI processing on 2026-09-20. No bulk backfill or other real-call provider requests were performed.

The result contains 5,143 words over 2,799.987 seconds. Of 13 saved QA quote fields, three match Grok alone, but **zero match uniquely in both sources**. Their links therefore stay hidden. **125 of 521 original transcript turns** pass the stricter check. This proves useful turn-level navigation, not universal quote alignment or transcription accuracy. The estimated provider cost for this recording is about $0.078 at the published $0.10/audio-hour rate, not an invoice reconciliation.

Timing data is kept separately in `eavesly_recording_word_timestamps`. Authenticated users have no direct table privileges. The read RPC uses `internal_alert_actor_email` and `alert_visible_to`, excludes partner/disposition-only modules, requires `alert_sent`, and binds the result to the alert's current stored recording reference. Client parsing and a second reference check guard the playback boundary.

## Verification

Commands:

```sh
npx tsc --noEmit -p tsconfig.app.json --lib ES2021,DOM,DOM.Iterable
npm run build
npm test -- --workers=1 --reporter=line
VITE_RECORDING_TIMESTAMPS=false npm test -- tests/recording-placement.spec.ts --grep 'timing flag' --workers=1 --reporter=line
```

New browser checks cover native seeking, no autoplay, repeated clicks, transcript links, return-to-prior-call state, ambiguity in either transcript, invalid/stale data, server failure, duration mismatch, monetary signs/negation, mobile controls and flag-off zero-RPC behavior. Fixtures are synthetic. Hosted screenshots, transcripts, recording URLs and credentials stay private.

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
