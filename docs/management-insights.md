# Management Insights (Sales Floor Insights) report

A print-friendly weekly management report at `/dashboard/insights` ("Insights"
in the top nav). It tells a manager where the floor stands this week, how it
moved week-over-week (WoW) and against the trailing month, and who to coach
next.

## What it shows

- **Headline KPIs** — volume-weighted compliance pass rate, high-CSAT share,
  escalation rate, and call volume for the week, each with a WoW delta pill.
- **Weekly action queue** — a deterministic, priority-ordered (high → low) list
  of concrete management actions for the week, rendered near the top (after the
  KPI/WoW strip, before the action-insight cards). Where the insight cards
  describe *what moved*, the queue says *what to do next*. See below.
- **Action insights** — deterministic cards (compliance/escalation/CSAT moves,
  watchlist size, rising alert modules, volume swings) generated from the
  metrics. No card asserts a cause; copy is directional.
- **Coaching watchlist** — agents (≥5 graded calls) flagged on low compliance,
  high escalation, soft CSAT, a sharp WoW compliance drop, or unreviewed
  alerts, with the reasons per agent. Rows link to the agent profile.
- **Top performers** — highest compliance among agents with ≥5 graded calls.
- **Alert & module pressure** — violations by module this week vs the
  trailing-month weekly average, with a "rising" flag.
- **Caveats footer** — window, timezone, and the "AI signals are directional"
  disclaimer.

## Weekly action queue

A deterministic list of management actions generated from the same aggregate
metrics as the rest of the report — no extra data source, no LLM narrative, no
persistence/status tracking. Each action carries a `priority`
(high/medium/low), a `category`, a title, a "why it matters" detail, a
recommended `action`, and an optional in-app `link` (agent profile or the
alerts page). The list is sorted high → low.

Actions generated, in build order:

1. **Review** — clear the unreviewed-alert backlog *before* coaching, so
   conversations sit on confirmed issues, not raw model flags. High priority at
   ≥10 open, otherwise medium. Links to the alerts page.
2. **Coach** — one action per agent for the top **three** coaching-watchlist
   entries (the watchlist itself is already prioritized). High priority when an
   agent is deep below compliance (<75%) or flagged on ≥3 signals, else medium.
   Links to the agent profile.
3. **Recognize** — celebrate the top performer, but only when they're genuinely
   strong (≥85% compliance) so praise stays credible. Low priority. Links to the
   agent profile.
4. **Validate** — sanity-check the single biggest *rising* alert module before
   treating it as a real trend (it could be a model shift), ahead of any team
   refresher. Medium priority. Links to the alerts page.
5. **Coverage** — flag thin graded-QA coverage (no graded calls, <5% of calls
   graded, or <10 graded calls team-wide) so the manager reads the week's rates
   as low-confidence.
6. **Maintain** — if nothing above fires, a positive maintenance action so the
   queue is never empty on a steady week.

The queue is **manager-safe**: it is built only from counts and rates the
manager is already cleared to see (no transcripts, customer PII, recordings, or
evidence quotes), and the copy repeats the directional-signal caveat —
AI/QA signals should be validated on a real call before coaching. Manager
scoping is inherited unchanged from the report: a regular manager's queue only
references their direct reports; god-mode sees all teams.

## Windows

All windows are Mon–Sun business weeks in **America/New_York**.

- **Current** — defaults to the previous *complete* week. Override with
  `?week=YYYY-MM-DD` (snapped to that week's Monday). The Previous/Next-week
  buttons and "Jump to latest" drive this param.
- **Prior** — the week before current (for WoW).
- **Baseline** — the 4 complete weeks before current (trailing-month / MoM-ish).
  Rates are computed volume-weighted over the whole window; volume comparisons
  use the per-week average.

## Data + privacy

The report is **aggregate-only**. It is built entirely from two existing
aggregate-safe sources, called across the three windows in
`fetchInsightsReport`:

- `fetchTeamRollup` — per-agent rollups + daily-metric trend buckets from the
  `team_daily_metrics` MV (paginated). **A regular manager sees only their
  mapped direct reports**; god-mode / super-admin users see all teams. In
  addition to the existing server/RLS scoping expectations for the RPC, the app
  now applies a defensive client-side filter (`filterDailyRowsToScope`) that
  drops any row outside `scope.managedAgents` for non-god users before
  aggregation — so KPIs, the watchlist, and top performers cannot include
  agents from another team if a broader row set reaches the client.
  Zero-activity direct reports are still surfaced (added back from
  `scope.managedAgents`), and display-name backfill is limited to in-scope
  agents.
- `fetchAlertBreakdown` — per-module/agent violation counts (paginated,
  suppressed modules excluded). For this report, manager-reviewed inaccurate
  alerts (`accurate=false`) are also excluded so overturned alerts do not keep
  driving coaching/module-pressure trends.

It does **not** read or render transcripts, customer names/phones, recordings,
transcript links, call summaries, or verbatim evidence. Agent/manager emails
appear only as internal coaching identifiers, behind auth. Query errors
propagate so the page fails visibly (`ErrorState`) rather than rendering a
false-clear report.

## Code

- `src/lib/insights-queries.ts` — window helpers, deltas, aggregation,
  watchlist/top-agent/module-pressure builders, insight generation
  (`buildInsights`), and `assembleReport` / `fetchInsightsReport`. The
  builder/aggregation/window functions are pure.
- `src/lib/insights-action-queue.ts` — `buildActionQueue` + the `ManagerAction`
  type. Pure and dependency-free (imports only *types* from
  `insights-queries`), so it carries no data/supabase code and is unit-checkable
  in plain node. `assembleReport` calls it and adds `actionQueue` to the report.
- `src/lib/insights-action-queue.check.ts` — runnable assertions for the queue
  builder (`npx tsx src/lib/insights-action-queue.check.ts`). No test runner
  required.
- `src/hooks/use-queries.ts` — `useInsightsReport(scope, week)`.
- `src/pages/SalesFloorInsightsPage.tsx` — the page + its section components.

## Print / PDF

The "Print / PDF" button calls `window.print()`. The app header, the
week/print controls, and hover styling are hidden in print via Tailwind
`print:hidden`; cards use `break-inside-avoid`. No PDF library is involved —
use the browser's "Save as PDF".
