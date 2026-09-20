# Paired manager inputs for warranted alerts

Live restricted staging: **https://rubric-staging.eavesly.pages.dev/login** — same password. Save/discard any draft before refreshing. Choose Manager, open a Full QA alert, and select **Yes, the alert was warranted**.

Runtime `42fdcad3cc4aeb6cbb5b93a84ad24600a07bcfca`; immutable https://081d4d2b.eavesly.pages.dev. Source UI `2b263f49615f2e0a64f9172deb97265b5168c102`, draft-guard follow-up `a04e9bdead7e368ec8f7b72620a5a630074f9ff4`. Staging branch stays local/unpushed. Production is unchanged; no merges.

## What changed

| Before | After | Why |
| --- | --- | --- |
| “Explain your decision” and a separate follow-up section | Action-choice pills, then **What happened?** and **What action did you take?** together | Matches the requested two-input reference without asking for extra data |
| Small generic textareas | Two full-width, rounded, 112px-minimum inputs with required markers and specific placeholders | Makes the issue and the manager's response distinct |
| Generic saved-outcome labels | Matching issue/action labels for warranted reviews in Kris's summary | Both answers remain independently visible |
| History guard loaded inside the lazy review route | Eager initialization before the router mounts | Cancelled browser navigation cannot transiently unmount the draft |

The two answers reuse `escalationReason` and `actionDetails`; no schema/API change or new fields. Existing 12–4,000-character validation, explicit findings, rubric thresholds, source/revision/decision locks and unnecessary-alert flow are preserved. An unnecessary alert can still retain coaching findings and follow-up. Answers and action survive verdict changes. No preselected action or automatically invented issue. Recording, full-width visualizer and motion are unchanged. Numbered shortcuts and quick-start text were not added.

## Evidence

- Focused paired-input suite: **3 passed**; new required-input expectation failed before implementation.
- Final full suite: `npm test -- --workers=1` — **161 passed, 8.5m, exit0** on final application source.
- History protection: strengthened real-browser event check failed before the eager import; **12/12 repeats passed** afterward. Original URL/draft assertions remain. No retries/timeouts weakened.
- App/staging TypeScript with ES2021 DOM libraries, all seven changed source/test files ESLint, `git diff --check`, production build (28.63s), staging build-seam, actual private staging build and password exclusion passed. Existing Browserslist/chunk-size warnings remain.
- Compiled production/staging entry inspected: guard listener registration precedes root render.
- Actual Claude Code Fable5.1 read-only reviews: no blockers for paired inputs or final eager-import fix. Parent owns runtime evidence.
- Native hosted browser: both authenticated roles; keyboard action selection; 1440/375/320px fields; verdict-switch retention; cancelled browser Forward and close preserve both answers; explicit discard works; Kris sees existing persisted answers. Zero browser errors/review writes.
- All existing staging call/result/transcript/QA/review/revision/decision/notification/message/ack/proposal hashes and user count unchanged. No reseed or saved test review.
- Stable/immutable HTTP200; stage-only CSP/media host, noindex, no-store and no-referrer verified. No password, Auth, data-policy, scoring or production changes.

### Earlier failure, not hidden by the final pass

The first broad run passed160/161 but exposed an existing generic-alert Back/Forward draft-loss race. Lazy loading invalidated the guard's old assumption that its listener was registered before the router. An intermediate `capture:true` hypothesis failed real Chromium (including12/12 strengthened checks), despite initial source-review approval; it was discarded and never deployed. The final fix eagerly imports the unchanged guard from `main.tsx`. The reviewer withdrew the capture approval and approved the actual eager-import solution after inspecting its independent RED→GREEN evidence. The final161 pass includes this fix.

## Synthetic screenshots

UI source pinned to `2b263f4` (unchanged by the later guard fix); synthetic HTTP fixture only, no customer content:

- [Desktop](qa-evidence/two-inputs-2b263f4/followup-1440.png)
- [375px](qa-evidence/two-inputs-2b263f4/followup-375.png)
- [320px](qa-evidence/two-inputs-2b263f4/followup-320.png)

Hosted screenshots remain private. Physical Safari and screen-reader speech were not tested. No new native database write lifecycle was necessary for this presentation-only field mapping.

PR120 still needs an explicitly approved base sync against PR119 before merge; this task does not bypass that gate or change reporting PR119.
