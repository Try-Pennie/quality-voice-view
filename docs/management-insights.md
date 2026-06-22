# Management Insights (Sales Floor Insights) report

A print-friendly weekly management report at `/dashboard/insights` ("Insights"
in the top nav). It tells a manager where the floor stands this week, how it
moved week-over-week (WoW) and against the trailing month, and who to coach
next.

## What it shows

- **Headline KPIs** — volume-weighted compliance pass rate, high-CSAT share,
  escalation rate, and call volume for the week, each with a WoW delta pill.
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
  `team_daily_metrics` MV (paginated; scoped to `scope.managedAgents` unless
  god-mode).
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
- `src/hooks/use-queries.ts` — `useInsightsReport(scope, week)`.
- `src/pages/SalesFloorInsightsPage.tsx` — the page + its section components.

## Print / PDF

The "Print / PDF" button calls `window.print()`. The app header, the
week/print controls, and hover styling are hidden in print via Tailwind
`print:hidden`; cards use `break-inside-avoid`. No PDF library is involved —
use the browser's "Save as PDF".
