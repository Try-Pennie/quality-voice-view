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
    !currentUserEmail ||
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
