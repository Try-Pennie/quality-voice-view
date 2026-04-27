import { useEffect, useState } from 'react'
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

  // Reset / hydrate form when alert changes.
  useEffect(() => {
    if (!alert) return
    setAccurate(alert.accurate)
    setAction(alert.action_taken)
    setReason(alert.inaccuracy_reason)
    setComment(alert.feedback_comment ?? '')
    setShowRaw(false)
  }, [alert?.call_id, alert?.module_name])

  // Keyboard shortcuts while drawer is open.
  useEffect(() => {
    if (!alert) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      // Cmd/Ctrl+Enter submits even from textarea.
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

  return (
    <Sheet open={!!alert} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <ViolationChip type={alert.violation_type} />
            <span className="text-xs text-muted-foreground">
              {formatDateTime(alert.alert_created_at)}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => onAdvance(-1)}
                disabled={!hasPrev}
                title="Previous (k)"
                className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => onAdvance(1)}
                disabled={!hasNext}
                title="Next (j)"
                className="p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <SheetTitle className="text-base font-semibold text-left">
            {violationLabel} on call {alert.call_id}
          </SheetTitle>
          <div className="text-sm text-muted-foreground text-left">
            {alert.agent_email || 'Unknown agent'} ·{' '}
            {alert.contact_name || 'No contact name'} ·{' '}
            {formatPhoneNumber(alert.contact_phone)}
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Recording */}
          <section>
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
              Recording
            </div>
            <AudioPlayer recordingUrl={alert.recording_link} />
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {alert.transcript_url && (
                <a
                  href={alert.transcript_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Transcript <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {alert.recording_link && (
                <a
                  href={alert.recording_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Open recording <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {alert.sfdc_lead_id && (
                <span className="text-muted-foreground">
                  SFDC: {alert.sfdc_lead_id}
                </span>
              )}
            </div>
          </section>

          {/* Why it fired */}
          <section>
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
              Why it fired
            </div>
            <div className="space-y-3 text-sm">
              {reasonText && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    Reason
                  </div>
                  <div className="text-foreground">{reasonText}</div>
                </div>
              )}
              {evidence && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    Evidence
                  </div>
                  <blockquote className="border-l-2 border-border pl-3 italic text-foreground">
                    {evidence}
                  </blockquote>
                </div>
              )}
              {alert.call_summary && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    Call summary
                  </div>
                  <div className="text-foreground whitespace-pre-wrap">
                    {alert.call_summary}
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowRaw(s => !s)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {showRaw ? 'Hide' : 'Show'} raw evaluation JSON
              </button>
              {showRaw && (
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-64 overflow-y-auto">
                  {JSON.stringify(alert.result_json, null, 2)}
                </pre>
              )}
            </div>
          </section>
        </div>

        {/* Sticky feedback footer */}
        <div className="border-t border-border bg-card px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">
              Was this alert accurate?
            </div>
            {alert.is_reviewed && (
              <div className="text-xs text-muted-foreground">
                Last reviewed{' '}
                {alert.reviewed_at ? formatDateTime(alert.reviewed_at) : ''} by{' '}
                {alert.feedback_by || '—'}
              </div>
            )}
          </div>

          <div className="flex gap-2">
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

          {accurate === true && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                What did you do?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ACTION_OPTIONS.map((opt, i) => (
                  <Chip
                    key={opt}
                    label={`${i + 1}. ${ACTION_TAKEN_LABELS[opt]}`}
                    active={action === opt}
                    onClick={() => setAction(action === opt ? null : opt)}
                  />
                ))}
              </div>
            </div>
          )}

          {accurate === false && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                What was wrong?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {INACCURACY_OPTIONS.map((opt, i) => (
                  <Chip
                    key={opt}
                    label={`${i + 1}. ${INACCURACY_REASON_LABELS[opt]}`}
                    active={reason === opt}
                    onClick={() => setReason(reason === opt ? null : opt)}
                  />
                ))}
              </div>
            </div>
          )}

          {accurate !== null && (
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Optional comment…"
              rows={2}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-none"
            />
          )}

          <div className="flex justify-between items-center">
            <div className="text-xs text-muted-foreground">
              ⌘/Ctrl+Enter to submit · J/K to navigate
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting || accurate === null}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
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
  const baseColors =
    tone === 'success'
      ? active
        ? 'bg-green-600 border-green-600 text-white'
        : 'border-border hover:bg-green-50'
      : active
        ? 'bg-red-600 border-red-600 text-white'
        : 'border-border hover:bg-red-50'
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-2.5 rounded-md text-sm font-semibold border transition-colors ${baseColors}`}
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
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card border-border hover:bg-accent'
      }`}
    >
      {label}
    </button>
  )
}

function ViolationChip({ type }: { type: string }) {
  const label = VIOLATION_TYPE_LABELS[type] || type
  const color =
    type === 'manager_escalation'
      ? 'bg-red-100 text-red-800'
      : type === 'budget_compliance'
        ? 'bg-orange-100 text-orange-800'
        : type === 'litigation_check'
          ? 'bg-purple-100 text-purple-800'
          : type === 'warm_transfer'
            ? 'bg-blue-100 text-blue-800'
            : type === 'program_expectations'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-gray-100 text-gray-800'
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}
    >
      {label}
    </span>
  )
}
