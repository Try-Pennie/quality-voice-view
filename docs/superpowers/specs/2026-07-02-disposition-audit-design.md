# Design — "Disposition Audit" page

**Date:** 2026-07-02
**Repo:** `quality-voice-view` (the Eavesly manager SPA)
**Status:** awaiting final approval → implementation plan

## Problem

The `disposition_review` AI module (in the `eavesly` worker) flags calls where the CRM
disposition doesn't match the transcript. It's muted from Slack + the manager alert
queue while in test (flag rate ~56%, too noisy for a raw queue). But inside that noise
are two **objective, high-precision** error types that directly hurt the customer
journey. Sales leadership wants a page for managers to **review and catch** their agents
mis-dispositioning — not the whole firehose, the mistakes that matter.

## What the page surfaces — two audit categories

Both are boundary-crossings the model is highly confident on, not subjective quibbles.
Same-direction interest disagreements (1.2↔1.3, 1.3A→1.3) are deliberately excluded as
low-impact noise.

| Category | Definition | Customer impact | Volume | Model conf |
|---|---|---|---|---|
| **Ended a live lead** | agent = `1.5 - Not Interested > END CAMPAIGNS`; model suggests an interested/positive disposition (1.2/1.3/1.3A/1.3B/1.4); `conversation_happened=yes` | Interested lead dropped from all campaigns — never called again | ~470/wk | ~0.94 |
| **Phantom conversation** | model says `conversation_happened=no`, but the agent's disposition's **canonical** value is "conversation happened" (1.2/1.3/1.3A/1.4/1.5/…) | Fake pipeline — lead logged as interested/converted on a voicemail/no-answer; wrong downstream treatment | ~610/wk | ~0.98 |

"Phantom conversation" automatically **excludes 1.1A** (its canonical is `no` — a no-show
first call legitimately has no conversation; see Bucket A fix in the `eavesly` repo).

## Non-goals

- Not un-muting `disposition_review` in the manager alert queue (stays suppressed).
- Not touching the `eavesly` worker/model (that's Bucket A — the 1.1A description fix).
- Not surfacing every disposition_review flag — only the two categories above.
- No threaded discussion / acknowledgements in v1 (labeling only — see below).

## Approach

Reuse the existing alert stack. `disposition_review` rows are **already in** the
`eavesly_alerts_with_feedback` view (`alert_sent=true`); they're only hidden from the
manager queue by `src/lib/suppressed-alerts.ts`. This page is the sanctioned surface
that intentionally reads a narrow, defined slice — it does not go through the queue's
suppression filter.

The two-category predicate is non-trivial (JSON extraction + a canonical-disposition
set), so it lives in **one authoritative place: a DB view** — the same pattern the repo
already uses for `eavesly_alerts_with_feedback` and `mv_agent_daily_metrics`. This keeps
the client query trivial and the definition of "an audit finding" in SQL.

## Components

### 1. DB view — `eavesly_disposition_audit` (new migration in `supabase/migrations/`)

```
select *,  -- from eavesly_alerts_with_feedback (mapping + feedback + threads already joined)
  case
    when result_json->>'current_disposition' = '1.5 - Not Interested > END CAMPAIGNS'
     and result_json->>'suggested_disposition' in ('1.2 …','1.3 …','1.3A …','1.3B …','1.4 …')
     and result_json->>'conversation_happened' = 'yes'
      then 'ended_live_lead'
    when result_json->>'conversation_happened' = 'no'
     and exists (select 1 from eavesly_dispositions d
                 where d.name = eavesly_alerts_with_feedback.result_json->>'current_disposition'
                   and d.conversation_happened = 'yes' and not d.ai_only and d.active)
      then 'phantom_conversation'
  end as audit_category,
  result_json->>'current_disposition'   as current_disposition,
  result_json->>'suggested_disposition' as suggested_disposition,
  result_json->>'conversation_happened' as model_conversation_happened,
  (result_json->>'confidence')::numeric as model_confidence
from eavesly_alerts_with_feedback
where module_name = 'disposition_review' and has_violation = true
  and (<category 1 predicate> or <category 2 predicate>)
```

- **Phantom-conversation category joins `eavesly_dispositions`** so it self-maintains as
  the catalog is curated — no hardcoded canonical set. Only the small category-1 lists
  (the one `1.5` current value + the interested-suggestion set) are literals in the view.
- Exposes `audit_category` so the client filters/groups without re-deriving the predicate.

### 2. Data layer — `src/lib/disposition-audit-queries.ts` (new)

`fetchDispositionAudit(scope, {startDate, endDate, category?})`:
- `from('eavesly_disposition_audit')`, date window via ET `startOfBusinessDay/endOfBusinessDay`, `.order('alert_created_at', desc)`
- optional `.eq('audit_category', category)` (tab filter)
- scope: `if (!scope.isGodMode) .in('agent_email', scope.managedAgents)`; no-agents + not-god-mode → `[]` (same guard as `fetchAlerts`)
- paginate via `fetchAllPaginated` (window can exceed 1000 rows)
- does **not** call `filterSuppressedAlertRows` — this page is the sanctioned exposure

`submitAuditFeedback` — reuse `submitAlertFeedback`, which currently hard-blocks
suppressed modules. Add an explicit opt-in param `{ allowSuppressed: true }` (one extra
arg, no duplicated upsert logic); the audit page is the only caller that passes it.
Labels captured here write to `eavesly_alert_feedback` and **become the disposition_review
ground-truth we lack today** (5 labels total) — the second win of this page.

### 3. Hook — `src/hooks/use-queries.ts`

`useDispositionAudit(scope, dateRange, category)` — key
`['disposition-audit', scopeKey, dateKey, category ?? 'all']`, standard staleTime/gcTime.
Invalidate after `submitAuditFeedback`.

### 4. Page — `src/pages/DispositionAuditPage.tsx` (new) + route

- Route `/dashboard/disposition-audit` under `<ProtectedRoute><DashboardLayout>` (wire in
  `App.tsx`); add sidebar nav in `DashboardLayout`. Title **"Disposition Audit"**.
- **Two tabs** (`audit_category`): "Ended a live lead" · "Phantom conversation" (+ an
  All view). Count badge per tab.
- **Table:** date (ET) · agent · contact · current disposition · model suggests ·
  model conversation? · confidence · reviewed/accurate badge.
- **Row → detail drawer** (shadcn `Sheet`): current vs suggested side-by-side,
  `model_conversation_happened`, `reasoning_summary`, `evidence[]` quotes (speaker/quote/
  rationale from `result_json`), then the feedback form (accurate? + inaccuracy_reason /
  action_taken + comment). `disposition_review` result_json keys differ from other
  modules, so a small disposition-specific display mapping (not the existing
  `extractEvidence`/`extractReason` switch).
- **Filters:** date range (URL-driven via `url-filters.ts`) + status (new/reviewed).
  Accuracy filter + client search are trivial later adds — omitted from v1.

## Data flow

manager opens page → `useDispositionAudit(scope, range, tab)` → `fetchDispositionAudit`
(view, scoped, paginated) → tabbed table → row drawer shows result_json detail → manager
labels → `submitAuditFeedback` upserts `eavesly_alert_feedback` → invalidate
`['disposition-audit', …]` → row shows reviewed.

## Scope / auth

Client-side scope filter (`.in('agent_email', managedAgents)`), identical to
`fetchAlerts`; god-mode sees all. No new server-side RLS in v1 — same trust model as the
existing alerts list.

## Error handling

- Query error → error card (match AlertsPage). No-agents manager → empty state.
- Feedback upsert failure → toast with `error.message`; row stays unreviewed.

## Testing / verification

No test suite; loose TS (`strict:false`). Verify by running the app:
1. `npm run dev`, god-mode user → both tabs list calls; counts ≈ 470/wk + 610/wk pro-rated to the window.
2. Non-god-mode manager sees only their agents' rows.
3. Open a row → current/suggested/evidence render from `result_json`; 1.1A does **not** appear under Phantom conversation.
4. Label a call → row flips reviewed; `eavesly_alert_feedback` shows the new
   `module_name='disposition_review'` row.
5. `/dashboard/alerts` still shows **no** disposition_review rows (suppression intact).

## Decisions locked with reviewer (2026-07-02)

1. Name: **"Disposition Audit"**.
2. Scope: both customer-impacting categories above (broader than just 1.5→interested, per
   "whatever's most helpful for managers to catch bad dispositions").
3. v1 = **labeling only**, no comment thread / acknowledgements (tables exist; easy to add later).
