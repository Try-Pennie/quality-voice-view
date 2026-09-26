# Interrupted evidence and chat transcript — staging contract

Goal: managers can jump to the reported saved handling-agent quote across customer interruptions, while reading clearly separated chat-style speaker turns.

Base: `bea432e`, PR #130. Reported staging call: REAL-REVIEW-001. Read-only diagnosis: original transcript splits the saved sentence into three handling-agent turns around two customer acknowledgments; existing timed recording has the complete quote contiguously. Current original-source matcher rejects it.

Scope: shared exact speaker-aware evidence matching and original offset mapping; Full QA source/jump wiring; transcript agent-right/contact-left bubble presentation; associated tests. Retain authoritative raw text, chronological DOM order, speaker labels, unknown/raw fallback, existing literal search, selected occurrence identity, and playback revision checks.

Non-goals: fuzzy/semantic matches, inferred speaker roles, dropping same-speaker words, guessed timestamps, transcript/QA rewrites, database migrations/backfill/provider processing, production or merging.

Done when:
1. The reported interrupted quote has Find and verified Listen in staging; each source fragment highlights without hiding intervening customer turns.
2. Unsupported, ambiguous, wrong-speaker, changed-number/negation, or wrong-revision matches still cannot manufacture Listen actions.
3. Handling-agent turns align right, contact turns left, with accessible branded chat bubbles; transcript order/search/playback/mobile behavior remain intact.
4. Focused and broader browser/type/build checks pass, with synthetic source-pinned screenshots and independent read-only review.
5. Isolated staging deploy and hosted read-only check of the actual reported quote pass; PR/Slack receipt shared.

Verification: typecheck, lint, build; browser tests for transcript matching, timestamp safeguards, source highlight/return, evidence feedback, mobile/contrast; guarded deploy:staging; hosted exact reported quote native playback plus offset/turn highlighting. Stop if safe support requires fuzzy matching, new timestamps, data mutation, or production changes.
