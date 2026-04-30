# Kris (Head of Sales, Pennie) — Eavesly Dash Feedback

**Date:** 2026-04-29
**Context:** Walkthrough of the new Eavesly Dash. Kris was reviewing on mobile mid-call, then on desktop. Goal: replace the current Slack-based review workflow.

---

## Current workflow Kris is replacing

- Managers review alerts in Slack (paragraph-style comments, ✅ to mark reviewed).
- Expectation: managers review and provide feedback within 24 hours.
- Kris reviews everything himself after-hours ("lay on the couch at midnight on my phone, listen to the files").
- Slack flow has been getting messy — hard to find untagged items, some managers miss the 24h SLA.
- Kris told managers to do **both** Slack and Eavesly until the new dash is ready.

---

## Feature requests

### Review workflow
- **Director / secondary-manager review layer** — Kris (above the assigned manager) needs to add his own review on top of theirs without overriding. Currently the only action available is overriding the manager's review.
- **Comments / additional notes** field on alerts that have already been reviewed.
- **Structured comment fields** instead of free-form paragraph. Slack reviews have inconsistent quality — example complaint: comment was just "addressed 428" with no detail on validity, action, or context. Required fields Kris named:
  - Was the alert valid? (false alarm vs. real)
  - What action was taken
  - Details / context
- **Reviewed-only checkbox** — for the majority of alerts where Kris agrees and has nothing to add, he wants a quick "reviewed, acceptable" mark with no comment required.
- **Notification loop to the agent** when Kris comments. For escalations specifically, he wants the agent to acknowledge / respond ("repeat what I said back, or write it down").
- **Approval flow on manager comments** — Kris wants to approve/respond to the assigned manager's feedback before it closes.

### Mobile
- Audio playback works on mobile (confirmed live). ✅
- Navigation is broken: got stuck on an alert detail page with no visible back button, had to zoom the phone out to find an X in the top right.
- General mobile polish needed — Kris wants to replicate his Slack-on-phone-from-the-couch flow.

### Date range
- 30-day cap is fine, but currently selecting >30 days slows page refresh.
- **Default to 30 days; allow user to manually extend past that** ("that's on me if I want to wait"). Don't silently change the range.

### Team / drill-down view
- Add **Total Alerts** column (not just Open Alerts) per agent in the team drill-down.
- Add **Calls Reviewed** column per agent — column appears to exist but data isn't populating.
- Support **company-wide ranked agent list** (descending alerts in time period) without needing to filter by team. Noah confirmed this works if you don't filter — defaults to most compliance issues.
- Group alerts **by manager** over rolling windows (last week / last month). Confirmed this is on the Team tab.

### Glossary / definitions
- Kris didn't know what CSAT meant; asked how Compliance % is calculated.
- Noah has a dictionary of terms — surface it in the UI (tooltips or a definitions panel).

---

## Bugs / data discrepancies to investigate

These came up while Kris was running historical date ranges and comparing to a spreadsheet Brian had pulled previously.

- **Agent counts way too low.** February shows 56 agents reporting; they had ~85–90 agents that month.
- **Bobby's team shows only ~7 agents in February** — should be 15–16. Likely agents deleted from Regal aren't being mapped. Noah to investigate.
- **Dugan's team historically had significantly more alerts than other teams** in Brian's spreadsheet; new dash doesn't reflect that. Brad now showing on top instead.
- **Enrique showing 1,111 compliance issues in February** — Kris flagged as suspicious. Likely a column-mapping issue (calls vs. issues). Noah to investigate.
- **"Calls" column is not pulling data.** Needs fix.
- **Manager-to-agent assignments** — Kris noted these were stale; Noah confirmed an update was just rerun manually (normally Sunday based on Regal). Should now be accurate going forward.

---

## Positive signals

- "This thing is actually something I really like."
- Mobile audio playback worked first try.
- Likes team breakdown view.
- Likes the feedback loop concept (manager feedback feeding the model to improve accuracy over time).
- "Much better organization" than the Slack flow.

---

## Commitments / next steps

- **Noah:** ship the changes above by Thursday/Friday.
  - Director/secondary review layer
  - Comments + structured fields on alerts
  - Reviewed checkmark + agent notification on comment
  - Mobile back-nav fix + general polish
  - Default date range to 30 days
  - Total Alerts + Calls Reviewed columns in drill-down
  - Investigate agent-count discrepancy (Bobby's team, Feb totals)
  - Investigate Enrique 1,111 number / Calls column not pulling
- **Demo at all-manager meeting:** Friday 1:30 PM Pacific (9:30 PM London). Noah to attend if possible — Q&A + walkthrough format.
- **Daily syncs:** ~8:30 AM Pacific going forward.
- **Next 1:1:** tomorrow morning (Kris's log-on time) to walk through the review/approval flow specifically.
