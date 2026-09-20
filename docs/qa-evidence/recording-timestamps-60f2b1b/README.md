# Recording-jump verification

UI source commit: `60f2b1b` (PR #120 follow-up). Screenshots here are **synthetic only**, captured with the real browser/media player. Customer-backed hosted screenshots remain private.

- Final-source full Playwright run: **179 passed**, one worker, retries disabled, 10.6 minutes.
- Final-source flag-off check: **1 passed**, zero timing RPC calls.
- Focused seek/transcript screenshot replay: **1 passed**; keyboard, repeated click, mobile and return-to-prior-call behavior asserted.
- TypeScript, production build and changed-file lint passed. Repository-wide lint still has its pre-existing baseline; no claim that whole-repo lint is clean.
- An earlier in-progress full run had 178 passes and a history-observer failure while source files were being edited. The final-source history test passed individually, then the complete frozen-source run passed 179/179. No test retry setting was changed.
- Actual isolated-stage SQL checks: both reviewer identities can read the authorized cache; direct table/anonymous/excluded-module/unknown-call access denied; unique claim and ready-state constraints enforced.
- Hosted runtime: `a342e99`, immutable deployment `https://595e9361.eavesly.pages.dev`, alias `https://rubric-staging.eavesly.pages.dev`.
- Hosted browser: both roles saw **125** qualifying original-transcript jumps; first/last seek, paused/no-autoplay behavior, native playback and 375px layout passed; zero browser errors, review writes or provider requests.
- Existing 11 protected staging tables and Auth user count unchanged. One separately authorized timing-cache row added; original transcript/QA unchanged.

Independent review used **Claude Code Fable 5.1**, after Pi's Anthropic reviewer was blocked by usage limits. Cached staging UI approval is separate from backend activation, which remains blocked/off.

Reviewer steps: sign into private staging, open the approved sample, choose **Transcript and call summary → Inspect transcript context**, then use **Jump to m:ss** and press Play. Only exact unique matches in both transcripts receive buttons; unverified saved QA quotes intentionally do not.
