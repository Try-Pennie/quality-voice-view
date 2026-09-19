# Final review polish — September 19, 2026

Implementation: `f685bdb4824dc12f86c76aa76f87665dc40965cc` plus keyboard-filter follow-up `5ae8e91fac1d67f0060138bfbf0a2819c7747f5a`, on PR #120's existing `7504827` base. This refines the current review flow rather than redesigning it. PR #119/#120 were not merged or rebased; the existing base-sync gate still applies before merging.

## Before / after

| Location | Before | After |
| --- | --- | --- |
| `src/components/alerts/AlertReviewDrawer.tsx:246` | Native selects could trigger J/K navigation; Full QA Y/N changed hidden generic state. | Selects keep their keyboard input; Full QA ignores generic verdict shortcuts. Working navigation and save shortcuts remain. |
| `src/lib/alert-queries.ts:86,679`; `src/pages/AlertsPage.tsx:1317` | Queue preview only described the call outcome. | Three scalar JSON projections supply **Why flagged** without full payloads, extra queries or migrations. Reviewed Full QA uses clearly labelled saved **Manager review**, never a newer AI assessment; missing/system reviews use **Call summary**. Detail-refresh cache fallback is tested. |
| `src/components/alerts/AlertReviewDrawer.tsx:638` | Duplicate type title and stacked identity details consumed fixed height. | Compact type/date/controls and agent/customer header, with accessible title and help retained. Full-width recording/player unchanged. |
| `src/components/alerts/FullQaRubricReview.tsx:360,535` | Adding a finding jumped away from evidence; blank findings hid required criteria. | Add stays at the criterion; Edit explicitly opens the issue. Blank issue criteria open immediately and remain open through multiple selections. |
| `src/components/alerts/FullQaRubricReview.tsx:547` | Explanation appeared before a verdict. | Verdict first; No reveals reason then explanation; Yes retains the paired What happened / What action inputs. Switching preserves drafts. |
| `src/components/alerts/FullQaRubricReview.tsx:69,454,522` | Permanent counters and repeated labels added reading noise. | Counters appear for invalid/near-limit text; descriptions remain accessible. Shorter Result/Evidence labels and quieter legacy-reference notice; unknown-hash warning stays prominent. |
| `src/components/alerts/AlertReviewDrawer.tsx:768` | Absolutely positioned hidden descriptions could enlarge and scroll the outer dialog. | Positioning the inner scroll container keeps all hidden labels inside it, including Discussion. Header, player and footer remain fixed. |
| `src/pages/AlertsPage.tsx:793,938`; `src/pages/TeamPage.tsx:507` | Repeated scope text, expanded workload counts and wrapping filters crowded mobile work. | Outstanding / Date range controls, one scope indicator, optional workload counts, compact keyboard-scrollable Team filters and secondary AI metrics below representative outcomes. |
| `src/components/alerts/AlertReviewDrawer.tsx:1033`; `src/pages/HelpPage.tsx:209` | Generic and Full QA alert verdicts used different terms. | Warranted / Unnecessary across shared reviews, validation and shortcut help; distinct coaching findings remain separate. |
| `src/pages/AlertsPage.tsx:1324`; workload/reviewer/representative count components | Zero counts looked actionable. | Muted, non-clickable zeros; nonzero drilldowns remain. |
| `src/components/ui/sheet.tsx:60` | Generic reviews used slower, darker stock sheets. | Review-only navy/40 scrim and 220ms pointer entrance; keyboard, deep links, next-call and reduced-motion paths stay instant. Other sheets retain their behavior. |

No scoring-policy, validation-boundary, source/revision-lock, authorization, production schema, recording-spectrum or approval-flow changes. No dependencies added. Broad row-nowrap/name-lookup changes, duplicate raw-JSON cleanup and unrelated animation-class cleanup were deliberately left out.

## Independent review

Actual Claude Code **Fable 5.1**, high effort, in Noah's user-opened Herdr pane, reviewed the diff read-only in multiple passes. Its criteria-picker collapse and system-note attribution findings were fixed; validation/help vocabulary was aligned. Its follow-up found the same hidden-label overflow risk in Discussion, addressed by the shared scroll-container fix. Final review: no remaining blockers/high findings; optional one-line counter layout shift accepted. Workload bucket totals remain behind a disclosure because coaching overlaps and a summed total would mislead.

The hidden-label check was demonstrated sensitive: removing only the positioning class in the browser changed outer scroll height **646 → 3,281px**; restoring it returned to **646px**. Five-width tests also check fixed Back/Close controls and zero outer scroll, including an unsent Discussion draft. A final visual check exposed a partially clipped, keyboard-focused Team filter; a native `scrollIntoView({ block: 'nearest', inline: 'nearest' })` fixes it. The strengthened test requires **100%** viewport intersection, not merely partial visibility.

## Verification

- Fresh final-source `npm test -- --workers=1 --reporter=line`: **168 passed, 8.6m, exit 0**. Eight focused regressions also passed in 1.8m.
- Production-mode build, ES2021 application TypeScript, staging TypeScript, `git diff --check`, staging build-seam checks and actual isolated staging build passed. Final staging runtime source: `212678fe537aeeed39c187971f3ab2909d4cc8ef`; its application/tests differ from `5ae8e91` only in the existing isolated login/client files.
- Changed UI/test files lint clean. Full lint retains **45 errors / 6 warnings**. The seven pre-existing errors in the two touched legacy type/query files were compared against the old source and are identical; no lint rules were disabled.
- Actual staging PostgREST accepted the three scalar aliases under native manager authentication, returning no full JSON/media fields. The deployment artifact excludes the password, synthetic build key and production project ref/key; stage-only CSP/privacy headers and a private SHA256 manifest are prepared.
- Earlier runs exposed obsolete global text locators (reason text now also appears in the queue) and tests that filled fields before choosing a verdict. Those now follow the intended UI without relaxing validation or save assertions. One concurrent media timing failure preceded the clean final single-worker run; no media assertions/timeouts were weakened.

### Commit-pinned synthetic screenshots

Captured from `5ae8e91fac1d67f0060138bfbf0a2819c7747f5a`, with intercepted synthetic fixtures only. [Machine-readable evidence](qa-evidence/final-polish-5ae8e91/verification.json).

- [Compact review entry at 1366×768](qa-evidence/final-polish-5ae8e91/polished-review-entry.png)
- [Mobile queue](qa-evidence/final-polish-5ae8e91/polished-mobile-queue.png)
- [Manager fields and fixed controls at 320px — unsaved verdict-switch test](qa-evidence/final-polish-5ae8e91/polished-form-320.png)
- [Team on mobile, including a fully visible keyboard-focused filter](qa-evidence/final-polish-5ae8e91/polished-team-375.png)
- [Team desktop](qa-evidence/final-polish-5ae8e91/polished-team-1440.png)
- [Kris summary and approval controls on mobile](qa-evidence/final-polish-5ae8e91/kris-summary-375.png)

Hosted customer-backed captures and credentials remain private. Physical Safari/iPhone and assistive-technology speech are not certified by these Chromium checks. Production rollout, PR merge/base synchronization, and backend/model-quality work remain separate approval gates.
