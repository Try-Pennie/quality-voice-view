# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Eavesly** — an internal Pennie tool (not consumer-facing) for sales managers to review Slack-flagged QA alerts on sales calls and capture structured feedback that improves the upstream QA model. Two audiences: managers clearing an alert queue (primary), and executives glancing at team rollups (secondary). The product *is* the review queue — optimize for clearing alerts fast. See `.impeccable.md` for the full design/brand spec and `kris-feedback-2026-04-29.md` for product context from the head of sales.

Vite + React 18 + TypeScript SPA, shadcn/ui (Radix) + Tailwind, TanStack Query for data, Supabase (Postgres + Auth + Edge Functions) as the only backend. Originally scaffolded by Lovable.

## Commands

```sh
npm run dev        # Vite dev server on port 8080
npm run build      # production build
npm run build:dev  # build with development mode (keeps lovable-tagger)
npm run lint       # eslint
npm run preview    # serve the built dist/
```

There is **no test suite** and no typecheck script. TS config is intentionally loose (`strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, unused-vars off) — type errors that would fail elsewhere pass here, so verify data-layer changes by running the app.

Supabase project is `miikotqnovnixpeqtqnd`. Migrations live in `supabase/migrations/`; the `supabase` MCP server is connected for running SQL / inspecting schema. The edge function is in `supabase/functions/migo-coverage/`.

## Architecture

### Routing & auth
`src/App.tsx` wires every route. All real pages live under `/dashboard/*`, each wrapped in `<ProtectedRoute>` (redirects to `/login` when unauthenticated) and `<DashboardLayout>`. Auth is Supabase Google OAuth via `src/hooks/useAuth.tsx` (`AuthProvider` context exposing `user`/`session`/`signInWithGoogle`/`signOut`). `src/pages/Index.tsx` is dead Lovable boilerplate — `/` redirects to `/login`.

### Data layer: hooks → query fns
The pattern is two layers:
- **`src/hooks/use-queries.ts`** — every `useQuery` lives here, one hook per fetch. This file owns the cache-key conventions and the only place to change caching behavior per-query.
- **`src/lib/*-queries.ts`** — plain async functions that call Supabase (`queries.ts`, `alert-queries.ts`, `team-queries.ts`, `notification-queries.ts`, `migo-queries.ts`). Hooks call these; components call hooks. Mutations (feedback, messages, acks) also live in the `lib/*-queries.ts` files and are invoked directly, then callers invalidate the relevant query keys.

The `QueryClient` (in `App.tsx`) sets `staleTime: 60s`, `gcTime: 10min`, and **disables** `refetchOnWindowFocus`/`refetchOnReconnect` — refetches happen on explicit invalidation, not focus. Don't re-enable focus refetch globally; it causes surprise reloads mid-review.

**Cache keys** are built from primitives, not live objects. `dateKey` uses `.getTime()`, `scopeKey` sorts `managedAgents` (the SELECT has no stable order), `alertFiltersKey` includes only *server-side* filters (date + module + status + accuracy). Status/search that are applied client-side must NOT go in the key. When adding a filter, decide whether it's server-side (goes in the key) or client-side (doesn't), and keep query-fn behavior consistent with that decision.

### Scope = the authorization model
`UserScope` (`{ email, isGodMode, managedAgents }`, from `fetchUserScope`) is the spine of access control. It's derived from two tables: `agent_manager_mapping` (which agents report to this manager) and `manager_coaching_prompts.is_god_mode` (sees everyone). Every team/alert query filters `.in('agent_email', scope.managedAgents)` unless god-mode. A manager with no mapped agents and no god-mode sees nothing — query fns return `[]` early on that condition. This client-side scoping is mirrored **server-side** in the `migo-coverage` edge function (it re-resolves scope from the JWT against the same two tables — never trust the emails the client sends).

### Supabase row caps — pagination is mandatory
PostgREST caps **every** response (and RPC result) at ~1000 rows regardless of `.limit()`. `src/lib/supabase-helpers.ts:fetchAllPaginated` pages through with `.range()` until a short page signals the end; use it for anything that can exceed 1000 rows (calls in a multi-day window, alert breakdowns, RPC results). `fetchTeamRollup` paginates the RPC manually for the same reason. Large `.in()` lists are also chunked (`fetchInBatches`, `fetchQASummaries`, batch size 300–500) to stay under URL/response limits.

### Team rollups via materialized view + RPC
Team/agent metrics do **not** aggregate raw calls client-side (that hit the row cap). Instead a materialized view `private.mv_agent_daily_metrics` pre-aggregates per `(agent_email, NY-calendar-day)`, refreshed by a pg_cron job. Clients call `SECURITY DEFINER` RPCs `team_daily_metrics` / `agent_daily_metrics` (which resolve scope server-side). `team-queries.ts` then folds those daily rows into `TrendPoint[]` buckets — day-granularity for ≤14-day windows, weekly above that. `compliance_pass_rate` is `null` (not 0) for empty buckets so charts render a gap, not a misleading 0%. When schema/metrics change, the MV definition in the migrations must be updated *and* the view refreshed.

### Timezone: everything is Eastern (ET)
All date filtering and bucketing happens in `America/New_York` so views are consistent regardless of where a manager sits (`src/lib/time-zone.ts`). Picker-state `Date`s carry the intended ET Y/M/D in their **local** components; `startOfBusinessDay`/`endOfBusinessDay` convert those to the absolute UTC bounds used in `.gte`/`.lte` filters. The MV buckets on `(started_at AT TIME ZONE 'America/New_York')::date` to match. Don't introduce naive `new Date()` range math — go through these helpers.

### URL-driven filter state
Filters (date range, selected agents) serialize into the URL via `src/lib/url-filters.ts` so a view is a shareable link. Uses local-time `YYYY-MM-DD` strings.

## Data model (key tables/views)

- `eavesly_calls` — one row per call (agent, timing, disposition, `sfdc_lead_id`). ~440k rows; never scan unscoped.
- `eavesly_transcription_qa` — QA scoring per call; the rich nested scorecards live in `qa_json` (typed as `QAJson` in `src/types/database.ts`): compliance / sales-process / customer-experience scorecards + coaching recommendations.
- `eavesly_module_results` → exposed via the **view `eavesly_alerts_with_feedback`** (joins agent→manager mapping + feedback + thread/ack counts). This view is what the alerts UI reads. There are **5 modules / violation types**: `full_qa`/`manager_escalation`, `budget_inputs`/`budget_compliance`, `warm_transfer`, `litigation_check`, `program_expectations`.
- `eavesly_alert_feedback` — one row per `(call_id, module_name)`, upserted (latest wins). `accurate` boolean; `action_taken` XOR `inaccuracy_reason` (DB CHECK enforces only one is set).
- `eavesly_alert_messages` / `eavesly_alert_acks` / `eavesly_notifications` — threaded discussion, acknowledgements, and the notification-bell feed (polled every 60s; no realtime wired up).
- `agent_manager_mapping` (+ `..._history` for date-aware "who was on X's team in February") and `manager_coaching_prompts` — the scope tables.

Label maps (`VIOLATION_TYPE_LABELS`, `MODULE_LABELS`, `ACTION_TAKEN_LABELS`, `INACCURACY_REASON_LABELS`) and `result_json` evidence extractors live in `alert-queries.ts`.

## Conventions & gotchas

- **`const sb = supabase as any`** appears in the query libs deliberately. `src/integrations/supabase/types.ts` and `client.ts` are **autogenerated — do not hand-edit**, and they lag behind migrations that add tables/views (e.g. the alert-feedback view). Casting to `any` at the call site is the accepted workaround until types are regenerated. Don't "fix" these casts by editing the generated files.
- Path alias `@/` → `src/` (Vite + tsconfig). shadcn/ui primitives are in `src/components/ui/` (generated by the shadcn CLI; `components.json` configures it) — treat them as vendored.
- **Design is brand-locked, light-mode only.** Follow `.impeccable.md` (Pennie tokens: PP Mori type, beige/navy neutrals, blue default accent, pill radii, no dark mode, no glassmorphism). Don't reach for shadcn-default grays or add a dark theme.
- This repo round-trips with Lovable: `build:dev`/dev runs `lovable-tagger`, and edits made in Lovable auto-commit here. The Supabase anon key is intentionally inlined in `client.ts` (it's the public anon key, RLS-gated).
