import { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { AudioPlayer } from '@/components/call-detail/AudioPlayer'
import {
  ACTION_TAKEN_LABELS,
  INACCURACY_REASON_LABELS,
  VIOLATION_TYPE_LABELS,
  editAlertMessage,
  extractEvidence,
  extractReason,
  postAlertMessage,
  setAlertAck,
  softDeleteAlertMessage,
  submitAlertFeedback,
} from '@/lib/alert-queries'
import { useAlertThread } from '@/hooks/use-queries'
import { VIOLATION_HELP_IDS } from '@/lib/help-content'
import { HelpHint } from '@/components/ui/help-hint'
import {
  accentForViolation,
  pillClasses,
} from '@/lib/violation-styles'
import { formatDateTime, formatPhoneNumber } from '@/lib/utils'
import type {
  AlertActionTaken,
  AlertAck,
  AlertInaccuracyReason,
  AlertMessage,
  AlertWithFeedback,
} from '@/types/database'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Copy,
  ExternalLink,
  Headphones,
  Info,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react'

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
  const [overrideMode, setOverrideMode] = useState(false)
  const [draftBody, setDraftBody] = useState('')
  const [replyTo, setReplyTo] = useState<AlertMessage | null>(null)
  const [requireAck, setRequireAck] = useState(false)
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [ackPending, setAckPending] = useState(false)
  const commentId = useId()
  const rawJsonId = useId()
  const queryClient = useQueryClient()

  const { data: thread, refetch: refetchThread } = useAlertThread(
    alert?.call_id,
    alert?.module_name,
  )

  useEffect(() => {
    if (!alert) return
    setAccurate(alert.accurate)
    setAction(alert.action_taken)
    setReason(alert.inaccuracy_reason)
    setComment(alert.feedback_comment ?? '')
    setShowRaw(false)
    setOverrideMode(false)
    setDraftBody('')
    setReplyTo(null)
    setEditingId(null)
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

  const ackedByMe = useMemo(() => {
    if (!alert || !currentUserEmail) return false
    const lower = currentUserEmail.toLowerCase()
    return (alert.acker_emails ?? []).some(e => e.toLowerCase() === lower)
  }, [alert, currentUserEmail])

  const invalidateAlertList = () => {
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }

  const handleToggleAck = async () => {
    if (!alert || !currentUserEmail) return
    setAckPending(true)
    const next = !ackedByMe
    const res = await setAlertAck({
      call_id: alert.call_id,
      module_name: alert.module_name,
      acker_email: currentUserEmail,
      acked: next,
    })
    setAckPending(false)
    if (!res.ok) {
      toast.error(`Couldn't update ack: ${res.error}`)
      return
    }
    const updatedAckers = next
      ? Array.from(
          new Set([...(alert.acker_emails ?? []), currentUserEmail]),
        )
      : (alert.acker_emails ?? []).filter(
          e => e.toLowerCase() !== currentUserEmail.toLowerCase(),
        )
    onSubmitted({ acker_emails: updatedAckers })
    invalidateAlertList()
  }

  const handlePostMessage = async () => {
    if (!alert || !currentUserEmail) return
    const body = draftBody.trim()
    if (!body) return
    setPosting(true)
    const res = await postAlertMessage({
      call_id: alert.call_id,
      module_name: alert.module_name,
      author_email: currentUserEmail,
      body,
      parent_message_id: replyTo?.id ?? null,
      requires_acknowledgment: requireAck,
    })
    setPosting(false)
    if (!res.ok) {
      toast.error(`Couldn't post message: ${res.error}`)
      return
    }
    setDraftBody('')
    setReplyTo(null)
    setRequireAck(false)
    refetchThread()
    onSubmitted({
      message_count: (alert.message_count ?? 0) + 1,
      last_message_at: new Date().toISOString(),
    })
    invalidateAlertList()
  }

  const handleEditMessage = async (messageId: number, body: string) => {
    const res = await editAlertMessage(messageId, body)
    if (!res.ok) {
      toast.error(`Couldn't edit message: ${res.error}`)
      return false
    }
    setEditingId(null)
    refetchThread()
    return true
  }

  const handleDeleteMessage = async (messageId: number) => {
    const res = await softDeleteAlertMessage(messageId)
    if (!res.ok) {
      toast.error(`Couldn't delete message: ${res.error}`)
      return
    }
    refetchThread()
    onSubmitted({
      message_count: Math.max(0, (alert?.message_count ?? 0) - 1),
    })
    invalidateAlertList()
  }

  const handleSubmit = async () => {
    if (!alert || !currentUserEmail) return
    if (accurate === null) {
      toast.error('Pick "Real issue" or "False alarm" first.')
      return
    }
    if (accurate === true && !action) {
      toast.error('Pick how you addressed it with the agent.')
      return
    }
    if (accurate === false && !reason) {
      toast.error('Pick why this was a false alarm.')
      return
    }
    if (accurate === true && comment.trim().length < 30) {
      toast.error('Add a few sentences on what happened and how you addressed it.')
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
      toast.error(`Couldn't save review: ${res.error}`)
      return
    }
    toast.success('Review saved')
    setOverrideMode(false)
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

  // Three review states drive the layout:
  //   - unreviewed       → first-pass; manager fills the structured form (required)
  //   - reviewedByMe     → editing my own review
  //   - reviewedByOther  → someone above the assigned manager (e.g. Kris) reviewing
  //                        a teammate's review — one-tap ✓ Approve, comment in
  //                        Discussion, structured form gated behind explicit Override
  const reviewedByMe =
    !!alert.is_reviewed &&
    !!alert.feedback_by &&
    !!currentUserEmail &&
    alert.feedback_by.toLowerCase() === currentUserEmail.toLowerCase()
  const reviewedByOther = !!alert.is_reviewed && !reviewedByMe

  const showStructuredForm = !alert.is_reviewed || reviewedByMe || overrideMode
  const showAckBar = reviewedByOther
  const showManagerReviewSummary = reviewedByOther

  const promptCopy = overrideMode
    ? `Override ${alert.feedback_by ? emailLabel(alert.feedback_by) : 'manager'}'s review`
    : reviewedByMe
      ? 'Your review'
      : 'Was this a real issue?'

  // Detailed notes are only required when the manager confirms a real issue.
  // False alarms already capture structured signal via inaccuracy_reason.
  const NOTES_MIN = 30
  const notesTooShort =
    accurate === true && comment.trim().length < NOTES_MIN
  const saveDisabled =
    submitting ||
    accurate === null ||
    (accurate === true && !action) ||
    (accurate === false && !reason) ||
    notesTooShort

  return (
    <Sheet open={!!alert} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        hideClose
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden bg-pennie-white"
      >
        {/* Header */}
        <SheetHeader className="px-4 sm:px-8 pt-4 pb-5 sm:py-5 border-b border-border space-y-3 text-left">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to alerts"
              className="min-h-[44px] -ml-1 sm:hidden inline-flex items-center gap-1 px-3 py-2 rounded-full text-sm font-semibold text-pennie-navy hover:bg-pennie-beige transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
            <span className={`${pillClasses(accentForViolation(alert.violation_type))} hidden sm:inline-flex`}>
              {violationLabel}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
              {formatDateTime(alert.alert_created_at)}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => onAdvance(-1)}
                disabled={!hasPrev}
                aria-label="Previous alert (k)"
                title="Previous (k)"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onAdvance(1)}
                disabled={!hasNext}
                aria-label="Next alert (j)"
                title="Next (j)"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close (Esc)"
                title="Close (Esc)"
                className="hidden sm:inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border hover:bg-pennie-beige transition-colors ml-1"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:hidden">
            <span className={pillClasses(accentForViolation(alert.violation_type))}>
              {violationLabel}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDateTime(alert.alert_created_at)}
            </span>
          </div>
          <SheetTitle className="text-xl font-semibold text-pennie-navy text-left inline-flex items-center gap-1.5">
            {violationLabel}
            {VIOLATION_HELP_IDS[alert.violation_type] && (
              <HelpHint id={VIOLATION_HELP_IDS[alert.violation_type]} size={4} />
            )}
          </SheetTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
              Agent
            </dt>
            <dd className="text-pennie-graphite font-medium break-all">
              {alert.agent_email || 'Unknown agent'}
            </dd>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
              Customer
            </dt>
            <dd className="text-pennie-graphite">
              {alert.contact_name || 'Unknown'}
              {alert.contact_phone && (
                <span className="text-pennie-graphite/70 ml-2 tabular-nums">
                  {formatPhoneNumber(alert.contact_phone)}
                </span>
              )}
            </dd>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
              Call&nbsp;ID
            </dt>
            <dd>
              <CallIdChip id={alert.call_id} />
            </dd>
          </dl>
        </SheetHeader>

        {/* Layered approval bar — only shown when reviewing a teammate's review.
             For first-pass managers, their structured form *is* the review record. */}
        {showAckBar && (
          <AckSection
            ackers={alert.acker_emails ?? []}
            ackedByMe={ackedByMe}
            feedbackBy={alert.feedback_by}
            currentUserEmail={currentUserEmail}
            pending={ackPending}
            onToggle={handleToggleAck}
          />
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">
          {showManagerReviewSummary && (
            <ManagerReviewSummary
              authorEmail={alert.feedback_by}
              reviewedAt={alert.reviewed_at}
              accurate={alert.accurate}
              actionTaken={alert.action_taken}
              inaccuracyReason={alert.inaccuracy_reason}
              comment={alert.feedback_comment}
            />
          )}

          <section>
            <h2 className="pennie-label mb-2 inline-flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
              Recording
            </h2>
            <AudioPlayer recordingUrl={alert.recording_link} />
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {alert.transcript_url && (
                <a
                  href={alert.transcript_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-pennie-blue-deeper font-semibold hover:underline underline-offset-4"
                >
                  Transcript <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              {alert.recording_link && (
                <a
                  href={alert.recording_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-pennie-blue-deeper font-semibold hover:underline underline-offset-4"
                >
                  Open recording <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
              {alert.sfdc_lead_id && (
                <a
                  href={`https://trypennie.lightning.force.com/lightning/r/Lead/${alert.sfdc_lead_id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-pennie-blue-deeper font-semibold hover:underline underline-offset-4"
                >
                  SFDC: {alert.sfdc_lead_id} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </section>

          <section>
            <h2 className="pennie-label mb-3 inline-flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
              Why it fired
            </h2>
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
                    Evidence (from transcript)
                  </p>
                  <blockquote className="border-l-2 border-pennie-blue-main pl-4 italic text-pennie-graphite leading-relaxed">
                    {evidence}
                  </blockquote>
                </div>
              )}
              {alert.call_summary && (
                <CallSummary summary={alert.call_summary} />
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

          <ThreadSection
            messages={thread?.messages ?? []}
            currentUserEmail={currentUserEmail}
            replyTo={replyTo}
            onSetReplyTo={setReplyTo}
            editingId={editingId}
            onSetEditingId={setEditingId}
            onEdit={handleEditMessage}
            onDelete={handleDeleteMessage}
            draft={draftBody}
            onDraftChange={setDraftBody}
            onPost={handlePostMessage}
            posting={posting}
            requireAck={requireAck}
            onSetRequireAck={setRequireAck}
          />
        </div>

        {/* Sticky review footer — content depends on review state */}
        <div className="border-t border-border bg-pennie-beige/40 px-8 py-5 space-y-4">
          {/* In State B (reviewing a teammate's review), the structured form is
              gated behind an explicit Override affordance. Approve via the bar
              at the top; comment via Discussion. */}
          {reviewedByOther && !overrideMode && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-pennie-graphite/70 leading-relaxed">
                Approve at the top, or comment in Discussion above. Only override if you
                disagree with the verdict.
              </p>
              <button
                type="button"
                onClick={() => setOverrideMode(true)}
                className="min-h-[36px] inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold border border-border text-pennie-graphite hover:bg-pennie-peach-light hover:border-pennie-peach-light transition-colors"
              >
                Override review
              </button>
            </div>
          )}

          {showStructuredForm && (
            <>
              <fieldset>
                <legend className="flex items-center justify-between w-full mb-3 gap-3">
                  <span className="text-sm font-semibold text-pennie-navy">
                    {promptCopy}
                    <span className="text-pennie-peach-deeper ml-1" aria-hidden="true">*</span>
                  </span>
                  {overrideMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOverrideMode(false)
                        setAccurate(alert.accurate)
                        setAction(alert.action_taken)
                        setReason(alert.inaccuracy_reason)
                        setComment(alert.feedback_comment ?? '')
                      }}
                      className="text-xs font-semibold text-pennie-graphite/70 hover:text-pennie-navy"
                    >
                      Cancel override
                    </button>
                  ) : (
                    alert.is_reviewed && (
                      <span className="text-xs text-muted-foreground">
                        Last edited{' '}
                        {alert.reviewed_at ? formatDateTime(alert.reviewed_at) : ''} by{' '}
                        {alert.feedback_by || '—'}
                      </span>
                    )
                  )}
                </legend>
                <div className="flex gap-2" role="radiogroup" aria-label={promptCopy}>
                  <Toggle
                    label="Real issue (Y)"
                    active={accurate === true}
                    tone="success"
                    onClick={() => {
                      setAccurate(true)
                      setReason(null)
                    }}
                  />
                  <Toggle
                    label="False alarm (N)"
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
                  <legend className="pennie-label mb-2">
                    How did you address it with the agent?
                    <span className="text-pennie-peach-deeper ml-1" aria-hidden="true">*</span>
                  </legend>
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
                  <legend className="pennie-label mb-2">
                    Why was it a false alarm?
                    <span className="text-pennie-peach-deeper ml-1" aria-hidden="true">*</span>
                  </legend>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="radiogroup"
                    aria-label="Why was it a false alarm?"
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
                    className="pennie-label mb-1.5 flex items-center justify-between"
                  >
                    <span>
                      {accurate ? 'What happened and how you addressed it' : 'Notes'}
                      {accurate === true && (
                        <span className="text-pennie-peach-deeper ml-1" aria-hidden="true">*</span>
                      )}
                      {accurate === false && (
                        <span className="text-pennie-graphite/60 ml-1 font-normal">(optional)</span>
                      )}
                    </span>
                    {accurate === true && (
                      <span
                        className={`text-[11px] font-normal tabular-nums ${
                          notesTooShort ? 'text-pennie-peach-deeper' : 'text-pennie-graphite/60'
                        }`}
                      >
                        {comment.trim().length}/{NOTES_MIN}
                      </span>
                    )}
                  </label>
                  <textarea
                    id={commentId}
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder={
                      accurate
                        ? 'Spoke with agent about tone — they acknowledged and committed to next 1:1…'
                        : 'Anything you want to flag…'
                    }
                    rows={3}
                    className="w-full px-3 py-2 rounded-2xl border border-border bg-pennie-white text-base sm:text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper"
                  />
                </div>
              )}

              <div className="flex justify-between items-center gap-3">
                <p className="text-[11px] text-muted-foreground">
                  ⌘/Ctrl+Enter to save · J/K to navigate
                </p>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saveDisabled}
                  className="min-h-[44px] px-5 py-2.5 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold transition-all duration-200 hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? 'Saving…'
                    : overrideMode
                      ? 'Save override'
                      : alert.is_reviewed
                        ? 'Update review'
                        : 'Save review'}
                </button>
              </div>
            </>
          )}
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
  // Verdict semantics live in the border + icon; text stays dark navy so the
  // label is legible at rest. (pennie-green-dark is a mint, not a dark green.)
  const baseColors =
    tone === 'success'
      ? active
        ? 'bg-pennie-green-dark border-pennie-green-dark text-pennie-white shadow-sm'
        : 'bg-pennie-green-light border-2 border-pennie-green-dark text-pennie-navy hover:bg-pennie-green-main/40 hover:border-pennie-green-dark'
      : active
        ? 'bg-pennie-peach-dark border-pennie-peach-dark text-pennie-white shadow-sm'
        : 'bg-pennie-peach-light border-2 border-pennie-peach-dark text-pennie-navy hover:bg-pennie-peach-main/30 hover:border-pennie-peach-deeper'
  const iconColor = active
    ? 'text-pennie-white'
    : tone === 'success'
      ? 'text-pennie-green-dark'
      : 'text-pennie-peach-deeper'
  const Icon = tone === 'success' ? Check : X
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex-1 min-h-[48px] px-4 py-3 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-all duration-200 ${baseColors}`}
    >
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${
          active ? 'bg-pennie-white/20' : 'bg-pennie-white'
        } ${iconColor}`}
      >
        <Icon className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
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
      className={`min-h-[44px] sm:min-h-[36px] px-4 sm:px-3.5 py-2 sm:py-1.5 rounded-full text-sm sm:text-xs font-semibold border transition-all duration-200 ${
        active
          ? 'bg-pennie-blue-dark text-pennie-white border-pennie-blue-dark'
          : 'bg-pennie-white border-border text-pennie-graphite hover:bg-pennie-blue-light hover:border-pennie-blue-light'
      }`}
    >
      {label}
    </button>
  )
}

function ManagerReviewSummary({
  authorEmail,
  reviewedAt,
  accurate,
  actionTaken,
  inaccuracyReason,
  comment,
}: {
  authorEmail: string | null | undefined
  reviewedAt: string | null | undefined
  accurate: boolean | null | undefined
  actionTaken: AlertActionTaken | null | undefined
  inaccuracyReason: AlertInaccuracyReason | null | undefined
  comment: string | null | undefined
}) {
  const verdictLabel =
    accurate === true ? 'Real issue' : accurate === false ? 'False alarm' : 'Reviewed'
  const verdictTone =
    accurate === true
      ? 'bg-pennie-green-light text-pennie-green-dark'
      : accurate === false
        ? 'bg-pennie-peach-light text-pennie-peach-deeper'
        : 'bg-pennie-beige text-pennie-graphite'
  return (
    <section
      aria-label="Manager review"
      className="rounded-2xl border border-pennie-blue-light bg-pennie-blue-light/20 px-4 py-4 space-y-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="pennie-label">Manager review</span>
        <span className="text-xs text-pennie-graphite/70">
          {authorEmail ? emailLabel(authorEmail) : '—'}
          {reviewedAt && ` · ${formatDateTime(reviewedAt)}`}
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${verdictTone}`}
        >
          {verdictLabel}
        </span>
        {accurate === true && actionTaken && (
          <span className="text-sm text-pennie-graphite">
            <span className="text-pennie-graphite/60">Action: </span>
            <span className="font-semibold">{ACTION_TAKEN_LABELS[actionTaken]}</span>
          </span>
        )}
        {accurate === false && inaccuracyReason && (
          <span className="text-sm text-pennie-graphite">
            <span className="text-pennie-graphite/60">Reason: </span>
            <span className="font-semibold">{INACCURACY_REASON_LABELS[inaccuracyReason]}</span>
          </span>
        )}
      </div>
      {comment && comment.trim() && (
        <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">
          {comment}
        </p>
      )}
    </section>
  )
}

function AckSection({
  ackers,
  ackedByMe,
  feedbackBy,
  currentUserEmail,
  pending,
  onToggle,
}: {
  ackers: string[]
  ackedByMe: boolean
  feedbackBy: string | null | undefined
  currentUserEmail: string | null | undefined
  pending: boolean
  onToggle: () => void
}) {
  const others = currentUserEmail
    ? ackers.filter(e => e.toLowerCase() !== currentUserEmail.toLowerCase())
    : ackers
  const summary =
    ackers.length === 0
      ? 'Not yet reviewed.'
      : ackedByMe && others.length === 0
        ? 'Reviewed by you.'
        : ackedByMe
          ? `Reviewed by you and ${formatNameList(others)}.`
          : `Reviewed by ${formatNameList(ackers)}.`

  // If a teammate has already submitted a verdict, frame the action as
  // approval — Slack-style ✓ stacked on top of theirs — instead of an
  // override. Matches Kris's "secondary review layer" ask.
  const priorReviewer =
    feedbackBy && feedbackBy.toLowerCase() !== (currentUserEmail || '').toLowerCase()
      ? emailLabel(feedbackBy)
      : null
  const ctaLabel = ackedByMe
    ? 'Reviewed'
    : priorReviewer
      ? `Approve ${priorReviewer}'s review`
      : 'Mark reviewed'

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-8 py-4 bg-pennie-green-light/40 border-b border-pennie-green-light">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`flex-none inline-flex items-center justify-center w-8 h-8 rounded-full ${
            ackers.length > 0
              ? 'bg-pennie-green-dark text-pennie-white'
              : 'bg-pennie-white border border-dashed border-pennie-graphite/30 text-pennie-graphite/40'
          }`}
          aria-hidden="true"
        >
          <CheckCheck className="w-4 h-4" />
        </span>
        <p className="text-sm font-semibold text-pennie-navy truncate">
          {summary}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending || !currentUserEmail}
        aria-pressed={ackedByMe}
        className={`min-h-[44px] inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          ackedByMe
            ? 'bg-pennie-green-dark border-pennie-green-dark text-pennie-white hover:bg-pennie-green-dark/90'
            : 'bg-pennie-navy border-pennie-navy text-pennie-white hover:bg-pennie-navy/90'
        }`}
      >
        {ackedByMe && <CheckCheck className="w-4 h-4" aria-hidden="true" />}
        {ctaLabel}
      </button>
    </section>
  )
}

function ThreadSection({
  messages,
  currentUserEmail,
  replyTo,
  onSetReplyTo,
  editingId,
  onSetEditingId,
  onEdit,
  onDelete,
  draft,
  onDraftChange,
  onPost,
  posting,
  requireAck,
  onSetRequireAck,
}: {
  messages: AlertMessage[]
  currentUserEmail: string | null | undefined
  replyTo: AlertMessage | null
  onSetReplyTo: (m: AlertMessage | null) => void
  editingId: number | null
  onSetEditingId: (id: number | null) => void
  onEdit: (id: number, body: string) => Promise<boolean>
  onDelete: (id: number) => void
  draft: string
  onDraftChange: (s: string) => void
  onPost: () => void
  posting: boolean
  requireAck: boolean
  onSetRequireAck: (v: boolean) => void
}) {
  const composeId = useId()
  const requireAckId = useId()
  const messageById = useMemo(() => {
    const m = new Map<number, AlertMessage>()
    for (const msg of messages) m.set(msg.id, msg)
    return m
  }, [messages])

  // A `requires_acknowledgment` message is "acknowledged" the moment any
  // non-author replies in-thread (parent_message_id = source.id). Renders
  // as a small green stamp on the source so the asker can see at a glance.
  const ackedSourceIds = useMemo(() => {
    const acked = new Set<number>()
    for (const msg of messages) {
      if (msg.deleted_at || !msg.parent_message_id) continue
      const parent = messageById.get(msg.parent_message_id)
      if (
        parent &&
        parent.requires_acknowledgment &&
        msg.author_email.toLowerCase() !== parent.author_email.toLowerCase()
      ) {
        acked.add(parent.id)
      }
    }
    return acked
  }, [messages, messageById])

  return (
    <section>
      <h2 className="pennie-label mb-3 inline-flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
        Discussion
        {messages.length > 0 && (
          <span className="text-pennie-graphite/60 font-normal">
            · {messages.filter(m => !m.deleted_at).length}
          </span>
        )}
      </h2>
      <div className="space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-pennie-graphite/60 italic">
            No messages yet. Start the conversation below.
          </p>
        ) : (
          messages.map(msg => (
            <MessageItem
              key={msg.id}
              message={msg}
              parent={
                msg.parent_message_id
                  ? messageById.get(msg.parent_message_id) ?? null
                  : null
              }
              currentUserEmail={currentUserEmail}
              isEditing={editingId === msg.id}
              onStartEdit={() => onSetEditingId(msg.id)}
              onCancelEdit={() => onSetEditingId(null)}
              onSaveEdit={body => onEdit(msg.id, body)}
              onDelete={() => onDelete(msg.id)}
              onReply={() => onSetReplyTo(msg)}
              acknowledged={ackedSourceIds.has(msg.id)}
            />
          ))
        )}
      </div>

      <div className="mt-4">
        {replyTo && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-full bg-pennie-blue-light/50 text-xs text-pennie-graphite">
            <CornerDownRight className="w-3 h-3" aria-hidden="true" />
            <span className="truncate">
              Replying to {emailLabel(replyTo.author_email)}:{' '}
              <span className="text-pennie-graphite/70">
                "{snippet(replyTo.body, 60)}"
              </span>
            </span>
            <button
              type="button"
              onClick={() => onSetReplyTo(null)}
              aria-label="Cancel reply"
              className="ml-auto min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-pennie-graphite/60 hover:text-pennie-navy"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        )}
        <label htmlFor={composeId} className="sr-only">
          Add a message
        </label>
        <div className="flex gap-2 items-end">
          <textarea
            id={composeId}
            value={draft}
            onChange={e => onDraftChange(e.target.value)}
            placeholder={
              currentUserEmail
                ? 'Add a message…'
                : 'Sign in to post a message'
            }
            disabled={!currentUserEmail || posting}
            rows={2}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                onPost()
              }
            }}
            className="flex-1 px-3 py-2 rounded-2xl border border-border bg-pennie-white text-base sm:text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onPost}
            disabled={!draft.trim() || !currentUserEmail || posting}
            aria-label="Post message"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full bg-pennie-navy text-pennie-white hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <label
          htmlFor={requireAckId}
          className="mt-2 inline-flex items-center gap-2 text-xs text-pennie-graphite cursor-pointer select-none"
        >
          <input
            id={requireAckId}
            type="checkbox"
            checked={requireAck}
            onChange={e => onSetRequireAck(e.target.checked)}
            disabled={!currentUserEmail || posting}
            className="w-4 h-4 rounded border-border text-pennie-blue-deeper focus:ring-pennie-blue-deeper/40"
          />
          <span>
            Require a reply
            <span className="ml-1.5 text-pennie-graphite/60">
              — recipients see a "Reply" prompt so you know they saw it.
            </span>
          </span>
        </label>
      </div>
    </section>
  )
}

function MessageItem({
  message,
  parent,
  currentUserEmail,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  acknowledged,
}: {
  message: AlertMessage
  parent: AlertMessage | null
  currentUserEmail: string | null | undefined
  isEditing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (body: string) => Promise<boolean>
  onDelete: () => void
  onReply: () => void
  acknowledged: boolean
}) {
  const [draft, setDraft] = useState(message.body)
  const [saving, setSaving] = useState(false)
  const isMine =
    !!currentUserEmail &&
    message.author_email.toLowerCase() === currentUserEmail.toLowerCase()
  const isDeleted = !!message.deleted_at

  useEffect(() => {
    if (isEditing) setDraft(message.body)
  }, [isEditing, message.body])

  if (isDeleted) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-2 text-xs italic text-pennie-graphite/50">
        (message deleted by {emailLabel(message.author_email)})
      </div>
    )
  }

  return (
    <article
      className={`rounded-2xl px-4 py-3 border ${
        isMine
          ? 'bg-pennie-blue-light/40 border-pennie-blue-light'
          : 'bg-pennie-white border-border'
      }`}
    >
      {parent && !parent.deleted_at && (
        <div className="text-[11px] text-pennie-graphite/60 mb-1.5 flex items-center gap-1">
          <CornerDownRight className="w-3 h-3" aria-hidden="true" />
          <span className="truncate">
            replying to {emailLabel(parent.author_email)}: "{snippet(parent.body, 50)}"
          </span>
        </div>
      )}
      <header className="flex items-baseline justify-between gap-2 mb-1">
        <span className="inline-flex items-baseline gap-1.5 text-sm font-semibold text-pennie-navy">
          {emailLabel(message.author_email)}
          {message.requires_acknowledgment && (
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-bold ${
                acknowledged
                  ? 'bg-pennie-green-light text-pennie-green-dark'
                  : 'bg-pennie-peach-light text-pennie-peach-deeper'
              }`}
            >
              {acknowledged ? 'Got reply' : 'Needs reply'}
            </span>
          )}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatDateTime(message.posted_at)}
          {message.edited_at && ' · edited'}
        </span>
      </header>
      {isEditing ? (
        <div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-border bg-pennie-white text-base sm:text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={saving}
              className="min-h-[44px] sm:min-h-[32px] px-4 sm:px-3 py-2 sm:py-1 text-sm sm:text-xs font-semibold text-pennie-graphite hover:text-pennie-navy"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!draft.trim()) return
                setSaving(true)
                const ok = await onSaveEdit(draft.trim())
                setSaving(false)
                if (!ok) return
              }}
              disabled={saving || !draft.trim() || draft.trim() === message.body}
              className="min-h-[44px] sm:min-h-[32px] px-4 sm:px-3 py-2 sm:py-1 rounded-full bg-pennie-navy text-pennie-white text-sm sm:text-xs font-semibold disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">
            {message.body}
          </p>
          <footer className="mt-2 -mx-1 flex items-center gap-1 sm:gap-3 text-xs sm:text-[11px]">
            {message.requires_acknowledgment && !isMine && !acknowledged && (
              <button
                type="button"
                onClick={onReply}
                className="min-h-[40px] sm:min-h-[28px] px-3 py-1.5 rounded-full bg-pennie-peach-dark text-pennie-white font-semibold hover:bg-pennie-peach-dark/90"
              >
                Reply now
              </button>
            )}
            <button
              type="button"
              onClick={onReply}
              className="min-h-[40px] sm:min-h-0 px-2 sm:px-0 py-2 sm:py-0 font-semibold text-pennie-graphite/70 hover:text-pennie-navy"
            >
              Reply
            </button>
            {isMine && (
              <>
                <button
                  type="button"
                  onClick={onStartEdit}
                  aria-label="Edit message"
                  className="min-h-[40px] sm:min-h-0 px-2 sm:px-0 py-2 sm:py-0 inline-flex items-center gap-1 font-semibold text-pennie-graphite/70 hover:text-pennie-navy"
                >
                  <Pencil className="w-3 h-3" aria-hidden="true" />
                  Edit
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      aria-label="Delete message"
                      className="min-h-[40px] sm:min-h-0 px-2 sm:px-0 py-2 sm:py-0 inline-flex items-center gap-1 font-semibold text-pennie-graphite/70 hover:text-pennie-peach-deeper"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                      Delete
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-3xl bg-pennie-white border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-pennie-navy">
                        Delete this message?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-pennie-graphite">
                        It'll be removed from the discussion. You can't undo
                        this.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-full">
                        Keep it
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={onDelete}
                        className="rounded-full bg-pennie-peach-dark text-pennie-white hover:bg-pennie-peach-dark/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </footer>
        </>
      )}
    </article>
  )
}

function CallSummary({ summary }: { summary: string }) {
  const COLLAPSE_THRESHOLD = 240
  const isLong = summary.length > COLLAPSE_THRESHOLD
  const [expanded, setExpanded] = useState(!isLong)
  const summaryId = useId()
  const display = expanded || !isLong ? summary : `${summary.slice(0, COLLAPSE_THRESHOLD).trimEnd()}…`
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Call summary
      </p>
      <p
        id={summaryId}
        className="text-pennie-graphite leading-relaxed whitespace-pre-wrap"
      >
        {display}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(s => !s)}
          aria-expanded={expanded}
          aria-controls={summaryId}
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
        >
          {expanded ? 'Show less' : 'Show full summary'}
          <ChevronDown
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  )
}

function CallIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const display = id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy call ID")
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy call ID: ${id}`}
      aria-label={`Copy call ID ${id}`}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border bg-pennie-beige/60 text-[11px] font-mono text-pennie-graphite hover:bg-pennie-beige hover:border-pennie-graphite/30 transition-colors"
    >
      <span className="tracking-tight">{display}</span>
      {copied ? (
        <CheckCheck className="w-3 h-3 text-pennie-green-dark" aria-hidden="true" />
      ) : (
        <Copy className="w-3 h-3 text-pennie-graphite/60" aria-hidden="true" />
      )}
    </button>
  )
}

function emailLabel(email: string): string {
  return email.split('@')[0] || email
}

function formatNameList(emails: string[]): string {
  const names = emails.map(emailLabel)
  if (names.length <= 1) return names.join('')
  if (names.length === 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function snippet(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
