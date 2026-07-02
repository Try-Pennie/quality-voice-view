# Achieve Drawer Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Achieve/FDR call-detail drawer clear about who the call was with, why it was flagged (or not), what the agent covered vs. missed, and what each term means — using data already present.

**Architecture:** Extract the one piece of non-trivial logic (mapping the checker's `script_adherence` into a 6-element pass/fail checklist) into a pure, tested `src/lib/achieve-checklist.ts` module that also holds the shared, script-derived labels and glossary definitions. Then rewire the drawer JSX in `src/pages/AchievePortalPage.tsx` to consume it: identity-first header, a plain verdict line, a "what happened" checklist card, inline ⓘ glossary tooltips (a small local Popover), and a native `<details>` key-terms panel.

**Tech Stack:** React + TypeScript, Vite, Tailwind, Radix (`@/components/ui/popover`), lucide-react icons, `@tanstack/react-query`. No new dependencies.

## Global Constraints

- **Only these files change:** `src/pages/AchievePortalPage.tsx`, new `src/lib/achieve-checklist.ts`, new `src/lib/achieve-checklist.check.ts`. No shared components, no other pages, no `package.json` deps.
- **Self-contained glossary:** definitions live locally; do NOT link to `/dashboard/help` (external reviewers can't reach it).
- **No new test framework:** the repo has no runner; the checklist self-check runs via `npx tsx`.
- **Handling agent stays hidden:** do not surface `agent_email`.
- **Definitions are verbatim from the spec** (`docs/superpowers/specs/2026-07-02-achieve-drawer-clarity-design.md`), sourced from the FDR welcome-call script.

---

### Task 1: Checklist logic + shared definitions (pure module, self-checked)

**Files:**
- Create: `src/lib/achieve-checklist.ts`
- Create (check): `src/lib/achieve-checklist.check.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (consumed by Task 2):
  - `ACHIEVE_ELEMENTS: AchieveElement[]` where `AchieveElement = { flag: string; missingKey: string; label: string; definition: string }`
  - `ACHIEVE_TERMS: Record<string, { label: string; definition: string }>` with keys `script_adherence`, `confidence`, `needs_review`, `supporting_quotes`
  - `deriveChecklist(adherence): Checklist` where `Checklist = { rows: ChecklistRow[]; coveredCount: number; total: number }` and `ChecklistRow = { key: string; label: string; definition: string; isCovered: boolean }`

- [ ] **Step 1: Write the module**

Create `src/lib/achieve-checklist.ts`:

```ts
// Required FDR welcome-call script elements the Achieve QA checker scores.
// Labels + definitions come from the FDR Welcome Call Script (Wholesale — DB
// Pilot); see docs/superpowers/specs/2026-07-02-achieve-drawer-clarity-design.md.
// `flag` is the boolean key on script_adherence; `missingKey` is the base name
// used in its missing_elements list (no suffix). Derivation checks both.

export type AchieveElement = {
  flag: string
  missingKey: string
  label: string
  definition: string
}

export const ACHIEVE_ELEMENTS: AchieveElement[] = [
  {
    flag: 'welcome_greeting_completed',
    missingKey: 'welcome_greeting',
    label: 'Welcome & greeting',
    definition:
      'Agent greeted the client, verified their identity, and gave the "recorded for quality" disclosure. (Script section 1 — Introduction)',
  },
  {
    flag: 'program_overview_covered',
    missingKey: 'program_overview',
    label: 'Program overview',
    definition:
      'Explained how the program works: the Dedicated Account, creditor negotiation, and restructured repayment terms (the "three keys"). (Script section 1)',
  },
  {
    flag: 'payment_process_explained',
    missingKey: 'payment_process',
    label: 'Payment process',
    definition:
      'Gave the client their first deposit date and how often deposits are made into the Dedicated Account. (Script — first key)',
  },
  {
    flag: 'timeline_expectations_covered',
    missingKey: 'timeline_expectations',
    label: 'Timeline expectations',
    definition:
      'Set expectations on settlement timing and authorizing new terms quickly to keep the program on track. (Script — keys 2 & 3)',
  },
  {
    flag: 'client_communication_process_covered',
    missingKey: 'client_communication_process',
    label: 'Client communication',
    definition:
      'Covered how the client hears from FDR: app/dashboard/email/text notifications, the customer-service line (800-655-6303), and "here 7 days a week". (Script — Dashboard/Closing)',
  },
  {
    flag: 'next_steps_provided',
    missingKey: 'next_steps',
    label: 'Next steps',
    definition:
      'Walked through account/app setup and the Program Guide email so the client knows what to do after the call. (Script — Dashboard/Tools)',
  },
]

// Jargon shown around the drawer, defined self-contained (external reviewers
// cannot reach the internal /dashboard/help glossary).
export const ACHIEVE_TERMS: Record<string, { label: string; definition: string }> = {
  script_adherence: {
    label: 'Script adherence',
    definition:
      'How closely the agent followed the required welcome-call script. "Full" = every required element covered; "minimal" = most required elements missing.',
  },
  confidence: {
    label: 'Confidence',
    definition:
      'How sure the automated checker is about this result, based on transcript and audio quality. Low confidence is worth a closer listen to the recording.',
  },
  needs_review: {
    label: 'Needs review',
    definition: "A human reviewer hasn't confirmed this automated result yet.",
  },
  supporting_quotes: {
    label: 'Supporting quotes',
    definition:
      'Verbatim snippets pulled from the call transcript that the checker used as evidence for its result.',
  },
}

export type ChecklistRow = {
  key: string
  label: string
  definition: string
  isCovered: boolean
}
export type Checklist = { rows: ChecklistRow[]; coveredCount: number; total: number }

type Adherence = { missing_elements?: unknown; [flag: string]: unknown }

export function deriveChecklist(adherence: Adherence | null | undefined): Checklist {
  const a = adherence ?? {}
  const missing = Array.isArray(a.missing_elements)
    ? (a.missing_elements as unknown[]).filter((m): m is string => typeof m === 'string')
    : []

  const rows: ChecklistRow[] = ACHIEVE_ELEMENTS.map(el => {
    const isMissing =
      a[el.flag] === false ||
      missing.some(m => m === el.missingKey || m.startsWith(el.missingKey))
    return { key: el.missingKey, label: el.label, definition: el.definition, isCovered: !isMissing }
  })

  return { rows, coveredCount: rows.filter(r => r.isCovered).length, total: rows.length }
}
```

- [ ] **Step 2: Write the self-check**

Create `src/lib/achieve-checklist.check.ts`:

```ts
// Self-check for deriveChecklist — no test runner in this repo by design.
// Run: npx tsx src/lib/achieve-checklist.check.ts
import assert from 'node:assert'
import { deriveChecklist } from './achieve-checklist'

// 1. Booleans-only input: two false flags -> 4 covered.
const bools = deriveChecklist({
  welcome_greeting_completed: true,
  program_overview_covered: false,
  payment_process_explained: true,
  timeline_expectations_covered: false,
  client_communication_process_covered: true,
  next_steps_provided: true,
})
assert.strictEqual(bools.coveredCount, 4)
assert.strictEqual(bools.rows.find(r => r.key === 'program_overview')!.isCovered, false)
assert.strictEqual(bools.rows.find(r => r.key === 'welcome_greeting')!.isCovered, true)

// 2. missing_elements-only, base spelling (matches real screenshot data).
const baseMissing = deriveChecklist({
  missing_elements: ['program_overview', 'timeline_expectations', 'client_communication_process'],
})
assert.strictEqual(baseMissing.coveredCount, 3)
assert.strictEqual(baseMissing.rows.find(r => r.key === 'program_overview')!.isCovered, false)

// 3. missing_elements-only, suffixed spelling -> loose startsWith still catches it.
const suffixMissing = deriveChecklist({ missing_elements: ['next_steps_provided'] })
assert.strictEqual(suffixMissing.rows.find(r => r.key === 'next_steps')!.isCovered, false)
assert.strictEqual(suffixMissing.coveredCount, 5)

// 4. Both present and agreeing -> counted once.
const both = deriveChecklist({ program_overview_covered: false, missing_elements: ['program_overview'] })
assert.strictEqual(both.rows.find(r => r.key === 'program_overview')!.isCovered, false)
assert.strictEqual(both.coveredCount, 5)

// 5. Empty / undefined -> all 6 default to covered.
assert.strictEqual(deriveChecklist({}).coveredCount, 6)
assert.strictEqual(deriveChecklist(undefined).coveredCount, 6)

console.log('achieve-checklist: all checks passed')
```

- [ ] **Step 3: Run the self-check to verify it passes**

Run: `cd /root/github_repos/pennie/quality-voice-view && npx tsx src/lib/achieve-checklist.check.ts`
Expected: `achieve-checklist: all checks passed` and exit code 0. (If `tsx` prompts to install, accept — it runs via `npx`, not added to `package.json`.)

- [ ] **Step 4: Lint the new module**

Run: `npm run lint`
Expected: no new errors for `src/lib/achieve-checklist.ts` / `.check.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/achieve-checklist.ts src/lib/achieve-checklist.check.ts
git commit -m "Add Achieve checklist logic + script-derived definitions"
```

---

### Task 2: Rewire the drawer UI to use the checklist + glossary

**Files:**
- Modify: `src/pages/AchievePortalPage.tsx` (imports; `SheetHeader` in `AchieveRowsState` ~L251-255; `AchieveAlertDetails` ~L348-429; `DrawerSection` ~L431-441; `Row` ~L583-590; add `Hint`)

**Interfaces:**
- Consumes from Task 1: `deriveChecklist`, `ACHIEVE_ELEMENTS`, `ACHIEVE_TERMS`.
- Produces: none (leaf UI).

- [ ] **Step 1: Update imports**

At the top of `src/pages/AchievePortalPage.tsx`, change the lucide import to add `Check` and `X`, add the popover + checklist imports. Replace:

```tsx
import { ChevronRight, ExternalLink, RefreshCcw } from 'lucide-react'
```

with:

```tsx
import { Check, ChevronRight, ExternalLink, HelpCircle, RefreshCcw, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ACHIEVE_ELEMENTS, ACHIEVE_TERMS, deriveChecklist } from '@/lib/achieve-checklist'
```

- [ ] **Step 2: Identity-first drawer header**

In `AchieveRowsState`, replace the `SheetHeader` block (currently rendering `selected.call_id` as the title):

```tsx
              <SheetHeader className="border-b border-slate-200 bg-white px-6 py-5 text-left">
                <SheetTitle className="break-all font-mono text-base leading-6 text-slate-950">
                  {selected.call_id || '—'}
                </SheetTitle>
              </SheetHeader>
```

with:

```tsx
              <SheetHeader className="space-y-1 border-b border-slate-200 bg-white px-6 py-5 text-left">
                <SheetTitle className="text-base font-semibold leading-6 text-slate-950">
                  {selected.contact_name || 'Unknown contact'}
                </SheetTitle>
                <p className="text-sm text-slate-600">
                  {selected.contact_phone || 'No phone on file'} · {formatDateTime(selected.alert_created_at)}
                </p>
                <p className="break-all font-mono text-xs text-slate-400">Call ID {selected.call_id || '—'}</p>
              </SheetHeader>
```

- [ ] **Step 3: Add the local `Hint` component**

Add this function next to `DrawerSection` in the same file:

```tsx
function Hint({ title, body }: { title: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What does "${title}" mean?`}
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center align-middle text-slate-400 transition-colors hover:text-blue-700"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm leading-snug" onClick={e => e.stopPropagation()}>
        <p className="mb-1 font-semibold text-slate-900">{title}</p>
        <p className="text-slate-600">{body}</p>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Extend `DrawerSection` and `Row` to accept an optional hint**

Replace `DrawerSection`:

```tsx
function DrawerSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 border-b border-slate-100 pb-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  )
}
```

with:

```tsx
function DrawerSection({
  title,
  description,
  hint,
  children,
}: {
  title: string
  description?: string
  hint?: { title: string; body: string }
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          {hint && <Hint title={hint.title} body={hint.body} />}
        </div>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  )
}
```

Replace `Row`:

```tsx
function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{value}</dd>
    </>
  )
}
```

with:

```tsx
function Row({ label, value, hint }: { label: string; value: string; hint?: { title: string; body: string } }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-slate-500">
        {label}
        {hint && <Hint title={hint.title} body={hint.body} />}
      </dt>
      <dd className="min-w-0 break-words text-slate-800">{value}</dd>
    </>
  )
}
```

- [ ] **Step 5: Rewrite `AchieveAlertDetails` body**

Replace the whole `return (...)` of `AchieveAlertDetails` (the `<article>…</article>`). First add two derived values right after the existing `const transcript = trimmedTranscript(alert)` line:

```tsx
  const checklist = deriveChecklist(adherence)
  const verdict = alert.has_violation
    ? `Flagged — ${checklist.total - checklist.coveredCount} of ${checklist.total} required script elements were missing.`
    : 'Passed — all required script elements were covered.'
```

Then replace the returned `<article>` with:

```tsx
  return (
    <article className="space-y-5">
      <DrawerSection title="Call summary">
        <div className="flex flex-wrap items-center gap-2">
          <ResultPill alert={alert} />
          {mode === 'review' && (
            <span className="inline-flex items-center gap-1">
              <AlertStatusPill reviewed={alert.is_reviewed} />
              <Hint title={ACHIEVE_TERMS.needs_review.label} body={ACHIEVE_TERMS.needs_review.definition} />
            </span>
          )}
          {confidence.level && (
            <span className="inline-flex items-center gap-1">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${confidenceTone(confidence.level)}`}>
                Confidence {confidence.level}{confidencePct ? ` · ${confidencePct}` : ''}
              </span>
              <Hint title={ACHIEVE_TERMS.confidence.label} body={ACHIEVE_TERMS.confidence.definition} />
            </span>
          )}
        </div>
        <p className={`mt-3 text-sm font-semibold ${alert.has_violation ? 'text-red-700' : 'text-emerald-700'}`}>
          {verdict}
        </p>
        {alert.call_summary && <p className="mt-3 text-sm leading-6 text-slate-700">{alert.call_summary}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {alert.recording_link && <ExternalLinkButton href={alert.recording_link} label="Recording" />}
        </div>
      </DrawerSection>

      <DrawerSection
        title="What happened on this call"
        description="Each required welcome-call element and whether the agent covered it."
      >
        <div className="mb-3 text-xs font-semibold text-slate-500">
          {checklist.coveredCount} / {checklist.total} covered
        </div>
        <ul className="space-y-2">
          {checklist.rows.map(row => (
            <li key={row.key} className="flex items-center gap-2 text-sm">
              {row.isCovered ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <X className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              )}
              <span className={row.isCovered ? 'text-slate-800' : 'font-medium text-slate-900'}>{row.label}</span>
              <Hint title={row.label} body={row.definition} />
              {!row.isCovered && <span className="ml-auto text-xs font-semibold text-red-700">missing</span>}
            </li>
          ))}
        </ul>
      </DrawerSection>

      <DrawerSection title="QA result" description="What the checker found and why it scored the call this way.">
        <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
          <Row
            label="Overall"
            value={adherence.overall_script_adherence ?? '—'}
            hint={{ title: ACHIEVE_TERMS.script_adherence.label, body: ACHIEVE_TERMS.script_adherence.definition }}
          />
          <Row label="Why" value={adherence.violation_reason ?? '—'} />
        </dl>
      </DrawerSection>

      <DrawerSection
        title="Supporting quotes"
        description="Evidence snippets used by the checker."
        hint={{ title: ACHIEVE_TERMS.supporting_quotes.label, body: ACHIEVE_TERMS.supporting_quotes.definition }}
      >
        {quotes.length ? (
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {quotes.map((quote, index) => <li key={index}>{quote}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No supporting quotes captured yet.</p>
        )}
      </DrawerSection>

      {hasConfidence && (
        <DrawerSection
          title="Scoring confidence"
          hint={{ title: ACHIEVE_TERMS.confidence.label, body: ACHIEVE_TERMS.confidence.definition }}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
            <Row label="Level" value={confidence.level ?? '—'} />
            <Row label="Score" value={confidencePct ?? '—'} />
            <Row label="Rationale" value={confidence.rationale ?? '—'} />
          </dl>
        </DrawerSection>
      )}

      <DrawerSection title="Trimmed transcript" description="Raw transcript from the graded Achieve/FDR segment.">
        {transcript ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs leading-5 text-slate-800">
            {transcript}
          </pre>
        ) : (
          <p className="text-sm text-slate-500">No trimmed transcript is available for this row yet.</p>
        )}
      </DrawerSection>

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-950">Key terms</summary>
        <dl className="mt-4 space-y-3 text-sm">
          {[...ACHIEVE_ELEMENTS, ...Object.values(ACHIEVE_TERMS)].map(term => (
            <div key={term.label}>
              <dt className="font-medium text-slate-900">{term.label}</dt>
              <dd className="text-slate-600">{term.definition}</dd>
            </div>
          ))}
        </dl>
      </details>

      <DrawerSection title="Reviewer feedback" description="Capture whether the QA result is useful/correct and what should happen next.">
        <AchieveFeedbackForm alert={alert} onSubmitted={onFeedbackSubmitted} />
      </DrawerSection>
    </article>
  )
```

Note: this removes the old "Gaps" `Row` (the checklist replaces it) and the duplicated `call_id` heading + "Achieve number" line (now in the header). The now-unused `missing` variable in `AchieveAlertDetails` should be deleted to satisfy lint.

- [ ] **Step 6: Remove the now-unused `missing` binding**

In `AchieveAlertDetails`, delete this line (no longer referenced after the Gaps row is gone):

```tsx
  const missing = Array.isArray(adherence.missing_elements) ? adherence.missing_elements : []
```

- [ ] **Step 7: Lint + typecheck via build**

Run: `npm run lint && npm run build`
Expected: lint clean (no unused-var error for `missing`, no missing imports) and `vite build` succeeds. Fix any type/lint errors before continuing.

- [ ] **Step 8: Visual smoke check (recommended)**

Run the app against demo data and eyeball the drawer:
`VITE_ACHIEVE_DEMO_DATA=true npm run dev`, open the Achieve portal, unlock, open a row. Confirm: header shows contact name + phone (SID demoted); verdict line reads correctly; the "What happened" card shows 6 ✓/✗ rows with a count; ⓘ popovers open with definitions; "Key terms" expands. (The demo alert passes with all elements covered → expect "6 / 6 covered" and the green verdict.)

- [ ] **Step 9: Commit**

```bash
git add src/pages/AchievePortalPage.tsx
git commit -m "Rewire Achieve drawer: identity header, verdict, script checklist, glossary"
```

---

## Self-Review

**1. Spec coverage:**
- Identity-first header (name+phone, demoted SID, drop "Achieve number") → Task 2 Step 2. ✓
- Plain verdict line → Task 2 Step 5. ✓
- Full pass/fail checklist from `script_adherence` → Task 1 (`deriveChecklist`) + Task 2 Step 5 card. ✓
- Robust dual-shape derivation (boolean flag OR loose `missing_elements` match) → Task 1 module + check cases 1–4. ✓
- QA result trimmed (drop Gaps, keep Overall+Why, ⓘ on Overall) → Task 2 Step 5 + Step 6. ✓
- Inline ⓘ tooltips, self-contained → `Hint` (Task 2 Step 3), definitions in Task 1. ✓
- Key-terms `<details>` panel, same source → Task 2 Step 5. ✓
- Agent stays hidden → nothing surfaces `agent_email`. ✓
- No new deps, only the three files → Global Constraints, imports use existing `@/components/ui/popover`. ✓
- Self-check via `npx tsx` (no framework) → Task 1 Steps 2–3. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**3. Type consistency:** `deriveChecklist` returns `{ rows, coveredCount, total }`; consumed as `checklist.coveredCount`/`checklist.total`/`checklist.rows` in Task 2. `ChecklistRow` fields `key/label/definition/isCovered` all used. `ACHIEVE_TERMS[key].label/.definition` and `ACHIEVE_ELEMENTS[].label/.definition` consistent between module and `Hint`/panel usage. `Hint` prop names `title`/`body` match all call sites and the `hint={{ title, body }}` props on `Row`/`DrawerSection`. ✓
