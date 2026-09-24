import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Flag, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ACTION_TAKEN_LABELS, INACCURACY_REASON_LABELS } from '../../lib/alert-queries'
import {
  decideFullQaRuleProposal,
  fetchFullQaReviewContext,
  initialFullQaCorrections,
  parseFullQaReviewDraft,
  proposeFullQaRule,
  submitFullQaReview,
  valueAtPath,
  type FullQaCriterion,
  type FullQaCriterionCorrection,
  type FullQaDraftResult,
  type FullQaFinding,
  type FullQaFindingCategory,
  type FullQaReviewContext,
  type FullQaReviewDraft,
} from '../../lib/full-qa-review'
import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '../../types/database'
import type { UserScope } from '../../lib/alert-queries'
import { formatDateTime } from '../../lib/utils'
import { INTERNAL_REVIEW_TEXT_LIMITS } from '../../lib/internal-alert-review'
import { ReviewChoice } from './ReviewChoice'
import type { FullQaEvidenceFeedback, FullQaEvidenceReference } from '../../lib/full-qa-evidence'

/** The review footer submits this form, so the primary action stays reachable while scrolling. */
export const FULL_QA_FORM_ID = 'full-qa-review-form'

/** Footer-facing save state and navigation to the incomplete section; never a separate validation policy. */
export type FullQaSaveState = { readonly disabled: boolean; readonly label: string; readonly message: string | null; readonly nextSectionId: string | null }

const CATEGORY_LABELS: Record<FullQaFindingCategory, string> = {
  compliance: 'Compliance', customer_experience: 'Customer experience', sales_process: 'Sales process',
  program_expectations: 'Program expectations', severe_customer_mistreatment: 'Severe customer mistreatment',
}
const ACTIONS: readonly AlertActionTaken[] = ['coached', 'escalated', 'follow_up_later', 'no_action_needed']
const REASONS: readonly AlertInaccuracyReason[] = ['addressed_off_call', 'evidence_misquoted', 'wrong_context', 'covered_not_verbatim', 'call_dropped_incomplete', 'policy_does_not_apply', 'soft_inquiry_misclassified', 'other']
const IDLE_SAVE: FullQaSaveState = { disabled: true, label: 'Save review', message: null, nextSectionId: null }

interface Props {
  readonly alert: AlertWithFeedback
  readonly scope: UserScope
  readonly editable: boolean
  readonly canReloadReview: boolean
  readonly renderAudioLink?: (quote: string, speaker?: string) => ReactNode
  readonly onStaleReview: () => void
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onBusyChange: (busy: boolean) => void
  readonly onSaveStateChange: (state: FullQaSaveState) => void
  readonly onSubmitted: (updated: Partial<AlertWithFeedback>) => void
}

type LocalDraft = Omit<FullQaReviewDraft, 'escalationJustified'> & { readonly escalationJustified: boolean | null }

function ReviewText({ id, label, value, onChange, disabled, placeholder, showEmptyHint = false, required = true }: {
  readonly required?: boolean
  readonly id?: string
  readonly showEmptyHint?: boolean
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
  readonly placeholder?: string
}) {
  const hintId = useId()
  const length = Array.from(value.trim()).length
  const { min, max } = INTERNAL_REVIEW_TEXT_LIMITS
  return <>
    <textarea id={id} aria-label={label} aria-required={required} aria-describedby={hintId} aria-invalid={length > max || (required && (showEmptyHint || length > 0) && length < min)}
      disabled={disabled} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)}
      className="pennie-focus-ring mt-1 min-h-20 w-full rounded-lg border border-border bg-white p-2 text-base font-normal sm:text-sm" />
    <span id={hintId} className={(showEmptyHint && length === 0) || (length > 0 && (length < min || length >= max - 200)) ? 'mt-1 block text-xs font-normal text-pennie-graphite/70' : 'sr-only'}>{required ? `${min}–` : 'Up to '}{max.toLocaleString('en-US')} characters · {length.toLocaleString('en-US')} entered</span>
  </>
}

function serializeDraft(value: LocalDraft): string {
  return JSON.stringify(value)
}

function scoreLabel(value: unknown): string {
  switch (value) {
    case 'pass': return 'Meets the rule'
    case 'fail': return 'Does not meet the rule'
    case 'not_applicable': return 'Not required on this call'
    case true: return 'Covered'
    case false: case 'missing': return 'Not covered'
    case 'partial': return 'Partly covered'
    case 'complete': return 'Complete'
    case 'excellent': return 'Excellent'
    case 'good': return 'Good'
    case 'fair': return 'Could improve'
    case 'poor': return 'Poor'
    default: return typeof value === 'string' ? value.replace(/_/g, ' ') : 'Unavailable'
  }
}

function correctionLabels(correction: FullQaCriterionCorrection) {
  switch (correction.disposition) {
    case 'confirmed': return { saved: 'Kept Eavesly’s result', summary: 'manager kept Eavesly’s result' }
    case 'corrected': return { saved: `Changed to: ${scoreLabel(correction.correctedValue)}`, summary: `manager changed to ${scoreLabel(correction.correctedValue)}` }
    case 'partially_correct': return { saved: 'Partly correct', summary: 'manager marked partly correct' }
    case 'needs_context': return { saved: 'Needs more context', summary: 'manager needs more context' }
  }
}

function savedText(input: unknown): string | null {
  return typeof input === 'string' && input.trim() ? input.trim() : null
}

function savedNotes(input: unknown): readonly string[] {
  return Array.isArray(input) ? input.flatMap(value => {
    const text = savedText(value)
    return text ? [text] : []
  }) : []
}

// These are saved criterion notes, not reasons inferred from the score or the rule.
function criterionNotes(source: unknown, key: string, evidence: unknown): readonly string[] {
  if (key === 'accurate_representations' || key === 'no_misleading_claims') return savedNotes(evidence)
  const step = /^step([1-6])_/.exec(key)
  const gaps = valueAtPath(source, 'sales_process_scorecard.section_gap_reasons')
  if (step && Array.isArray(gaps)) return gaps.flatMap(gap => {
    const reason = savedText(valueAtPath(gap, 'reason'))
    return valueAtPath(gap, 'section') === Number(step[1]) && reason ? [reason] : []
  })
  // Evidence context describes when/where a quote occurred; it is not model rationale.
  return []
}

function evidenceEntries(evidence: unknown): readonly unknown[] {
  return Array.isArray(evidence) ? evidence : evidence == null ? [] : [evidence]
}

// Text seeded into a coaching issue: only saved notes and attributed quotes, never a derived conclusion.
function seededEvidence(evidence: unknown, notes: readonly string[]): string {
  const lines = evidenceEntries(evidence).flatMap(entry => {
    if (typeof entry === 'string') return savedText(entry) ? [entry.trim()] : []
    const quote = savedText(valueAtPath(entry, 'quote'))
    if (!quote) return []
    const attribution = [savedText(valueAtPath(entry, 'speaker')) ?? 'Speaker not saved', savedText(valueAtPath(entry, 'process_step'))].filter(value => value !== null).join(' · ')
    const context = savedText(valueAtPath(entry, 'context'))
    return [`${attribution}: “${quote}”`, ...(context ? [`Saved context: ${context}`] : [])]
  })
  return [...new Set([...notes, ...lines])].join('\n')
}

function EvidenceFeedbackCard({ reference, index, feedback, editable, disabled, renderAudioLink, onChange }: {
  readonly reference: FullQaEvidenceReference
  readonly index: number
  readonly feedback: FullQaEvidenceFeedback | undefined
  readonly editable: boolean
  readonly disabled: boolean
  readonly renderAudioLink?: (quote: string, speaker?: string) => ReactNode
  readonly onChange: (feedback: FullQaEvidenceFeedback | null) => void
}) {
  const question = reference.claimKind === 'general_focus'
    ? reference.evidenceKind === 'note' ? 'Was Eavesly right to flag this saved note for review?' : 'Was Eavesly right to flag this passage for review?'
    : reference.evidenceKind === 'note' ? 'Does this saved note support Eavesly’s claim?'
      : 'Does this evidence support Eavesly’s claim?'
  const guidance = reference.claimKind === 'general_focus'
    ? 'Judge whether this passage belonged in manager review—not transcript spelling.'
    : 'Judge whether the saved evidence supports the claim—not transcript spelling.'
  const missingMessage = reference.claimKind === 'general_focus'
    ? 'No readable passage or note was saved for this general review focus.'
    : 'No readable evidence was saved for this claim. Check the transcript before judging it.'
  const attribution = [reference.speaker ?? (reference.evidenceKind === 'quote' ? 'Speaker not saved' : null), reference.processStep].filter(Boolean).join(' · ')
  return <div role="group" aria-label={`${reference.claimLabel} evidence ${index + 1}`} className="space-y-3 rounded-xl border border-border bg-white p-3">
    {reference.evidenceKind === 'quote' ? <figure className="space-y-1">
      {attribution && <figcaption className="text-xs font-semibold text-pennie-graphite/70">{attribution}</figcaption>}
      <blockquote className="whitespace-pre-wrap break-words border-l-2 border-pennie-yellow-dark pl-3 text-sm leading-relaxed text-pennie-graphite">{reference.text}</blockquote>
      {reference.context && <p className="whitespace-pre-wrap break-words text-xs text-pennie-graphite/80"><span className="font-semibold">Saved context: </span>{reference.context}</p>}
      {reference.text && renderAudioLink?.(reference.text, reference.speaker ?? undefined)}
    </figure> : reference.evidenceKind === 'note' ? <div>
      <p className="text-xs font-semibold text-pennie-graphite/70">Saved note — not a transcript quote</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-pennie-graphite">{reference.text}</p>
    </div> : <p className="text-sm text-pennie-graphite">{missingMessage}</p>}
    {editable && reference.evidenceKind !== 'missing' ? <div className="space-y-2 border-t border-border pt-3">
      <fieldset disabled={disabled}>
        <legend className="text-sm font-semibold text-pennie-navy">{question} <span className="font-normal">(optional)</span></legend>
        <p className="mt-1 text-xs text-pennie-graphite/70">{guidance}</p>
        <div className="mt-2 flex flex-wrap gap-2">{([{ disposition: 'correct', label: 'Correct' }, { disposition: 'incorrect', label: 'Incorrect' }, { disposition: 'partly_correct', label: 'Partly correct' }] as const).map(option => <label key={option.disposition} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${feedback?.disposition === option.disposition ? 'border-pennie-blue-deeper bg-pennie-blue-light text-pennie-navy' : 'border-border text-pennie-graphite hover:bg-pennie-blue-light/50'}`}>
          <input type="radio" name={`evidence-${reference.referenceId}`} aria-label={`Evidence: ${option.label}`} checked={feedback?.disposition === option.disposition} onChange={() => onChange({ referenceId: reference.referenceId, disposition: option.disposition, comment: feedback?.comment ?? null })} className="pennie-focus-ring h-4 w-4 accent-pennie-blue-deeper" />
          {option.label}
        </label>)}</div>
      </fieldset>
      {feedback && <>
        <label className="block text-sm font-semibold">Comment <span className="font-normal">(optional)</span><ReviewText required={false} label={`${reference.claimLabel} evidence comment`} disabled={disabled} value={feedback.comment ?? ''} placeholder={reference.claimKind === 'general_focus' ? 'Add context for why this passage was or was not worth flagging.' : 'Add context for this evidence and claim.'} onChange={comment => onChange({ ...feedback, comment: comment || null })} /></label>
        <button type="button" disabled={disabled} onClick={() => onChange(null)} className="pennie-focus-ring min-h-[44px] text-xs font-semibold text-pennie-blue-deeper">Clear passage response</button>
      </>}
    </div> : feedback ? <div className="border-t border-border pt-3 text-sm text-pennie-graphite">
      <p className="text-xs font-bold text-pennie-blue-deeper">Saved passage response</p>
      <p className="mt-1 font-semibold text-pennie-navy">{feedback.disposition === 'partly_correct' ? 'Partly correct' : feedback.disposition === 'correct' ? 'Correct' : 'Incorrect'}</p>
      {feedback.comment && <p className="mt-1 whitespace-pre-wrap break-words">{feedback.comment}</p>}
    </div> : reference.evidenceKind === 'missing' ? <p className="border-t border-border pt-3 text-xs text-pennie-graphite/70">No passage response is available because no readable evidence was saved. {reference.claimKind === 'criterion' ? 'Use the optional criterion adjustment below if needed.' : 'The overall alert decision remains separate.'}</p>
      : <p className="border-t border-border pt-3 text-xs text-pennie-graphite/70">No passage-level response was recorded.</p>}
  </div>
}

function ReasonText({ text, violations }: { readonly text: string | null; readonly violations: readonly string[] }) {
  return <>
    {text ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-pennie-graphite">{text}</p>
      : <p className="mt-2 text-sm text-pennie-graphite">No alert reason saved.</p>}
    {violations.length > 0 && <details className="mt-2 text-sm">
      <summary className="pennie-focus-ring flex min-h-[36px] cursor-pointer items-center text-xs font-semibold text-pennie-blue-deeper">Recorded compliance issues ({violations.length})</summary>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-pennie-graphite">{violations.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{item}</li>)}</ul>
    </details>}
  </>
}

function sourceNotice(context: FullQaReviewContext) {
  if (context.sourceReferenceKind === 'known') return `Exact production rubric · ${context.sourcePromptSha256}`
  if (context.sourceReferenceKind === 'legacy_current_reference') return `Original rubric unknown; current reference only · ${context.referencePromptSha256}`
  return `Original rubric unavailable for stamped hash ${context.sourcePromptSha256}; current field map only. Current rules are not shown as original.`
}

/** Pinned manager outcome for read-only viewers: verdict, action, issues, and score changes from the saved revision. */
function ManagerReviewOutcome({ context }: { readonly context: FullQaReviewContext }) {
  const review = context.review
  if (!review) return null
  const label = (key: string) => context.criteria.find(item => item.key === key)?.label ?? key
  const originalLabel = (key: string) => {
    const criterion = context.criteria.find(item => item.key === key)
    const original = criterion ? valueAtPath(context.sourceResult, criterion.scorePath) : undefined
    return scoreLabel(criterion?.domain.find(value => value === original))
  }
  const changed = review.corrections.filter(item => item.disposition !== 'confirmed')
  const evidenceLabel = (referenceId: string) => context.evidenceReferences.find(item => item.referenceId === referenceId)?.claimLabel ?? 'Unavailable saved claim'
  return <section aria-label="Manager’s review" className="space-y-3 rounded-2xl border border-pennie-blue-deeper bg-pennie-blue-light p-4 sm:p-5">
    <div>
      <h2 className="text-lg font-semibold text-pennie-navy">Manager’s review</h2>
      <p className="text-xs text-pennie-graphite/70">Saved {formatDateTime(review.savedAt)} by {review.savedBy} · revision {review.feedbackRevision}</p>
    </div>
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-sm text-pennie-graphite [&>dd]:mb-2 sm:grid-cols-[auto_1fr] sm:[&>dd]:mb-0">
      <dt className="font-semibold text-pennie-navy">Alert warranted</dt>
      <dd className="font-semibold">{review.escalationJustified ? 'Yes' : 'No'}{review.inaccuracyReason ? ` · ${INACCURACY_REASON_LABELS[review.inaccuracyReason]}` : ''}</dd>
      <dt className="font-semibold text-pennie-navy">{review.escalationJustified ? 'Review summary' : 'Manager’s reason'}</dt>
      <dd className="whitespace-pre-wrap break-words">{review.escalationReason || 'No additional feedback recorded.'}</dd>
    </dl>
    <div className="text-sm text-pennie-graphite">
      <p className="font-semibold text-pennie-navy">Coaching issues ({review.findings.length})</p>
      {review.findings.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{review.findings.map(finding => <li key={finding.findingId} className="break-words">{finding.summary} <span className="text-xs text-pennie-graphite/70">({CATEGORY_LABELS[finding.category]} · {finding.relatedCriteria.map(label).join(', ')})</span>
        <details className="mt-1"><summary className="pennie-focus-ring min-h-[44px] cursor-pointer py-3.5 text-xs font-semibold text-pennie-blue-deeper sm:min-h-0 sm:py-0">Manager’s evidence</summary><p className="mt-1 whitespace-pre-wrap break-words text-sm">{finding.evidence}</p></details></li>)}</ul> : <p className="mt-1">None recorded.</p>}
    </div>
    <div className="text-sm text-pennie-graphite">
      <p className="font-semibold text-pennie-navy">{review.escalationJustified ? 'What action did you take?' : 'Follow-up with the rep'}</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{review.actionTaken ? ACTION_TAKEN_LABELS[review.actionTaken] : 'No follow-up recorded'}{review.actionDetails ? ` · ${review.actionDetails}` : ''}</p>
    </div>
    <div className="text-sm text-pennie-graphite">
      <p className="font-semibold text-pennie-navy">Passage-level responses ({review.evidenceFeedback.length})</p>
      {review.evidenceFeedback.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{review.evidenceFeedback.map(item => <li key={item.referenceId} className="break-words"><span className="font-semibold">{evidenceLabel(item.referenceId)}</span>: {item.disposition === 'partly_correct' ? 'Partly correct' : item.disposition === 'correct' ? 'Correct' : 'Incorrect'}{item.comment ? ` — ${item.comment}` : ''}</li>)}</ul> : <p className="mt-1">No passage-level responses recorded. Unanswered evidence remains unreviewed.</p>}
    </div>
    <div className="text-sm text-pennie-graphite">
      <p className="font-semibold text-pennie-navy">Saved criterion-level opinions ({changed.length})</p>
      <p className="mt-1 text-xs text-pennie-graphite/70">These score opinions are separate from passage-level responses.</p>
      {changed.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{changed.map(item => <li key={item.criterionKey} className="break-words"><span className="font-semibold">{label(item.criterionKey)}</span>: Eavesly said {originalLabel(item.criterionKey)} → {correctionLabels(item).summary}{item.reason ? ` — ${item.reason}` : ''}</li>)}</ul> : <p className="mt-1">No criterion-level score corrections recorded. Unanswered scores are not manager-confirmed.</p>}
    </div>
  </section>
}

/** An alert decision with optional explicit score feedback and coaching; original AI judgments stay immutable. */
export function FullQaRubricReview({ alert, scope, editable, canReloadReview, renderAudioLink, onStaleReview, onDirtyChange, onBusyChange, onSaveStateChange, onSubmitted }: Props) {
  const queryClient = useQueryClient()
  const scorecardId = useId()
  const [showFullScorecard, setShowFullScorecard] = useState(false)
  const query = useQuery({ queryKey: ['fullQaReviewContext', alert.call_id], queryFn: () => fetchFullQaReviewContext(alert.call_id) })
  const context = query.data
  const initializedFor = useRef<string | null>(null)
  const contextToken = useRef('')
  // Pin both optimistic locks to the draft, never to independently refreshed alert metadata.
  const reviewIdentity = useRef<{ revision: number; decisionId: number | null }>({ revision: 0, decisionId: null })
  const [staleReview, setStaleReview] = useState(false)
  const baseline = useRef('')
  const [corrections, setCorrections] = useState<readonly FullQaCriterionCorrection[]>([])
  const [evidenceFeedback, setEvidenceFeedback] = useState<readonly FullQaEvidenceFeedback[]>([])
  const [findings, setFindings] = useState<readonly FullQaFinding[]>([])
  // No verdict is preselected locally; the saved contract stays boolean.
  const [escalationJustified, setEscalationJustified] = useState<boolean | null>(null)
  const [escalationReason, setEscalationReason] = useState('')
  const [inaccuracyReason, setInaccuracyReason] = useState<AlertInaccuracyReason | null>(null)
  const [actionTaken, setActionTaken] = useState<AlertActionTaken | null>(null)
  const [actionDetails, setActionDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [proposalCriterion, setProposalCriterion] = useState('')
  const [proposalText, setProposalText] = useState('')
  const [proposalWhy, setProposalWhy] = useState('')
  const [proposalPending, setProposalPending] = useState(false)
  const [proposalDecisionPending, setProposalDecisionPending] = useState(false)
  const [decisionReason, setDecisionReason] = useState<Record<number, string>>({})

  const draft = useMemo((): LocalDraft => ({ corrections, evidenceFeedback, findings, escalationJustified, escalationReason,
    inaccuracyReason: escalationJustified === true ? null : inaccuracyReason, actionTaken,
    actionDetails: actionDetails || null }), [corrections, evidenceFeedback, findings, escalationJustified, escalationReason, inaccuracyReason, actionTaken, actionDetails])

  const loadContext = useCallback((nextContext: FullQaReviewContext) => {
    const next: LocalDraft = { corrections: initialFullQaCorrections(nextContext), evidenceFeedback: nextContext.review?.evidenceFeedback ?? [], findings: nextContext.review?.findings ?? [],
      escalationJustified: nextContext.review?.escalationJustified ?? null,
      escalationReason: nextContext.review?.escalationReason ?? '',
      inaccuracyReason: nextContext.review?.inaccuracyReason ?? null,
      actionTaken: nextContext.review?.actionTaken ?? null,
      actionDetails: nextContext.review?.actionDetails ?? null }
    setCorrections(next.corrections); setEvidenceFeedback(next.evidenceFeedback); setFindings(next.findings); setEscalationJustified(next.escalationJustified)
    setEscalationReason(next.escalationReason); setInaccuracyReason(next.inaccuracyReason); setActionTaken(next.actionTaken); setActionDetails(next.actionDetails ?? '')
    setProposalCriterion(nextContext.criteria[0]?.key ?? '')
    setShowFullScorecard(false)
    baseline.current = serializeDraft({ ...next,
      inaccuracyReason: next.escalationJustified === true ? null : next.inaccuracyReason,
      actionTaken: next.actionTaken,
      actionDetails: next.actionDetails || null,
    })
    contextToken.current = `${nextContext.sourceFingerprint}:${nextContext.review?.feedbackRevision ?? 0}`
    reviewIdentity.current = { revision: nextContext.review?.feedbackRevision ?? alert.review_revision ?? 0, decisionId: alert.current_decision_id ?? null }
    setStaleReview(false)
    initializedFor.current = alert.call_id
  }, [alert.call_id, alert.review_revision, alert.current_decision_id])

  useEffect(() => {
    if (!context || initializedFor.current === alert.call_id) return
    loadContext(context)
  }, [context, alert.call_id, loadContext])

  // Loading the initial server snapshot is not a user edit (including the render
  // before loadContext initializes the local draft).
  const reviewDirty = !!context && initializedFor.current === alert.call_id && serializeDraft(draft) !== baseline.current
  const proposalDirty = !!proposalText.trim() || !!proposalWhy.trim() || Object.values(decisionReason).some(value => !!value.trim())
  const dirty = reviewDirty || proposalDirty
  const busy = saving || proposalPending || proposalDecisionPending
  const latestContextToken = context ? `${context.sourceFingerprint}:${context.review?.feedbackRevision ?? 0}` : ''
  const contextChanged = staleReview || (!!context && !!contextToken.current && latestContextToken !== contextToken.current)
  const parsed: FullQaDraftResult = !context ? { ok: false, message: 'Loading the Full QA rubric.', section: 'scores' }
    : parseFullQaReviewDraft(context, { ...draft, findings: escalationJustified === true ? findings : [] })
  const saveDisabled = !editable || busy || parsed.ok === false || !reviewDirty || contextChanged
  const saveLabel = saving ? 'Saving…' : context?.review ? 'Update review' : 'Save review'
  const saveMessage = query.isError ? 'Review unavailable. Retry above.'
    : !context || initializedFor.current !== alert.call_id ? 'Loading review…'
      : contextChanged ? 'This review changed. Reload it before continuing.'
        : busy ? 'Please wait for the current change to finish.'
          : context.review && !reviewDirty ? 'No unsaved review changes.'
            : parsed.ok === false ? reviewDirty ? parsed.message : 'Choose whether this alert was warranted. Score feedback and coaching are optional.' : null
  const nextSectionId = context && initializedFor.current === alert.call_id && !query.isError && !contextChanged && !busy && parsed.ok === false
    ? parsed.finding ? `${scorecardId}-finding-${parsed.finding.id}-${parsed.finding.field}` : `${scorecardId}-${parsed.section}` : null
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => { onSaveStateChange({ disabled: saveDisabled, label: saveLabel, message: saveMessage, nextSectionId }) }, [saveDisabled, saveLabel, saveMessage, nextSectionId, onSaveStateChange])
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); onSaveStateChange(IDLE_SAVE) }, [onDirtyChange, onBusyChange, onSaveStateChange])

  if (query.isPending) return <section className="rounded-2xl border border-border p-4 text-sm text-muted-foreground">Loading review…</section>
  if (query.isError || !context) return <section className="rounded-2xl border border-pennie-peach-dark bg-pennie-peach-light/30 p-4 text-sm">
    <p className="font-semibold text-pennie-navy">Full QA rubric context unavailable</p>
    <p className="mt-1 text-pennie-graphite">We couldn’t load the information needed to review this call. Please retry.</p>
    <button type="button" onClick={() => query.refetch()} className="mt-3 min-h-[36px] rounded-full border border-border px-3 font-semibold">Retry</button>
  </section>

  // This is a display filter, not an escalation rule. Keep the immutable AI concerns
  // and saved/draft human changes visible even after a score is corrected to pass.
  const aiConcernKeys = new Set(context.criteria.filter(criterion => {
    const original = valueAtPath(context.sourceResult, criterion.scorePath)
    if (!criterion.domain.some(value => value === original)) return false
    if (criterion.findingCategory === 'program_expectations') {
      return original === false && valueAtPath(context.sourceResult, 'program_expectations_scorecard.section_status') !== 'not_applicable'
        && valueAtPath(context.sourceResult, 'program_expectations_scorecard.enrollment_completed') !== false
    }
    return original === 'fail' || original === 'poor' || original === 'fair' || original === 'partial' || original === 'missing'
  }).map(criterion => criterion.key))
  const evidenceResponseIds = new Set([...evidenceFeedback, ...(context.review?.evidenceFeedback ?? [])].map(item => item.referenceId))
  const attentionKeys = new Set(context.criteria.filter(criterion => aiConcernKeys.has(criterion.key)
    || [corrections, context.review?.corrections ?? []].some(items => items.some(item => item.criterionKey === criterion.key && item.disposition !== 'confirmed'))
    || [...findings, ...(context.review?.findings ?? [])].some(item => item.relatedCriteria.includes(criterion.key))
    || context.evidenceReferences.some(item => item.claimKind === 'criterion' && item.claimKey === criterion.key && evidenceResponseIds.has(item.referenceId))
    || !criterion.domain.some(value => value === valueAtPath(context.sourceResult, criterion.scorePath))).map(criterion => criterion.key))
  const reviewReason = savedText(valueAtPath(context.sourceResult, 'call_overview.manager_review_reason'))
  const recordedViolations = savedNotes(valueAtPath(context.sourceResult, 'compliance_scorecard.compliance_violations'))
  const requestedReview = valueAtPath(context.sourceResult, 'call_overview.manager_review_required')
  const programSummary = savedText(valueAtPath(context.sourceResult, 'program_expectations_scorecard.section_summary'))
  const programGaps = savedNotes(valueAtPath(context.sourceResult, 'program_expectations_scorecard.missing_elements'))
  const hasProgramConcerns = context.criteria.some(criterion => criterion.findingCategory === 'program_expectations' && aiConcernKeys.has(criterion.key))
  const practiceFalsePositive = import.meta.env.MODE === 'staging'
    && valueAtPath(context.sourceResult, '_synthetic_staging') === true
    && ['DEMO-REVIEW-001', 'DEMO-REVIEW-002', 'DEMO-REVIEW-003', 'DEMO-APPROVAL-001', 'DEMO-CONFIRMED-001', 'DEMO-OLDER-001', 'DEMO-OTHER-TEAM-001'].includes(alert.call_id)
  const practiceSupported = import.meta.env.MODE === 'staging'
    && valueAtPath(context.sourceResult, '_synthetic_staging') === true && alert.call_id === 'DEMO-SUPPORTED-001'
  const locked = busy || contextChanged
  const updateEvidenceFeedback = (referenceId: string, next: FullQaEvidenceFeedback | null) => setEvidenceFeedback(items => {
    const current = items.find(item => item.referenceId === referenceId)
    if (next === null) return items.filter(item => item.referenceId !== referenceId)
    return current ? items.map(item => item.referenceId === referenceId ? next : item) : [...items, next]
  })
  const updateCorrection = (key: string, patch: Partial<FullQaCriterionCorrection>) => setCorrections(items => {
    const current = items.find(item => item.criterionKey === key)
    const next: FullQaCriterionCorrection = { criterionKey: key, disposition: 'corrected', correctedValue: null, reason: null, ...current, ...patch }
    return current ? items.map(item => item.criterionKey === key ? next : item) : [...items, next]
  })
  const updateFinding = (id: string, patch: Partial<FullQaFinding>) => setFindings(items => items.map(item => item.findingId === id ? { ...item, ...patch } : item))
  const findingElementId = (id: string) => `${scorecardId}-finding-${id}`
  const focusFinding = (id: string) => {
    const element = document.getElementById(findingElementId(id))
    element?.scrollIntoView({ block: 'center' })
    element?.querySelector('textarea')?.focus()
  }
  // Explicit manager action only. Seeds criterion metadata and saved evidence; the summary stays the manager's words.
  const addIssueFromCriterion = (criterion: FullQaCriterion, evidence: unknown, notes: readonly string[]) => {
    const findingId = crypto.randomUUID()
    setFindings(items => [...items, { findingId, category: criterion.findingCategory, relatedCriteria: [criterion.key], summary: '', evidence: seededEvidence(evidence, notes) }])
  }
  const addBlankIssue = () => setFindings(items => [...items, { findingId: crypto.randomUUID(), category: 'compliance', relatedCriteria: [], summary: '', evidence: '' }])

  const save = async () => {
    if (contextChanged) { toast.error('The saved source or revision changed. Reload it before saving.'); return }
    if (parsed.ok === false || busy || !reviewDirty || !editable) { if (parsed.ok === false) toast.error(parsed.message); return }
    setSaving(true)
    const result = await submitFullQaReview({ callId: alert.call_id, expectedRevision: reviewIdentity.current.revision,
      expectedDecisionId: reviewIdentity.current.decisionId, expectedSourceFingerprint: context.sourceFingerprint, draft: parsed.value })
    setSaving(false)
    if (result.ok === false) {
      toast.error(`Couldn't save Full QA review: ${result.error.message}`)
      if (result.error._tag === 'StaleReview') {
        setStaleReview(true)
        onStaleReview()
        await query.refetch()
      }
      return
    }
    // Replace locally edited values with the normalized payload that was persisted.
    setEvidenceFeedback(parsed.value.evidenceFeedback)
    // Keep hidden coaching in the draft until the manager successfully saves No.
    setFindings(parsed.value.findings)
    baseline.current = serializeDraft(parsed.value)
    contextToken.current = `${context.sourceFingerprint}:${result.value.reviewRevision}`
    reviewIdentity.current = { revision: result.value.reviewRevision, decisionId: null }
    onDirtyChange(false)
    onSubmitted({ feedback_id: result.value.feedbackId, feedback_by: scope.email, is_reviewed: true,
      accurate: parsed.value.escalationJustified, inaccuracy_reason: parsed.value.inaccuracyReason,
      action_taken: parsed.value.actionTaken, violation_details: parsed.value.escalationReason, action_details: parsed.value.actionDetails,
      feedback_comment: parsed.value.escalationJustified ? null : parsed.value.escalationReason, reviewed_at: result.value.reviewedAt,
      review_revision: result.value.reviewRevision, current_decision_id: null, current_decision: null,
      current_decision_by: null, current_decision_instructions: null, current_decided_at: null, current_decision_source: null })
    await queryClient.invalidateQueries({ queryKey: ['fullQaReviewContext', alert.call_id] })
    toast.success(alert.current_decision ? 'Full QA review resubmitted' : 'Full QA review saved')
  }

  const submitProposal = async () => {
    if (!context.review || proposalPending) return
    setProposalPending(true)
    const result = await proposeFullQaRule({ callId: alert.call_id, feedbackRevision: context.review.feedbackRevision,
      criterionKey: proposalCriterion, proposedRule: proposalText.trim(), why: proposalWhy.trim() })
    setProposalPending(false)
    if (result.ok === false) { toast.error(`Couldn't submit proposal: ${result.error.message}`); return }
    setProposalText(''); setProposalWhy('')
    await query.refetch()
    toast.success('Rule proposed for evaluation review — production scoring is unchanged')
  }

  const decideProposal = async (id: number, decision: 'accepted_for_evaluation' | 'rejected') => {
    setProposalDecisionPending(true)
    const result = await decideFullQaRuleProposal({ proposalId: id, decision, reason: decisionReason[id] ?? '' })
    setProposalDecisionPending(false)
    if (result.ok === false) { toast.error(`Couldn't decide proposal: ${result.error.message}`); return }
    setDecisionReason(value => ({ ...value, [id]: '' }))
    await query.refetch()
    toast.success(decision === 'accepted_for_evaluation' ? 'Approved for evaluation — not published' : 'Proposal rejected')
  }

  const criticalClaimKeys = [...new Set(context.evidenceReferences.filter(item => item.claimKind === 'critical_flag').map(item => item.claimKey))]
  const generalFocusReferences = context.evidenceReferences.filter(item => item.claimKind === 'general_focus')
  const evidenceCard = (reference: FullQaEvidenceReference, index: number) => <EvidenceFeedbackCard key={reference.referenceId}
    reference={reference} index={index} feedback={evidenceFeedback.find(item => item.referenceId === reference.referenceId)}
    editable={editable} disabled={locked} renderAudioLink={renderAudioLink}
    onChange={next => updateEvidenceFeedback(reference.referenceId, next)} />

  const scorecard = <>
    {criticalClaimKeys.map(claimKey => {
      const references = context.evidenceReferences.filter(item => item.claimKind === 'critical_flag' && item.claimKey === claimKey)
      const label = references[0]?.claimLabel ?? 'Unlabeled critical flag'
      return <article key={claimKey} aria-label={label} className="space-y-3 border-b border-border py-5">
        <div><p className="text-xs font-semibold text-pennie-yellow-deeper">Eavesly flagged</p><h3 className="text-base font-semibold text-pennie-navy">{label}</h3></div>
        <div className="space-y-3">{references.map(evidenceCard)}</div>
      </article>
    })}
    {hasProgramConcerns && (programSummary || programGaps.length > 0) && <aside aria-label="Program expectations section notes" className="border-b border-border pb-4 text-sm text-pennie-graphite">
      <p className="font-semibold">Program expectations — saved section notes</p>
      <p className="mt-1 text-xs">These notes cover the whole section, not an individual score. Program-expectations gaps alone do not trigger this alert.</p>
      {programSummary && <p className="mt-2 whitespace-pre-wrap break-words">{programSummary}</p>}
      {programGaps.length > 0 && <ul className="mt-2 list-disc pl-5">{programGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
    </aside>}
    {!showFullScorecard && attentionKeys.size === 0 && <p className="py-4 text-sm text-pennie-graphite">No flagged criteria or review changes to show. Open the full scorecard to inspect other scores; this does not clear the alert.</p>}
    <div id={scorecardId}>{context.criteria.map(criterion => {
      const correction = corrections.find(item => item.criterionKey === criterion.key)
      const original = valueAtPath(context.sourceResult, criterion.scorePath)
      const evidence = valueAtPath(context.sourceResult, criterion.evidencePath)
      const aiConcern = aiConcernKeys.has(criterion.key)
      const originalValue = criterion.domain.find(value => value === original)
      const notes = criterionNotes(context.sourceResult, criterion.key, evidence)
      const saved = context.review?.corrections.find(item => item.criterionKey === criterion.key)
      const humanChanged = [correction, saved].some(item => item && item.disposition !== 'confirmed')
      const linkedIndex = findings.findIndex(item => item.relatedCriteria.includes(criterion.key))
      const label = aiConcern ? original === 'fail' ? 'Eavesly flagged this' : 'Eavesly score concern'
        : originalValue === undefined ? 'Eavesly score unavailable' : humanChanged ? 'Manager review item'
          : attentionKeys.has(criterion.key) ? 'Included in this review' : 'Other Eavesly score'
      const entries = evidenceEntries(evidence)
      const evidenceReferences = context.evidenceReferences.filter(item => item.claimKind === 'criterion' && item.claimKey === criterion.key)
      const sourceHeading = aiConcern ? 'What Eavesly flagged' : 'Eavesly’s assessment'
      const responseHeading = editable ? 'Your review' : 'Manager’s response'
      return <article key={criterion.key} aria-label={criterion.label} hidden={!showFullScorecard && !attentionKeys.has(criterion.key)} className="border-b border-border py-5">
        <div className="min-w-0 space-y-4">
          <section aria-label={`${criterion.label}: ${sourceHeading}`} className="min-w-0 space-y-3">
            <div>
              <p className={`mb-0.5 inline-flex items-center gap-2 text-xs font-bold ${aiConcern ? 'text-pennie-yellow-deeper' : 'text-pennie-blue-deeper'}`}>{aiConcern ? <Flag className="h-4 w-4 shrink-0" aria-hidden="true" /> : <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />}{label}</p>
              <h3 className="min-w-0 break-words text-base font-semibold text-pennie-navy">{criterion.label}</h3>
              <p className="mt-1 text-sm text-pennie-graphite">Eavesly’s result: <strong>{scoreLabel(originalValue)}</strong></p>
            </div>
            {aiConcern && (notes.length > 0 ? <div className="space-y-1 text-sm text-pennie-graphite">
              <p className="text-xs font-semibold">Why this was flagged</p>
              {notes.map((note, index) => <p key={index} className="whitespace-pre-wrap break-words leading-relaxed">{note}</p>)}
            </div> : <p className="text-xs text-pennie-graphite/70">{criterion.findingCategory === 'program_expectations' && (programSummary || programGaps.length > 0) ? 'No separate reason saved for this score; see the saved section notes above.' : 'No reason saved for this score.'}</p>)}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-pennie-graphite">Evidence tied to this claim</p>
              {evidenceReferences.map(evidenceCard)}
            </div>
            <details>
              <summary className="pennie-focus-ring min-h-[44px] cursor-pointer py-3.5 text-xs font-semibold text-pennie-blue-deeper sm:min-h-0 sm:py-0">Rule and saved evidence</summary>
              {context.sourceReferenceKind !== 'unknown_hash' ? <p className="mt-2 text-sm leading-relaxed text-pennie-graphite">{criterion.rule}</p> : <p className="mt-2 text-xs text-pennie-peach-deeper">Original rule unavailable for this stamped hash.</p>}
              {entries.length > 0 && <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(evidence, null, 2)}</pre>}
            </details>
          </section>
          <section aria-label={`${criterion.label}: ${responseHeading}`} className="min-w-0 space-y-3">
            {saved && <div className="border-b border-pennie-blue-main pb-3 text-sm">
              <p className="mb-1 text-xs font-bold text-pennie-blue-deeper">Saved criterion-level opinion</p>
              <p className="font-semibold text-pennie-navy">{correctionLabels(saved).saved}</p>
              {saved.reason && <p className="mt-1 whitespace-pre-wrap break-words text-pennie-graphite">{saved.reason}</p>}
            </div>}
            {editable && <details className="rounded-xl border border-border px-3 py-2">
              <summary className="pennie-focus-ring min-h-[44px] cursor-pointer py-3 text-sm font-semibold text-pennie-blue-deeper">Optional criterion score adjustment</summary>
              <div className="space-y-3 pb-2 pt-1">
              <fieldset disabled={locked} role="radiogroup" aria-label={`${criterion.label} disposition`}>
                <legend className="mb-2 text-sm font-semibold text-pennie-navy">Criterion-level opinion <span className="font-normal">(optional; separate from passage feedback)</span></legend>
                <div className="flex flex-wrap gap-2">{([{ disposition: 'confirmed', label: 'Correct' }, { disposition: 'corrected', label: 'Incorrect' }, { disposition: 'partially_correct', label: 'Partly correct' }] as const).map(({ disposition, label }) => <label key={disposition} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${correction?.disposition === disposition ? 'border-pennie-blue-deeper bg-pennie-blue-light text-pennie-navy' : 'border-border text-pennie-graphite hover:bg-pennie-blue-light/50'}`}>
                  <input type="radio" name={`${scorecardId}-${criterion.key}`} checked={correction?.disposition === disposition} disabled={disposition === 'confirmed' && originalValue === undefined} className="pennie-focus-ring h-4 w-4 accent-pennie-blue-deeper" onChange={() => {
                    if (correction?.disposition === disposition) return
                    if (disposition === 'confirmed') {
                      if (originalValue !== undefined) updateCorrection(criterion.key, { disposition, correctedValue: originalValue, reason: null })
                    } else if (disposition === 'partially_correct') updateCorrection(criterion.key, { disposition, correctedValue: null, reason: correction?.reason ?? '' })
                    else updateCorrection(criterion.key, { disposition, correctedValue: originalValue === undefined ? null : criterion.domain.find(value => value !== original) ?? null, reason: correction?.reason ?? '' })
                  }} />
                  <span className="whitespace-nowrap">{label}</span>
                </label>)}</div>
              </fieldset>
              {correction?.disposition === 'corrected' && <label className="block text-sm font-semibold">What should the result be?<select aria-label={`${criterion.label} corrected value`} disabled={locked} value={correction.correctedValue === null ? '' : String(correction.correctedValue)} onChange={event => updateCorrection(criterion.key, { correctedValue: criterion.domain.find(value => String(value) === event.target.value) ?? null })} className="mt-1 min-h-[44px] w-full rounded-lg border border-border bg-white px-2 font-normal">{originalValue === undefined && <option value="" disabled>Choose a result</option>}{criterion.domain.map(value => <option key={String(value)} value={String(value)}>{scoreLabel(value)}</option>)}</select></label>}
              {originalValue === undefined && !correction && <p className="text-sm text-pennie-graphite">No score was saved. You can still review the alert; correcting this score is optional.</p>}
              {correction && <button type="button" disabled={locked} onClick={() => setCorrections(items => items.filter(item => item.criterionKey !== criterion.key))} className="pennie-focus-ring min-h-[44px] text-xs font-semibold text-pennie-blue-deeper">Clear score response</button>}
              {correction?.disposition === 'corrected' && <label className="block text-sm font-semibold">Why is the assessment incorrect?<ReviewText label={`${criterion.label} correction reason`} disabled={locked} value={correction.reason ?? ''} onChange={reason => updateCorrection(criterion.key, { reason })} /></label>}
              {correction?.disposition === 'partially_correct' && <label className="block text-sm font-semibold">Which parts are right or wrong?<ReviewText label={`${criterion.label} partly correct explanation`} disabled={locked} value={correction.reason ?? ''} placeholder="A brief explanation is enough. No replacement score or coaching plan needed." onChange={reason => updateCorrection(criterion.key, { reason })} /></label>}
              </div>
            </details>}
            {!editable && !saved && <p className="text-sm text-pennie-graphite/70">No criterion-level opinion was recorded.</p>}
            {editable && escalationJustified === true && (linkedIndex >= 0
              ? <button type="button" disabled={locked} onClick={() => focusFinding(findings[linkedIndex].findingId)} className="pennie-focus-ring min-h-[44px] sm:min-h-[36px] text-xs font-semibold text-pennie-blue-deeper underline-offset-4 hover:underline">Edit coaching issue {linkedIndex + 1}</button>
              : <button type="button" disabled={locked} onClick={() => addIssueFromCriterion(criterion, evidence, notes)} className="pennie-focus-ring min-h-[44px] sm:min-h-[36px] rounded-full border border-border px-3 text-xs font-semibold text-pennie-blue-deeper disabled:opacity-40"><Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Add as coaching issue</button>)}
          </section>
        </div>
      </article>
    })}</div>
    {generalFocusReferences.map((reference, index) => <article key={reference.referenceId} aria-label="General review focus" className="space-y-3 border-b border-border py-5">
      <div><h3 className="text-base font-semibold text-pennie-navy">General review focus</h3><p className="text-xs text-pennie-graphite/70">This saved focus was not linked to a specific claim. It stays separate rather than being matched by quote text.</p></div>
      {evidenceCard(reference, index)}
    </article>)}
    <div className="flex flex-wrap items-center justify-end gap-x-3">
      <button type="button" aria-expanded={showFullScorecard} aria-controls={scorecardId} onClick={() => setShowFullScorecard(value => !value)} className="pennie-focus-ring min-h-[44px] rounded-lg py-2 text-sm font-semibold text-pennie-blue-deeper underline-offset-4 hover:underline active:bg-pennie-beige">
        {showFullScorecard ? 'Show only items to check' : `View full scorecard · ${context.criteria.length} criteria`}
      </button>
    </div>
  </>

  return <form id={FULL_QA_FORM_ID} onSubmit={event => { event.preventDefault(); void save() }} className="space-y-6" aria-label="Full QA rubric review">
    {(practiceFalsePositive || practiceSupported) && <aside aria-label="Staging practice guidance" className="text-xs text-pennie-graphite/70">
      <details>
        <summary className="pennie-focus-ring cursor-pointer font-semibold">Practice call (synthetic) · about this example</summary>
        <p className="mt-1">{practiceFalsePositive ? 'The consent failure is deliberately wrong: the fictional customer gave permission. Practice correcting that score. The separate outcome promise still needs review.' : 'The fictional agent pulls credit after the customer refuses permission, then guarantees a debt-free date. Review the two separate issues and the coaching needed.'} These are synthetic scores, not a real model evaluation.</p>
      </details>
    </aside>}

    {contextChanged && <div className="rounded-2xl border border-pennie-peach-dark bg-pennie-peach-light/40 p-4 text-sm"><p className="font-semibold text-pennie-navy">Saved source or revision changed</p><p className="mt-1 text-xs text-pennie-graphite">This review changed since you opened it. Reload to see the latest version. Your unsaved draft will be discarded.</p><button type="button" disabled={busy || query.isFetching || !canReloadReview} onClick={() => loadContext(context)} className="pennie-focus-ring mt-3 min-h-[44px] rounded-full border border-pennie-navy px-4 text-xs font-semibold disabled:opacity-40">Reload review and discard draft</button></div>}

    {!editable && <ManagerReviewOutcome context={context} />}

    <section aria-label="Why Eavesly requested review" className="space-y-2">
      <h2 className="text-lg font-semibold text-pennie-navy">Why Eavesly requested review</h2>
      <ReasonText text={reviewReason} violations={recordedViolations} />
      {requestedReview === false && <p className="mt-2 text-xs font-semibold text-pennie-peach-deeper">Eavesly’s saved assessment says manager review was not required, but this alert was sent.</p>}
    </section>
    {context.sourceReferenceKind !== 'known' && <p className={context.sourceReferenceKind === 'legacy_current_reference' ? 'text-xs text-pennie-graphite/70' : 'rounded-xl border border-pennie-peach-dark bg-pennie-peach-light/30 p-3 text-xs text-pennie-graphite'}>{context.sourceReferenceKind === 'legacy_current_reference' ? 'Original rubric unknown; current reference only.' : 'Original rubric unavailable for this stamped hash; current field map only.'}</p>}
    {editable && context.review && <p className="text-xs text-pennie-graphite/70">Saved revision {context.review.feedbackRevision} · {formatDateTime(context.review.savedAt)} by {context.review.savedBy}</p>}

    <section aria-label="What Eavesly flagged" className="border-t border-border pt-5">
      <h2 id={`${scorecardId}-scores`} tabIndex={-1} className="pennie-focus-ring text-lg font-semibold text-pennie-navy">What Eavesly flagged</h2>
      <p className="mt-1 text-xs text-pennie-graphite/70">Passage feedback is optional; unanswered evidence stays unreviewed. Your overall alert decision is separate.</p>
      {scorecard}
    </section>

    {editable && <fieldset disabled={locked} className="space-y-3 border-t border-border pt-5"><legend id={`${scorecardId}-decision`} tabIndex={-1} className="pennie-focus-ring pr-2 text-base font-semibold text-pennie-navy">Was this alert warranted?</legend>
      <p className="text-sm text-pennie-graphite/70">Your decision is enough. Add feedback only when useful.</p>
      <div role="radiogroup" aria-label="Alert verdict" className="flex flex-wrap gap-2">{([true, false] as const).map(value => <ReviewChoice key={String(value)} name={`${scorecardId}-escalation`} checked={escalationJustified === value} onChange={() => setEscalationJustified(value)} pill={false} label={value ? 'Yes, the alert was warranted' : 'No, the alert was unnecessary'} />)}</div>
      {escalationJustified === true && <label className="block text-sm font-semibold">Feedback on Eavesly (optional)<ReviewText required={false} label="Feedback on Eavesly (optional)" value={escalationReason} placeholder="Agree with the alert, but not every reason? Tell us which part was wrong. No coaching plan needed." onChange={setEscalationReason} /></label>}
      {escalationJustified === false && <>
        <label className="block text-sm font-semibold">Explain your decision<ReviewText label="Explain your decision" value={escalationReason} placeholder="What did Eavesly miss or misunderstand? A brief explanation is enough." onChange={setEscalationReason} /></label>
        <fieldset><legend className="mb-2 text-xs font-semibold">Reason category (optional)</legend><div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Why was the alert unnecessary?">{REASONS.map(value => <ReviewChoice key={value} name={`${scorecardId}-reason`} checked={inaccuracyReason === value} onChange={() => setInaccuracyReason(value)} label={INACCURACY_REASON_LABELS[value]} />)}</div>{inaccuracyReason !== null && <button type="button" onClick={() => setInaccuracyReason(null)} className="pennie-focus-ring min-h-[44px] text-xs font-semibold text-pennie-blue-deeper">Clear reason category</button>}</fieldset>
        {findings.length > 0 && <p className="text-sm text-pennie-graphite/70">Coaching issues won’t be included when you save No. Select Yes to restore your draft. Earlier saved revisions remain in review history.</p>}
      </>}

    {escalationJustified === true && <section aria-label="Coaching issues" className="space-y-4 border-t border-border pt-5">
      <div><h2 id={`${scorecardId}-coaching`} tabIndex={-1} className="pennie-focus-ring text-base font-semibold text-pennie-navy">Coaching issues (optional)</h2><p className="mt-1 text-sm text-pennie-graphite">Only add details if useful for coaching. You can save the alert decision without adding any issues.</p></div>
      {findings.map((finding, index) => <fieldset key={finding.findingId} id={findingElementId(finding.findingId)} disabled={locked} className="rounded-xl bg-pennie-beige/60 p-3 space-y-2"><legend className="px-1 text-xs font-semibold">Issue {index + 1}</legend>
        <label className="block text-xs font-semibold">Category<select aria-label={`Finding ${index + 1} category`} value={finding.category} onChange={event => updateFinding(finding.findingId, { category: event.target.value as FullQaFindingCategory })} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal">{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <details className="text-xs" ref={element => { if (element && finding.relatedCriteria.length === 0) element.open = true }}>
          <summary className="pennie-focus-ring min-h-[44px] cursor-pointer font-semibold">Related criteria ({finding.relatedCriteria.length} selected{finding.relatedCriteria.length ? `: ${finding.relatedCriteria.map(key => context.criteria.find(item => item.key === key)?.label ?? key).join(', ')}` : ''})</summary>
          <div role="group" aria-label={`Finding ${index + 1} related criteria`} className="mt-2 grid gap-1 sm:grid-cols-2">{context.criteria.map(item => <label key={item.key} className="flex min-h-[32px] items-center gap-2 font-normal"><input type="checkbox" checked={finding.relatedCriteria.includes(item.key)} onChange={event => updateFinding(finding.findingId, { relatedCriteria: event.target.checked ? [...finding.relatedCriteria, item.key] : finding.relatedCriteria.filter(key => key !== item.key) })} className="pennie-focus-ring h-4 w-4 accent-pennie-blue-deeper" />{item.label}</label>)}</div>
        </details>
        <label className="block text-xs font-semibold">What was the issue?<ReviewText id={`${findingElementId(finding.findingId)}-summary`} showEmptyHint label={`What was the issue? Finding ${index + 1} summary`} value={finding.summary} placeholder="Describe the issue in your own words." onChange={summary => updateFinding(finding.findingId, { summary })} /></label>
        <label className="block text-xs font-semibold">Evidence<ReviewText id={`${findingElementId(finding.findingId)}-evidence`} showEmptyHint label={`Finding ${index + 1} evidence`} value={finding.evidence} onChange={evidence => updateFinding(finding.findingId, { evidence })} /></label>
        <button type="button" onClick={() => setFindings(items => items.filter(item => item.findingId !== finding.findingId))} className="min-h-[36px] text-xs font-semibold text-pennie-peach-deeper"><Trash2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Remove issue</button>
      </fieldset>)}
      {findings.length === 0 && <p className="text-sm text-pennie-graphite/70">No coaching issues added.</p>}
      <button type="button" disabled={locked} onClick={addBlankIssue} className="min-h-[40px] rounded-full border border-border px-3 text-xs font-semibold text-pennie-blue-deeper disabled:opacity-40"><Plus className="mr-1 inline h-4 w-4" aria-hidden="true" />{findings.length ? 'Add another issue' : 'Add an issue'}</button>
    </section>}
    </fieldset>}

    {editable && escalationJustified !== null && <section aria-label="Follow-up with the rep" className="space-y-3 border-t border-border pt-5 [&_textarea]:min-h-28">
      <h2 id={`${scorecardId}-followup`} tabIndex={-1} className="pennie-focus-ring text-base font-semibold text-pennie-navy">Follow-up with the rep</h2>
      <p className="text-sm text-pennie-graphite">Optional. Saving a review does not mark the agent as coached.</p>
      <fieldset disabled={locked} className="space-y-3">
        <legend className="text-sm font-semibold">Record coaching or follow-up (optional)</legend><div className="flex flex-wrap gap-2" role="radiogroup" aria-label={escalationJustified ? 'Action taken' : 'What did you do about the issue?'}>{ACTIONS.map(value => <ReviewChoice key={value} name={`${scorecardId}-action`} checked={actionTaken === value} onChange={() => setActionTaken(value)} label={ACTION_TAKEN_LABELS[value]} />)}</div>
        {actionTaken !== null && <>
          <label className="block text-sm font-semibold">{escalationJustified ? 'What action did you take?' : 'Coaching or next steps'}<ReviewText label={escalationJustified ? 'What action did you take?' : 'Coaching or next steps'} value={actionDetails} placeholder="Describe the coaching, escalation, or planned follow-up." onChange={setActionDetails} /></label>
          <button type="button" onClick={() => { setActionTaken(null); setActionDetails('') }} className="pennie-focus-ring min-h-[44px] text-xs font-semibold text-pennie-blue-deeper">Clear optional follow-up</button>
        </>}
      </fieldset>
    </section>}

    <details className="border-t border-border py-3">
      <summary className="pennie-focus-ring min-h-[36px] cursor-pointer text-sm font-semibold text-pennie-blue-deeper">Scoring policy &amp; source</summary>
      <p className="mt-1 break-all text-xs text-pennie-graphite">{sourceNotice(context)}</p>
      <p className="mt-1 text-xs text-pennie-graphite/70">Each saved review keeps the original AI assessment for reference.</p>
      {context.sourceReferenceKind !== 'unknown_hash' && <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-pennie-graphite"><p><strong>AI escalation policy:</strong> two or more distinct compliance findings, or severe customer mistreatment. This describes Eavesly’s scoring policy, not a requirement to create findings before saving your review.</p><p className="mt-1"><strong>Program expectations:</strong> enrollment gating applies; only handling-agent delivery counts, and ACDR/GOTA-only delivery does not count for discussion points.</p></div>}
      {context.rubricPromptText && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-pennie-blue-deeper">{context.sourceReferenceKind === 'known' ? 'Full exact scoring policy used' : 'Full current scoring policy — reference only'}</summary><pre className="mt-2 whitespace-pre-wrap break-words bg-white py-3 text-[11px] text-pennie-graphite">{context.rubricPromptText}</pre></details>}
    </details>

    {(context.proposals.length > 0 || (editable && context.review)) && <details className="group border-t border-border py-3"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-pennie-blue-deeper">{editable ? 'Suggest a rule change' : 'Rule change proposals'} <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="mt-3 space-y-3">
      <p className="text-xs text-pennie-graphite/70">Proposals are separate from per-call findings. Accepted means approved for evaluation, not published; the production rubric remains unchanged.</p>
      {context.proposals.map(proposal => <article key={proposal.id} className="rounded-xl bg-pennie-beige/60 p-3 text-sm"><p className="font-semibold">{context.criteria.find(item => item.key === proposal.criterionKey)?.label ?? proposal.criterionKey}</p><p className="mt-1">{proposal.proposedRule}</p><p className="mt-1 text-xs text-muted-foreground">Why: {proposal.why}</p><p className="mt-2 text-xs font-semibold">{proposal.decision === 'accepted_for_evaluation' ? 'Approved for evaluation — not published' : proposal.decision.replace('_', ' ')}</p>
        {scope.isGodMode && proposal.decision === 'pending' && <div className="mt-2"><textarea aria-label={`Proposal ${proposal.id} decision reason`} value={decisionReason[proposal.id] ?? ''} onChange={event => setDecisionReason(value => ({ ...value, [proposal.id]: event.target.value }))} className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" placeholder="Required decision reason" /><div className="mt-2 flex gap-2"><button type="button" disabled={proposalDecisionPending || (decisionReason[proposal.id]?.trim().length ?? 0) < 12} onClick={() => decideProposal(proposal.id, 'accepted_for_evaluation')} className="min-h-[36px] rounded-full bg-pennie-navy px-3 text-xs font-semibold text-white disabled:opacity-40">Approve for evaluation</button><button type="button" disabled={proposalDecisionPending || (decisionReason[proposal.id]?.trim().length ?? 0) < 12} onClick={() => decideProposal(proposal.id, 'rejected')} className="min-h-[36px] rounded-full border px-3 text-xs font-semibold disabled:opacity-40">Reject</button></div></div>}
      </article>)}
      {editable && context.review && <div className="space-y-2 border-t border-border pt-3"><label className="block text-xs font-semibold">Current criterion<select aria-label="Current criterion for proposal" value={proposalCriterion} onChange={event => setProposalCriterion(event.target.value)} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal">{context.criteria.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="block text-xs font-semibold">Proposed rule content<textarea aria-label="Proposed rule content" value={proposalText} onChange={event => setProposalText(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label><label className="block text-xs font-semibold">Why change it?<textarea aria-label="Why change this rule?" value={proposalWhy} onChange={event => setProposalWhy(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label><button type="button" disabled={proposalPending || proposalText.trim().length < 12 || proposalWhy.trim().length < 12} onClick={submitProposal} className="min-h-[40px] rounded-full border border-pennie-navy px-4 text-xs font-semibold text-pennie-navy disabled:opacity-40">Propose for evaluation</button></div>}
    </div></details>}
  </form>
}
