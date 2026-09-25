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
