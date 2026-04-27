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
  VIOLATION_TYPE_LABELS,
  extractEvidence,
  extractReason,
  submitAlertFeedback,
} from '@/lib/alert-queries'
import {
  accentForViolation,
  pillClasses,
} from '@/lib/violation-styles'
import { formatDateTime, formatPhoneNumber } from '@/lib/utils'
import type {
  AlertActionTaken,
  AlertInaccuracyReason,
  AlertWithFeedback,
} from '@/types/database'
import { ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'

const ACTION_OPTIONS: AlertActionTaken[] = [
  'coached',
  'escalated',
  'follow_up_later',
  'no_action_needed',
]

const INACCURACY_OPTIONS: AlertInaccuracyReason[] = [
  'soft_inquiry_misclassified',
  'wrong_context',
  'evidence_misquoted',
  'policy_does_not_apply',
  'addressed_off_call',
  'other',
]

interface Props {
  alert: AlertWithFeedback | null
  currentUserEmail: string | null | undefined
  onClose: () => void
  onSubmitted: (updated: Partial<AlertWithFeedback>) => void
  onAdvance: (delta: 1 | -1) => void
  hasNext: boolean
  hasPrev: boolean
}

export function AlertReviewDrawer({
  alert,
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
  const [showRaw, setShowRaw] = useState(false)
  const commentId = useId()
  const rawJsonId = useId()

  useEffect(() => {
    if (!alert) return
    setAccurate(alert.accurate)
    setAction(alert.action_taken)
    setReason(alert.inaccuracy_reason)
    setComment(alert.feedback_comment ?? '')
    setShowRaw(false)
  }, [alert?.call_id, alert?.module_name])

  useEffect(() => {
    if (!alert) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
        return
      }
      if (isText) return

      if (e.key === 'y' || e.key === 'Y') {
        setAccurate(true)
        setReason(null)
      } else if (e.key === 'n' || e.key === 'N') {
        setAccurate(false)
        setAction(null)
      } else if (e.key === 'j') {
        if (hasNext) onAdvance(1)
      } else if (e.key === 'k') {
        if (hasPrev) onAdvance(-1)
      } else if (e.key === 'Escape') {
        onClose()
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        if (accurate === true && ACTION_OPTIONS[idx]) setAction(ACTION_OPTIONS[idx])
        if (accurate === false && INACCURACY_OPTIONS[idx])
          setReason(INACCURACY_OPTIONS[idx])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert, accurate, hasNext, hasPrev])

  const handleSubmit = async () => {
    if (!alert || !currentUserEmail) return
    if (accurate === null) {
      toast.error('Please mark the alert as accurate or not.')
      return
    }
    setSubmitting(true)
    const res = await submitAlertFeedback({
      call_id: alert.call_id,
      module_name: alert.module_name,
      manager_email: currentUserEmail,
      accurate,
      action_taken: accurate ? action : null,
      inaccuracy_reason: !accurate ? reason : null,
      comment: comment.trim() || null,
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error(`Couldn't save feedback: ${res.error}`)
      return
    }
    toast.success('Feedback saved')
    onSubmitted({
      feedback_id: alert.feedback_id ?? -1,
      feedback_by: currentUserEmail,
      accurate,
      action_taken: accurate ? action : null,
      inaccuracy_reason: !accurate ? reason : null,
      feedback_comment: comment.trim() || null,
      reviewed_at: new Date().toISOString(),
      is_reviewed: true,
    })
  }

  if (!alert) return null

  const evidence = extractEvidence(alert.violation_type, alert.result_json)
  const reasonText = extractReason(alert.violation_type, alert.result_json)
  const violationLabel =
    VIOLATION_TYPE_LABELS[alert.violation_type] || alert.violation_type
  const promptCopy = alert.is_reviewed ? 'Update your review' : 'Was this alert accurate?'

  return (
    <Sheet open={!!alert} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden bg-pennie-white"
      >
        {/* Header */}
        <SheetHeader className="px-8 py-5 border-b border-border space-y-3 text-left">
          <div className="flex items-center gap-3">
            <span className={pillClasses(accentForViolation(alert.violation_type))}>
              {violationLabel}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDateTime(alert.alert_created_at)}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => onAdvance(-1)}
                disabled={!hasPrev}
                aria-label="Previous alert (k)"
                title="Previous (k)"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onAdvance(1)}
                disabled={!hasNext}
                aria-label="Next alert (j)"
                title="Next (j)"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <SheetTitle className="text-xl font-semibold text-pennie-navy text-left">
            {violationLabel}{' '}
            <span className="text-pennie-graphite/60 font-normal">
              · call {alert.call_id}
            </span>
          </SheetTitle>
          <p className="text-sm text-pennie-graphite/80">
            {alert.agent_email || 'Unknown agent'} ·{' '}
            {alert.contact_name || 'No contact name'} ·{' '}
            <span className="tabular-nums">{formatPhoneNumber(alert.contact_phone)}</span>
          </p>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">
          <section>
            <h2 className="pennie-label mb-2">Recording</h2>
            <AudioPlayer recordingUrl={alert.recording_link} />
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {alert.transcript_url && (
                <a
                  href={alert.transcript_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-pennie-blue-dark font-semibold hover:underline underline-offset-4"
                >
                  Transcript <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              {alert.recording_link && (
                <a
                  href={alert.recording_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-pennie-blue-dark font-semibold hover:underline underline-offset-4"
                >
                  Open recording <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              {alert.sfdc_lead_id && (
                <a
                  href={`https://trypennie.lightning.force.com/lightning/r/Lead/${alert.sfdc_lead_id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-pennie-blue-dark font-semibold hover:underline underline-offset-4"
                >
                  SFDC: {alert.sfdc_lead_id} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </section>

          <section>
            <h2 className="pennie-label mb-3">Why it fired</h2>
            <div className="space-y-4 text-sm">
              {reasonText && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Reason
                  </p>
                  <p className="text-pennie-graphite leading-relaxed">{reasonText}</p>
                </div>
              )}
              {evidence && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Evidence
                  </p>
                  <blockquote className="border-l-2 border-pennie-blue-main pl-4 italic text-pennie-graphite leading-relaxed">
                    {evidence}
                  </blockquote>
                </div>
              )}
              {alert.call_summary && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Call summary
                  </p>
                  <p className="text-pennie-graphite leading-relaxed whitespace-pre-wrap">
                    {alert.call_summary}
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowRaw(s => !s)}
                aria-expanded={showRaw}
                aria-controls={rawJsonId}
                className="text-xs font-semibold text-muted-foreground hover:text-pennie-navy underline-offset-4 hover:underline"
              >
                {showRaw ? 'Hide' : 'Show'} raw evaluation JSON
              </button>
              {showRaw && (
                <pre
                  id={rawJsonId}
                  className="bg-pennie-beige p-4 rounded-2xl text-xs overflow-x-auto max-h-64 overflow-y-auto text-pennie-graphite"
                >
                  {JSON.stringify(alert.result_json, null, 2)}
                </pre>
              )}
            </div>
          </section>
        </div>

        {/* Sticky feedback footer */}
        <div className="border-t border-border bg-pennie-beige/40 px-8 py-5 space-y-4">
          <fieldset>
            <legend className="flex items-center justify-between w-full mb-3">
              <span className="text-sm font-semibold text-pennie-navy">
                {promptCopy}
              </span>
              {alert.is_reviewed && (
                <span className="text-xs text-muted-foreground">
                  Last reviewed{' '}
                  {alert.reviewed_at ? formatDateTime(alert.reviewed_at) : ''} by{' '}
                  {alert.feedback_by || '—'}
                </span>
              )}
            </legend>

            <div className="flex gap-2" role="radiogroup" aria-label={promptCopy}>
              <Toggle
                label="Yes (Y)"
                active={accurate === true}
                tone="success"
                onClick={() => {
                  setAccurate(true)
                  setReason(null)
                }}
              />
              <Toggle
                label="No (N)"
                active={accurate === false}
                tone="danger"
                onClick={() => {
                  setAccurate(false)
                  setAction(null)
                }}
              />
            </div>
          </fieldset>

          {accurate === true && (
            <fieldset>
              <legend className="pennie-label mb-2">What did you do?</legend>
              <div
                className="flex flex-wrap gap-1.5"
                role="radiogroup"
                aria-label="Action taken"
              >
                {ACTION_OPTIONS.map((opt, i) => (
                  <Chip
                    key={opt}
                    label={`${i + 1}. ${ACTION_TAKEN_LABELS[opt]}`}
                    active={action === opt}
                    onClick={() => setAction(action === opt ? null : opt)}
                  />
                ))}
              </div>
            </fieldset>
          )}

          {accurate === false && (
            <fieldset>
              <legend className="pennie-label mb-2">What was wrong?</legend>
              <div
                className="flex flex-wrap gap-1.5"
                role="radiogroup"
                aria-label="Inaccuracy reason"
              >
                {INACCURACY_OPTIONS.map((opt, i) => (
                  <Chip
                    key={opt}
                    label={`${i + 1}. ${INACCURACY_REASON_LABELS[opt]}`}
                    active={reason === opt}
                    onClick={() => setReason(reason === opt ? null : opt)}
                  />
                ))}
              </div>
            </fieldset>
          )}

          {accurate !== null && (
            <div>
              <label
                htmlFor={commentId}
                className="pennie-label mb-1.5 block"
              >
                Optional comment
              </label>
              <textarea
                id={commentId}
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Add context for the model team…"
                rows={2}
                className="w-full px-3 py-2 rounded-2xl border border-border bg-pennie-white text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-pennie-blue-dark/40 focus:border-pennie-blue-dark"
              />
            </div>
          )}

          <div className="flex justify-between items-center gap-3">
            <p className="text-[11px] text-muted-foreground">
              ⌘/Ctrl+Enter to submit · J/K to navigate
            </p>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || accurate === null}
              className="min-h-[44px] px-5 py-2.5 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold transition-all duration-200 hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting
                ? 'Saving…'
                : alert.is_reviewed
                  ? 'Update feedback'
                  : 'Submit feedback'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Toggle({
  label,
  active,
  tone,
  onClick,
}: {
  label: string
  active: boolean
  tone: 'success' | 'danger'
  onClick: () => void
}) {
  // Pennie palette: green-dark for accurate (positive), peach-dark for false-positive.
  const baseColors =
    tone === 'success'
      ? active
        ? 'bg-pennie-green-dark border-pennie-green-dark text-pennie-white'
        : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-green-light hover:border-pennie-green-light'
      : active
        ? 'bg-pennie-peach-dark border-pennie-peach-dark text-pennie-white'
        : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-peach-light hover:border-pennie-peach-light'
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex-1 min-h-[48px] px-4 py-3 rounded-full text-sm font-semibold border transition-all duration-200 ${baseColors}`}
    >
      {label}
    </button>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 ${
        active
          ? 'bg-pennie-blue-dark text-pennie-white border-pennie-blue-dark'
          : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-blue-light hover:border-pennie-blue-light'
      }`}
    >
      {label}
    </button>
  )
}
