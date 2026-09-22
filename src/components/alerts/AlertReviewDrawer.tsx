import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import { AudioPlayer, type RecordingControls } from '@/components/call-detail/AudioPlayer'
import { AlertTranscript } from './AlertTranscript'
import { extractEvidenceQuotes, findTranscriptRanges, parseTranscriptTurns } from '@/lib/transcript-evidence'
import { createAudioQuoteMatcher } from '@/lib/recording-timestamps'
import { isHumanReviewed, needsCoachingFollowUp } from '@/lib/alert-review-queue'
import {
  ACTION_TAKEN_LABELS,
  INACCURACY_REASON_LABELS,
  VIOLATION_TYPE_LABELS,
  decideInternalAlertFeedback,
  editAlertMessage,
  extractEvidence,
  extractReason,
  fetchAlertOne,
  postAlertMessage,
  setAlertAck,
  softDeleteAlertMessage,
  submitAlertFeedback,
  submitInternalAlertFeedback,
  type UserScope,
} from '@/lib/alert-queries'
import { useAgentFeedbackForCall, useAlertThread, useCallDetail, useRecordingTiming } from '@/hooks/use-queries'
import { registerHistoryNavigationGuard } from '@/lib/history-navigation-guard'
import { PennieAgentFeedbackSection } from '@/components/PennieAgentFeedbackSection'
import { FULL_QA_FORM_ID, FullQaRubricReview, type FullQaSaveState } from './FullQaRubricReview'
import { ReviewChoice } from './ReviewChoice'
import { fetchFullQaReviewContext } from '@/lib/full-qa-review'
import { VIOLATION_HELP_IDS } from '@/lib/help-content'
import {
  INTERNAL_REVIEW_TEXT_LIMITS,
  parseInitialManagerReview,
  parseInternalReviewDraft,
} from '@/lib/internal-alert-review'
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
import type { AlertWorkload } from '@/lib/suppressed-alerts'
import {
  ArrowLeft,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Copy,
  ExternalLink,
  Headphones,
  Info,
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

// Ordered most-common-first so the fastest hotkeys hit the frequent reasons.
// "Covered on a prior call" leads — it was ~57% of what used to be logged as "other".
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

const LEGACY_REAL_NOTES_MIN = 30
const LEGACY_OTHER_NOTES_MIN = 10

// Insert-and-edit starters for action details. The text remains editable and
// must satisfy the same database-owned 12-character minimum.
const QUICK_PHRASES: { label: string; text: string }[] = [
  {
    label: 'Coached in 1:1',
    text: 'Coached in 1:1 — agent acknowledged the issue and committed to correcting it going forward.',
  },
  {
    label: 'Discussed after call',
    text: 'Discussed with the agent right after the call; they understood the gap and will adjust.',
  },
  {
    label: 'Escalated',
    text: 'Escalated to leadership with the recording attached for follow-up.',
  },
]

interface Props {
  alert: AlertWithFeedback | null
  animateOpen: boolean
  detailsLoading: boolean
  detailsError: boolean
  onRetryDetails: () => void
  currentUserEmail: string | null | undefined
  scope: UserScope
  workload: AlertWorkload
  onClose: () => void
  onSubmitted: (updated: Partial<AlertWithFeedback>) => void
  onAdvance: (delta: 1 | -1) => void
  hasNext: boolean
  hasPrev: boolean
  /** 1-based position of this alert in the visible queue, for "3 of 17". */
  queuePosition?: { index: number; total: number } | null
}

export function AlertReviewDrawer({
  alert,
  animateOpen,
  detailsLoading,
  detailsError,
  onRetryDetails,
  currentUserEmail,
  scope,
  workload,
  onClose,
  onSubmitted,
  onAdvance,
  hasNext,
  hasPrev,
  queuePosition,
}: Props) {
  const isFullQa = workload === 'internal' && alert?.module_name === 'full_qa'
  const callInScope = scope.isGodMode || (!!alert?.agent_email && scope.managedAgents.some(email => email.toLowerCase() === alert.agent_email?.toLowerCase()))
  const { data: transcriptCall } = useCallDetail(isFullQa && callInScope ? alert?.call_id : undefined, scope, alert?.agent_email)
  const { data: recordingTiming } = useRecordingTiming(callInScope ? alert?.call_id : undefined, alert?.module_name, alert?.recording_reference, scope)
  const player = useRef<RecordingControls>(null)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const verifiedTiming = alert?.recording_link && recordingTiming?.recording_reference === alert.recording_reference ? recordingTiming : null
  const matchAudioQuote = useMemo(() => verifiedTiming ? createAudioQuoteMatcher(verifiedTiming) : null, [verifiedTiming])
  const hasTranscriptQuote = useMemo(() => {
    const loadedTranscript = transcriptCall?.qa?.original_transcript
    const transcript = typeof loadedTranscript === 'string' ? loadedTranscript : verifiedTiming?.original_transcript ?? ''
    const original = (parseTranscriptTurns(transcript) ?? [{ text: transcript }]).map(turn => turn.text).join('\u0000')
    const matches = new Map<string, boolean>()
    return (quote: string) => {
      if (!matches.has(quote)) matches.set(quote, quote.trim().length >= 12 && findTranscriptRanges(original, [quote]).length > 0)
      return matches.get(quote) === true
    }
  }, [transcriptCall?.qa?.original_transcript, verifiedTiming])
  const renderAudioLink = (quote: string, speaker?: string, allowFind = false) => {
    const range = matchAudioQuote?.(quote)
    const canFind = allowFind && hasTranscriptQuote(quote)
    const buttonClass = 'pennie-focus-ring inline-flex min-h-[44px] items-center rounded-full px-2 text-xs font-semibold text-pennie-blue-deeper hover:underline'
    const findButton = canFind ? <button type="button" className={buttonClass} onClick={() => { openTranscript(); setTranscriptQuote(quote) }}
      aria-label={`Find in transcript${speaker ? ` — ${speaker}` : ''}`}>Find in transcript</button> : null
    if (!range) return findButton
    const label = `${Math.floor(range.start / 60)}:${Math.floor(range.start % 60).toString().padStart(2, '0')}`
    return <span className="flex flex-wrap items-center gap-1">
      <button type="button" className={buttonClass}
        aria-label={`Play from here at ${label}${speaker ? ` — ${speaker}` : ''}`}
        onClick={() => player.current?.playFrom(range.start, verifiedTiming.duration)}>
        Play from here <span className="ml-1 tabular-nums">· {label}</span>
      </button>
      {findButton}
    </span>
  }
  const [accurate, setAccurate] = useState<boolean | null>(null)
  const [action, setAction] = useState<AlertActionTaken | null>(null)
  const [reason, setReason] = useState<AlertInaccuracyReason | null>(null)
  const [comment, setComment] = useState('')
  const [violationDetails, setViolationDetails] = useState('')
  const [actionDetails, setActionDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [decisionPending, setDecisionPending] = useState(false)
  const [changeInstructions, setChangeInstructions] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [fullQaView, setFullQaView] = useState<'transcript' | 'review'>('transcript')
  const [transcriptFocusRequest, setTranscriptFocusRequest] = useState(0)
  const [transcriptQuote, setTranscriptQuote] = useState('')
  const openTranscript = () => {
    setTranscriptQuote('')
    if (isFullQa) setFullQaView('transcript')
    else setShowTranscript(true)
    setTranscriptFocusRequest(request => request + 1)
  }
  const submissionPending = useRef(false)
  const returnFocusTarget = useRef<HTMLElement | null>(null)
  const [overrideMode, setOverrideMode] = useState(false)
  const [draftBody, setDraftBody] = useState('')
  const [replyTo, setReplyTo] = useState<AlertMessage | null>(null)
  const [requireAck, setRequireAck] = useState(false)
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [ackPending, setAckPending] = useState(false)
  const [fullQaDraftDirty, setFullQaDraftDirty] = useState(false)
  const [fullQaBusy, setFullQaBusy] = useState(false)
  const [fullQaSave, setFullQaSave] = useState<FullQaSaveState>({ disabled: true, label: 'Save review', message: null, nextSectionId: null })
  const [requestingChanges, setRequestingChanges] = useState(false)
  const commentId = useId()
  const violationDetailsId = useId()
  const actionDetailsId = useId()
  const rawJsonId = useId()
  const queryClient = useQueryClient()
  // Share the rubric's cached, revision-pinned source for every Full QA evidence surface.
  const fullQaContext = useQuery({ queryKey: ['fullQaReviewContext', alert?.call_id],
    queryFn: () => fetchFullQaReviewContext(alert?.call_id ?? ''), enabled: isFullQa })

  const { data: thread, refetch: refetchThread } = useAlertThread(
    alert?.call_id,
    alert?.module_name,
    scope,
    workload,
  )
  const visibleThreadCount = thread?.messages.filter(message => !message.deleted_at).length ?? 0

  // Pennie agent form feedback about the Achieve welcome-call rep — only
  // relevant (and only fetched) for Achieve welcome-call QA alerts.
  const { data: agentFeedback } = useAgentFeedbackForCall(
    alert?.call_id,
    alert?.module_name === 'achieve_welcome_call_qa',
  )

  useEffect(() => {
    if (!alert) return
    setAccurate(alert.accurate)
    setAction(alert.action_taken)
    setReason(alert.inaccuracy_reason)
    setComment(alert.feedback_comment ?? '')
    setViolationDetails(alert.violation_details ?? '')
    setActionDetails(alert.action_details ?? '')
    setChangeInstructions('')
    setShowRaw(false)
    setShowTranscript(false)
    setFullQaView('transcript')
    setTranscriptFocusRequest(0)
    setTranscriptQuote('')
    setOverrideMode(false)
    setDraftBody('')
    setReplyTo(null)
    setRequireAck(false)
    setEditingId(null)
    setFullQaDraftDirty(false)
    setFullQaBusy(false)
    setFullQaSave({ disabled: true, label: 'Save review', message: null, nextSectionId: null })
    setRequestingChanges(false)
    // Identity changes initialize a fresh form; list enrichment must not erase a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.call_id, alert?.module_name])

  useEffect(() => {
    if (!alert) return
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      const isText =
        target &&
        ((target instanceof HTMLInputElement && target.type !== 'radio') ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (isFullQa) {
          // The Full QA form owns its own guards (dirty, valid, stale, busy); submit through it.
          const form = document.getElementById(FULL_QA_FORM_ID)
          if (form instanceof HTMLFormElement && showStructuredForm) form.requestSubmit()
          return
        }
        handleSubmit()
        return
      }
      if (isText || e.metaKey || e.ctrlKey || e.altKey || submitting) return
      if (e.key === 'j') {
        if (hasNext) requestAdvance(1)
        return
      }
      if (e.key === 'k') {
        if (hasPrev) requestAdvance(-1)
        return
      }
      if (!showStructuredForm || isFullQa) return

      if (e.key === 'y' || e.key === 'Y') {
        setAccurate(true)
      } else if (e.key === 'n' || e.key === 'N') {
        setAccurate(false)
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        if (accurate === true && ACTION_OPTIONS[idx]) setAction(ACTION_OPTIONS[idx])
        if (accurate === false && INACCURACY_OPTIONS[idx])
          setReason(INACCURACY_OPTIONS[idx])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

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
    }, scope, workload)
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
    }, scope, workload)
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

  const refreshAuthoritativeReview = async () => {
    if (!alert) return
    const latest = await fetchAlertOne(alert.call_id, alert.module_name, scope, workload).catch(() => null)
    if (latest) onSubmitted(latest)
  }

  const handleSubmit = async () => {
    if (!alert || !currentUserEmail || submissionPending.current || !showStructuredForm || isFullQa) return
    if (saveDisabled) {
      toast.error('Complete the review before saving.')
      return
    }
    submissionPending.current = true
    setSubmitting(true)

    if (workload === 'internal') {
      const draft = parsedDraft
      if (draft === null) {
        submissionPending.current = false
        setSubmitting(false)
        return
      }
      if (draft.ok === false) {
        submissionPending.current = false
        setSubmitting(false)
        toast.error(draft.error.message)
        return
      }
      const result = await submitInternalAlertFeedback({
        callId: alert.call_id,
        moduleName: alert.module_name,
        expectedRevision: alert.review_revision ?? 0,
        expectedDecisionId: alert.current_decision_id,
        draft: draft.value,
      })
      submissionPending.current = false
      setSubmitting(false)
      if (result.ok === false) {
        toast.error(`Couldn't save review: ${result.error.message}`)
        if (result.error._tag === 'StaleReview') await refreshAuthoritativeReview()
        return
      }
      toast.success(alert.current_decision === 'changes_requested' ? 'Review resubmitted' : 'Review saved')
      setAction(draft.value.action)
      setReason(draft.value.reason)
      setViolationDetails(draft.value.violationDetails ?? '')
      setActionDetails(draft.value.actionDetails ?? '')
      setComment(draft.value.falseAlarmDetails ?? '')
      onSubmitted({
        feedback_id: result.value.feedbackId,
        feedback_by: currentUserEmail,
        accurate: draft.value.verdict,
        action_taken: draft.value.action,
        inaccuracy_reason: draft.value.reason,
        feedback_comment: draft.value.falseAlarmDetails,
        violation_details: draft.value.violationDetails,
        action_details: draft.value.actionDetails,
        reviewed_at: result.value.reviewedAt,
        review_revision: result.value.reviewRevision,
        current_decision_id: null,
        current_decision: null,
        current_decision_by: null,
        current_decision_instructions: null,
        current_decided_at: null,
        current_decision_source: null,
        is_reviewed: true,
      })
      return
    }

    if (accurate === null || (accurate && !action) || (!accurate && !reason)) {
      submissionPending.current = false
      setSubmitting(false)
      toast.error('Complete the review before saving.')
      return
    }
    const result = await submitAlertFeedback({
      call_id: alert.call_id,
      module_name: alert.module_name,
      manager_email: currentUserEmail,
      accurate,
      action_taken: accurate ? action : null,
      inaccuracy_reason: !accurate ? reason : null,
      comment: comment.trim() || null,
    }, scope, workload).catch(() => ({ ok: false, error: 'Network unavailable. Your draft is still here; try again.' }))
    submissionPending.current = false
    setSubmitting(false)
    if (!result.ok) {
      toast.error(`Couldn't save review: ${result.error}`)
      return
    }
    toast.success('Review saved')
    setOverrideMode(false)
    setAction(accurate ? action : null)
    setReason(!accurate ? reason : null)
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

  const handleDecision = async (decision: 'approved' | 'changes_requested') => {
    if (!alert || workload !== 'internal' || !scope.isGodMode || decisionPending || !alert.review_revision) return
    const instructions = changeInstructions.trim()
    if (decision === 'changes_requested' && (instructions.length < INTERNAL_REVIEW_TEXT_LIMITS.min || instructions.length > INTERNAL_REVIEW_TEXT_LIMITS.max)) {
      toast.error(`Instructions must be ${INTERNAL_REVIEW_TEXT_LIMITS.min}–${INTERNAL_REVIEW_TEXT_LIMITS.max} characters.`)
      return
    }
    setDecisionPending(true)
    const result = await decideInternalAlertFeedback({
      callId: alert.call_id,
      moduleName: alert.module_name,
      expectedRevision: alert.review_revision,
      decision,
      instructions: decision === 'changes_requested' ? instructions : null,
    })
    setDecisionPending(false)
    if (result.ok === false) {
      toast.error(`Couldn't update approval: ${result.error.message}`)
      if (result.error._tag === 'StaleReview') await refreshAuthoritativeReview()
      return
    }
    if (decision === 'approved') toast.success('Review approved')
    else toast.success('Changes requested')
    setChangeInstructions('')
    onSubmitted({
      current_decision_id: result.value.decisionId,
      current_decision: result.value.decision,
      current_decision_by: currentUserEmail,
      current_decision_instructions: decision === 'changes_requested' ? instructions : null,
      current_decided_at: result.value.decidedAt,
      current_decision_source: 'typed',
      message_count: decision === 'changes_requested' ? (alert.message_count ?? 0) + 1 : alert.message_count,
    })
  }

  const reviewedByMe = !!alert && isHumanReviewed(alert) && !!currentUserEmail &&
    alert.feedback_by?.toLowerCase() === currentUserEmail.toLowerCase()
  const isCurrentManager = !!alert && !!currentUserEmail &&
    alert.assigned_manager_email?.toLowerCase() === currentUserEmail.toLowerCase()
  const returnedToCurrentManager = workload === 'internal' && alert?.current_decision === 'changes_requested' && isCurrentManager
  const showStructuredForm = !!alert && (workload === 'internal'
    ? (!alert.is_reviewed || reviewedByMe || returnedToCurrentManager)
    : (!alert.is_reviewed || reviewedByMe || overrideMode))
  const reviewDraftDirty = !!alert && !isFullQa && showStructuredForm && (accurate !== alert.accurate ||
    action !== alert.action_taken || reason !== alert.inaccuracy_reason || comment !== (alert.feedback_comment ?? '') ||
    violationDetails !== (alert.violation_details ?? '') || actionDetails !== (alert.action_details ?? ''))
  const dirty = reviewDraftDirty || fullQaDraftDirty || !!changeInstructions.trim() || !!draftBody.trim() || editingId !== null
  useEffect(() => {
    if (!dirty && !submitting && !posting && !decisionPending && !fullQaBusy) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, submitting, posting, decisionPending, fullQaBusy])
  const canLeave = () => {
    if (submitting || posting || ackPending || decisionPending || fullQaBusy) {
      toast.info('Wait for the current save to finish.')
      return false
    }
    return !dirty || window.confirm('Discard your unsaved review or message?')
  }
  const requestClose = () => { if (canLeave()) onClose() }
  const requestAdvance = (delta: 1 | -1) => { if (canLeave()) onAdvance(delta) }

  useEffect(() => {
    if (!dirty && !submitting && !posting && !ackPending && !decisionPending && !fullQaBusy) return
    const indexOf = (state: unknown): number | null =>
      state && typeof state === 'object' && 'idx' in state && typeof state.idx === 'number' && Number.isInteger(state.idx)
        ? state.idx : null
    const currentIndex = indexOf(window.history.state)
    let restoring = false
    const handler = (event: PopStateEvent) => {
      const nextIndex = indexOf(event.state)
      if (currentIndex === null || nextIndex === null) return
      if (restoring && nextIndex === currentIndex) {
        restoring = false
        event.stopImmediatePropagation()
        return
      }
      const pending = submitting || posting || ackPending || decisionPending || fullQaBusy
      if (!pending && window.confirm('Discard your unsaved review or message?')) return
      if (pending) toast.info('Wait for the current save to finish.')
      // BrowserRouter stores entry indices. Capture before its listener, then
      // traverse back to the existing entry on cancel; never push sentinels or
      // rewrite router history state. React retains the drawer and its draft.
      event.stopImmediatePropagation()
      restoring = true
      window.history.go(currentIndex - nextIndex)
    }
    return registerHistoryNavigationGuard(handler)
  }, [dirty, submitting, posting, ackPending, decisionPending, fullQaBusy])

  if (!alert) return null

  const reviewSource = isFullQa ? fullQaContext.isError ? undefined : fullQaContext.data?.sourceResult : alert.result_json
  const evidence = extractEvidence(alert.violation_type, reviewSource)
  const reasonText = extractReason(alert.violation_type, reviewSource)
  const violationLabel =
    VIOLATION_TYPE_LABELS[alert.violation_type] || alert.violation_type

  const reviewedByOther = isHumanReviewed(alert) && !reviewedByMe
  const showLegacyAckBar = workload === 'partner_qa' && reviewedByOther
  const showInternalDecisionBar = workload === 'internal' && isHumanReviewed(alert) && !returnedToCurrentManager &&
    (scope.isGodMode || alert.current_decision !== null)
  const showManagerReviewSummary = reviewedByOther && !isFullQa
  const showLegacyFullQaReviewSummary = isFullQa && fullQaContext.isSuccess && fullQaContext.data.review === null && isHumanReviewed(alert)
  const parsedInitial = alert.review_revision && alert.review_revision > 1
    ? parseInitialManagerReview(alert.initial_manager_review)
    : null
  const initialReview = parsedInitial?.ok ? parsedInitial.value : null

  const promptCopy = returnedToCurrentManager
    ? 'Correct and resubmit this review'
    : overrideMode
      ? `Override ${alert.feedback_by ? emailLabel(alert.feedback_by) : 'manager'}'s review`
      : reviewedByMe
        ? 'Your review'
        : 'Was this alert warranted?'

  const parsedDraft = workload === 'internal' ? parseInternalReviewDraft({
    verdict: accurate,
    action: accurate === true ? action : null,
    reason: accurate === false ? reason : null,
    violationDetails: accurate === true ? violationDetails : null,
    actionDetails: accurate === true ? actionDetails : null,
    falseAlarmDetails: accurate === false ? comment : null,
  }) : null
  const legacyNotesInvalid = workload === 'partner_qa' && (
    (accurate === true && comment.trim().length < LEGACY_REAL_NOTES_MIN) ||
    (accurate === false && reason === 'other' && comment.trim().length < LEGACY_OTHER_NOTES_MIN)
  )
  const saveDisabled = submitting || (workload === 'internal'
    ? !parsedDraft?.ok
    : accurate === null || (accurate && !action) || (!accurate && !reason) || legacyNotesInvalid)
  // Approval targets the persisted review; unchanged legacy reviews remain eligible.
  const approvalBlockedByDraft = workload === 'internal' && showStructuredForm &&
    (reviewDraftDirty || fullQaDraftDirty || fullQaBusy || submitting)
  const standaloneResponseId = `${commentId}-response`
  const standaloneSaveMessage = accurate === null
    ? 'Choose whether this alert was warranted.'
    : accurate === true && !action
      ? 'Choose how you addressed it with the agent.'
      : accurate === false && !reason
        ? 'Choose why the alert was unnecessary.'
        : saveDisabled
          ? 'Complete the required details before saving.'
          : null
  const standaloneReviewForm = !isFullQa && <div className="space-y-4">
    {needsCoachingFollowUp(alert) && <p className="text-sm text-pennie-blue-deeper">Coaching follow-up is still open. Update the action after follow-up through the review form when available. Approval or discussion does not complete it.</p>}
    {showStructuredForm && <>
      <fieldset disabled={submitting}>
        <legend className="mb-3 flex w-full items-center justify-between gap-3">
          <span className="text-sm font-semibold text-pennie-navy">{promptCopy}<span className="ml-1 text-pennie-peach-deeper" aria-hidden="true">*</span></span>
          {overrideMode ? <button type="button" onClick={() => {
            setOverrideMode(false); setAccurate(alert.accurate); setAction(alert.action_taken); setReason(alert.inaccuracy_reason); setComment(alert.feedback_comment ?? '')
          }} className="text-xs font-semibold text-pennie-graphite/70 hover:text-pennie-navy">Cancel override</button>
            : alert.is_reviewed && <span className="text-xs text-muted-foreground">Last edited {alert.reviewed_at ? formatDateTime(alert.reviewed_at) : ''} by {alert.feedback_by || '—'}</span>}
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={promptCopy}>
          <ReviewChoice name={`${commentId}-verdict`} label="Warranted" ariaLabel="Warranted (Y)" checked={accurate === true} onChange={() => setAccurate(true)} pill={false} />
          <ReviewChoice name={`${commentId}-verdict`} label="Unnecessary" ariaLabel="Unnecessary (N)" checked={accurate === false} onChange={() => setAccurate(false)} pill={false} />
        </div>
      </fieldset>
      {accurate === true && <fieldset disabled={submitting}>
        <legend className="pennie-label mb-2">How did you address it with the agent?<span className="ml-1 text-pennie-peach-deeper" aria-hidden="true">*</span></legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Action taken">
          {ACTION_OPTIONS.map((opt, index) => <ReviewChoice key={opt} name={`${commentId}-action`} label={`${index + 1}. ${ACTION_TAKEN_LABELS[opt]}`} ariaLabel={`${index + 1}. ${ACTION_TAKEN_LABELS[opt]}`} checked={action === opt} onChange={() => setAction(opt)} />)}
        </div>
      </fieldset>}
      {accurate === false && <fieldset disabled={submitting}>
        <legend className="pennie-label mb-2">Reason<span className="ml-1 text-pennie-peach-deeper" aria-hidden="true">*</span></legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason the alert was unnecessary">
          {INACCURACY_OPTIONS.map((opt, index) => <ReviewChoice key={opt} name={`${commentId}-reason`} label={`${index + 1}. ${INACCURACY_REASON_LABELS[opt]}`} ariaLabel={`${index + 1}. ${INACCURACY_REASON_LABELS[opt]}`} checked={reason === opt} onChange={() => setReason(opt)} />)}
        </div>
      </fieldset>}
      {workload === 'internal' && accurate === true && <div className="space-y-3">
        <ReviewTextarea id={violationDetailsId} label="What happened?" value={violationDetails} onChange={setViolationDetails} placeholder="Describe the specific behavior or missed requirement." disabled={submitting} />
        <ReviewTextarea id={actionDetailsId} label="What action did you take?" value={actionDetails} onChange={setActionDetails} placeholder="Describe the coaching, escalation, or planned follow-up." disabled={submitting} />
        <div className="flex flex-wrap items-center gap-1.5"><span className="text-[11px] font-medium text-pennie-graphite/60">Quick start:</span>{QUICK_PHRASES.map(phrase => <button key={phrase.label} type="button" disabled={submitting} title={phrase.text} onClick={() => setActionDetails(previous => previous.trim() ? `${previous.trimEnd()} ${phrase.text}` : phrase.text)} className="pennie-focus-ring min-h-[32px] rounded-full border border-border bg-white px-3 py-1 text-[11px] font-semibold text-pennie-graphite hover:bg-pennie-blue-light">{phrase.label}…</button>)}</div>
      </div>}
      {workload === 'internal' && accurate === false && <ReviewTextarea id={commentId} label="Why was the alert unnecessary?" value={comment} onChange={setComment} placeholder="Explain why the alert does not apply to this call." disabled={submitting} />}
      {workload === 'partner_qa' && accurate !== null && <ReviewTextarea id={commentId} label={accurate ? 'What happened and how you addressed it' : 'Notes'} value={comment} onChange={setComment} placeholder={accurate ? 'Describe what happened and the follow-up.' : 'Anything you want to flag…'} disabled={submitting} required={accurate || reason === 'other'} minimum={accurate ? LEGACY_REAL_NOTES_MIN : LEGACY_OTHER_NOTES_MIN} />}
      <div className="text-[11px] text-muted-foreground"><p className="hidden sm:block">⌘/Ctrl+Enter to save · J/K to navigate</p>{workload === 'internal' && alert.current_decision === 'approved' && <p>Updating creates a new revision that requires approval.</p>}</div>
    </>}
  </div>

  return (
    <Sheet open={!!alert} onOpenChange={open => !open && requestClose()}>
      <SheetContent
        side="center"
        animateOpen={animateOpen}
        hideClose
        onOpenAutoFocus={() => {
          const active = document.activeElement
          returnFocusTarget.current = active instanceof HTMLElement && active !== document.body ? active : null
        }}
        onCloseAutoFocus={event => {
          const target = returnFocusTarget.current
          if (!target?.isConnected) return
          event.preventDefault()
          target.focus()
        }}
        className={`flex flex-col gap-0 overflow-hidden bg-pennie-white p-0 shadow-xl [--border:225_12%_72%] [&_textarea]:border-pennie-navy/60 [&_select]:border-pennie-navy/60 ${isFullQa ? 'sm:inset-x-2 sm:inset-y-[2dvh] sm:h-[96dvh] sm:w-[calc(100%-1rem)] sm:max-w-none xl:max-w-[1600px]' : ''}`}
      >
        <SheetDescription className="sr-only">Review the call evidence, record a decision and follow-up, or approve the manager’s saved review.</SheetDescription>
        {/* Header */}
        <SheetHeader className="shrink-0 space-y-1 border-b border-border px-4 py-2 text-left sm:px-8 sm:py-3 lg:px-10">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={requestClose}
              aria-label="Back to alerts"
              className="min-h-[44px] -ml-1 sm:hidden inline-flex items-center gap-1 px-3 py-2 rounded-full text-sm font-semibold text-pennie-navy hover:bg-pennie-beige transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
            <span className={`${pillClasses(accentForViolation(alert.violation_type))} hidden sm:inline-flex`}>
              {violationLabel}
            </span>
            {VIOLATION_HELP_IDS[alert.violation_type] && <span className="hidden sm:inline-flex"><HelpHint id={VIOLATION_HELP_IDS[alert.violation_type]} size={4} /></span>}
            <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
              {formatDateTime(alert.alert_created_at)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {queuePosition && queuePosition.index > 0 && (
                <span
                  className="text-xs text-muted-foreground tabular-nums whitespace-nowrap mr-1.5"
                  aria-label={`Alert ${queuePosition.index} of ${queuePosition.total} in queue`}
                >
                  {queuePosition.index} of {queuePosition.total}
                </span>
              )}
              <button
                type="button"
                onClick={() => requestAdvance(-1)}
                disabled={!hasPrev}
                aria-label="Previous alert (k)"
                title="Previous (k)"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => requestAdvance(1)}
                disabled={!hasNext}
                aria-label="Next alert (j)"
                title="Next (j)"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-border hover:bg-pennie-beige disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={requestClose}
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
          <SheetTitle className="sr-only">{violationLabel} review</SheetTitle>
          <p className="break-words text-xs leading-relaxed text-pennie-graphite sm:text-sm">
            <span className="font-medium">{alert.agent_email || 'Unknown agent'}</span>
            <span className="text-pennie-graphite/60"> · </span>
            {alert.contact_name || 'Unknown'}
            {alert.contact_phone && <span className="ml-2 tabular-nums text-pennie-graphite/70">{formatPhoneNumber(alert.contact_phone)}</span>}
          </p>
        </SheetHeader>

        <section aria-label="Call recording" className="shrink-0 border-b border-border bg-pennie-blue-main/30 px-4 py-2 sm:px-8 sm:py-3 lg:px-10">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            {alert.recording_link ? <h2 className="pennie-label hidden sm:inline-flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5" aria-hidden="true" />Recording
            </h2> : !detailsLoading && !detailsError && !alert.recording_error && alert.recording_link === null && <p className="text-xs text-pennie-graphite/70">Recording not available</p>}
            {alert.transcript_url && (
              <a href={alert.transcript_url} target="_blank" rel="noopener noreferrer"
                className="pennie-focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-pennie-white px-4 py-2 text-sm font-semibold text-pennie-blue-deeper transition-colors hover:bg-pennie-beige motion-safe:active:scale-[0.96]">
                View Regal transcript
                <span className="sr-only"> (opens in a new tab)</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            <button type="button" onClick={openTranscript} className="pennie-focus-ring min-h-[44px] text-xs font-semibold text-pennie-blue-deeper hover:underline sm:ml-auto sm:mr-4">View transcript</button>
            {alert.recording_link && <a href={alert.recording_link} target="_blank" rel="noopener noreferrer" className="pennie-focus-ring inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-pennie-blue-deeper hover:underline">
              Open recording <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>}
          </div>
          {detailsError ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p role="alert">Couldn't load the recording and call details. Your review stays here.</p>
            <button type="button" onClick={onRetryDetails} className="pennie-focus-ring min-h-[44px] rounded-full border border-border px-3 font-semibold text-pennie-blue-deeper">Retry recording</button>
          </div> : alert.recording_error ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p role="alert">Recording unavailable. Call details and review evidence are still available.</p>
            <button type="button" onClick={onRetryDetails} className="pennie-focus-ring min-h-[44px] rounded-full border border-border px-3 font-semibold text-pennie-blue-deeper">Retry recording</button>
          </div> : detailsLoading || alert.recording_link === undefined
            ? <p role="status" aria-busy="true" className="min-h-[112px] sm:min-h-[68px] text-xs text-pennie-graphite/70">Loading recording…</p>
            : alert.recording_link && <AudioPlayer key={alert.call_id} recordingUrl={alert.recording_link} onRetry={onRetryDetails}
              ref={player} onAudioElement={setAudioElement} />}
        </section>

        {showLegacyAckBar && (
          <AckSection
            ackers={alert.acker_emails ?? []}
            ackedByMe={ackedByMe}
            feedbackBy={alert.feedback_by}
            currentUserEmail={currentUserEmail}
            pending={ackPending}
            onToggle={handleToggleAck}
          />
        )}
        {/* Full QA keeps transcript and review mounted together; other modules retain the original single flow. */}
        <div className={isFullQa ? 'flex min-h-0 flex-1 flex-col' : 'relative min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:space-y-7 sm:px-8 sm:py-6 lg:px-10'}>
          {isFullQa && <div role="group" aria-label="Full QA workspace view" className="grid shrink-0 grid-cols-2 border-b border-border bg-pennie-white p-2 lg:hidden">
            <button type="button" aria-pressed={fullQaView === 'transcript'} aria-controls="full-qa-transcript-panel" onClick={() => setFullQaView('transcript')} className={`pennie-focus-ring min-h-[44px] rounded-full text-sm font-semibold ${fullQaView === 'transcript' ? 'bg-pennie-navy text-pennie-white' : 'text-pennie-blue-deeper'}`}>Transcript</button>
            <button type="button" aria-pressed={fullQaView === 'review'} aria-controls="full-qa-review-panel" onClick={() => setFullQaView('review')} className={`pennie-focus-ring min-h-[44px] rounded-full text-sm font-semibold ${fullQaView === 'review' ? 'bg-pennie-navy text-pennie-white' : 'text-pennie-blue-deeper'}`}>Review</button>
          </div>}
          <div className={isFullQa ? 'grid min-h-0 flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]' : 'contents'}>
            {isFullQa && <section id="full-qa-transcript-panel" aria-label="Transcript workspace" onFocusCapture={() => setFullQaView('transcript')} className={`${fullQaView === 'transcript' ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 lg:px-8`}>
              <header>
                <p className="pennie-label text-pennie-blue-deeper">Call context</p>
                <h2 className="mt-1 text-xl font-semibold text-pennie-navy">Transcript</h2>
                <p className="mt-1 text-sm text-pennie-graphite/70">Search the call or jump here from Eavesly’s evidence. Playback never moves the transcript for you.</p>
              </header>
              <AlertTranscript key={alert.call_id} callId={alert.call_id} scope={scope} agentEmail={alert.agent_email} focusRequest={transcriptFocusRequest} searchQuote={transcriptQuote} audioElement={audioElement} recordingTiming={verifiedTiming} renderAudioLink={renderAudioLink} evidence={extractEvidenceQuotes(alert.violation_type, reviewSource)} />
              {(alert.call_summary || alert.sfdc_lead_id) && <aside className="border-t border-border pt-4">
                {alert.call_summary && <CallSummary summary={alert.call_summary} />}
                {alert.sfdc_lead_id && <a href={`https://trypennie.lightning.force.com/lightning/r/Lead/${alert.sfdc_lead_id}/view`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-pennie-blue-deeper hover:underline">SFDC: {alert.sfdc_lead_id} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
              </aside>}
            </section>}
            <div id={isFullQa ? 'full-qa-review-panel' : undefined} role={isFullQa ? 'region' : undefined} aria-label={isFullQa ? 'Review workspace' : undefined} onFocusCapture={isFullQa ? () => setFullQaView('review') : undefined} className={isFullQa ? `${fullQaView === 'review' ? 'block' : 'hidden lg:block'} min-h-0 space-y-6 overflow-y-auto overscroll-contain border-border px-4 py-5 sm:px-6 lg:border-l lg:px-7` : 'contents'}>
          {returnedToCurrentManager && alert.current_decision_instructions && (
            <div className="rounded-2xl bg-pennie-peach-light/60 px-4 py-3">
              <p className="pennie-label mb-1">Changes requested by {alert.current_decision_by ? emailLabel(alert.current_decision_by) : 'Kris'}</p>
              <p className="text-sm text-pennie-graphite whitespace-pre-wrap">{alert.current_decision_instructions}</p>
            </div>
          )}

          {initialReview && (
            <details className="group rounded-2xl border border-border px-4 py-3">
              <summary className="pennie-focus-ring cursor-pointer list-none flex items-center justify-between gap-2 rounded-full text-sm font-semibold text-pennie-blue-deeper">
                Original review history
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-3">
                <ManagerReviewSummary
                  title="Original manager review"
                  authorEmail={initialReview.managerEmail}
                  reviewedAt={initialReview.reviewedAt}
                  accurate={initialReview.accurate}
                  actionTaken={initialReview.actionTaken}
                  inaccuracyReason={initialReview.inaccuracyReason}
                  comment={initialReview.comment}
                  violationDetails={initialReview.violationDetails}
                  actionDetails={initialReview.actionDetails}
                />
              </div>
            </details>
          )}

          {isFullQa && showInternalDecisionBar && (
            <InternalDecisionSection
              alert={alert}
              instructions={changeInstructions}
              onInstructionsChange={setChangeInstructions}
              pending={decisionPending}
              requesting={requestingChanges}
            />
          )}

          {!isFullQa && <article aria-label={`${violationLabel} review`} className="overflow-hidden rounded-2xl border border-border md:grid md:grid-cols-2">
            <section aria-label={`${violationLabel}: Eavesly evidence`} className="min-w-0 space-y-5 bg-pennie-beige p-4 sm:p-5">
              <div>
                <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold text-pennie-blue-deeper"><Info className="h-3.5 w-3.5" aria-hidden="true" />Eavesly’s assessment</p>
                <h2 className="text-base font-semibold text-pennie-navy">Why this alert needs review</h2>
              </div>
              {reasonText && <div><p className="pennie-label mb-1">Reason</p><p className="text-sm leading-relaxed text-pennie-graphite">{reasonText}</p></div>}
              {evidence && <div><p className="pennie-label mb-1">Evidence</p><blockquote className="border-l-2 border-pennie-yellow-dark pl-3 text-sm leading-relaxed text-pennie-graphite">{evidence}</blockquote>{renderAudioLink(evidence, undefined, true)}</div>}
              {alert.call_summary && <CallSummary summary={alert.call_summary} />}
              <div className="flex flex-wrap gap-4 text-sm">
                {alert.sfdc_lead_id && <a href={`https://trypennie.lightning.force.com/lightning/r/Lead/${alert.sfdc_lead_id}/view`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-pennie-blue-deeper hover:underline">SFDC: {alert.sfdc_lead_id} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
              </div>
              <button type="button" onClick={() => setShowTranscript(value => !value)} aria-expanded={showTranscript} className="pennie-focus-ring min-h-[44px] rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-pennie-blue-deeper">{showTranscript ? 'Hide transcript context' : 'Inspect transcript context'}</button>
              {showTranscript && <AlertTranscript key={alert.call_id} callId={alert.call_id} scope={scope} agentEmail={alert.agent_email} focusRequest={transcriptFocusRequest} searchQuote={transcriptQuote} audioElement={audioElement} recordingTiming={verifiedTiming} renderAudioLink={renderAudioLink} evidence={extractEvidenceQuotes(alert.violation_type, reviewSource)} />}
            </section>
            <section id={standaloneResponseId} tabIndex={-1} aria-label={`${violationLabel}: ${showStructuredForm ? 'Your response' : 'Manager’s response'}`} className="pennie-focus-ring min-w-0 space-y-4 border-t border-border p-4 sm:p-5 md:border-l md:border-t-0">
              <div><p className="mb-1 text-xs font-bold text-pennie-blue-deeper">{showStructuredForm ? 'Your response' : 'Manager’s response'}</p><h2 className="text-base font-semibold text-pennie-navy">{showStructuredForm ? 'Review and follow up' : 'Saved review'}</h2></div>
              {showStructuredForm ? standaloneReviewForm : showManagerReviewSummary ? <ManagerReviewSummary authorEmail={alert.feedback_by} reviewedAt={alert.reviewed_at} accurate={alert.accurate} actionTaken={alert.action_taken} inaccuracyReason={alert.inaccuracy_reason} comment={alert.feedback_comment} violationDetails={alert.violation_details} actionDetails={alert.action_details} /> : <p className="text-sm text-pennie-graphite/70">No editable response is available.</p>}
              {!showStructuredForm && workload === 'partner_qa' && reviewedByOther && !overrideMode && <button type="button" onClick={() => setOverrideMode(true)} className="min-h-[44px] rounded-full border border-border px-4 text-sm font-semibold text-pennie-graphite hover:bg-pennie-peach-light">Override review</button>}
              {!showStructuredForm && needsCoachingFollowUp(alert) && <p className="text-sm text-pennie-blue-deeper">Coaching follow-up is still open. Approval or discussion does not complete it.</p>}
            </section>
          </article>}

          {/* What the Pennie agent said about the Achieve welcome-call rep
              (achieve_welcome_call_qa alerts only; hidden when no submission). */}
          <PennieAgentFeedbackSection feedback={agentFeedback} compact />

          {showLegacyFullQaReviewSummary && (
            <ManagerReviewSummary
              title="Earlier manager review"
              description="This review was saved before individual scores could be reviewed. Original feedback is shown below."
              authorEmail={alert.feedback_by}
              reviewedAt={alert.reviewed_at}
              accurate={alert.accurate}
              actionTaken={alert.action_taken}
              inaccuracyReason={alert.inaccuracy_reason}
              comment={alert.feedback_comment}
              violationDetails={alert.violation_details}
              actionDetails={alert.action_details}
            />
          )}

          {isFullQa && (
            <FullQaRubricReview
              alert={alert}
              scope={scope}
              editable={showStructuredForm}
              canReloadReview={!detailsLoading && !detailsError}
              renderAudioLink={(quote, speaker) => renderAudioLink(quote, speaker, true)}
              onStaleReview={onRetryDetails}
              onDirtyChange={setFullQaDraftDirty}
              onBusyChange={setFullQaBusy}
              onSaveStateChange={setFullQaSave}
              onSubmitted={onSubmitted}
            />
          )}

          {!isFullQa && showInternalDecisionBar && (
            <InternalDecisionSection
              requesting={requestingChanges}
              alert={alert}
              instructions={changeInstructions}
              onInstructionsChange={setChangeInstructions}
              pending={decisionPending}
            />
          )}

          {isFullQa && needsCoachingFollowUp(alert) && <p className="text-sm text-pennie-blue-deeper">
            Coaching follow-up is still open. Update the action after follow-up through the review form when available. Approval or discussion does not complete it.
          </p>}

          <details className="group rounded-2xl border border-border px-4 py-3">
            <summary className="pennie-focus-ring cursor-pointer list-none flex items-center justify-between gap-2 rounded-full text-sm font-semibold text-pennie-blue-deeper">
              Technical details
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="pennie-label">Call ID</dt>
              <dd><CallIdChip id={alert.call_id} /></dd>
            </dl>
            <button
              type="button"
              onClick={() => setShowRaw(value => !value)}
              aria-expanded={showRaw}
              aria-controls={rawJsonId}
              className="mt-4 text-xs font-semibold text-muted-foreground hover:text-pennie-navy underline-offset-4 hover:underline"
            >
              {showRaw ? 'Hide' : 'Show'} raw evaluation JSON
            </button>
            {showRaw && (
              <pre id={rawJsonId} className="mt-3 bg-pennie-beige p-4 rounded-2xl text-xs overflow-x-auto text-pennie-graphite">
                {reviewSource === undefined ? 'Original assessment unavailable. Reload the rubric before inspecting its evidence.' : JSON.stringify(reviewSource, null, 2)}
              </pre>
            )}
          </details>

          <details className="group rounded-2xl border border-border px-4 py-3">
            <summary className="pennie-focus-ring cursor-pointer list-none flex items-center justify-between gap-2 rounded-full text-sm font-semibold text-pennie-blue-deeper">
              <span className="inline-flex items-center gap-2">
                Discussion
                {visibleThreadCount > 0 && <span className="text-xs text-pennie-graphite/60">{visibleThreadCount}</span>}
              </span>
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-4">
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
          </details>
            </div>
          </div>
        </div>

        {(showStructuredForm || (showInternalDecisionBar && scope.isGodMode && alert.current_decision === null)) && (
          <footer className="shrink-0 border-t border-border bg-pennie-white px-4 py-3 sm:px-8 lg:px-10">
            {approvalBlockedByDraft && scope.isGodMode && alert.current_decision === null && (
              <p className="mb-2 text-xs text-pennie-graphite/70">Complete and save review changes before approval.</p>
            )}
            {scope.isGodMode && alert.current_decision === null && changeInstructions.trim() && (
              <p className="mb-2 text-xs text-pennie-graphite/70">Send or clear the change instructions before approving.</p>
            )}
            {requestingChanges && changeInstructions.trim().length < INTERNAL_REVIEW_TEXT_LIMITS.min && (
              <p className="mb-2 text-xs text-pennie-graphite">Add at least {INTERNAL_REVIEW_TEXT_LIMITS.min} characters of instructions to request changes.</p>
            )}
            {showStructuredForm && isFullQa && fullQaSave.message && (
              <p className="mb-1 text-xs text-pennie-graphite" role="status">{fullQaSave.message}</p>
            )}
            {showStructuredForm && !isFullQa && standaloneSaveMessage && (
              <p className="mb-1 text-xs text-pennie-graphite" role="status">{standaloneSaveMessage}</p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {showStructuredForm && !isFullQa && saveDisabled && !submitting && (
                <button type="button" aria-controls={standaloneResponseId} onClick={() => {
                  const section = document.getElementById(standaloneResponseId)
                  section?.focus({ preventScroll: true })
                  section?.scrollIntoView({ block: 'start', behavior: 'instant' })
                }} className="pennie-focus-ring mr-auto min-h-[44px] text-sm font-semibold text-pennie-blue-deeper underline-offset-4 hover:underline">
                  Continue review
                </button>
              )}
              {showStructuredForm && isFullQa && fullQaSave.nextSectionId && (
                <button type="button" aria-controls={fullQaSave.nextSectionId} disabled={decisionPending} onClick={() => {
                  setFullQaView('review')
                  requestAnimationFrame(() => {
                    const section = document.getElementById(fullQaSave.nextSectionId ?? '')
                    section?.focus({ preventScroll: true })
                    section?.scrollIntoView({ block: section instanceof HTMLTextAreaElement ? 'center' : 'start', behavior: 'instant' })
                  })
                }} className="pennie-focus-ring mr-auto min-h-[44px] text-sm font-semibold text-pennie-blue-deeper underline-offset-4 hover:underline disabled:opacity-40">
                  Continue review
                </button>
              )}
              {showStructuredForm && isFullQa && (
                <button
                  type="submit"
                  form={FULL_QA_FORM_ID}
                  disabled={fullQaSave.disabled || decisionPending}
                  className="min-h-[44px] whitespace-nowrap px-4 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {fullQaSave.label}
                </button>
              )}
              {showStructuredForm && !isFullQa && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saveDisabled || decisionPending}
                  className="min-h-[44px] whitespace-nowrap px-4 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? 'Saving…'
                    : returnedToCurrentManager
                      ? 'Resubmit review'
                      : overrideMode
                        ? 'Save override'
                        : alert.is_reviewed
                          ? 'Update review'
                          : 'Save review'}
                </button>
              )}
              {showInternalDecisionBar && scope.isGodMode && alert.current_decision === null && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDecision('approved')}
                    disabled={decisionPending || approvalBlockedByDraft || !!changeInstructions.trim()}
                    className="min-h-[44px] whitespace-nowrap px-4 rounded-full bg-pennie-navy text-pennie-white text-xs sm:text-sm font-semibold disabled:opacity-40"
                  >
                    Approve review
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!requestingChanges) { setRequestingChanges(true); return }
                      void handleDecision('changes_requested')
                    }}
                    disabled={decisionPending || approvalBlockedByDraft || (requestingChanges && changeInstructions.trim().length < INTERNAL_REVIEW_TEXT_LIMITS.min)}
                    className="min-h-[44px] whitespace-nowrap px-4 rounded-full border border-pennie-peach-dark text-pennie-peach-deeper text-xs sm:text-sm font-semibold disabled:opacity-40"
                  >
                    Request changes
                  </button>
                </>
              )}
            </div>
          </footer>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ReviewTextarea({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  required = true,
  minimum = INTERNAL_REVIEW_TEXT_LIMITS.min,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled: boolean
  required?: boolean
  minimum?: number
}) {
  const length = value.trim().length
  return (
    <div>
      <label htmlFor={id} className="pennie-label mb-1.5 flex items-center justify-between">
        <span>
          {label}
          {required
            ? <span className="text-pennie-peach-deeper ml-1" aria-hidden="true">*</span>
            : <span className="text-pennie-graphite/60 ml-1 font-normal">(optional)</span>}
        </span>
        {required && <span className={`text-[11px] font-normal tabular-nums ${length < minimum ? 'text-pennie-peach-deeper' : 'text-pennie-graphite/60'}`}>
          {length}/{minimum}
        </span>}
      </label>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        maxLength={INTERNAL_REVIEW_TEXT_LIMITS.max}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full px-3 py-2 rounded-2xl border border-border bg-pennie-white text-base sm:text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper"
      />
    </div>
  )
}

function ManagerReviewSummary({
  title = 'Manager review',
  description,
  authorEmail,
  reviewedAt,
  accurate,
  actionTaken,
  inaccuracyReason,
  comment,
  violationDetails,
  actionDetails,
}: {
  title?: string
  description?: string
  authorEmail: string | null | undefined
  reviewedAt: string | null | undefined
  accurate: boolean | null | undefined
  actionTaken: AlertActionTaken | null | undefined
  inaccuracyReason: AlertInaccuracyReason | null | undefined
  comment: string | null | undefined
  violationDetails: string | null | undefined
  actionDetails: string | null | undefined
}) {
  const verdictLabel =
    accurate === true ? 'Warranted' : accurate === false ? 'Unnecessary' : 'Reviewed'
  const verdictTone =
    accurate === true
      ? 'bg-pennie-green-light text-pennie-green-deeper'
      : accurate === false
        ? 'bg-pennie-peach-light text-pennie-peach-deeper'
        : 'bg-pennie-beige text-pennie-graphite'
  return (
    <section
      aria-label="Manager review"
      className="rounded-2xl border border-pennie-blue-light bg-pennie-blue-light/20 px-4 py-4 space-y-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="pennie-label">{title}</span>
        <span className="text-xs text-pennie-graphite/70">
          {authorEmail ? emailLabel(authorEmail) : '—'}
          {reviewedAt && ` · ${formatDateTime(reviewedAt)}`}
        </span>
      </header>
      {description && <p className="text-xs leading-relaxed text-pennie-graphite/70">{description}</p>}
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
      {violationDetails?.trim() && <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">
        <span className="font-semibold">What happened: </span>{violationDetails}
      </p>}
      {actionDetails?.trim() && <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">
        <span className="font-semibold">Action details: </span>{actionDetails}
      </p>}
      {comment?.trim() && (
        <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">{comment}</p>
      )}
    </section>
  )
}

function InternalDecisionSection({
  alert,
  instructions,
  onInstructionsChange,
  pending,
  requesting,
}: {
  alert: AlertWithFeedback
  instructions: string
  onInstructionsChange: (value: string) => void
  pending: boolean
  /** When provided, the instructions box stays behind an explicit button until requested. */
  requesting?: boolean
}) {
  const instructionsHintId = useId()
  if (alert.current_decision === 'approved') {
    return <section className="flex items-center justify-between gap-3 px-4 py-4 rounded-2xl bg-pennie-green-light/40 border border-pennie-green-light">
      <p className="text-sm font-semibold text-pennie-navy">Approved by {alert.current_decision_by ? emailLabel(alert.current_decision_by) : 'a super-admin'}</p>
      <button type="button" disabled className="min-h-[44px] px-5 rounded-full bg-pennie-green-dark text-pennie-white text-sm font-semibold disabled:opacity-80">
        <CheckCheck className="inline w-4 h-4 mr-1.5" aria-hidden="true" />Approved
      </button>
    </section>
  }

  if (alert.current_decision === 'changes_requested') {
    return <section className="px-4 py-4 rounded-2xl bg-pennie-peach-light/50 border border-pennie-peach-light">
      <p className="text-sm font-semibold text-pennie-navy">Changes requested by {alert.current_decision_by ? emailLabel(alert.current_decision_by) : 'a super-admin'}</p>
      {alert.current_decision_instructions && <p className="mt-1 text-sm text-pennie-graphite whitespace-pre-wrap">{alert.current_decision_instructions}</p>}
    </section>
  }

  // Start with the manager's outcome; Request changes explicitly opens this editor.
  if (requesting === false) return null
  return <section className="px-4 py-4 rounded-2xl bg-pennie-blue-light/30 border border-pennie-blue-light space-y-3">
    <p className="text-sm font-semibold text-pennie-navy">This manager review is awaiting Kris’s approval.</p>
    <label className="block text-xs font-semibold text-pennie-graphite">
      Request changes with instructions
      <textarea
        autoFocus={requesting === true}
        aria-describedby={instructionsHintId}
        value={instructions}
        disabled={pending}
        onChange={event => onInstructionsChange(event.target.value)}
        maxLength={INTERNAL_REVIEW_TEXT_LIMITS.max}
        rows={2}
        placeholder="Explain what the current manager should correct."
        className="mt-1 w-full px-3 py-2 rounded-2xl border border-border bg-pennie-white text-base sm:text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40"
      />
    </label>
    <p id={instructionsHintId} className="text-xs text-pennie-graphite/70">{INTERNAL_REVIEW_TEXT_LIMITS.min}–{INTERNAL_REVIEW_TEXT_LIMITS.max.toLocaleString('en-US')} characters · {instructions.trim().length.toLocaleString('en-US')} entered</p>
  </section>
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
    <section aria-label="Discussion thread">
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
                e.stopPropagation()
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
                  ? 'bg-pennie-green-light text-pennie-green-deeper'
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
