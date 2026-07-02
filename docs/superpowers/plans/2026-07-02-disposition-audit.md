# Disposition Audit Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manager-facing "Disposition Audit" page to the Eavesly SPA that surfaces two high-precision, customer-impacting `disposition_review` error categories and lets managers label each call (which also builds disposition_review ground-truth).

**Architecture:** A new read-only Postgres **view** (`eavesly_disposition_audit`) encapsulates the two-category predicate over the existing `eavesly_alerts_with_feedback` view. A thin data layer (`disposition-audit-queries.ts`) + TanStack hook feed a new tabbed page (`DispositionAuditPage`) with a purpose-built review drawer. Scope, pagination, ET date handling, and the feedback-upsert all reuse existing patterns.

**Tech Stack:** Vite + React 18 + TypeScript, TanStack Query, Supabase (Postgres + PostgREST), shadcn/ui (Radix) + Tailwind, react-router-dom.

## Global Constraints

- **No test runner / no typecheck in this repo.** TS is loose (`strict:false`); `npm run build` = `vite build` and does **not** fail on type errors. Verification is therefore: (a) SQL checks via the `supabase` MCP against project `miikotqnovnixpeqtqnd`, (b) `npm run build` for syntax/import sanity, (c) manual checks in `npm run dev`. This replaces the usual TDD loop — do not scaffold a test framework.
- **All dates are Eastern (ET).** Never use naive `new Date()` range math — go through `startOfBusinessDay`/`endOfBusinessDay`/`ymdInBusinessTZ` (`src/lib/time-zone.ts`).
- **PostgREST caps responses at ~1000 rows.** Any windowed list must page via `fetchAllPaginated` (`src/lib/supabase-helpers.ts`).
- **Scope is the auth model.** Every list query filters `.in('agent_email', scope.managedAgents)` unless `scope.isGodMode`. A non-god-mode manager with zero mapped agents sees nothing (return `[]` early).
- **Cache keys are primitives**, built with `dateKey`/`scopeKey` (`src/hooks/use-queries.ts`). Server-side filters go in the key; client-side ones don't.
- **`disposition_review` stays suppressed in the alert queue.** Do not remove it from `ALWAYS_SUPPRESSED_ALERT_MODULES`. This page is a separate, sanctioned surface; it does NOT call `filterSuppressedAlertRows`.
- **Exact disposition strings (copy verbatim):**
  - current (agent): `1.5 - Not Interested > END CAMPAIGNS`
  - interested/positive suggestions: `1.2 - Interested > No Call Scheduled`, `1.3 - Interested > Call Scheduled`, `1.3A - First Call Completed - Interested`, `1.3B - Turnbull Pending`, `1.4 - Converted/Won > END CAMPAIGNS`

---

## File Structure

- **Create** `supabase/migrations/20260702130000_disposition_audit_view.sql` — the `eavesly_disposition_audit` view.
- **Create** `src/lib/disposition-audit-queries.ts` — types, fetch (list + one), feedback upsert, result_json display helpers.
- **Modify** `src/components/alerts/AlertReviewDrawer.tsx` — export the existing `Toggle` and `Chip` presentational components for reuse (2-line change).
- **Create** `src/components/alerts/DispositionAuditDrawer.tsx` — detail + labeling drawer for one audit row.
- **Create** `src/pages/DispositionAuditPage.tsx` — tabbed table page.
- **Modify** `src/hooks/use-queries.ts` — add `useDispositionAudit`.
- **Modify** `src/App.tsx` — add the `/dashboard/disposition-audit` route.
- **Modify** `src/components/DashboardLayout.tsx` — add desktop + mobile nav links.

---

## Task 1: Create the `eavesly_disposition_audit` view

**Files:**
- Create: `supabase/migrations/20260702130000_disposition_audit_view.sql`

**Interfaces:**
- Produces: view `public.eavesly_disposition_audit` — every column of `eavesly_alerts_with_feedback` plus `current_disposition text`, `suggested_disposition text`, `model_conversation_happened text`, `model_confidence numeric`, `audit_category text` (`'ended_live_lead'` | `'phantom_conversation'`).

- [ ] **Step 1: Write the migration file**

```sql
-- Disposition Audit surface: two customer-impacting disposition_review error
-- categories, exposed on a dedicated manager page (NOT the alert queue).
-- Additive + read-only: a new view over eavesly_alerts_with_feedback. No existing
-- object is modified. disposition_review stays suppressed everywhere else.
CREATE OR REPLACE VIEW public.eavesly_disposition_audit AS
SELECT
  a.*,
  a.result_json->>'current_disposition'    AS current_disposition,
  a.result_json->>'suggested_disposition'  AS suggested_disposition,
  a.result_json->>'conversation_happened'  AS model_conversation_happened,
  (a.result_json->>'confidence')::numeric  AS model_confidence,
  CASE
    WHEN a.result_json->>'conversation_happened' = 'yes'
     AND a.result_json->>'current_disposition' = '1.5 - Not Interested > END CAMPAIGNS'
     AND a.result_json->>'suggested_disposition' IN (
       '1.2 - Interested > No Call Scheduled',
       '1.3 - Interested > Call Scheduled',
       '1.3A - First Call Completed - Interested',
       '1.3B - Turnbull Pending',
       '1.4 - Converted/Won > END CAMPAIGNS'
     )
      THEN 'ended_live_lead'
    WHEN a.result_json->>'conversation_happened' = 'no'
     AND EXISTS (
       SELECT 1 FROM public.eavesly_dispositions d
       WHERE d.name = a.result_json->>'current_disposition'
         AND d.conversation_happened = 'yes'
         AND d.ai_only = false
         AND d.active = true
     )
      THEN 'phantom_conversation'
  END AS audit_category
FROM public.eavesly_alerts_with_feedback a
WHERE a.module_name = 'disposition_review'
  AND a.has_violation = true
  AND (
    (a.result_json->>'conversation_happened' = 'yes'
     AND a.result_json->>'current_disposition' = '1.5 - Not Interested > END CAMPAIGNS'
     AND a.result_json->>'suggested_disposition' IN (
       '1.2 - Interested > No Call Scheduled',
       '1.3 - Interested > Call Scheduled',
       '1.3A - First Call Completed - Interested',
       '1.3B - Turnbull Pending',
       '1.4 - Converted/Won > END CAMPAIGNS'
     ))
    OR
    (a.result_json->>'conversation_happened' = 'no'
     AND EXISTS (
       SELECT 1 FROM public.eavesly_dispositions d
       WHERE d.name = a.result_json->>'current_disposition'
         AND d.conversation_happened = 'yes'
         AND d.ai_only = false
         AND d.active = true
     ))
  );

GRANT SELECT ON public.eavesly_disposition_audit TO authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via the `supabase` MCP `apply_migration` tool (name: `disposition_audit_view`, the SQL above) against project `miikotqnovnixpeqtqnd`. (Equivalent CLI: `supabase db push`.)

- [ ] **Step 3: Verify the view returns both categories with sane counts**

Run via `supabase` MCP `execute_sql`:

```sql
select audit_category, count(*), round(avg(model_confidence),3) as conf
from public.eavesly_disposition_audit
where alert_created_at > now() - interval '30 days'
group by 1 order by 2 desc;
```
Expected: two rows — `ended_live_lead` (~2,000/30d, conf ~0.94) and `phantom_conversation` (~2,600/30d, conf ~0.98). No `null` category.

- [ ] **Step 4: Verify 1.1A is excluded from phantom_conversation**

```sql
select count(*) from public.eavesly_disposition_audit
where current_disposition = '1.1A - No Show - First Call';
```
Expected: `0` (its canonical `conversation_happened` is `no`, so it can't be a phantom conversation).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260702130000_disposition_audit_view.sql
git commit -m "feat: add eavesly_disposition_audit view (two disposition_review error categories)"
```

---

## Task 2: Data layer — `disposition-audit-queries.ts`

**Files:**
- Create: `src/lib/disposition-audit-queries.ts`

**Interfaces:**
- Consumes: `UserScope` (from `./alert-queries`); `fetchAllPaginated` (`./supabase-helpers`); `startOfBusinessDay`/`endOfBusinessDay` (`./time-zone`); `AlertWithFeedback`, `AlertActionTaken`, `AlertInaccuracyReason` (`@/types/database`).
- Produces:
  - type `AuditCategory = 'ended_live_lead' | 'phantom_conversation'`
  - type `DispositionAuditRow = AlertWithFeedback & { current_disposition, suggested_disposition, model_conversation_happened: string|null, model_confidence: number|null, audit_category: AuditCategory }`
  - type `AuditFilters = { startDate: Date; endDate: Date; category?: AuditCategory }`
  - `fetchDispositionAudit(filters: AuditFilters, scope: UserScope): Promise<DispositionAuditRow[]>`
  - `fetchDispositionAuditOne(callId: string): Promise<DispositionAuditRow | null>`
  - `submitAuditFeedback(input: AuditFeedbackInput): Promise<{ ok: boolean; error?: string }>` where `AuditFeedbackInput = { call_id, manager_email, accurate: boolean, action_taken?, inaccuracy_reason?, comment? }`
  - `auditEvidence(result: any): { speaker?: string; quote?: string; rationale?: string }[]`
  - `auditReasoning(result: any): string`
  - `CATEGORY_LABELS: Record<AuditCategory, string>`

- [ ] **Step 1: Write the file**

```ts
import { supabase } from '@/integrations/supabase/client'
import { fetchAllPaginated } from './supabase-helpers'
import { startOfBusinessDay, endOfBusinessDay } from './time-zone'
import type { UserScope } from './alert-queries'
import type {
  AlertWithFeedback,
  AlertActionTaken,
  AlertInaccuracyReason,
} from '@/types/database'

// The generated Database<> type doesn't include this new view yet; cast at the
// boundary, matching alert-queries.ts.
const sb = supabase as any

export type AuditCategory = 'ended_live_lead' | 'phantom_conversation'

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  ended_live_lead: 'Ended a live lead',
  phantom_conversation: 'Phantom conversation',
}

export type DispositionAuditRow = AlertWithFeedback & {
  current_disposition: string | null
  suggested_disposition: string | null
  model_conversation_happened: string | null
  model_confidence: number | null
  audit_category: AuditCategory
}

export type AuditFilters = {
  startDate: Date
  endDate: Date
  category?: AuditCategory
}

// List columns exclude result_json/recording_link/transcript_url — those load on
// demand when the drawer opens (fetchDispositionAuditOne), same as the alerts list.
const AUDIT_LIST_COLUMNS = [
  'call_id',
  'module_name',
  'violation_type',
  'alert_created_at',
  'agent_email',
  'contact_name',
  'contact_phone',
  'call_summary',
  'sfdc_lead_id',
  'current_disposition',
  'suggested_disposition',
  'model_conversation_happened',
  'model_confidence',
  'audit_category',
  'is_reviewed',
  'accurate',
  'action_taken',
  'inaccuracy_reason',
  'feedback_by',
  'feedback_comment',
  'reviewed_at',
].join(',')

export async function fetchDispositionAudit(
  filters: AuditFilters,
  scope: UserScope,
): Promise<DispositionAuditRow[]> {
  if (!scope.isGodMode && scope.managedAgents.length === 0) return []

  return fetchAllPaginated<DispositionAuditRow>((from, to) => {
    let q = sb
      .from('eavesly_disposition_audit')
      .select(AUDIT_LIST_COLUMNS)
      .gte('alert_created_at', startOfBusinessDay(filters.startDate).toISOString())
      .lte('alert_created_at', endOfBusinessDay(filters.endDate).toISOString())
      .order('alert_created_at', { ascending: false })
      .range(from, to)
    if (filters.category) q = q.eq('audit_category', filters.category)
    if (!scope.isGodMode) q = q.in('agent_email', scope.managedAgents)
    return q
  })
}

export async function fetchDispositionAuditOne(
  callId: string,
): Promise<DispositionAuditRow | null> {
  const { data, error } = await sb
    .from('eavesly_disposition_audit')
    .select('*')
    .eq('call_id', callId)
    .eq('module_name', 'disposition_review')
    .maybeSingle()
  if (error) {
    console.error('Error fetching audit row:', error)
    throw error
  }
  return (data as DispositionAuditRow) ?? null
}

export type AuditFeedbackInput = {
  call_id: string
  manager_email: string
  accurate: boolean
  action_taken?: AlertActionTaken | null
  inaccuracy_reason?: AlertInaccuracyReason | null
  comment?: string | null
}

// Direct upsert to eavesly_alert_feedback. We intentionally bypass
// submitAlertFeedback() (which blocks suppressed modules) — this page is the
// sanctioned place to capture disposition_review feedback. onConflict matches the
// table's (call_id, module_name) unique constraint. These rows become the
// disposition_review ground-truth the module otherwise lacks.
export async function submitAuditFeedback(
  input: AuditFeedbackInput,
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    call_id: input.call_id,
    module_name: 'disposition_review',
    manager_email: input.manager_email,
    accurate: input.accurate,
    action_taken: input.accurate ? input.action_taken ?? null : null,
    inaccuracy_reason: !input.accurate ? input.inaccuracy_reason ?? null : null,
    comment: input.comment?.trim() || null,
    reviewed_at: new Date().toISOString(),
  }
  const { error } = await sb
    .from('eavesly_alert_feedback')
    .upsert(payload, { onConflict: 'call_id,module_name' })
  if (error) {
    console.error('Error submitting audit feedback:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// disposition_review result_json shape differs from the other modules, so it needs
// its own extractors (the alert-queries extractEvidence/extractReason switch has no
// disposition case).
export function auditEvidence(
  result: any,
): { speaker?: string; quote?: string; rationale?: string }[] {
  const ev = result?.evidence
  return Array.isArray(ev) ? ev : []
}

export function auditReasoning(result: any): string {
  return result?.reasoning_summary || ''
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds (no import/syntax errors). Note: type errors do not fail this repo's build; runtime correctness is verified in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/lib/disposition-audit-queries.ts
git commit -m "feat: disposition-audit data layer (fetch + feedback upsert)"
```

---

## Task 3: Export `Toggle` and `Chip`, add `useDispositionAudit` hook

**Files:**
- Modify: `src/components/alerts/AlertReviewDrawer.tsx` (add `export` to two functions)
- Modify: `src/hooks/use-queries.ts`

**Interfaces:**
- Consumes: `fetchDispositionAudit`, `AuditFilters` (Task 2); `scopeKey`, `dateKey` (existing in use-queries).
- Produces:
  - exported `Toggle` (`{ label: string; active: boolean; tone: 'success'|'danger'; onClick: () => void }`) and `Chip` (`{ label: string; active: boolean; onClick: () => void }`) from AlertReviewDrawer.
  - `useDispositionAudit(filters: AuditFilters, scope: UserScope | null | undefined)` returning the TanStack query for `DispositionAuditRow[]`.

- [ ] **Step 1: Export the two presentational components**

In `src/components/alerts/AlertReviewDrawer.tsx`, change `function Toggle({` (line ~790) to `export function Toggle({`, and `function Chip({` (line ~837) to `export function Chip({`. No other change.

- [ ] **Step 2: Add the hook imports and hook to `use-queries.ts`**

Add to the imports near the other `../lib/*` imports:

```ts
import {
  fetchDispositionAudit,
  type AuditFilters,
} from '../lib/disposition-audit-queries'
```

Add the hook (place it after `useAlerts`):

```ts
export function useDispositionAudit(
  filters: AuditFilters,
  scope: UserScope | null | undefined,
) {
  return useQuery({
    queryKey: [
      'dispositionAudit',
      scopeKey(scope),
      {
        start: dateKey(filters.startDate),
        end: dateKey(filters.endDate),
        category: filters.category ?? 'all',
      },
    ],
    queryFn: () => fetchDispositionAudit(filters, scope!),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/alerts/AlertReviewDrawer.tsx src/hooks/use-queries.ts
git commit -m "feat: export Toggle/Chip, add useDispositionAudit hook"
```

---

## Task 4: `DispositionAuditDrawer` component

**Files:**
- Create: `src/components/alerts/DispositionAuditDrawer.tsx`

**Interfaces:**
- Consumes: `DispositionAuditRow`, `submitAuditFeedback`, `auditEvidence`, `auditReasoning`, `CATEGORY_LABELS` (Task 2); `Toggle`, `Chip` (Task 3); `ACTION_TAKEN_LABELS`, `INACCURACY_REASON_LABELS` (`@/lib/alert-queries`); `Sheet*` (`@/components/ui/sheet`); `AudioPlayer` (`@/components/call-detail/AudioPlayer`); `formatDateTime`, `formatPhoneNumber` (`@/lib/utils`); `AlertActionTaken`, `AlertInaccuracyReason` (`@/types/database`).
- Produces: `DispositionAuditDrawer` with props `{ row: DispositionAuditRow | null; currentUserEmail: string | null | undefined; onClose: () => void; onSubmitted: (updated: Partial<DispositionAuditRow>) => void; onAdvance: (delta: 1 | -1) => void; hasNext: boolean; hasPrev: boolean }`.

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { AudioPlayer } from '@/components/call-detail/AudioPlayer'
import {
  ACTION_TAKEN_LABELS,
  INACCURACY_REASON_LABELS,
} from '@/lib/alert-queries'
import { Toggle, Chip } from '@/components/alerts/AlertReviewDrawer'
import {
  CATEGORY_LABELS,
  auditEvidence,
  auditReasoning,
  submitAuditFeedback,
  type DispositionAuditRow,
} from '@/lib/disposition-audit-queries'
import { formatDateTime, formatPhoneNumber } from '@/lib/utils'
import type { AlertActionTaken, AlertInaccuracyReason } from '@/types/database'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'

const ACTION_OPTIONS: AlertActionTaken[] = [
  'coached',
  'escalated',
  'follow_up_later',
  'no_action_needed',
]
const INACCURACY_OPTIONS: AlertInaccuracyReason[] = [
  'addressed_off_call',
  'evidence_misquoted',
  'wrong_context',
  'covered_not_verbatim',
  'call_dropped_incomplete',
  'policy_does_not_apply',
  'soft_inquiry_misclassified',
  'other',
]
const OTHER_NOTES_MIN = 10
const REAL_NOTES_MIN = 30

interface Props {
  row: DispositionAuditRow | null
  currentUserEmail: string | null | undefined
  onClose: () => void
  onSubmitted: (updated: Partial<DispositionAuditRow>) => void
  onAdvance: (delta: 1 | -1) => void
  hasNext: boolean
  hasPrev: boolean
}

export function DispositionAuditDrawer({
  row,
  currentUserEmail,
  onClose,
  onSubmitted,
  onAdvance,
  hasNext,
  hasPrev,
}: Props) {
  const [accurate, setAccurate] = useState<boolean | null>(null)
  const [action, setAction] = useState<AlertActionTaken | null>(null)
  const [reason, setReason] = useState<AlertInaccuracyReason | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const commentId = useId()

  useEffect(() => {
    if (!row) return
    setAccurate(row.accurate)
    setAction(row.action_taken)
    setReason(row.inaccuracy_reason)
    setComment(row.feedback_comment ?? '')
  }, [row?.call_id])

  const otherNoteRequired = accurate === false && reason === 'other'
  const notesTooShort =
    (accurate === true && comment.trim().length < REAL_NOTES_MIN) ||
    (otherNoteRequired && comment.trim().length < OTHER_NOTES_MIN)
  const saveDisabled =
    submitting ||
    accurate === null ||
    (accurate === true && !action) ||
    (accurate === false && !reason) ||
    notesTooShort

  const handleSubmit = async () => {
    if (!row || !currentUserEmail || accurate === null) {
      toast.error('Pick "Real issue" or "False alarm" first.')
      return
    }
    setSubmitting(true)
    const res = await submitAuditFeedback({
      call_id: row.call_id,
      manager_email: currentUserEmail,
      accurate,
      action_taken: accurate ? action : null,
      inaccuracy_reason: !accurate ? reason : null,
      comment: comment.trim() || null,
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error(`Couldn't save review: ${res.error}`)
      return
    }
    toast.success('Review saved')
    onSubmitted({
      feedback_by: currentUserEmail,
      accurate,
      action_taken: accurate ? action : null,
      inaccuracy_reason: !accurate ? reason : null,
      feedback_comment: comment.trim() || null,
      reviewed_at: new Date().toISOString(),
      is_reviewed: true,
    })
  }

  if (!row) return null

  const evidence = auditEvidence(row.result_json)
  const reasoning = auditReasoning(row.result_json)

  return (
    <Sheet open={!!row} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        hideClose
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden bg-pennie-white"
      >
        <SheetHeader className="px-4 sm:px-8 pt-4 pb-5 border-b border-border space-y-3 text-left">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-pennie-beige text-pennie-navy">
              {CATEGORY_LABELS[row.audit_category]}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
              {formatDateTime(row.alert_created_at)}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => onAdvance(-1)}
                disabled={!hasPrev}
                aria-label="Previous (k)"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onAdvance(1)}
                disabled={!hasNext}
                aria-label="Next (j)"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close (Esc)"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <SheetTitle className="text-lg font-semibold text-pennie-navy text-left">
            {row.agent_email || 'Unknown agent'} · {row.contact_name || 'Unknown'}
            {row.contact_phone && (
              <span className="text-pennie-graphite/70 ml-2 tabular-nums text-sm font-normal">
                {formatPhoneNumber(row.contact_phone)}
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-7">
          {/* Current vs suggested */}
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-pennie-peach-light bg-pennie-peach-light/20 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 mb-1">
                Agent set
              </p>
              <p className="text-sm font-semibold text-pennie-navy">
                {row.current_disposition || '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-pennie-green-light bg-pennie-green-light/20 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 mb-1">
                Model suggests
              </p>
              <p className="text-sm font-semibold text-pennie-navy">
                {row.suggested_disposition || '—'}
              </p>
            </div>
          </section>

          <p className="text-sm text-pennie-graphite">
            <span className="text-pennie-graphite/60">Model read: </span>
            conversation {row.model_conversation_happened === 'no' ? 'did NOT happen' : row.model_conversation_happened}
            {row.model_confidence != null && (
              <span className="text-pennie-graphite/60">
                {' '}· confidence {Math.round(row.model_confidence * 100)}%
              </span>
            )}
          </p>

          {/* Recording + links */}
          <section>
            <h2 className="pennie-label mb-2">Recording</h2>
            <AudioPlayer recordingUrl={row.recording_link} />
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {row.transcript_url && (
                <a href={row.transcript_url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-pennie-blue-deeper font-semibold hover:underline underline-offset-4">
                  Transcript <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              {row.sfdc_lead_id && (
                <a href={`https://trypennie.lightning.force.com/lightning/r/Lead/${row.sfdc_lead_id}/view`}
                   target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-pennie-blue-deeper font-semibold hover:underline underline-offset-4">
                  SFDC: {row.sfdc_lead_id} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </section>

          {/* Model reasoning + evidence */}
          <section className="space-y-4 text-sm">
            {reasoning && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Why the model disagrees
                </p>
                <p className="text-pennie-graphite leading-relaxed">{reasoning}</p>
              </div>
            )}
            {evidence.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Evidence (from transcript)
                </p>
                <ul className="space-y-2">
                  {evidence.map((e, i) => (
                    <li key={i} className="border-l-2 border-pennie-blue-main pl-4">
                      <p className="italic text-pennie-graphite leading-relaxed">"{e.quote}"</p>
                      {(e.speaker || e.rationale) && (
                        <p className="text-xs text-pennie-graphite/60 mt-0.5">
                          {e.speaker}{e.speaker && e.rationale ? ' — ' : ''}{e.rationale}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {row.call_summary && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Call summary
                </p>
                <p className="text-pennie-graphite leading-relaxed whitespace-pre-wrap">{row.call_summary}</p>
              </div>
            )}
          </section>
        </div>

        {/* Verdict form */}
        <div className="border-t border-border bg-pennie-beige/40 px-4 sm:px-8 py-5 space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-pennie-navy mb-3">
              Did the agent disposition this wrong?
              <span className="text-pennie-peach-deeper ml-1" aria-hidden="true">*</span>
            </legend>
            <div className="flex gap-2" role="radiogroup" aria-label="Verdict">
              <Toggle label="Real issue" active={accurate === true} tone="success"
                onClick={() => { setAccurate(true); setReason(null) }} />
              <Toggle label="False alarm" active={accurate === false} tone="danger"
                onClick={() => { setAccurate(false); setAction(null) }} />
            </div>
          </fieldset>

          {accurate === true && (
            <fieldset>
              <legend className="pennie-label mb-2">How did you address it with the agent? *</legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Action taken">
                {ACTION_OPTIONS.map((opt, i) => (
                  <Chip key={opt} label={`${i + 1}. ${ACTION_TAKEN_LABELS[opt]}`}
                    active={action === opt} onClick={() => setAction(action === opt ? null : opt)} />
                ))}
              </div>
            </fieldset>
          )}

          {accurate === false && (
            <fieldset>
              <legend className="pennie-label mb-2">Why was it a false alarm? *</legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="False alarm reason">
                {INACCURACY_OPTIONS.map((opt, i) => (
                  <Chip key={opt} label={`${i + 1}. ${INACCURACY_REASON_LABELS[opt]}`}
                    active={reason === opt} onClick={() => setReason(reason === opt ? null : opt)} />
                ))}
              </div>
            </fieldset>
          )}

          {accurate !== null && (
            <div>
              <label htmlFor={commentId} className="pennie-label mb-1.5 block">
                {accurate ? 'What happened and how you addressed it *' : otherNoteRequired ? 'Explain why *' : 'Notes (optional)'}
              </label>
              <textarea id={commentId} value={comment} onChange={e => setComment(e.target.value)} rows={3}
                className="w-full px-3 py-2 rounded-2xl border border-border bg-pennie-white text-base sm:text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper" />
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={handleSubmit} disabled={saveDisabled}
              className="min-h-[44px] px-5 py-2.5 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              {submitting ? 'Saving…' : row.is_reviewed ? 'Update review' : 'Save review'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds. (The drawer is exercised in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/components/alerts/DispositionAuditDrawer.tsx
git commit -m "feat: DispositionAuditDrawer (detail + labeling)"
```

---

## Task 5: `DispositionAuditPage` + route + nav

**Files:**
- Create: `src/pages/DispositionAuditPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/DashboardLayout.tsx`

**Interfaces:**
- Consumes: `useUserScope`, `useDispositionAudit` (hooks); `fetchDispositionAuditOne`, `CATEGORY_LABELS`, `AuditCategory`, `AuditFilters`, `DispositionAuditRow` (Task 2); `DispositionAuditDrawer` (Task 4); `DateRangePicker` (`@/components/dashboard/DateRangePicker`); `parseDateParam`, `formatDateParam` (`@/lib/url-filters`); `ymdInBusinessTZ` (`@/lib/time-zone`); `formatDateTime`, `formatPhoneNumber` (`@/lib/utils`); `PageHero` (`@/components/PageHero`); `ErrorState`/`EmptyState` (`@/components/states/*`).

- [ ] **Step 1: Write the page**

```tsx
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { useUserScope, useDispositionAudit } from '../hooks/use-queries'
import {
  fetchDispositionAuditOne,
  CATEGORY_LABELS,
  type AuditCategory,
  type AuditFilters,
  type DispositionAuditRow,
} from '../lib/disposition-audit-queries'
import { DispositionAuditDrawer } from '../components/alerts/DispositionAuditDrawer'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { parseDateParam, formatDateParam } from '../lib/url-filters'
import { ymdInBusinessTZ } from '../lib/time-zone'
import { formatDateTime, formatPhoneNumber } from '../lib/utils'
import { PageHero } from '../components/PageHero'
import { ErrorState } from '@/components/states/ErrorState'
import { EmptyState } from '@/components/states/EmptyState'
import { ChevronRight, Inbox } from 'lucide-react'

const TABS: (AuditCategory | 'all')[] = ['all', 'ended_live_lead', 'phantom_conversation']
type StatusView = 'all' | 'new' | 'reviewed'

function todayStart() {
  const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
  const local = new Date(y, m - 1, d); local.setHours(0, 0, 0, 0); return local
}
function todayEnd() {
  const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
  const local = new Date(y, m - 1, d); local.setHours(23, 59, 59, 999); return local
}

export default function DispositionAuditPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: scope, isError: scopeError, refetch: refetchScope } = useUserScope(user?.email)

  const [startDate, setStartDate] = useState<Date>(() => parseDateParam(searchParams.get('start'), todayStart()))
  const [endDate, setEndDate] = useState<Date>(() => parseDateParam(searchParams.get('end'), todayEnd(), true))
  const [tab, setTab] = useState<AuditCategory | 'all'>(() => {
    const t = searchParams.get('tab')
    return t === 'ended_live_lead' || t === 'phantom_conversation' ? t : 'all'
  })
  const [statusView, setStatusView] = useState<StatusView>('new')
  const [drawerRow, setDrawerRow] = useState<DispositionAuditRow | null>(null)

  const filters = useMemo<AuditFilters>(
    () => ({ startDate, endDate, category: tab === 'all' ? undefined : tab }),
    [startDate, endDate, tab],
  )
  const { data, isPending, isError, refetch } = useDispositionAudit(filters, scope)
  const allRows = useMemo(() => data ?? [], [data])
  const loading = isPending && !data

  // Sync filter state to the URL (shareable view).
  useMemo(() => {
    const params = new URLSearchParams()
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    if (tab !== 'all') params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }, [startDate, endDate, tab, setSearchParams])

  const rows = useMemo(() => {
    if (statusView === 'new') return allRows.filter(r => !r.is_reviewed)
    if (statusView === 'reviewed') return allRows.filter(r => r.is_reviewed)
    return allRows
  }, [allRows, statusView])

  const openDrawer = useCallback((row: DispositionAuditRow) => {
    setDrawerRow(row)
    if (!row.result_json) {
      fetchDispositionAuditOne(row.call_id).then(full => {
        if (!full) return
        setDrawerRow(curr => (curr && curr.call_id === full.call_id ? { ...curr, ...full } : curr))
      }).catch(err => console.error('Failed to enrich audit row:', err))
    }
  }, [])

  const advance = useCallback((delta: 1 | -1) => {
    if (!drawerRow) return
    const idx = rows.findIndex(r => r.call_id === drawerRow.call_id)
    const next = rows[idx + delta]
    if (next) openDrawer(next)
  }, [rows, drawerRow, openDrawer])

  const onSubmitted = useCallback((updated: Partial<DispositionAuditRow>) => {
    if (!drawerRow) return
    const merged = { ...drawerRow, ...updated, is_reviewed: true } as DispositionAuditRow
    queryClient.setQueriesData<DispositionAuditRow[]>({ queryKey: ['dispositionAudit'] }, old =>
      old?.map(r => (r.call_id === merged.call_id ? merged : r)) ?? old,
    )
    setDrawerRow(merged)
  }, [drawerRow, queryClient])

  if (scopeError) {
    return <ErrorState title="Couldn't load your access" message="Retry to reload." onRetry={() => refetchScope()} />
  }
  if (!scope) {
    return <div className="flex items-center justify-center h-96"><p className="text-base text-muted-foreground">Loading…</p></div>
  }
  if (!scope.isGodMode && scope.managedAgents.length === 0) {
    return (
      <section className="pennie-card max-w-2xl mx-auto text-center">
        <div className="pennie-icon-chip mx-auto mb-5 bg-pennie-beige"><Inbox className="w-6 h-6 text-pennie-navy" /></div>
        <h1 className="text-2xl font-semibold text-pennie-navy mb-2">No agents assigned to you</h1>
        <p className="text-pennie-graphite/80">This audit is scoped to the agents you manage.</p>
      </section>
    )
  }

  const idx = drawerRow ? rows.findIndex(r => r.call_id === drawerRow.call_id) : -1

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <PageHero
        label="Disposition audit"
        display
        headline={<>{rows.length.toLocaleString()} <span className="text-pennie-graphite/70 font-normal text-[0.6em] align-baseline">to review</span></>}
        description="Calls where an agent's disposition may have hurt the customer's journey — reviewed by the model against the transcript."
      />

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Audit category">
        {TABS.map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
              tab === t ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
            }`}>
            {t === 'all' ? 'All' : CATEGORY_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <section className="pennie-card-tight flex flex-wrap gap-3 sm:gap-5 items-end">
        <DateRangePicker startDate={startDate} endDate={endDate} onRangeChange={(s, e) => { setStartDate(s); setEndDate(e) }} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pennie-label">Status</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Filter by status">
            {(['new', 'reviewed', 'all'] as const).map(s => (
              <button key={s} type="button" role="radio" aria-checked={statusView === s} onClick={() => setStatusView(s)}
                className={`min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                  statusView === s ? 'bg-pennie-navy text-pennie-white border-pennie-navy' : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-beige'
                }`}>
                {s === 'new' ? 'New' : s === 'reviewed' ? 'Reviewed' : 'All'}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      {/* Table */}
      <section className="bg-pennie-white rounded-3xl shadow-resting overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-muted-foreground">Loading…</div>
        ) : isError ? (
          <ErrorState title="Couldn't load the audit" message="Retry to reload." onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={statusView === 'new' ? 'Nothing to review.' : 'No calls match.'} message="Try widening the date range or switching tabs." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-pennie-beige/60">
                <tr>
                  <Th>Time (ET)</Th><Th>Agent</Th><Th>Contact</Th><Th>Agent set</Th><Th>Model suggests</Th><Th>Conf</Th><Th>Status</Th>
                  <th aria-hidden="true" className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.call_id} role="button" tabIndex={0}
                    className={`pennie-focus-ring-inset group cursor-pointer transition-colors hover:bg-pennie-blue-light/40 ${i !== 0 ? 'border-t border-border/60' : ''}`}
                    onClick={() => openDrawer(r)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r) } }}>
                    <Td><span className="text-sm text-muted-foreground tabular-nums">{formatDateTime(r.alert_created_at)}</span></Td>
                    <Td><span className="text-sm font-semibold text-pennie-navy">{r.agent_email || '—'}</span></Td>
                    <Td>
                      <div className="text-sm text-pennie-graphite font-medium">{r.contact_name || '—'}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatPhoneNumber(r.contact_phone)}</div>
                    </Td>
                    <Td><span className="text-sm text-pennie-graphite">{r.current_disposition || '—'}</span></Td>
                    <Td><span className="text-sm font-semibold text-pennie-navy">{r.suggested_disposition || '—'}</span></Td>
                    <Td><span className="text-sm tabular-nums text-pennie-graphite/70">{r.model_confidence != null ? `${Math.round(r.model_confidence * 100)}%` : '—'}</span></Td>
                    <Td>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        !r.is_reviewed ? 'bg-pennie-blue-light text-pennie-blue-deeper'
                          : r.accurate === false ? 'bg-pennie-peach-light text-pennie-peach-deeper'
                          : 'bg-pennie-green-light text-pennie-green-dark'
                      }`}>
                        {!r.is_reviewed ? 'New' : r.accurate === false ? 'False alarm' : 'Reviewed'}
                      </span>
                    </Td>
                    <td className="pl-2 pr-5 py-3 w-10 text-right">
                      <ChevronRight aria-hidden="true" className="inline-block w-4 h-4 text-pennie-graphite/35 group-hover:text-pennie-blue-deeper group-hover:translate-x-0.5 transition-all" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DispositionAuditDrawer
        row={drawerRow}
        currentUserEmail={user?.email}
        onClose={() => setDrawerRow(null)}
        onSubmitted={onSubmitted}
        onAdvance={advance}
        hasNext={idx > -1 && idx < rows.length - 1}
        hasPrev={idx > 0}
      />
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 sm:px-6 py-3 text-left text-[11px] font-bold text-pennie-graphite/70 uppercase tracking-[0.06em]">{children}</th>
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 sm:px-6 py-3 sm:py-4 align-top">{children}</td>
}
```

- [ ] **Step 2: Add the route in `src/App.tsx`**

Mirror the existing `/dashboard/alerts` route block. Add the lazy/eager import next to the other page imports:

```tsx
import DispositionAuditPage from "./pages/DispositionAuditPage";
```

Add this `<Route>` inside `<Routes>` alongside the other `/dashboard/*` routes:

```tsx
<Route
  path="/dashboard/disposition-audit"
  element={
    <ProtectedRoute>
      <DashboardLayout>
        <DispositionAuditPage />
      </DashboardLayout>
    </ProtectedRoute>
  }
/>
```

(Match the exact wrapper style used by the neighboring routes in this file — check whether they use `<DashboardLayout>` inside the element or a shared layout wrapper, and follow that.)

- [ ] **Step 3: Add nav links in `src/components/DashboardLayout.tsx`**

In the desktop `<nav>` (after the Alerts link, line ~83):

```tsx
<DashNavLink to="/dashboard/disposition-audit">Disposition Audit</DashNavLink>
```

In the mobile `<nav>` (after the Alerts `MobileNavLink`, line ~167):

```tsx
<MobileNavLink to="/dashboard/disposition-audit">Disposition Audit</MobileNavLink>
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification in the running app**

Run: `npm run dev` (port 8080). Sign in as a god-mode user, then:
1. Nav shows "Disposition Audit"; the page lists calls. Widen the date range to 30 days — "All" tab count ≈ 4,600; "Ended a live lead" ≈ 2,000; "Phantom conversation" ≈ 2,600.
2. Click a row → drawer shows agent-set vs model-suggested disposition, model reasoning, evidence quotes, recording player.
3. Mark a call **False alarm → "Wrong context"** and save → toast "Review saved"; row flips to "False alarm" / reviewed.
4. Confirm the label persisted (via `supabase` MCP):
   ```sql
   select call_id, accurate, inaccuracy_reason, manager_email
   from eavesly_alert_feedback
   where module_name='disposition_review' and reviewed_at > now() - interval '10 minutes'
   order by reviewed_at desc;
   ```
   Expected: your just-labeled row with `accurate=false`.
5. Open `/dashboard/alerts` → confirm **no** disposition_review rows appear there (suppression intact).
6. Sign in as a non-god-mode manager → the audit table shows only their agents' calls.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DispositionAuditPage.tsx src/App.tsx src/components/DashboardLayout.tsx
git commit -m "feat: Disposition Audit page + route + nav"
```

---

## Self-Review

**Spec coverage:**
- Two categories (ended_live_lead, phantom_conversation) → Task 1 view + Task 5 tabs. ✓
- Reuse existing alert stack / shared view → Task 1 selects from `eavesly_alerts_with_feedback`. ✓
- Labeling builds ground-truth → Task 2 `submitAuditFeedback` upserts `eavesly_alert_feedback` with `module_name='disposition_review'`. ✓
- Scope model (managers see own agents; god-mode all) → Task 2 `.in('agent_email', ...)` + Task 5 no-agents guard. ✓
- Suppression stays intact → no change to `suppressed-alerts.ts`; verified in Task 5 step 5. ✓
- 1.1A excluded from phantom → Task 1 catalog join (`conversation_happened='yes'`) + verified Task 1 step 4. ✓
- v1 labeling only (no thread/acks) → drawer omits thread/ack UI. ✓
- ET dates, pagination, primitive cache keys → Tasks 2 & 3. ✓

**Deviation from spec (intentional):** the spec proposed adding an `allowSuppressed` flag to `submitAlertFeedback`; this plan uses a dedicated `submitAuditFeedback` instead — same table/constraint, but touches no shared code (cleaner, lower risk).

**Placeholder scan:** none — all steps carry real SQL/TS.

**Type consistency:** `DispositionAuditRow`, `AuditCategory`, `AuditFilters`, `submitAuditFeedback` names match across Tasks 2→3→4→5. `Toggle`/`Chip` prop shapes match their definitions in AlertReviewDrawer. `onSubmitted(Partial<DispositionAuditRow>)` matches between drawer (Task 4) and page (Task 5).

**One open risk to check during execution:** confirm `src/App.tsx` route-wrapping convention (some routes may wrap `<DashboardLayout>` in the element, others via a parent route) and match it — Step 2 of Task 5 notes this.
```
