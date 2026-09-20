# Private recording previews

Call and alert details resolve `storage://review-sample-recordings/<32 hex characters>.mp3` through the current Supabase session. Storage's SELECT policy authorizes signing; the browser never receives a service key. Existing recording URLs are unchanged.

Signed URLs live only in the open page/query state, not in database rows, logs, fixtures, or exports. They are bearer links valid for three hours: enough for the sample's two-hour recordings plus review/seek time. Do not share them. Reopen the alert or reload the call to obtain a fresh URL after expiry. Signing failures stop detail loading rather than falling back to public storage.

The hosted sample is staging-only. Before importing customer content, verify:

- Private bucket; only the designated preview reviewers can sign/read; no authenticated uploads.
- Anonymous and unrelated authenticated sessions cannot read REST tables/views/RPCs, GraphQL, or private recordings.
- No outbound integrations, automated model evaluations, or Realtime publication of sample tables.
- Production is read-only during copying. Existing staging reviews remain untouched; imported calls start with no human review.
- Preserve original AI results, transcripts, and call times. Pseudonymous rep/contact labels and staging ownership must be disclosed as preview metadata, not historical manager attribution.
- No transcripts, recordings, customer identifiers, credentials, or access URLs in Git/PR artifacts. Keep any production-backed screenshots private.

The isolated staging project additionally uses a PostgREST pre-request allowlist (including inherited security-definer views), restrictive table-RLS backstops, and a separate Storage policy. That environment configuration is **not a production migration**. Its deployment CSP allows media only from the isolated Supabase project.

A separately approved 2026-09-20 exception permits one existing staging sample to be processed by xAI Grok through Cloudflare Gateway BYOK for timestamp evaluation. That operator-run proof does not enable integrations, browser-triggered transcription, other samples, backfill, or production processing. The original transcript and QA remain untouched; only the scoped timing cache is added. See [recording timestamp staging proof](recording-timestamps.md).

Verification: `npx playwright test tests/private-recording.spec.ts tests/recording-placement.spec.ts`. These use synthetic HTTP fixtures; hosted real-data playback and authorization checks are separate private operational checks, not an AI-accuracy evaluation.
