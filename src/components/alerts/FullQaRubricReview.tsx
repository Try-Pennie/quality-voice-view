import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  type FullQaCriterionCorrection,
  type FullQaFinding,
  type FullQaFindingCategory,
  type FullQaReviewContext,
} from '../../lib/full-qa-review'
import type { AlertActionTaken, AlertInaccuracyReason, AlertWithFeedback } from '../../types/database'
import type { UserScope } from '../../lib/alert-queries'
import { formatDateTime } from '../../lib/utils'

const CATEGORY_LABELS: Record<FullQaFindingCategory, string> = {
  compliance: 'Compliance', customer_experience: 'Customer experience', sales_process: 'Sales process',
  program_expectations: 'Program expectations', severe_customer_mistreatment: 'Severe customer mistreatment',
}
const ACTIONS: readonly AlertActionTaken[] = ['coached', 'escalated', 'follow_up_later', 'no_action_needed']
const REASONS: readonly AlertInaccuracyReason[] = ['addressed_off_call', 'evidence_misquoted', 'wrong_context', 'covered_not_verbatim', 'call_dropped_incomplete', 'policy_does_not_apply', 'soft_inquiry_misclassified', 'other']

interface Props {
  readonly alert: AlertWithFeedback
  readonly scope: UserScope
  readonly editable: boolean
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onBusyChange: (busy: boolean) => void
  readonly onSubmitted: (updated: Partial<AlertWithFeedback>) => void
}

function serializeDraft(value: unknown): string {
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

// Stored evidence can be a note, a list of notes, or structured speaker/quote/context
// entries. Only explicit quote fields are presented as quotations; notes stay notes.
function CriterionEvidence({ evidence, displayedNotes = [] }: { readonly evidence: unknown; readonly displayedNotes?: readonly string[] }) {
  const entries = Array.isArray(evidence) ? evidence : evidence == null ? [] : [evidence]
  const excerpts = entries.flatMap((entry, index) => {
    if (typeof entry === 'string' && entry.trim()) return displayedNotes.includes(entry.trim()) ? [] : [<p key={index} className="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry}</p>]
    const quote = valueAtPath(entry, 'quote')
    if (typeof quote !== 'string' || !quote.trim()) return []
    const speaker = valueAtPath(entry, 'speaker')
    const context = valueAtPath(entry, 'context')
    const step = valueAtPath(entry, 'process_step')
    const attribution = [savedText(speaker) ?? 'Speaker not saved', savedText(step)].filter(value => value !== null).join(' · ')
    return [<figure key={index} className="space-y-1">
      <figcaption className="text-xs font-semibold text-pennie-graphite/70">{attribution}</figcaption>
      <blockquote className="whitespace-pre-wrap break-words border-l-2 border-pennie-yellow-dark pl-3 text-sm leading-relaxed">{quote}</blockquote>
      {typeof context === 'string' && context.trim() && !displayedNotes.includes(context.trim()) && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed"><span className="font-semibold">Saved context: </span>{context}</p>}
    </figure>]
  })
  return <div className="space-y-2 text-pennie-graphite">
    <p className="text-xs font-semibold">Evidence Eavesly used</p>
    {excerpts.length ? excerpts : <p className="text-sm">No readable excerpt was saved. Check the transcript before deciding.</p>}
    {entries.some(entry => !savedText(entry) && !savedText(valueAtPath(entry, 'quote')) && !savedText(valueAtPath(entry, 'context'))) && excerpts.length > 0 && <p className="text-xs">Some evidence is only available in the saved details below.</p>}
    {entries.length > 0 && <details><summary className="pennie-focus-ring cursor-pointer text-xs text-pennie-blue-deeper">View saved evidence details</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(evidence, null, 2)}</pre></details>}
  </div>
}

function sourceNotice(context: FullQaReviewContext) {
  if (context.sourceReferenceKind === 'known') return `Exact production rubric · ${context.sourcePromptSha256}`
  if (context.sourceReferenceKind === 'legacy_current_reference') return `Original rubric unknown; current reference only · ${context.referencePromptSha256}`
  return `Original rubric unavailable for stamped hash ${context.sourcePromptSha256}; current field map only. Current rules are not shown as original.`
}

/** Full QA-specific review: immutable AI judgments, 23 criterion treatments, distinct findings, and escalation. */
export function FullQaRubricReview({ alert, scope, editable, onDirtyChange, onBusyChange, onSubmitted }: Props) {
  const queryClient = useQueryClient()
  const scorecardId = useId()
  const [showFullScorecard, setShowFullScorecard] = useState(false)
  const query = useQuery({ queryKey: ['fullQaReviewContext', alert.call_id], queryFn: () => fetchFullQaReviewContext(alert.call_id) })
  const context = query.data
  const initializedFor = useRef<string | null>(null)
  const contextToken = useRef('')
  const baseline = useRef('')
  const [corrections, setCorrections] = useState<readonly FullQaCriterionCorrection[]>([])
  const [findings, setFindings] = useState<readonly FullQaFinding[]>([])
  const [escalationJustified, setEscalationJustified] = useState(false)
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

  const draft = useMemo(() => ({ corrections, findings, escalationJustified, escalationReason,
    inaccuracyReason: escalationJustified ? null : inaccuracyReason, actionTaken: findings.length ? actionTaken : null,
    actionDetails: findings.length ? actionDetails : null }), [corrections, findings, escalationJustified, escalationReason, inaccuracyReason, actionTaken, actionDetails])

  const loadContext = useCallback((nextContext: FullQaReviewContext) => {
    const next = { corrections: initialFullQaCorrections(nextContext), findings: nextContext.review?.findings ?? [],
      escalationJustified: nextContext.review?.escalationJustified ?? false, escalationReason: nextContext.review?.escalationReason ?? '',
      inaccuracyReason: nextContext.review?.inaccuracyReason ?? null,
      actionTaken: nextContext.review?.findings.length ? nextContext.review.actionTaken : null,
      actionDetails: nextContext.review?.findings.length ? nextContext.review.actionDetails ?? '' : '' }
    setCorrections(next.corrections); setFindings(next.findings); setEscalationJustified(next.escalationJustified)
    setEscalationReason(next.escalationReason); setInaccuracyReason(next.inaccuracyReason); setActionTaken(next.actionTaken); setActionDetails(next.actionDetails)
    setProposalCriterion(nextContext.criteria[0]?.key ?? '')
    setShowFullScorecard(false)
    baseline.current = serializeDraft({ ...next,
      inaccuracyReason: next.escalationJustified ? null : next.inaccuracyReason,
      actionTaken: next.findings.length ? next.actionTaken : null,
      actionDetails: next.findings.length ? next.actionDetails : null,
    })
    contextToken.current = `${nextContext.sourceFingerprint}:${nextContext.review?.feedbackRevision ?? 0}`
    initializedFor.current = alert.call_id
  }, [alert.call_id])

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
  const contextChanged = !!context && !!contextToken.current && latestContextToken !== contextToken.current
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false) }, [onDirtyChange, onBusyChange])

  if (query.isPending) return <section className="rounded-2xl border border-border p-4 text-sm text-muted-foreground">Loading exact Full QA rubric…</section>
  if (query.isError || !context) return <section className="rounded-2xl border border-pennie-peach-dark bg-pennie-peach-light/30 p-4 text-sm">
    <p className="font-semibold text-pennie-navy">Full QA rubric context unavailable</p>
    <p className="mt-1 text-pennie-graphite">The generic review form is intentionally not used as a bypass.</p>
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
  const attentionKeys = new Set(context.criteria.filter(criterion => aiConcernKeys.has(criterion.key)
    || [corrections, context.review?.corrections ?? []].some(items => items.some(item => item.criterionKey === criterion.key && item.disposition !== 'confirmed'))
    || [...findings, ...(context.review?.findings ?? [])].some(item => item.relatedCriteria.includes(criterion.key))
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
  const parsed = parseFullQaReviewDraft(context, draft)
  const updateCorrection = (key: string, patch: Partial<FullQaCriterionCorrection>) => setCorrections(items => items.map(item => item.criterionKey === key ? { ...item, ...patch } : item))
  const addFinding = () => setFindings(items => [...items, { findingId: crypto.randomUUID(), category: 'compliance', relatedCriteria: [context.criteria[0]?.key ?? 'call_recording_disclosure'], summary: '', evidence: '' }])
  const updateFinding = (id: string, patch: Partial<FullQaFinding>) => setFindings(items => items.map(item => item.findingId === id ? { ...item, ...patch } : item))

  const save = async () => {
    if (contextChanged) { toast.error('The saved source or revision changed. Reload it before saving.'); return }
    if (parsed.ok === false || saving) { if (parsed.ok === false) toast.error(parsed.message); return }
    setSaving(true)
    const result = await submitFullQaReview({ callId: alert.call_id, expectedRevision: alert.review_revision ?? 0,
      expectedDecisionId: alert.current_decision_id ?? null, expectedSourceFingerprint: context.sourceFingerprint, draft: parsed.value })
    setSaving(false)
    if (result.ok === false) { toast.error(`Couldn't save Full QA review: ${result.error.message}`); if (result.error._tag === 'StaleReview') query.refetch(); return }
    baseline.current = serializeDraft(parsed.value)
    contextToken.current = `${context.sourceFingerprint}:${result.value.reviewRevision}`
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

  return <section className="space-y-5" aria-label="Full QA rubric review">
    {(practiceFalsePositive || practiceSupported) && <aside className="rounded-xl border border-pennie-blue-main bg-pennie-blue-light p-4 text-sm" aria-label="Staging practice guidance">
      <p className="font-semibold text-pennie-navy">{practiceFalsePositive ? 'Practice example: intentionally incorrect AI score' : 'Practice example: two supported compliance issues'}</p>
      <p className="mt-1 text-pennie-graphite">{practiceFalsePositive ? 'The consent failure is deliberately wrong: the fictional customer gave permission. Practice correcting that score. The separate outcome promise still needs review.' : 'The fictional agent pulls credit after the customer refuses permission, then guarantees a debt-free date. Review the two separate issues and the coaching needed.'} These are synthetic scores, not a real model evaluation.</p>
    </aside>}
    <section aria-label="Why Eavesly requested review" className="rounded-2xl border border-pennie-yellow-main bg-pennie-yellow-light/50 p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-pennie-navy">Why Eavesly requested review</h2>
      <p className="mt-1 text-xs text-pennie-graphite/70">Eavesly’s saved assessment — not a confirmed manager finding.</p>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-pennie-graphite">{reviewReason ?? 'No explanation was saved for this alert. A failed score alone does not tell us why it was sent; check the conversation before deciding.'}</p>
      {requestedReview === false && <p className="mt-2 text-sm font-semibold text-pennie-peach-deeper">The saved assessment says manager review was not required, but this alert was sent. The reason for that mismatch is not available here.</p>}
      {recordedViolations.length > 0 && <div className="mt-3"><p className="text-sm font-semibold text-pennie-navy">Compliance issues Eavesly recorded</p><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-pennie-graphite">{recordedViolations.map((text, index) => <li key={index} className="whitespace-pre-wrap break-words">{text}</li>)}</ul></div>}
      <p className="mt-3 text-xs text-pennie-graphite/70">The cards below also include other score concerns and manager changes; they are not all alert triggers. Repeated descriptions may refer to the same issue.</p>
    </section>
    {context.sourceReferenceKind !== 'known' && <p className="rounded-xl border border-pennie-peach-dark bg-pennie-peach-light/30 p-3 text-xs text-pennie-graphite">{context.sourceReferenceKind === 'legacy_current_reference' ? 'Original rubric unknown; current reference only.' : 'Original rubric unavailable for this stamped hash; current field map only.'}</p>}
    <details className="rounded-2xl border border-border px-4 py-3">
      <summary className="pennie-focus-ring min-h-[36px] cursor-pointer text-sm font-semibold text-pennie-blue-deeper">Scoring policy &amp; source</summary>
      <p className="mt-1 break-all text-xs text-pennie-graphite">{sourceNotice(context)}</p>
      <p className="mt-1 text-xs text-pennie-graphite/70">The reviewed AI JSON is snapshotted per saved revision. No model or replay identity is claimed.</p>
      {context.sourceReferenceKind !== 'unknown_hash' && <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-pennie-graphite"><p><strong>Escalation:</strong> two or more distinct confirmed compliance findings, or an explicit severe customer-mistreatment finding. Poor CX alone is not severe.</p><p className="mt-1"><strong>Program expectations:</strong> enrollment gating applies; only handling-agent delivery counts, and ACDR/GOTA-only delivery does not count for discussion points.</p></div>}
      {context.rubricPromptText && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-pennie-blue-deeper">{context.sourceReferenceKind === 'known' ? 'Full exact scoring policy used' : 'Full current scoring policy — reference only'}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-3 text-[11px] text-pennie-graphite">{context.rubricPromptText}</pre></details>}
    </details>

    {contextChanged && <div className="rounded-2xl border border-pennie-peach-dark bg-pennie-peach-light/40 p-4 text-sm"><p className="font-semibold text-pennie-navy">Saved source or revision changed</p><p className="mt-1 text-xs text-pennie-graphite">Your draft was not paired with the new token. Reload explicitly to discard it and review the authoritative source.</p><button type="button" onClick={() => loadContext(context)} className="mt-3 min-h-[40px] rounded-full border border-pennie-navy px-4 text-xs font-semibold">Reload review and discard draft</button></div>}

    {context.review && <div className="rounded-2xl border border-border px-4 py-3 text-sm">
      <p className="font-semibold text-pennie-navy">Saved revision {context.review.feedbackRevision}</p>
      <p className="text-xs text-muted-foreground">Saved {formatDateTime(context.review.savedAt)} by {context.review.savedBy}</p>
    </div>}

    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-pennie-navy">{showFullScorecard ? 'Full scorecard' : editable ? 'Check what Eavesly found' : 'Check the manager’s review'}</h2>
        <p className="mt-1 text-sm text-pennie-graphite">{editable ? 'Read the evidence, then give your response. Eavesly’s results are kept unless you change them. Save your review below.' : 'Amber shows Eavesly’s concerns. Blue shows the manager’s saved response. Check their reasoning, then approve or request changes below.'}</p>
      </div>
      {hasProgramConcerns && (programSummary || programGaps.length > 0) && <aside aria-label="Program expectations section notes" className="rounded-xl border border-border p-3 text-sm text-pennie-graphite">
        <p className="font-semibold">Program expectations — saved section notes</p>
        <p className="mt-1 text-xs">These notes cover the whole section, not an individual score. Program-expectations gaps alone do not trigger this alert.</p>
        {programSummary && <p className="mt-2 whitespace-pre-wrap break-words">{programSummary}</p>}
        {programGaps.length > 0 && <ul className="mt-2 list-disc pl-5">{programGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
      </aside>}
      <button type="button" aria-expanded={showFullScorecard} aria-controls={scorecardId} onClick={() => setShowFullScorecard(value => !value)} className="pennie-focus-ring min-h-[44px] rounded-lg py-2 text-sm font-semibold text-pennie-blue-deeper underline-offset-4 hover:underline active:bg-pennie-beige">
        {showFullScorecard ? 'Show only issues & changes' : `View full scorecard · ${context.criteria.length} criteria`}
      </button>
      {!showFullScorecard && attentionKeys.size === 0 && <p className="text-sm text-pennie-graphite">No flagged criteria or review changes to show. Open the full scorecard to inspect other scores; this does not clear the alert.</p>}
    </div>
    <div id={scorecardId} className="space-y-3">{context.criteria.map(criterion => {
        const correction = corrections.find(item => item.criterionKey === criterion.key)
        if (!correction) return null
        const original = valueAtPath(context.sourceResult, criterion.scorePath)
        const evidence = valueAtPath(context.sourceResult, criterion.evidencePath)
        const aiConcern = aiConcernKeys.has(criterion.key)
        const originalValue = criterion.domain.find(value => value === original)
        const notes = criterionNotes(context.sourceResult, criterion.key, evidence)
        const question = criterion.key === 'credit_pull_consent'
          ? 'Did the customer give permission before credit was pulled?'
          : `Does Eavesly’s assessment of “${criterion.label}” match the call?`
        const saved = context.review?.corrections.find(item => item.criterionKey === criterion.key)
        const humanChanged = [correction, saved].some(item => item && item.disposition !== 'confirmed')
        const label = aiConcern ? original === 'fail' ? 'Eavesly flagged this' : 'Eavesly score concern'
          : originalValue === undefined ? 'Eavesly score unavailable' : humanChanged ? 'Manager review item'
            : attentionKeys.has(criterion.key) ? 'Included in this review' : 'Other Eavesly score'
        return <article key={criterion.key} aria-label={criterion.label} hidden={!showFullScorecard && !attentionKeys.has(criterion.key)} className={`space-y-4 rounded-2xl border border-l-4 p-4 sm:p-5 ${aiConcern ? 'border-pennie-yellow-main bg-pennie-yellow-light/50' : attentionKeys.has(criterion.key) ? 'border-pennie-blue-main bg-pennie-blue-light/30' : 'border-border bg-pennie-beige/40'}`}>
          <div>
            <p className={`mb-2 inline-flex items-center gap-2 text-xs font-bold ${aiConcern ? 'text-pennie-yellow-deeper' : 'text-pennie-blue-deeper'}`}>{aiConcern ? <Flag className="h-4 w-4 shrink-0" aria-hidden="true" /> : <MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />}{label}</p>
            <h3 className="break-words text-lg font-semibold text-pennie-navy">{criterion.label}</h3>
            <p className="mt-1 text-sm text-pennie-graphite">Eavesly’s result: <strong>{scoreLabel(originalValue)}</strong></p>
          </div>
          {aiConcern && <div className="space-y-1 text-sm text-pennie-graphite">
            <p className="font-semibold">{original === 'fail' ? 'Why Eavesly flagged this' : 'Why Eavesly noted a concern'}</p>
            {notes.length > 0 ? <><p className="text-xs text-pennie-graphite/70">Saved assessment notes</p>{notes.map((note, index) => <p key={index} className="whitespace-pre-wrap break-words leading-relaxed">{note}</p>)}</> : <p>{criterion.findingCategory === 'program_expectations' && (programSummary || programGaps.length > 0) ? 'No separate explanation was saved for this score; see the saved section notes above.' : 'No explanation was saved for this score. The result and any excerpt below are not an explanation by themselves.'}</p>}
          </div>}
          <CriterionEvidence evidence={evidence} displayedNotes={aiConcern ? notes : []} />
          {saved && <div className="rounded-xl border border-pennie-blue-main bg-pennie-blue-light p-3 text-sm">
            <p className="mb-1 text-xs font-bold text-pennie-blue-deeper">Manager’s saved response</p>
            <p className="font-semibold text-pennie-navy">{saved.disposition === 'confirmed' ? 'Kept Eavesly’s result' : saved.disposition === 'corrected' ? `Changed to: ${scoreLabel(saved.correctedValue)}` : 'Needs more context'}</p>
            {saved.reason && <p className="mt-1 whitespace-pre-wrap break-words text-pennie-graphite">{saved.reason}</p>}
          </div>}
          {editable && <div className="space-y-3 rounded-xl border border-pennie-blue-main bg-white p-3">
            <fieldset disabled={busy || contextChanged} role="radiogroup" aria-label={`${criterion.label} disposition`}>
              <legend className="mb-2 text-sm font-semibold text-pennie-navy">Your response</legend>
              <p className="mb-2 text-sm text-pennie-navy">{question}</p>
              <p className="mb-3 text-xs text-pennie-graphite/70">Agree keeps Eavesly’s result above. Disagree lets you correct it.</p>
              <div className="flex flex-wrap gap-2">{(['confirmed', 'corrected', 'needs_context'] as const).map(disposition => <label key={disposition} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${correction.disposition === disposition ? 'border-pennie-blue-deeper bg-pennie-blue-light text-pennie-navy' : 'border-border text-pennie-graphite hover:bg-pennie-blue-light/50'}`}>
                <input type="radio" name={`${scorecardId}-${criterion.key}`} checked={correction.disposition === disposition} disabled={disposition === 'confirmed' && originalValue === undefined} className="pennie-focus-ring h-4 w-4 accent-pennie-blue-deeper" onChange={() => {
                  if (correction.disposition === disposition) return
                  if (disposition === 'confirmed') {
                    if (originalValue !== undefined) updateCorrection(criterion.key, { disposition, correctedValue: originalValue, reason: null })
                  } else updateCorrection(criterion.key, disposition === 'needs_context' ? { disposition, correctedValue: null, reason: '' }
                    : { disposition, correctedValue: criterion.domain.find(value => value !== original) ?? null, reason: '' })
                }} />
                <span className="whitespace-nowrap">{disposition === 'confirmed' ? 'Agree with Eavesly' : disposition === 'corrected' ? 'Disagree' : 'Need more context'}</span>
              </label>)}</div>
            </fieldset>
            {correction.disposition === 'corrected' && <label className="block text-sm font-semibold">What should the result be?<select aria-label={`${criterion.label} corrected value`} disabled={busy || contextChanged} value={String(correction.correctedValue)} onChange={event => updateCorrection(criterion.key, { correctedValue: criterion.domain.find(value => String(value) === event.target.value) ?? null })} className="mt-1 min-h-[44px] w-full rounded-lg border border-border bg-white px-2 font-normal">{criterion.domain.map(value => <option key={String(value)} value={String(value)}>{scoreLabel(value)}</option>)}</select></label>}
            {correction.disposition !== 'confirmed' && <label className="block text-sm font-semibold">{correction.disposition === 'corrected' ? 'Why do you disagree?' : 'What context is missing?'}<textarea aria-label={`${criterion.label} correction reason`} disabled={busy || contextChanged} value={correction.reason ?? ''} onChange={event => updateCorrection(criterion.key, { reason: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-border bg-white p-2 font-normal" /></label>}
            <p className="text-xs text-pennie-graphite/70">Changes are submitted when you save your review below.</p>
          </div>}
          {context.sourceReferenceKind !== 'unknown_hash' ? <details><summary className="pennie-focus-ring cursor-pointer text-xs font-semibold text-pennie-blue-deeper">View scoring rule</summary><p className="mt-2 text-sm leading-relaxed text-pennie-graphite">{criterion.rule}</p></details> : <p className="text-xs text-pennie-peach-deeper">Original rule unavailable for this stamped hash.</p>}
        </article>
    })}</div>

    <div className="rounded-2xl border border-border p-4 space-y-3">
      <div><h2 className="text-base font-semibold text-pennie-navy">Issues to coach</h2><p className="mt-1 text-sm text-pennie-graphite">Add each separate issue you confirmed. If several flags describe the same issue, add it once. Changing a score above does not add an issue here.</p></div>
      {findings.map((finding, index) => <fieldset key={finding.findingId} disabled={!editable} className="rounded-xl bg-pennie-beige/60 p-3 space-y-2"><legend className="px-1 text-xs font-semibold">Finding {index + 1}</legend>
        <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-semibold">Category<select aria-label={`Finding ${index + 1} category`} value={finding.category} onChange={event => updateFinding(finding.findingId, { category: event.target.value as FullQaFindingCategory })} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal">{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold">Related criteria<select multiple aria-label={`Finding ${index + 1} related criteria`} value={[...finding.relatedCriteria]} onChange={event => updateFinding(finding.findingId, { relatedCriteria: Array.from(event.target.selectedOptions, option => option.value) })} className="mt-1 h-24 w-full rounded-lg border bg-white px-2 font-normal">{context.criteria.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
        <label className="block text-xs font-semibold">Summary<textarea aria-label={`Finding ${index + 1} summary`} value={finding.summary} onChange={event => updateFinding(finding.findingId, { summary: event.target.value })} className="mt-1 min-h-16 w-full rounded-lg border bg-white p-2 font-normal" /></label>
        <label className="block text-xs font-semibold">Evidence<textarea aria-label={`Finding ${index + 1} evidence`} value={finding.evidence} onChange={event => updateFinding(finding.findingId, { evidence: event.target.value })} className="mt-1 min-h-16 w-full rounded-lg border bg-white p-2 font-normal" /></label>
        {editable && <button type="button" onClick={() => setFindings(items => items.filter(item => item.findingId !== finding.findingId))} className="min-h-[36px] text-xs font-semibold text-pennie-peach-deeper"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Remove finding</button>}
      </fieldset>)}
      {editable && <button type="button" onClick={addFinding} className="min-h-[40px] rounded-full border border-border px-3 text-xs font-semibold text-pennie-blue-deeper"><Plus className="mr-1 inline h-4 w-4" />Add confirmed issue</button>}
    </div>

    <fieldset disabled={!editable} className="rounded-2xl border border-border p-4 space-y-3"><legend className="px-1 text-base font-semibold text-pennie-navy">Should this alert have been sent?</legend>
      <p className="text-sm text-pennie-graphite">You can say the alert was unnecessary and still record a real issue that needs coaching.</p>
      <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={escalationJustified} onClick={() => setEscalationJustified(true)} className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold ${escalationJustified ? 'bg-pennie-navy text-white' : 'bg-white'}`}>Yes, the alert was needed</button><button type="button" aria-pressed={!escalationJustified} onClick={() => setEscalationJustified(false)} className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold ${!escalationJustified ? 'bg-pennie-navy text-white' : 'bg-white'}`}>No, the alert was unnecessary</button></div>
      <label className="block text-xs font-semibold">Explain your decision<textarea aria-label="Explain your decision" value={escalationReason} onChange={event => setEscalationReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label>
      {!escalationJustified && <label className="block text-xs font-semibold">Why was the alert unnecessary?<select aria-label="Why was the alert unnecessary?" value={inaccuracyReason ?? ''} onChange={event => setInaccuracyReason(event.target.value as AlertInaccuracyReason)} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal"><option value="">Choose a reason</option>{REASONS.map(value => <option key={value} value={value}>{INACCURACY_REASON_LABELS[value]}</option>)}</select></label>}
      {findings.length > 0 && <><label className="block text-xs font-semibold">What did you do about the issue?<select aria-label="What did you do about the issue?" value={actionTaken ?? ''} onChange={event => setActionTaken(event.target.value as AlertActionTaken)} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal"><option value="">Choose an action</option>{ACTIONS.map(value => <option key={value} value={value}>{ACTION_TAKEN_LABELS[value]}</option>)}</select></label>
      <label className="block text-xs font-semibold">What happened, or what will you do next?<textarea aria-label="Coaching or next steps" value={actionDetails} onChange={event => setActionDetails(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label></>}
      {editable && <><button type="button" onClick={save} disabled={saving || !parsed.ok || !reviewDirty || contextChanged} className="min-h-[44px] rounded-full bg-pennie-navy px-5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : context.review ? 'Update review' : 'Save review'}</button>{parsed.ok === false && <p className="text-xs text-pennie-peach-deeper" role="status">{parsed.message}</p>}</>}
    </fieldset>

    <details className="group rounded-2xl border border-border px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-pennie-blue-deeper">Candidate rule proposals <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="mt-3 space-y-3">
      <p className="text-xs text-pennie-graphite/70">Proposals are separate from per-call findings. Accepted means approved for evaluation, not published; the production rubric remains unchanged.</p>
      {context.proposals.map(proposal => <article key={proposal.id} className="rounded-xl bg-pennie-beige/60 p-3 text-sm"><p className="font-semibold">{context.criteria.find(item => item.key === proposal.criterionKey)?.label ?? proposal.criterionKey}</p><p className="mt-1">{proposal.proposedRule}</p><p className="mt-1 text-xs text-muted-foreground">Why: {proposal.why}</p><p className="mt-2 text-xs font-semibold">{proposal.decision === 'accepted_for_evaluation' ? 'Approved for evaluation — not published' : proposal.decision.replace('_', ' ')}</p>
        {scope.isGodMode && proposal.decision === 'pending' && <div className="mt-2"><textarea aria-label={`Proposal ${proposal.id} decision reason`} value={decisionReason[proposal.id] ?? ''} onChange={event => setDecisionReason(value => ({ ...value, [proposal.id]: event.target.value }))} className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" placeholder="Required decision reason" /><div className="mt-2 flex gap-2"><button type="button" disabled={proposalDecisionPending || (decisionReason[proposal.id]?.trim().length ?? 0) < 12} onClick={() => decideProposal(proposal.id, 'accepted_for_evaluation')} className="min-h-[36px] rounded-full bg-pennie-navy px-3 text-xs font-semibold text-white disabled:opacity-40">Approve for evaluation</button><button type="button" disabled={proposalDecisionPending || (decisionReason[proposal.id]?.trim().length ?? 0) < 12} onClick={() => decideProposal(proposal.id, 'rejected')} className="min-h-[36px] rounded-full border px-3 text-xs font-semibold disabled:opacity-40">Reject</button></div></div>}
      </article>)}
      {editable && context.review && <div className="space-y-2 border-t border-border pt-3"><label className="block text-xs font-semibold">Current criterion<select aria-label="Current criterion for proposal" value={proposalCriterion} onChange={event => setProposalCriterion(event.target.value)} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal">{context.criteria.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="block text-xs font-semibold">Proposed rule content<textarea aria-label="Proposed rule content" value={proposalText} onChange={event => setProposalText(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label><label className="block text-xs font-semibold">Why change it?<textarea aria-label="Why change this rule?" value={proposalWhy} onChange={event => setProposalWhy(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label><button type="button" disabled={proposalPending || proposalText.trim().length < 12 || proposalWhy.trim().length < 12} onClick={submitProposal} className="min-h-[40px] rounded-full border border-pennie-navy px-4 text-xs font-semibold text-pennie-navy disabled:opacity-40">Propose for evaluation</button></div>}
    </div></details>
  </section>
}
