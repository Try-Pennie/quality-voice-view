# Achieve call-detail drawer clarity pass

**Date:** 2026-07-02
**Scope:** `src/pages/AchievePortalPage.tsx` only (the external, password-gated Achieve/FDR portal). No other pages or shared components change.

## Problem

The Achieve call-detail slide-out doesn't make it clear *why* a call was flagged (or not), what went well vs. what didn't, or how to act. Specifically:

- The headline is the Twilio call SID, not the person the call was about.
- The subtitle labels the contact's phone as "Achieve number", which is confusing.
- The only signal for *what happened* is a comma-joined `missing_elements` string of raw `snake_case` keys ("Gaps"). Reviewers see failures only, as jargon, with no contrast against what the agent did cover.
- Reviewers are external (Achieve/FDR) and don't know Eavesly jargon (script adherence, confidence levels, element names), and the existing in-product glossary lives behind the internal `/dashboard/help` route they can't reach.

## Grounding: the FDR welcome-call script

The checker's `result_json.script_adherence` element flags map ~1:1 onto sections of the FDR Welcome Call Script (Wholesale – DB Pilot). Labels and definitions below are drawn from that script.

| Element flag | `missing_elements` key | Script section | What the agent was supposed to do |
|---|---|---|---|
| `welcome_greeting_completed` | `welcome_greeting` | 1. Introduction | Greet, verify identity, give the "recorded for quality" disclosure |
| `program_overview_covered` | `program_overview` | 1. The "three keys" | Explain how the program works: Dedicated Account, creditor negotiation, restructured terms |
| `payment_process_explained` | `payment_process` | Key #1 | Give the first deposit date and deposit frequency into the Dedicated Account |
| `timeline_expectations_covered` | `timeline_expectations` | Keys #2–3 | Set expectations on settlement timing and authorizing new terms quickly |
| `client_communication_process_covered` | `client_communication_process` | Dashboard / Closing | How the client hears from FDR: app/dashboard/email/text notifications, CS line (800-655-6303), "7 days a week" |
| `next_steps_provided` | `next_steps` | Dashboard / Tools | Account/app setup and the Program Guide email — what to do after the call |

Note the two key shapes differ: boolean flags carry suffixes (`_covered`/`_completed`/`_explained`); `missing_elements` entries do not. Derivation must handle both.

## Decisions (from brainstorming)

1. **Full pass/fail checklist** — show all 6 elements as covered/missing, not gaps only.
2. **Both** inline ⓘ tooltips **and** a collapsible key-terms panel, self-contained on the page.
3. **Handling agent stays hidden** — consistent with the recent commit that removed `agent_email` from this view.

## Design

### 1. Header — identity, not the SID
- `SheetTitle` renders `contact_name` (fallback "Unknown contact").
- A muted line beneath shows `contact_phone` + formatted date.
- The call SID (`call_id`) is demoted to a small muted mono "Call ID" line (kept for lookups).
- Remove the "· Achieve number +1…" subtitle from the Call summary card (phone now lives in the header).

### 2. Verdict line — one plain sentence
Above the summary paragraph in the Call summary card, a derived sentence:
- Flagged → "Flagged — {N} of 6 required script elements were missing."
- Pass → "Passed — all required script elements were covered."

Badges (Failed check/Pass · Needs review · Confidence · 85%) stay; jargon badges get an inline ⓘ.

### 3. "What happened on this call" — new card (the core)
- Header with a "{covered} / 6 covered" count.
- Six rows, one per element in the table above, each showing `✓ covered` (green) or `✗ missing` (red), the plain-English label, an inline ⓘ (script-based definition), and a "missing" tag on failed rows.
- Robust derivation, per element:
  `isMissing = adherence[flag] === false || missing_elements.some(m => m === missingKey || m.startsWith(missingKey))`
  `isCovered = !isMissing`
  Works whether the checker emits booleans, a `missing_elements` list, or both. The loose `startsWith` guards against `missing_elements` using the suffixed spelling (`next_steps_provided`) instead of the base (`next_steps`). Covered count = elements where `!isMissing`.

### 4. QA result — trimmed
- Keep **Overall** (`overall_script_adherence`, with ⓘ explaining full/minimal) and **Why** (`violation_reason`).
- Drop the raw **Gaps** row — the checklist now shows gaps visually and in plain English.

### 5. Existing sections — kept
Supporting quotes (+ ⓘ "verbatim transcript evidence"), Scoring confidence, Trimmed transcript, Reviewer feedback — unchanged except added ⓘ icons.

### 6. Key terms panel — new
A native `<details>`/`<summary>` collapsible at the bottom, listing every definition in one place. Reads the same local definitions map that feeds the inline ⓘ tooltips.

## New pieces (all in-file, self-contained)

- **`ACHIEVE_TERMS`** — local map `{ key: { label, definition } }` for the 6 elements plus jargon (script adherence, confidence, needs review, supporting quotes). Single source of truth for both the inline ⓘ and the key-terms panel.
- **`TermHint`** — small ⓘ using `@/components/ui/popover` (Radix, already a dependency). No link out to the internal glossary.
- **`deriveChecklist(adherence)`** — pure function returning the 6 rows (`{ key, label, isCovered }`) and the covered count.

### Definitions (from the script)

- **Script adherence** — How closely the agent followed the required welcome-call script. "Full" = everything covered; "minimal" = most required elements missing.
- **Confidence** — How sure the automated checker is about this result, based on transcript/audio quality. Low confidence is worth a closer listen.
- **Needs review** — A human hasn't confirmed this result yet.
- **Supporting quotes** — Verbatim snippets pulled from the transcript that the checker used as evidence.
- (Six element definitions as in the grounding table.)

## Testing

The repo has **no test runner** (no vitest/jest, no `test` script) and ponytail says don't add a framework for one check. So: extract `deriveChecklist` to a small pure module (`src/lib/achieve-checklist.ts`, no React import) and leave a committed `src/lib/achieve-checklist.check.ts` beside it — a plain `node:assert` self-check, runnable with `npx tsx src/lib/achieve-checklist.check.ts` (no devDependency, no config). It covers: booleans-only input, `missing_elements`-only input (base + suffixed spellings), both present, and empty/undefined `script_adherence` (all 6 default to covered). Run it once to prove green before finishing.

## Deliberately skipped (ponytail)

- No "not applicable" element state. The script allows skipping app setup, but the checker doesn't emit N/A. Add only if real data shows it.
- No auto-derived action-nudge line (the plain checklist was chosen over the action variant).
- No changes to shared components, the internal glossary, or the queue row list.
