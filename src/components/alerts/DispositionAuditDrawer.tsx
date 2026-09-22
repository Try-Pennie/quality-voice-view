import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AudioPlayer } from '@/components/call-detail/AudioPlayer'
import { ReviewChoice } from '@/components/alerts/ReviewChoice'
import { AlertTranscript } from '@/components/alerts/AlertTranscript'
import { ACTION_TAKEN_LABELS, INACCURACY_REASON_LABELS } from '@/lib/alert-queries'
import { CATEGORY_LABELS, auditEvidence, auditReasoning, submitAuditFeedback, type DispositionAuditRow } from '@/lib/disposition-audit-queries'
import { registerHistoryNavigationGuard } from '@/lib/history-navigation-guard'
import { formatDateTime, formatPhoneNumber } from '@/lib/utils'
import type { AlertActionTaken, AlertInaccuracyReason } from '@/types/database'
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Headphones, X } from 'lucide-react'

const ACTION_OPTIONS: readonly AlertActionTaken[] = ['coached', 'escalated', 'follow_up_later', 'no_action_needed']
const INACCURACY_OPTIONS: readonly AlertInaccuracyReason[] = ['addressed_off_call', 'evidence_misquoted', 'wrong_context', 'covered_not_verbatim', 'call_dropped_incomplete', 'policy_does_not_apply', 'soft_inquiry_misclassified', 'other']
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

/** Disposition review using the same evidence-to-response workspace as alert reviews. */
export function DispositionAuditDrawer({ row, currentUserEmail, onClose, onSubmitted, onAdvance, hasNext, hasPrev }: Props) {
  const [accurate, setAccurate] = useState<boolean | null>(null)
  const [action, setAction] = useState<AlertActionTaken | null>(null)
  const [reason, setReason] = useState<AlertInaccuracyReason | null>(null)
  const [comment, setComment] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [transcriptFocusRequest, setTranscriptFocusRequest] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const submissionPending = useRef(false)
  const returnFocusTarget = useRef<HTMLElement | null>(null)
  const commentId = useId()
  const responseId = `${commentId}-response`

  useEffect(() => {
    if (!row) return
    setAccurate(row.accurate)
    setAction(row.action_taken)
    setReason(row.inaccuracy_reason)
    setComment(row.feedback_comment ?? '')
    setShowTranscript(false)
    setTranscriptFocusRequest(0)
    // Preserve an in-progress draft when this same call refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.call_id])

  const otherNoteRequired = accurate === false && reason === 'other'
  const notesTooShort = (accurate === true && comment.trim().length < REAL_NOTES_MIN) || (otherNoteRequired && comment.trim().length < OTHER_NOTES_MIN)
  const formIncomplete = !currentUserEmail || accurate === null || (accurate === true && !action) || (accurate === false && !reason) || notesTooShort
  const saveDisabled = submitting || formIncomplete
  const dirty = !!row && (accurate !== row.accurate || action !== row.action_taken || reason !== row.inaccuracy_reason || comment !== (row.feedback_comment ?? ''))
  const guidance = accurate === null ? 'Choose whether the disposition was wrong.'
    : accurate === true && !action ? 'Choose how you addressed it with the agent.'
      : accurate === false && !reason ? 'Choose why it was a false alarm.'
        : notesTooShort ? 'Complete the required details before saving.' : null

  const canLeave = () => {
    if (submitting) { toast.info('Wait for the current save to finish.'); return false }
    return !dirty || window.confirm('Discard your unsaved review?')
  }
  const requestClose = () => { if (canLeave()) onClose() }
  const requestAdvance = (delta: 1 | -1) => { if (canLeave()) onAdvance(delta) }

  useEffect(() => {
    if (!dirty && !submitting) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, submitting])

  useEffect(() => {
    if (!dirty && !submitting) return
    const indexOf = (state: unknown): number | null => state && typeof state === 'object' && 'idx' in state && typeof state.idx === 'number' && Number.isInteger(state.idx) ? state.idx : null
    const currentIndex = indexOf(window.history.state)
    let restoring = false
    const handler = (event: PopStateEvent) => {
      const nextIndex = indexOf(event.state)
      if (currentIndex === null || nextIndex === null) return
      if (restoring && nextIndex === currentIndex) { restoring = false; event.stopImmediatePropagation(); return }
      if (!submitting && window.confirm('Discard your unsaved review?')) return
      if (submitting) toast.info('Wait for the current save to finish.')
      event.stopImmediatePropagation()
      restoring = true
      window.history.go(currentIndex - nextIndex)
    }
    return registerHistoryNavigationGuard(handler)
  }, [dirty, submitting])

  const handleSubmit = async () => {
    if (!row || !currentUserEmail || formIncomplete || submissionPending.current) {
      toast.error('Complete the review before saving.')
      return
    }
    submissionPending.current = true
    setSubmitting(true)
    const result = await submitAuditFeedback({
      call_id: row.call_id,
      manager_email: currentUserEmail,
      accurate,
      action_taken: accurate ? action : null,
      inaccuracy_reason: !accurate ? reason : null,
      comment: comment.trim() || null,
    }).catch(() => ({ ok: false, error: 'Network unavailable. Your draft is still here; try again.' }))
    submissionPending.current = false
    setSubmitting(false)
    if (!result.ok) { toast.error(`Couldn't save review: ${result.error}`); return }
    toast.success('Review saved')
    onSubmitted({ feedback_by: currentUserEmail, accurate, action_taken: accurate ? action : null, inaccuracy_reason: !accurate ? reason : null, feedback_comment: comment.trim() || null, reviewed_at: new Date().toISOString(), is_reviewed: true })
  }

  useEffect(() => {
    if (!row) return
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const isText = target && ((target instanceof HTMLInputElement && target.type !== 'radio') || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void handleSubmit(); return }
      if (isText || event.metaKey || event.ctrlKey || event.altKey || submitting) return
      if (event.key === 'j' && hasNext) requestAdvance(1)
      if (event.key === 'k' && hasPrev) requestAdvance(-1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (!row) return null
  const evidence = auditEvidence(row.result_json)
  const reasoning = auditReasoning(row.result_json)
  const openTranscript = () => {
    setShowTranscript(true)
    setTranscriptFocusRequest(request => request + 1)
  }

  return <Sheet open onOpenChange={open => !open && requestClose()}>
    <SheetContent side="center" hideClose
      onOpenAutoFocus={() => { const active = document.activeElement; returnFocusTarget.current = active instanceof HTMLElement && active !== document.body ? active : null }}
      onCloseAutoFocus={event => { const target = returnFocusTarget.current; if (!target?.isConnected) return; event.preventDefault(); target.focus() }}
      className="flex flex-col gap-0 overflow-hidden bg-pennie-white p-0 shadow-xl [--border:225_12%_72%] [&_textarea]:border-pennie-navy/60 [&_select]:border-pennie-navy/60">
      <SheetDescription className="sr-only">Review the disposition evidence, record a decision, and save the follow-up.</SheetDescription>
      <SheetHeader className="shrink-0 space-y-1 border-b border-border px-4 py-2 text-left sm:px-8 sm:py-3 lg:px-10">
        <div className="flex items-center gap-2 sm:gap-3">
          <button type="button" onClick={requestClose} aria-label="Back to disposition audit" className="pennie-focus-ring -ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-sm font-semibold text-pennie-navy hover:bg-pennie-beige sm:hidden"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</button>
          <span className="hidden rounded-full bg-pennie-beige px-3 py-1 text-xs font-bold uppercase tracking-wider text-pennie-navy sm:inline-flex">{CATEGORY_LABELS[row.audit_category]}</span>
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{formatDateTime(row.alert_created_at)}</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => requestAdvance(-1)} disabled={!hasPrev} aria-label="Previous (k)" className="pennie-focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => requestAdvance(1)} disabled={!hasNext} aria-label="Next (j)" className="pennie-focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={requestClose} aria-label="Close (Esc)" className="pennie-focus-ring ml-1 hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border hover:bg-pennie-beige sm:inline-flex"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:hidden"><span className="rounded-full bg-pennie-beige px-3 py-1 text-xs font-bold uppercase tracking-wider text-pennie-navy">{CATEGORY_LABELS[row.audit_category]}</span><span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(row.alert_created_at)}</span></div>
        <SheetTitle className="sr-only">Disposition audit review</SheetTitle>
        <p className="break-words text-xs leading-relaxed text-pennie-graphite sm:text-sm"><span className="font-medium">{row.agent_email || 'Unknown agent'}</span><span className="text-pennie-graphite/60"> · </span>{row.contact_name || 'Unknown'}{row.contact_phone && <span className="ml-2 tabular-nums text-pennie-graphite/70">{formatPhoneNumber(row.contact_phone)}</span>}</p>
      </SheetHeader>

      <section aria-label="Call recording" className="shrink-0 border-b border-border bg-pennie-blue-main/30 px-4 py-2 sm:px-8 sm:py-3 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          {row.recording_link ? <h2 className="pennie-label hidden items-center gap-1.5 sm:inline-flex"><Headphones className="h-3.5 w-3.5" aria-hidden="true" />Recording</h2> : <p className="text-xs text-pennie-graphite/70">Recording not available</p>}
          {row.transcript_url && (
            <a href={row.transcript_url} target="_blank" rel="noopener noreferrer"
              className="pennie-focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-pennie-white px-4 py-2 text-sm font-semibold text-pennie-blue-deeper transition-colors hover:bg-pennie-beige motion-safe:active:scale-[0.96]">
              View Regal transcript
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <button type="button" onClick={openTranscript} className="pennie-focus-ring ml-auto mr-4 min-h-[44px] text-xs font-semibold text-pennie-blue-deeper hover:underline">View transcript</button>
          {row.recording_link && <a href={row.recording_link} target="_blank" rel="noopener noreferrer" className="pennie-focus-ring inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-pennie-blue-deeper hover:underline">Open recording <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
        </div>
        {row.recording_link && <AudioPlayer key={row.call_id} recordingUrl={row.recording_link} />}
      </section>

      <div className="relative min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-8 sm:py-6 lg:px-10">
        <article aria-label="Disposition audit review" className="overflow-hidden rounded-2xl border border-border md:grid md:grid-cols-2">
          <section aria-label="Disposition audit: Eavesly evidence" className="min-w-0 space-y-5 bg-pennie-beige p-4 sm:p-5">
            <div><p className="mb-1 text-xs font-bold text-pennie-blue-deeper">Eavesly’s assessment</p><h2 className="text-base font-semibold text-pennie-navy">Why the disposition needs review</h2></div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-pennie-peach-light/30 p-3"><dt className="pennie-label">Agent set</dt><dd className="mt-1 text-sm font-semibold text-pennie-navy">{row.current_disposition || '—'}</dd></div>
              <div className="rounded-xl bg-pennie-green-light/30 p-3"><dt className="pennie-label">Eavesly suggests</dt><dd className="mt-1 text-sm font-semibold text-pennie-navy">{row.suggested_disposition || '—'}</dd></div>
            </dl>
            <p className="text-sm text-pennie-graphite">Conversation {row.model_conversation_happened === 'no' ? 'did not happen' : row.model_conversation_happened}{row.model_confidence != null && <span className="text-pennie-graphite/60"> · confidence {Math.round(row.model_confidence * 100)}%</span>}</p>
            {reasoning && <div><p className="pennie-label mb-1">Why Eavesly disagrees</p><p className="text-sm leading-relaxed text-pennie-graphite">{reasoning}</p></div>}
            {evidence.length > 0 && <div><p className="pennie-label mb-2">Evidence</p><ul className="space-y-3">{evidence.map((item, index) => <li key={index}><blockquote className="border-l-2 border-pennie-yellow-dark pl-3 text-sm leading-relaxed text-pennie-graphite">{item.quote}</blockquote>{(item.speaker || item.rationale) && <p className="mt-1 text-xs text-pennie-graphite/60">{item.speaker}{item.speaker && item.rationale ? ' · ' : ''}{item.rationale}</p>}</li>)}</ul></div>}
            {row.call_summary && <div><p className="pennie-label mb-1">Call summary</p><p className="whitespace-pre-wrap text-sm leading-relaxed text-pennie-graphite">{row.call_summary}</p></div>}
            <div className="flex flex-wrap gap-4">
              {row.sfdc_lead_id && <a href={`https://trypennie.lightning.force.com/lightning/r/Lead/${row.sfdc_lead_id}/view`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-pennie-blue-deeper hover:underline">SFDC: {row.sfdc_lead_id} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
            </div>
            <button type="button" onClick={() => showTranscript ? setShowTranscript(false) : openTranscript()} aria-expanded={showTranscript} className="pennie-focus-ring min-h-[44px] rounded-full border border-border bg-white px-4 text-sm font-semibold text-pennie-blue-deeper">{showTranscript ? 'Hide transcript context' : 'Inspect transcript context'}</button>
            {showTranscript && <AlertTranscript callId={row.call_id} focusRequest={transcriptFocusRequest} evidence={evidence.flatMap(item => typeof item.quote === 'string' ? [item.quote] : [])} />}
          </section>
          <section id={responseId} tabIndex={-1} aria-label="Disposition audit: Your response" className="pennie-focus-ring min-w-0 space-y-4 border-t border-border p-4 sm:p-5 md:border-l md:border-t-0">
            <div><p className="mb-1 text-xs font-bold text-pennie-blue-deeper">Your response</p><h2 className="text-base font-semibold text-pennie-navy">Review and follow up</h2></div>
            <fieldset disabled={submitting}><legend className="mb-3 text-sm font-semibold text-pennie-navy">Did the agent disposition this wrong?<span className="ml-1 text-pennie-peach-deeper" aria-hidden="true">*</span></legend><div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Verdict"><ReviewChoice name={`${commentId}-verdict`} label="Real issue" checked={accurate === true} onChange={() => { setAccurate(true); setReason(null) }} pill={false} /><ReviewChoice name={`${commentId}-verdict`} label="False alarm" checked={accurate === false} onChange={() => { setAccurate(false); setAction(null) }} pill={false} /></div></fieldset>
            {accurate === true && <fieldset disabled={submitting}><legend className="pennie-label mb-2">How did you address it with the agent? *</legend><div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Action taken">{ACTION_OPTIONS.map((option, index) => <ReviewChoice key={option} name={`${commentId}-action`} label={`${index + 1}. ${ACTION_TAKEN_LABELS[option]}`} ariaLabel={`${index + 1}. ${ACTION_TAKEN_LABELS[option]}`} checked={action === option} onChange={() => setAction(option)} />)}</div></fieldset>}
            {accurate === false && <fieldset disabled={submitting}><legend className="pennie-label mb-2">Why was it a false alarm? *</legend><div className="flex flex-wrap gap-2" role="radiogroup" aria-label="False alarm reason">{INACCURACY_OPTIONS.map((option, index) => <ReviewChoice key={option} name={`${commentId}-reason`} label={`${index + 1}. ${INACCURACY_REASON_LABELS[option]}`} ariaLabel={`${index + 1}. ${INACCURACY_REASON_LABELS[option]}`} checked={reason === option} onChange={() => setReason(option)} />)}</div></fieldset>}
            {accurate !== null && <div><label htmlFor={commentId} className="pennie-label mb-1.5 block">{accurate ? 'What happened and how you addressed it *' : otherNoteRequired ? 'Explain why *' : 'Notes (optional)'}</label><textarea id={commentId} value={comment} disabled={submitting} onChange={event => setComment(event.target.value)} rows={4} className="pennie-focus-ring w-full resize-none rounded-2xl border border-border bg-white px-3 py-2 text-base font-medium sm:text-sm disabled:opacity-60" /></div>}
          </section>
        </article>
      </div>

      <footer className="shrink-0 border-t border-border bg-white px-4 py-3 sm:px-8 lg:px-10">
        {guidance && <p className="mb-1 text-xs text-pennie-graphite" role="status">{guidance}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saveDisabled && !submitting && <button type="button" aria-controls={responseId} onClick={() => { const section = document.getElementById(responseId); section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: 'start', behavior: 'instant' }) }} className="pennie-focus-ring mr-auto min-h-[44px] text-sm font-semibold text-pennie-blue-deeper hover:underline">Continue review</button>}
          <button type="button" onClick={() => void handleSubmit()} disabled={saveDisabled} className="min-h-[44px] rounded-full bg-pennie-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-pennie-navy/90 disabled:cursor-not-allowed disabled:opacity-40">{submitting ? 'Saving…' : row.is_reviewed ? 'Update review' : 'Save review'}</button>
        </div>
      </footer>
    </SheetContent>
  </Sheet>
}
