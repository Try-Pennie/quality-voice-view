# Reliability & State-Clarity Pass — Design

**Date:** 2026-06-04
**Status:** Approved (design); pending implementation plan
**Scope:** Make every data-fetching surface honest about its state (loading / error / empty / data), and move notifications from 60s polling to realtime.

---

## Problem

Eavesly's read query functions swallow Supabase errors at the source. Every read fn in `src/lib/*-queries.ts` does:

```ts
const { data, error } = await q
if (error) {
  console.error('Error fetching alerts:', error)
  return []        // <-- error becomes an empty success
}
```

Because the fn returns `[]`/`null` instead of throwing, React Query never sets `isError`. The query "succeeds" with no data, and pages — which only check `isPending` — render an ordinary empty state. A manager on a 24-hour review SLA who sees an empty alerts list cannot distinguish **"nothing to review, I'm done"** from **"the fetch broke."** They close the tab believing the queue is clear. This is a correctness/trust bug, not cosmetics.

Secondary gaps in the same theme (the user always knows what state the UI is in):

- Loading states are inconsistent — only `AlertsPage` has a real skeleton; `CallDetailPage` / `AgentProfilePage` / `TeamPage` use bare spinners or "Loading…" text.
- Empty states are bespoke inline strings duplicated across ~3 components, visually indistinguishable from where an error would appear.
- Notifications poll every 60s with no realtime, so a reply can be up to a minute stale and the unread badge lags.

Mutations are **not** part of the problem: they already return `{ ok, error }` and components already `toast.error` on `!ok` (see `AlertReviewDrawer.tsx`). This pass touches **read** queries and notification transport only.

## Goals

1. Every read query can be in exactly one of four honest states: **loading / error / empty / data** — and the UI renders a distinct treatment for each.
2. No fetch failure is silent. Primary treatment is an inline, retryable error state; a global toast is the backstop.
3. Notifications update in ~1–2s via realtime, with a slow poll as a safety net.

## Non-goals

- Reworking mutation error handling (already adequate).
- Changing cache-key conventions, `staleTime`, or scope/authorization logic (`scopeKey`, `alertFiltersKey`, `dateKey` are untouched).
- Realtime for anything other than notifications (alerts/threads stay on explicit invalidation).

---

## Approach (selected: A — throw at source, render at edge)

Rejected alternatives:
- **B (global-only):** add a global toast + top-level error boundary, leave fns returning `[]`. Doesn't fix the root cause — the dangerous empty-list misread persists after the toast disappears.
- **C (sentinel returns):** return `{ data, error }` from every fn and thread it through hooks. Reinvents what React Query already provides via `isError`; massive churn.

A is the only option that structurally eliminates the silent-empty misread, and it leans on machinery already present (`retry: 1`, `staleTime`, sonner `<Toaster>`).

---

## Design

### 1. Data layer — errors throw, deliberate empties stay

In every `src/lib/*-queries.ts` **read** fn, on a genuine Supabase error:

```ts
const { data, error } = await q
if (error) {
  console.error('Error fetching alerts:', error)
  throw error            // was: return []
}
return (data ?? []) as Alert[]
```

**Preserve intentional empties** — these are "no data," not failure, and keep returning `[]`/`null`:

- scope short-circuits: `if (!scope.isGodMode && scope.managedAgents.length === 0) return []`
- argument guards: `if (!email) return []`
- In paginated/chunked helpers (`fetchAllPaginated`, `fetchInBatches`, `fetchTeamRollup`'s manual RPC paging): if **any** page or batch errors, the whole fn throws. This also removes today's silent partial-truncation risk, where a failed page past the first could quietly drop rows.

Affected files: `alert-queries.ts`, `team-queries.ts`, `queries.ts`, `notification-queries.ts`, `migo-queries.ts`, and the helpers in `supabase-helpers.ts`. Mutations in these files are left unchanged.

### 2. Shared state components

New brand-locked primitives (per `.impeccable.md`: Pennie tokens, light-mode, pill radii — no shadcn-default grays, no dark theme). Location: `src/components/states/` (or `src/components/ui/` to match existing convention — decide in plan).

- **`<ErrorState>`** — icon + "Couldn't load {thing}." + a **Retry** button wired to the query's `refetch`. A `compact` variant for in-card use (e.g. call-detail alerts section, agent alerts panel).
- **`<EmptyState>`** — icon + a contextual message passed per usage (`"No alerts in this view."`). Visually distinct from `<ErrorState>` so the two are never confused.
- **Skeleton set** — reusable shapes on top of the existing `skeleton.tsx` primitive: `<TableSkeleton rows cols>`, `<CardSkeleton>`, `<ChartSkeleton>`. `AlertsPage`'s existing `SkeletonAlertsTable` is refactored to one instance of `<TableSkeleton>`.

**Global backstop:** configure `QueryCache({ onError })` on the `QueryClient` in `App.tsx` to fire a single throttled `toast.error("Something went wrong loading data.")`. Inline `<ErrorState>` is the primary per-surface treatment; the toast guarantees nothing fails silently even on a surface we don't individually wire.

### 3. Page-by-page wiring

Each page/panel adopts the same three-branch render: `isPending → skeleton`, `isError → <ErrorState onRetry={refetch}>`, else data (with `<EmptyState>` when the result is empty).

| Surface | Today | After |
|---|---|---|
| `AlertsPage` | skeleton ✓, empty ✓, no error branch | + `<ErrorState>`; skeleton becomes `<TableSkeleton>` |
| `DashboardPage` | spinner, `loading = isPending && !data` | `<TableSkeleton>` + `<ErrorState>`; keep `keepPreviousData` so filter changes don't flash |
| `TeamPage` | three sub-queries (rollup/breakdown/themes), spinners | per-section skeleton + `<ErrorState>` each, so one failing section doesn't blank the page |
| `AgentProfilePage` | bare "Loading…" | `<CardSkeleton>` / `<ChartSkeleton>` + `<ErrorState>` |
| `CallDetailPage` | "Loading call details…" | skeleton + `<ErrorState>`; alerts sub-section gets its own `compact` error |
| `NotificationBell` | dropdown, poll | inline error row in dropdown on fetch failure |

Hooks expose `isError` + `refetch` where pages don't already destructure them (mechanical). No cache-key or `staleTime` changes. `retry: 1` already self-heals transient blips before the user sees an error; manual Retry covers the rest.

### 4. Realtime notifications

Replace the 60s poll on `useNotifications` with a Supabase `postgres_changes` subscription:

- **Subscription** (a `useNotificationsRealtime` hook, or inside `NotificationBell`): subscribe to `INSERT`/`UPDATE` on `eavesly_notifications` filtered by `recipient_email=eq.<email>`. On an event, `queryClient.invalidateQueries(['notifications', email])` — reuse the existing capped (30-row) fetch rather than hand-merging payloads. Unsubscribe on unmount / email change.
- **Fallback:** relax `refetchInterval` from `60_000` to `300_000` (5 min) as a safety net for missed socket events; drop `refetchOnWindowFocus: true` (realtime makes it redundant).
- **Migration** `supabase/migrations/<ts>_notifications_realtime.sql`:
  ```sql
  ALTER PUBLICATION supabase_realtime ADD TABLE public.eavesly_notifications;
  ALTER TABLE public.eavesly_notifications REPLICA IDENTITY FULL;
  ```
  The existing RLS `SELECT` policy (scoped to `recipient_email`) already gates socket delivery — no new policy.
- **Unread badge:** already derivable from the fetched list (`filter(n => !n.read_at).length`); realtime keeps it live. No separate count query.

---

## Verification

No test suite and intentionally loose TS (per CLAUDE.md) — verify by running the app (`npm run dev`, port 8080):

- **Error path:** temporarily point a query at a bad table / block the request in devtools → confirm inline `<ErrorState>` + Retry appears (not an empty list); Retry recovers.
- **Empty path:** a manager scope with no mapped agents → `<EmptyState>`, no error.
- **Loading path:** throttle network → skeletons, no spinners, no layout shift.
- **Realtime:** two browser sessions; post a message in one, confirm the bell in the other updates within ~1–2s with no poll; kill the socket and confirm the 5-min fallback still fires.
- `npm run build` and `npm run lint` clean.

---

## Risks / open questions

- **Component location** — `src/components/states/` vs `src/components/ui/`. Resolve in the plan to match existing convention.
- **`REPLICA IDENTITY FULL`** slightly increases WAL volume for `eavesly_notifications`; acceptable for a low-write notifications table, and required for `UPDATE` payloads (read_at changes) to carry old values.
- **Global toast throttling** — must throttle/dedupe so a burst of failing queries doesn't stack toasts.
- **Realtime in headless/cron contexts** — N/A here; the bell is only mounted in the authenticated dashboard shell.
