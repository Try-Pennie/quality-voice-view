import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
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

function sourceNotice(context: FullQaReviewContext) {
  if (context.sourceReferenceKind === 'known') return `Exact production rubric · ${context.sourcePromptSha256}`
  if (context.sourceReferenceKind === 'legacy_current_reference') return `Original rubric unknown; current reference only · ${context.referencePromptSha256}`
  return `Original rubric unavailable for stamped hash ${context.sourcePromptSha256}; current field map only. Current rules are not shown as original.`
}

/** Full QA-specific review: immutable AI judgments, 23 criterion treatments, distinct findings, and escalation. */
export function FullQaRubricReview({ alert, scope, editable, onDirtyChange, onBusyChange, onSubmitted }: Props) {
  const queryClient = useQueryClient()
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

  const reviewDirty = !!context && serializeDraft(draft) !== baseline.current
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
    <div className={`rounded-2xl border px-4 py-3 ${context.sourceReferenceKind === 'known' ? 'border-pennie-green-light bg-pennie-green-light/20' : 'border-pennie-peach-dark bg-pennie-peach-light/30'}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-pennie-navy">Rubric provenance</p>
      <p className="mt-1 break-all text-xs text-pennie-graphite">{sourceNotice(context)}</p>
      <p className="mt-1 text-xs text-pennie-graphite/70">The reviewed AI JSON is snapshotted per saved revision. No model or replay identity is claimed.</p>
      {context.sourceReferenceKind !== 'unknown_hash' && <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-pennie-graphite"><p><strong>Escalation:</strong> two or more distinct confirmed compliance findings, or an explicit severe customer-mistreatment finding. Poor CX alone is not severe.</p><p className="mt-1"><strong>Program expectations:</strong> enrollment gating applies; only handling-agent delivery counts, and ACDR/GOTA-only delivery does not count for discussion points.</p></div>}
      {context.rubricPromptText && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-pennie-blue-deeper">{context.sourceReferenceKind === 'known' ? 'Full exact scoring policy used' : 'Full current scoring policy — reference only'}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white p-3 text-[11px] text-pennie-graphite">{context.rubricPromptText}</pre></details>}
    </div>

    {contextChanged && <div className="rounded-2xl border border-pennie-peach-dark bg-pennie-peach-light/40 p-4 text-sm"><p className="font-semibold text-pennie-navy">Saved source or revision changed</p><p className="mt-1 text-xs text-pennie-graphite">Your draft was not paired with the new token. Reload explicitly to discard it and review the authoritative source.</p><button type="button" onClick={() => loadContext(context)} className="mt-3 min-h-[40px] rounded-full border border-pennie-navy px-4 text-xs font-semibold">Reload review and discard draft</button></div>}

    {context.review && <div className="rounded-2xl border border-border px-4 py-3 text-sm">
      <p className="font-semibold text-pennie-navy">Saved revision {context.review.feedbackRevision}</p>
      <p className="text-xs text-muted-foreground">Saved {formatDateTime(context.review.savedAt)} by {context.review.savedBy}</p>
    </div>}

    <div>
      <h2 className="text-base font-semibold text-pennie-navy">23 criterion judgments</h2>
      <p className="mt-1 text-xs text-pennie-graphite/70">Confirm the AI value, correct it with a reason, or mark needs context. A correction does not create a confirmed finding.</p>
    </div>
    {['Compliance', 'Customer experience', 'Sales process', 'Program expectations'].map(section => <details key={section} className="group rounded-2xl border border-border px-4 py-3" open={section === 'Compliance'}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-pennie-blue-deeper">{section}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
      <div className="mt-3 space-y-3">{context.criteria.filter(item => item.section === section).map(criterion => {
        const correction = corrections.find(item => item.criterionKey === criterion.key)
        if (!correction) return null
        const original = valueAtPath(context.sourceResult, criterion.scorePath)
        const evidence = valueAtPath(context.sourceResult, criterion.evidencePath)
        return <article key={criterion.key} className="rounded-xl bg-pennie-beige/60 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-pennie-navy">{criterion.label}</h3>
            {context.sourceReferenceKind !== 'unknown_hash' ? <p className="mt-1 text-xs leading-relaxed text-pennie-graphite">{criterion.rule}</p> : <p className="mt-1 text-xs text-pennie-peach-deeper">Original rule unavailable for this stamped hash.</p>}</div>
            <span className="rounded-full bg-pennie-white px-2 py-1 text-xs font-semibold">Original AI: {String(original ?? 'unavailable')}</span></div>
          <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-pennie-blue-deeper">Original AI evidence</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs text-pennie-graphite">{JSON.stringify(evidence ?? 'No evidence saved', null, 2)}</pre></details>
          {context.review && <div className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-xs"><p className="font-semibold text-pennie-navy">Saved human treatment: {correction.disposition === 'confirmed' ? 'Retained original AI value' : correction.disposition === 'corrected' ? `Corrected to ${String(correction.correctedValue)}` : 'Needs context / uncertain'}</p>{correction.reason && <p className="mt-1 text-pennie-graphite">Reason: {correction.reason}</p>}</div>}
          {editable && <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold">Review disposition<select aria-label={`${criterion.label} disposition`} value={correction.disposition} onChange={event => {
              const disposition = event.target.value as FullQaCriterionCorrection['disposition']
              updateCorrection(criterion.key, disposition === 'confirmed' ? { disposition, correctedValue: original as string | boolean, reason: null }
                : disposition === 'needs_context' ? { disposition, correctedValue: null, reason: '' }
                  : { disposition, correctedValue: criterion.domain.find(value => value !== original) ?? null, reason: '' })
            }} className="mt-1 min-h-[40px] w-full rounded-lg border border-border bg-white px-2 font-normal"><option value="confirmed">Retain original</option><option value="corrected">Correct AI judgment</option><option value="needs_context">Needs context / uncertain</option></select></label>
            {correction.disposition === 'corrected' && <label className="text-xs font-semibold">Corrected value<select aria-label={`${criterion.label} corrected value`} value={String(correction.correctedValue)} onChange={event => updateCorrection(criterion.key, { correctedValue: criterion.domain.find(value => String(value) === event.target.value) ?? null })} className="mt-1 min-h-[40px] w-full rounded-lg border border-border bg-white px-2 font-normal">{criterion.domain.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select></label>}
            {correction.disposition !== 'confirmed' && <label className="text-xs font-semibold sm:col-span-2">Required reason<textarea aria-label={`${criterion.label} correction reason`} value={correction.reason ?? ''} onChange={event => updateCorrection(criterion.key, { reason: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-border bg-white p-2 font-normal" /></label>}
          </div>}
        </article>
      })}</div>
    </details>)}

    <div className="rounded-2xl border border-border p-4 space-y-3">
      <div><h2 className="text-base font-semibold text-pennie-navy">Individual findings</h2><p className="mt-1 text-xs text-pennie-graphite/70">Record each distinct underlying confirmed issue once. Retaining an AI failure or correcting a score does not create a finding.</p></div>
      {findings.map((finding, index) => <fieldset key={finding.findingId} disabled={!editable} className="rounded-xl bg-pennie-beige/60 p-3 space-y-2"><legend className="px-1 text-xs font-semibold">Finding {index + 1}</legend>
        <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-semibold">Category<select aria-label={`Finding ${index + 1} category`} value={finding.category} onChange={event => updateFinding(finding.findingId, { category: event.target.value as FullQaFindingCategory })} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal">{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold">Related criteria<select multiple aria-label={`Finding ${index + 1} related criteria`} value={[...finding.relatedCriteria]} onChange={event => updateFinding(finding.findingId, { relatedCriteria: Array.from(event.target.selectedOptions, option => option.value) })} className="mt-1 h-24 w-full rounded-lg border bg-white px-2 font-normal">{context.criteria.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
        <label className="block text-xs font-semibold">Summary<textarea aria-label={`Finding ${index + 1} summary`} value={finding.summary} onChange={event => updateFinding(finding.findingId, { summary: event.target.value })} className="mt-1 min-h-16 w-full rounded-lg border bg-white p-2 font-normal" /></label>
        <label className="block text-xs font-semibold">Evidence<textarea aria-label={`Finding ${index + 1} evidence`} value={finding.evidence} onChange={event => updateFinding(finding.findingId, { evidence: event.target.value })} className="mt-1 min-h-16 w-full rounded-lg border bg-white p-2 font-normal" /></label>
        {editable && <button type="button" onClick={() => setFindings(items => items.filter(item => item.findingId !== finding.findingId))} className="min-h-[36px] text-xs font-semibold text-pennie-peach-deeper"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Remove finding</button>}
      </fieldset>)}
      {editable && <button type="button" onClick={addFinding} className="min-h-[40px] rounded-full border border-border px-3 text-xs font-semibold text-pennie-blue-deeper"><Plus className="mr-1 inline h-4 w-4" />Add distinct finding</button>}
    </div>

    <fieldset disabled={!editable} className="rounded-2xl border border-border p-4 space-y-3"><legend className="px-1 text-base font-semibold text-pennie-navy">Escalation judgment</legend>
      <p className="text-xs text-pennie-graphite/70">Alert validity is separate from individual finding validity. A not-justified escalation may retain real findings and coaching.</p>
      <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={escalationJustified} onClick={() => setEscalationJustified(true)} className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold ${escalationJustified ? 'bg-pennie-navy text-white' : 'bg-white'}`}>Escalation justified</button><button type="button" aria-pressed={!escalationJustified} onClick={() => setEscalationJustified(false)} className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold ${!escalationJustified ? 'bg-pennie-navy text-white' : 'bg-white'}`}>Escalation not justified</button></div>
      <label className="block text-xs font-semibold">Escalation judgment reason<textarea aria-label="Escalation judgment reason" value={escalationReason} onChange={event => setEscalationReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label>
      {!escalationJustified && <label className="block text-xs font-semibold">Why was escalation unnecessary?<select aria-label="Why was escalation unnecessary?" value={inaccuracyReason ?? ''} onChange={event => setInaccuracyReason(event.target.value as AlertInaccuracyReason)} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal"><option value="">Choose a reason</option>{REASONS.map(value => <option key={value} value={value}>{INACCURACY_REASON_LABELS[value]}</option>)}</select></label>}
      {findings.length > 0 && <><label className="block text-xs font-semibold">Finding coaching / action<select aria-label="Finding coaching / action" value={actionTaken ?? ''} onChange={event => setActionTaken(event.target.value as AlertActionTaken)} className="mt-1 min-h-[40px] w-full rounded-lg border bg-white px-2 font-normal"><option value="">Choose an action</option>{ACTIONS.map(value => <option key={value} value={value}>{ACTION_TAKEN_LABELS[value]}</option>)}</select></label>
      <label className="block text-xs font-semibold">Action details<textarea aria-label="Full QA action details" value={actionDetails} onChange={event => setActionDetails(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-2 font-normal" /></label></>}
      {editable && <><button type="button" onClick={save} disabled={saving || !parsed.ok || !reviewDirty || contextChanged} className="min-h-[44px] rounded-full bg-pennie-navy px-5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : context.review ? 'Update Full QA review' : 'Save Full QA review'}</button>{parsed.ok === false && <p className="text-xs text-pennie-peach-deeper" role="status">{parsed.message}</p>}</>}
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
