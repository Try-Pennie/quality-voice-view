# Reliability & State-Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every read-query surface honest about its state (loading / error / empty / data) and move the notification bell from 60s polling to Supabase realtime.

**Architecture:** Read query functions stop swallowing Supabase errors into empty arrays and instead `throw`, so React Query's `isError`/`refetch` light up. Pages render a shared `<ErrorState>` (with Retry) on error and a shared `<EmptyState>` on no-data; a global `QueryCache.onError` toast is the backstop. Notifications get a `postgres_changes` subscription that invalidates the cached fetch, with the poll relaxed to a 5-minute safety net.

**Tech Stack:** Vite + React 18 + TypeScript, TanStack Query v5, Supabase JS (`@supabase/supabase-js`), sonner toasts, Tailwind (Pennie brand tokens), shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-06-04-reliability-state-clarity-design.md`

**Conventions to respect (from CLAUDE.md):**
- No test suite and no typecheck script; TS is intentionally loose. **Verification = `npm run build` + `npm run lint` clean, plus running the app (`npm run dev`, port 8080) and observing behavior.**
- `const sb = supabase as any` casts in query libs are deliberate — keep them.
- Design is brand-locked, light-mode (`.impeccable.md`): use Pennie tokens (`pennie-icon-chip`, `text-pennie-navy`, `bg-pennie-beige`, `pennie-focus-ring`, etc.), never shadcn-default grays or a dark theme.
- `src/components/ui/` is vendored shadcn — do not put app components there. New state components go in `src/components/states/`.
- Cache-key conventions (`scopeKey`, `alertFiltersKey`, `dateKey`) and `staleTime` are **not** changed by this plan.

**Branch:** `feat/reliability-state-clarity` (already created; the design spec is committed there).

---

## File Structure

**Create:**
- `src/components/states/ErrorState.tsx` — retryable error block (full + `compact` variants).
- `src/components/states/EmptyState.tsx` — no-data block (icon + title + optional message).
- `src/components/states/skeletons.tsx` — `TableSkeleton`, `CardSkeleton`, `ChartSkeleton`.
- `supabase/migrations/20260604120000_notifications_realtime.sql` — add notifications table to the realtime publication.

**Modify:**
- `src/lib/supabase-helpers.ts` — `fetchAllPaginated` throws on error.
- `src/lib/alert-queries.ts`, `src/lib/queries.ts`, `src/lib/team-queries.ts`, `src/lib/notification-queries.ts` — read fns throw on Supabase error (mutations and intentional empties unchanged).
- `src/App.tsx` — add `QueryCache` with a throttled global error toast.
- `src/pages/AlertsPage.tsx`, `DashboardPage.tsx`, `TeamPage.tsx`, `AgentProfilePage.tsx`, `CallDetailPage.tsx` — add `isError → <ErrorState onRetry={refetch}>` branches; adopt `<EmptyState>` where it dedupes inline markup.
- `src/components/NotificationBell.tsx` — render an inline error row on fetch failure; mount the realtime subscription.
- `src/hooks/use-queries.ts` — add `useNotificationsRealtime` hook; relax the notifications poll.

**Deliberate exceptions (do NOT convert to throw):**
- `src/lib/migo-queries.ts` `fetchMigoCoverage` — its design is graceful-degrade to `EMPTY_COVERAGE` (the card is feature-gated on `configured` and not yet rendered). Leave as-is.
- `fetchAgentManagerMappingAt`'s `42883` ("function does not exist") branch — that is an intentional feature-detect fallback to the live snapshot. Keep it; only the *other* error path throws.

---

## Task 1: Shared state components

**Files:**
- Create: `src/components/states/ErrorState.tsx`
- Create: `src/components/states/EmptyState.tsx`
- Create: `src/components/states/skeletons.tsx`

- [ ] **Step 1: Confirm the brand tokens these components use actually exist**

Run:
```bash
cd /root/github_repos/pennie/quality-voice-view
grep -rEo "pennie-[a-z-]+" src/index.css tailwind.config.* | sort -u | grep -Ei "navy|beige|peach|white|graphite|blue|icon-chip|focus-ring"
```
Expected: confirms classes like `pennie-icon-chip`, `text-pennie-navy`, `bg-pennie-beige`, `pennie-focus-ring`, `text-pennie-peach-dark`, `bg-pennie-navy`, `text-pennie-white`, `text-pennie-blue-deeper`. If a token below is absent, substitute the nearest confirmed token (e.g. use `bg-pennie-beige` if no peach background exists). The markup mirrors the existing empty state in `AlertsPage.tsx:621-636`, so reuse whatever it uses.

- [ ] **Step 2: Write `EmptyState.tsx`**

```tsx
import { Inbox } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * No-data state. Visually distinct from <ErrorState> so "nothing here"
 * never reads as "it broke". Markup mirrors the existing alerts empty
 * block (AlertsPage) so adopting it is a drop-in.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
}: {
  icon?: LucideIcon
  title: string
  message?: string
}) {
  return (
    <div className="p-16 text-center">
      <div className="pennie-icon-chip mx-auto mb-4 bg-pennie-beige">
        <Icon className="w-6 h-6 text-pennie-navy" aria-hidden="true" />
      </div>
      <p className="text-pennie-navy font-semibold text-lg">{title}</p>
      {message && <p className="text-sm text-muted-foreground mt-1">{message}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Write `ErrorState.tsx`**

```tsx
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Retryable error state. `onRetry` should be a React Query `refetch`.
 * `compact` is for in-card use (call-detail alerts section, panels).
 */
export function ErrorState({
  title = 'Couldn’t load this',
  message = 'Something went wrong fetching this data. Try again in a moment.',
  onRetry,
  compact = false,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  compact?: boolean
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-pennie-beige px-4 py-3">
        <AlertTriangle
          className="w-4 h-4 text-pennie-peach-dark flex-none"
          aria-hidden="true"
        />
        <p className="flex-1 text-sm text-pennie-navy">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="pennie-focus-ring text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
          >
            Retry
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="p-16 text-center">
      <div className="pennie-icon-chip mx-auto mb-4 bg-pennie-beige">
        <AlertTriangle className="w-6 h-6 text-pennie-peach-dark" aria-hidden="true" />
      </div>
      <p className="text-pennie-navy font-semibold text-lg">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="pennie-focus-ring mt-4 inline-flex items-center gap-2 rounded-full bg-pennie-navy px-4 py-2 text-sm font-semibold text-pennie-white hover:bg-pennie-navy/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write `skeletons.tsx`**

```tsx
/**
 * Shared loading skeletons built on the same shimmer idiom as the existing
 * SkeletonAlertsTable in AlertsPage. Use where a page currently shows a bare
 * spinner or "Loading…" text.
 */

function Bar({ widthPct }: { widthPct: number }) {
  return (
    <span
      className="block h-3 rounded-full bg-pennie-beige animate-pulse"
      style={{ width: `${widthPct}%` }}
    />
  )
}

/** Body-row shimmer. Caller supplies the surrounding <table>/<thead>. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className={i !== 0 ? 'border-t border-border/60' : ''}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-6 py-4 align-top">
              <Bar widthPct={50 + ((i * 7 + j) % 5) * 8} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-pennie-white rounded-3xl shadow-resting p-6 space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <Bar key={i} widthPct={i === 0 ? 40 : 70 + (i % 3) * 8} />
      ))}
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="bg-pennie-white rounded-3xl shadow-resting p-6">
      <Bar widthPct={30} />
      <div className="mt-6 h-40 rounded-2xl bg-pennie-beige animate-pulse" />
    </div>
  )
}
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: clean (components are unused so far — that is fine).

- [ ] **Step 6: Commit**

```bash
git add src/components/states/
git commit -m "feat: shared ErrorState/EmptyState/skeleton state components"
```

---

## Task 2: Global error-toast backstop

**Files:**
- Modify: `src/App.tsx:18-32` (the `QueryClient` construction)

- [ ] **Step 1: Add a throttled `QueryCache.onError` to the QueryClient**

Replace the import line and the `new QueryClient({...})` block. Current (App.tsx:4):
```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
```
becomes:
```ts
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
} from "@tanstack/react-query";
import { toast } from "sonner";
```

Then, immediately above `const queryClient = new QueryClient({` (App.tsx:18), add a throttle guard, and wire the cache in:
```ts
// Backstop so no read failure is ever fully silent, even on a surface we
// don't individually wire. Inline <ErrorState> remains the primary
// treatment; this dedupes bursts to one toast per few seconds.
let lastErrorToastAt = 0;
const queryCache = new QueryCache({
  onError: () => {
    const now = Date.now();
    if (now - lastErrorToastAt < 4000) return;
    lastErrorToastAt = now;
    toast.error("Something went wrong loading data. Try again in a moment.");
  },
});

const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
```
(Keep the existing `defaultOptions` body — `staleTime`, `gcTime`, `refetchOnWindowFocus`, `refetchOnReconnect`, `retry` — unchanged.)

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: global query-error toast backstop"
```

---

## Task 3: Data layer — read fns throw on Supabase error

This is the root-cause fix. Apply one rule across the read functions: **when a Supabase call returns a non-null `error` in a read path, `throw error` instead of returning `[]`/`null`.** Keep the `console.error(...)` line above it for the dev console. Do **not** touch mutations or the intentional empties.

**The rule, by example.** Current pattern (alert-queries.ts:108-112):
```ts
const { data, error } = await q
if (error) {
  console.error('Error fetching alerts:', error)
  return []
}
return (data || []) as AlertWithFeedback[]
```
becomes:
```ts
const { data, error } = await q
if (error) {
  console.error('Error fetching alerts:', error)
  throw error
}
return (data || []) as AlertWithFeedback[]
```

**Sites to convert (READ paths → `throw error`):**

| File | ~Line | Function | Note |
|---|---|---|---|
| `supabase-helpers.ts` | 19-21 | `fetchAllPaginated` | `return all` on error → `throw error`. Removes silent partial-truncation. |
| `alert-queries.ts` | 109-111 | `fetchAlerts` | `return []` → throw |
| `alert-queries.ts` | 127-129 | `fetchAlertsForCall` | `return []` → throw |
| `alert-queries.ts` | 144-146 | `fetchAlertOne` | `return null` → throw |
| `alert-queries.ts` | 199-205 | `fetchAlertThread` | throw if **either** `messagesRes.error` or `acksRes.error` (see Step 2) |
| `queries.ts` | 23-25 | `fetchQASummaries` batch | `return []` → throw |
| `queries.ts` | 150-152 | `fetchCallDetail` (call) | `return null` → throw on `callError`. Keep `if (!call) return null` (that's "not found", not an error). |
| `queries.ts` | 163-165 | `fetchCallDetail` (qa) | throw on `qaError` (a fetch error, distinct from a call legitimately having no QA row) |
| `notification-queries.ts` | 20-22 | `fetchRecentNotifications` | `return []` → throw |
| `team-queries.ts` | 321-323 | `team_daily_metrics` RPC | `return []` → throw |
| `team-queries.ts` | 385-387 | agent display names | throw |
| `team-queries.ts` | 412-414 | agent alerts batch | throw |
| `team-queries.ts` | 449-451 | `agent_daily_metrics` RPC | `return null` → throw |
| `team-queries.ts` | 478-480 | agent qa_json batch | throw |
| `team-queries.ts` | 577-579 | manager names | throw |
| `team-queries.ts` | 598-600 | `fetchAgentManagerMapping` | throw |
| `team-queries.ts` | 619-628 | `fetchAgentManagerMappingAt` | **keep** the `if (error.code === '42883') return fetchAgentManagerMapping()` fallback; change the trailing `return []` (non-42883) → `throw error` (see Step 3) |
| `team-queries.ts` | 765-767 | godmode agents (themes) | throw |
| `team-queries.ts` | 788-790 | recent calls per agent | throw |
| `team-queries.ts` | 819-821 | team qa_json batch | throw |

**Sites to LEAVE returning `[]`/`null` (intentional empties / not-found / deliberate degrade):**
`alert-queries.ts:85` and `:316` (scope short-circuit) · `queries.ts:58` (`calls.length === 0`) · `queries.ts:154` (`if (!call) return null`) · `notification-queries.ts:13` (`!email`) · `team-queries.ts:102`, `:305`, `:403` (empty-input short-circuits) · `team-queries.ts` `42883` fallback · all of `migo-queries.ts` · **all mutations** (`submitAlertFeedback`, `postAlertMessage`, `editAlertMessage`, `softDeleteAlertMessage`, `setAlertAck`, `markNotificationsRead`, `markAllNotificationsRead` — they keep returning `{ ok, error }`).

- [ ] **Step 1: Convert the simple single-`error` read sites**

Apply the rule to every "simple" row in the table above (everything except `fetchAlertThread` and `fetchAgentManagerMappingAt`, handled next). For each: change `return []`/`return null` directly under a read-path `console.error` to `throw error`. Keep `as any`/`sb` casts and the surrounding logic intact.

- [ ] **Step 2: Convert `fetchAlertThread` (parallel fetch)**

In `alert-queries.ts`, replace the two separate `if (...error) console.error` blocks (lines ~199-205) with:
```ts
  if (messagesRes.error) {
    console.error('Error fetching alert messages:', messagesRes.error)
    throw messagesRes.error
  }
  if (acksRes.error) {
    console.error('Error fetching alert acks:', acksRes.error)
    throw acksRes.error
  }
```

- [ ] **Step 3: Convert `fetchAgentManagerMappingAt` (preserve feature-detect)**

In `team-queries.ts`, the block becomes:
```ts
  if (error) {
    // 42883 = "function does not exist" — migration not applied yet; degrade
    // gracefully to the live snapshot so the page keeps rendering.
    if ((error as any).code === '42883') {
      return fetchAgentManagerMapping()
    }
    console.error('Error calling agent_manager_mapping_at:', error)
    throw error
  }
```
(Only the final `return []` becomes `throw error`; the 42883 fallback stays.)

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: clean. (Type signatures are unchanged — fns still declare `Promise<T[]>`/`Promise<T | null>`; throwing doesn't violate that.)

- [ ] **Step 5: Manual smoke — confirm an error now propagates**

Run `npm run dev`. Temporarily break one read: in `alert-queries.ts` `fetchAlerts`, change the table name in the `.from('...')` call to a nonexistent table (e.g. `eavesly_alerts_with_feedback_BROKEN`). Reload `/dashboard/alerts`.
Expected: the global toast fires ("Something went wrong loading data…"). (The inline `<ErrorState>` comes in Task 4 — for now the list may render empty, but the toast proves the throw reaches React Query.) **Revert the table-name edit before committing.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/
git commit -m "feat: read query fns throw on supabase error instead of swallowing"
```

---

## Task 4: Wire AlertsPage error + empty states

**Files:**
- Modify: `src/pages/AlertsPage.tsx` (query destructure ~104-118; render ~615-637)

- [ ] **Step 1: Destructure `isError` + `refetch` from the alerts query**

At `AlertsPage.tsx:104`, extend the `useAlerts` destructure:
```ts
  const {
    data: allAlertsData,
    isPending: alertsPending,
    isFetching: alertsFetching,
    isError: alertsError,
    refetch: refetchAlerts,
  } = useAlerts(serverFilters, scope)
```

- [ ] **Step 2: Import the shared components**

Add near the top imports of `AlertsPage.tsx`:
```ts
import { ErrorState } from '@/components/states/ErrorState'
import { EmptyState } from '@/components/states/EmptyState'
```

- [ ] **Step 3: Add the error branch and adopt `<EmptyState>`**

In the Table `<section>` (AlertsPage.tsx:615), update the conditional ladder so error precedes empty:
```tsx
        {loading ? (
          <SkeletonAlertsTable />
        ) : alertsError ? (
          <ErrorState
            title="Couldn’t load alerts"
            message="We hit an error fetching this queue. Your place is saved — just retry."
            onRetry={() => refetchAlerts()}
          />
        ) : alerts.length === 0 ? (
          <EmptyState
            title={statusView === 'new' ? 'Inbox zero — nothing to review.' : 'No alerts match.'}
            message={
              statusView === 'new'
                ? 'New alerts will land here as Eavesly flags them.'
                : 'Try widening the date range or clearing filters.'
            }
          />
        ) : (
```
(The default `EmptyState` icon is `Inbox`, matching the prior markup. Leave the rest of the table branch unchanged.)

- [ ] **Step 4: Verify + manual check**

Run: `npm run build && npm run lint` → clean.
Run `npm run dev`, break `fetchAlerts`'s table name again, reload `/dashboard/alerts`.
Expected: inline `<ErrorState>` with a "Try again" button renders in the table card (not an empty "Inbox zero"). Click Try again with the name fixed → list loads. **Revert the temporary break.**

- [ ] **Step 5: Commit**

```bash
git add src/pages/AlertsPage.tsx
git commit -m "feat: error + empty states on alerts queue"
```

---

## Task 5: Wire DashboardPage error state

**Files:**
- Modify: `src/pages/DashboardPage.tsx` (query ~78-85; empty branch ~587)

- [ ] **Step 1: Destructure `isError` + `refetch`**

At `DashboardPage.tsx:78`:
```ts
  const {
    data: callsData,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useDashboardData(/* existing args unchanged */)
```

- [ ] **Step 2: Import ErrorState**

```ts
import { ErrorState } from '@/components/states/ErrorState'
```

- [ ] **Step 3: Render the error branch**

Immediately before the existing empty block at `DashboardPage.tsx:587` (`{!loading && filteredCalls.length === 0 && (`), add:
```tsx
      {!loading && isError && (
        <ErrorState
          title="Couldn’t load calls"
          message="We hit an error fetching the call list. Retry to reload."
          onRetry={() => refetch()}
        />
      )}
```
And guard the empty block so it doesn't show under an error — change its condition to:
```tsx
      {!loading && !isError && filteredCalls.length === 0 && (
```

- [ ] **Step 4: Verify + manual check**

`npm run build && npm run lint` → clean. Run dev, break `fetchDashboardData`'s `.from('eavesly_calls')` table name, reload `/dashboard`.
Expected: `<ErrorState>` renders instead of "no calls". **Revert the break.**

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx
git commit -m "feat: error state on dashboard call list"
```

---

## Task 6: Wire TeamPage per-section error states

TeamPage has three independent queries (rollup, breakdown, themes). One failing must not blank the others.

**Files:**
- Modify: `src/pages/TeamPage.tsx` (queries ~149-163, ~318-324; render ~365-495)

- [ ] **Step 1: Destructure `isError` + `refetch` for all three**

Extend each existing destructure:
```ts
  const {
    data: rollupData,
    isPending: rollupPending,
    isError: rollupError,
    refetch: refetchRollup,
  } = useTeamRollup(scope, startDate, endDate)
```
```ts
  const {
    data: breakdownData,
    isPending: breakdownPending,
    isError: breakdownError,
    refetch: refetchBreakdown,
  } = useAlertBreakdown(scope, startDate, endDate)
```
```ts
  const {
    data: teamThemesData,
    isPending: themesPending,
    isError: themesError,
    refetch: refetchThemes,
  } = useTeamCoachingThemes(/* existing args unchanged */)
```
(Keep all existing arg lists and the `loading`/`breakdownLoading`/`themesLoading` derived booleans.)

- [ ] **Step 2: Import ErrorState**

```ts
import { ErrorState } from '@/components/states/ErrorState'
```

- [ ] **Step 3: Gate the rollup-dependent header/trend/leaderboard region**

The header stats, trend section, and leaderboard all read the rollup. Wrap that region (the block beginning around `TeamPage.tsx:375` with `<TeamHeaderStats … />`) so that when `rollupError` and not loading, it renders the error instead:
```tsx
      {rollupError && !loading ? (
        <ErrorState
          title="Couldn’t load team metrics"
          message="We hit an error building the team rollup. Retry to reload."
          onRetry={() => refetchRollup()}
        />
      ) : (
        <>
          {/* existing TeamHeaderStats / TeamTrendSection / TeamLeaderboard JSX */}
        </>
      )}
```

- [ ] **Step 4: Gate the breakdown (heatmap) and themes sections individually**

Where the heatmap renders (around `TeamPage.tsx:483`, `loading={breakdownLoading}`), wrap:
```tsx
      {breakdownError && !breakdownLoading ? (
        <ErrorState compact message="Couldn’t load the alert heatmap." onRetry={() => refetchBreakdown()} />
      ) : (
        /* existing heatmap JSX */
      )}
```
And the coaching-themes section (around `TeamPage.tsx:492`, `loading={themesLoading}`):
```tsx
      {themesError && !themesLoading ? (
        <ErrorState compact message="Couldn’t load coaching themes." onRetry={() => refetchThemes()} />
      ) : (
        /* existing themes JSX */
      )}
```
(Leave the existing `noAgents` empty handling at `TeamPage.tsx:352` intact — that's an intentional empty, not an error.)

- [ ] **Step 5: Verify + manual check**

`npm run build && npm run lint` → clean. Run dev, break the `team_daily_metrics` RPC name in `fetchTeamRollup`, open `/dashboard/team`.
Expected: the header/trend/leaderboard region shows `<ErrorState>` with Retry; the rest of the page chrome still renders. **Revert the break.**

- [ ] **Step 6: Commit**

```bash
git add src/pages/TeamPage.tsx
git commit -m "feat: per-section error states on team page"
```

---

## Task 7: Wire AgentProfilePage error state

**Files:**
- Modify: `src/pages/AgentProfilePage.tsx` (query ~63-71; render ~100-126)

- [ ] **Step 1: Destructure `isError` + `refetch`**

At `AgentProfilePage.tsx:63`:
```ts
  const {
    data: profileData,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useAgentProfile(/* existing args unchanged */)
```

- [ ] **Step 2: Import ErrorState + a skeleton**

```ts
import { ErrorState } from '@/components/states/ErrorState'
import { CardSkeleton } from '@/components/states/skeletons'
```

- [ ] **Step 3: Add an error branch near the top of the render**

After the `const loading = isPending && !profileData` line, add an early error return inside the page body (matching how the page lays out its container — place it where the profile content would render):
```tsx
  if (isError && !loading) {
    return (
      <ErrorState
        title="Couldn’t load this agent"
        message="We hit an error loading this profile. Retry to reload."
        onRetry={() => refetch()}
      />
    )
  }
```
(If the page wraps content in a layout container, put the `<ErrorState>` inside that same container rather than returning bare, to keep page chrome consistent. Use `CardSkeleton` in the existing `loading` branch if the page currently renders nothing meaningful while loading.)

- [ ] **Step 4: Verify + manual check**

`npm run build && npm run lint` → clean. Run dev, break `agent_daily_metrics` RPC name in `fetchAgentProfile`, open an agent profile from the leaderboard.
Expected: `<ErrorState>` with Retry. **Revert the break.**

- [ ] **Step 5: Commit**

```bash
git add src/pages/AgentProfilePage.tsx
git commit -m "feat: error state on agent profile page"
```

---

## Task 8: Wire CallDetailPage error states

**Files:**
- Modify: `src/pages/CallDetailPage.tsx` (queries ~29-35; loading branch ~35-40; alerts section ~121)

- [ ] **Step 1: Destructure `isError` + `refetch` for both queries**

```ts
  const {
    data: call,
    isPending: callPending,
    isError: callError,
    refetch: refetchCall,
  } = useCallDetail(callId)
  const loading = callPending
  const {
    data: alertsData,
    isPending: alertsPending,
    isError: alertsError,
    refetch: refetchAlerts,
  } = useAlertsForCall(callId)
```

- [ ] **Step 2: Import ErrorState**

```ts
import { ErrorState } from '@/components/states/ErrorState'
```

- [ ] **Step 3: Replace the bare loading text and add a top-level error branch**

The current loading branch (CallDetailPage.tsx:35-40) renders `<div className="text-lg text-muted-foreground">Loading call details...</div>`. Leave the loading text as-is (low value to skeleton a single detail page) but add an error branch directly after it:
```tsx
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-lg text-muted-foreground">Loading call details...</div>
      </div>
    )
  }
  if (callError) {
    return (
      <ErrorState
        title="Couldn’t load this call"
        message="We hit an error loading the call. Retry to reload."
        onRetry={() => refetchCall()}
      />
    )
  }
```
(Match the existing container/markup style of the loading branch; the snippet above assumes a centered wrapper — adapt to whatever the file currently uses.)

- [ ] **Step 4: Add a compact error to the alerts sub-section**

At `CallDetailPage.tsx:121`, where `<CallAlertsSection alerts={alerts} loading={alertsLoading} />` renders, precede it with an error guard:
```tsx
      {alertsError ? (
        <ErrorState compact message="Couldn’t load alerts for this call." onRetry={() => refetchAlerts()} />
      ) : (
        <CallAlertsSection alerts={alerts} loading={alertsLoading} />
      )}
```

- [ ] **Step 5: Verify + manual check**

`npm run build && npm run lint` → clean. Run dev, break `fetchCallDetail`'s call query table name, open a call detail page.
Expected: top-level `<ErrorState>`. Restore that, break `fetchAlertsForCall` instead → the compact alerts error renders while the rest of the call detail shows. **Revert the break.**

- [ ] **Step 6: Commit**

```bash
git add src/pages/CallDetailPage.tsx
git commit -m "feat: error states on call detail page"
```

---

## Task 9: Notifications realtime

Three parts: a migration enabling realtime on the table, a subscription hook, and the bell rendering an error row + using the relaxed poll.

**Files:**
- Create: `supabase/migrations/20260604120000_notifications_realtime.sql`
- Modify: `src/hooks/use-queries.ts` (notifications hook ~231-240; add new hook)
- Modify: `src/components/NotificationBell.tsx`

- [ ] **Step 1: Check whether the table is already in the realtime publication**

Use the supabase MCP `execute_sql` (project `miikotqnovnixpeqtqnd`):
```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'eavesly_notifications';
```
Expected: **0 rows** (not yet added). If it already returns a row, skip the `ALTER PUBLICATION` line in Step 2 but still set `REPLICA IDENTITY FULL`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260604120000_notifications_realtime.sql`:
```sql
-- Enable Supabase Realtime for the notification bell. The existing RLS
-- SELECT policy (recipient_email = auth email) already gates what each
-- subscriber receives, so no new policy is required. REPLICA IDENTITY FULL
-- lets UPDATE events (read_at changes) carry the full old row over the wire.

alter publication supabase_realtime add table public.eavesly_notifications;
alter table public.eavesly_notifications replica identity full;
```
(If Step 1 showed the table is already in the publication, drop the `alter publication` line to keep the migration idempotent.)

- [ ] **Step 3: Apply the migration**

Apply via supabase MCP `apply_migration` (name: `notifications_realtime`) with the SQL above. Then re-run the Step 1 query and confirm it now returns 1 row.

- [ ] **Step 4: Add the realtime subscription hook**

In `src/hooks/use-queries.ts`, add the supabase + react imports at the top if not present:
```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../integrations/supabase/client'
```
Then add the hook (place it next to `useNotifications`):
```ts
// Live-updates the bell: a postgres_changes subscription on the caller's
// own notification rows invalidates the cached fetch. RLS scopes delivery
// to recipient_email; the client filter narrows the channel further.
export function useNotificationsRealtime(email: string | null | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!email) return
    const lower = email.toLowerCase()
    const channel = supabase
      .channel(`notifications:${lower}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'eavesly_notifications',
          filter: `recipient_email=eq.${lower}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notifications', email] })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [email, queryClient])
}
```

- [ ] **Step 5: Relax the notifications poll to a safety net**

In `useNotifications` (use-queries.ts:~237-238), change the poll and drop focus-refetch:
```ts
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
```
(Update the comment above the hook to note realtime now drives freshness; the poll is a fallback for missed socket events.)

- [ ] **Step 6: Mount the subscription + add an error row in `NotificationBell`**

In `src/components/NotificationBell.tsx`:
- Import and call the hook + surface the query error. Change the import line `import { useNotifications } from '../hooks/use-queries'` to:
```ts
import { useNotifications, useNotificationsRealtime } from '../hooks/use-queries'
```
- In the component body, extend the query read and mount realtime:
```ts
  const { data, isError } = useNotifications(user?.email)
  useNotificationsRealtime(user?.email)
```
- In the dropdown body (where `notifications.length === 0 ? (…all caught up…)`), add an error case first:
```tsx
          {isError ? (
            <p className="px-4 py-8 text-sm text-pennie-peach-dark text-center">
              Couldn’t load notifications. They’ll refresh automatically.
            </p>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-8 text-sm text-pennie-graphite/60 text-center">
              You're all caught up.
            </p>
          ) : (
            /* existing <ul> of notifications */
          )}
```

- [ ] **Step 7: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 8: Manual check — realtime delivery**

Run `npm run dev`. Open the app in two browser profiles signed in as a manager and someone who can post into one of that manager's alert threads (or use the supabase SQL editor to `insert` a row into `eavesly_notifications` with `recipient_email` = the logged-in manager).
Expected: the bell badge/list updates within ~1-2s **without** waiting for a poll. Then disable network briefly and confirm the 5-minute `refetchInterval` still eventually refreshes (or just confirm no console errors from the channel on unmount/navigation).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260604120000_notifications_realtime.sql src/hooks/use-queries.ts src/components/NotificationBell.tsx
git commit -m "feat: realtime notifications via supabase postgres_changes"
```

---

## Task 10: Final verification pass

- [ ] **Step 1: Full build + lint**

Run: `npm run build && npm run lint`
Expected: both clean.

- [ ] **Step 2: Walk the four states on each surface**

With `npm run dev`, for AlertsPage, DashboardPage, TeamPage, AgentProfilePage, CallDetailPage:
- **Loading:** throttle network (DevTools) → skeleton/loading affordance, no layout jump.
- **Error:** temporarily break the relevant query's table/RPC name → inline `<ErrorState>` + Retry (not an empty state); Retry recovers after fixing. **Revert every temporary break.**
- **Empty:** where reachable (e.g. a filter with no matches) → `<EmptyState>`, no error styling.
- **Data:** normal load renders.

- [ ] **Step 3: Confirm no stray temporary breaks remain**

Run:
```bash
git diff --stat
grep -rn "_BROKEN\|BROKEN" src/ || echo "no temporary breaks left"
```
Expected: "no temporary breaks left" and a clean working tree (everything committed).

- [ ] **Step 4: Push the branch and open a PR (only if the user asks)**

Per repo convention, push/PR only on request. When asked:
```bash
git push -u origin feat/reliability-state-clarity
gh pr create --title "Reliability & state-clarity pass" --body "<summary + test notes>"
```

---

## Self-review notes (author)

- **Spec coverage:** §1 data-layer throw → Task 3; §2 shared components + global backstop → Tasks 1-2; §3 page wiring → Tasks 4-8; §4 realtime → Task 9; §Verification → Task 10. All spec sections map to tasks.
- **Deliberate exceptions** (migo graceful-degrade, `42883` fallback) are called out so the throw rule isn't applied blindly.
- **Type consistency:** `ErrorState` props (`title`, `message`, `onRetry`, `compact`) and `EmptyState` props (`icon`, `title`, `message`) are used identically across Tasks 4-9. `useNotificationsRealtime(email)` signature matches its call site.
- **No test suite** is a real constraint (CLAUDE.md); verification is build + lint + scripted manual breaks, which is why each task carries an explicit "break it, observe, revert" step instead of an automated assertion.
