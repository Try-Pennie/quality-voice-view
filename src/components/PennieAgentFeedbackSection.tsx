import { MessageSquareText } from 'lucide-react'
import type { AchieveAgentFeedback } from '@/lib/achieve-queries'
import { formatDateTime } from '@/lib/utils'

// What the Pennie agent said about the Achieve welcome-call rep on this call
// (from the "Achieve Welcome Call" feedback form). Internal-dashboard version
// of the card the /achieve portal shows Achieve managers. Renders nothing when
// no submission matched the call — most calls won't have one.

function qualityTone(quality: string | null): string {
  const q = (quality ?? '').toLowerCase()
  if (q === 'good') return 'bg-pennie-green-light text-pennie-green-dark'
  if (q === 'poor') return 'bg-pennie-peach-light text-pennie-peach-deeper'
  if (q === 'fair') return 'bg-pennie-yellow-light text-pennie-yellow-dark'
  return 'bg-pennie-beige text-pennie-graphite'
}

export function PennieAgentFeedbackSection({
  feedback,
  compact = false,
}: {
  feedback: AchieveAgentFeedback[] | undefined
  compact?: boolean
}) {
  if (!feedback || feedback.length === 0) return null

  const body = (
    <>
      <h2 className="pennie-label mb-1 inline-flex items-center gap-1.5">
        <MessageSquareText className="w-3.5 h-3.5" aria-hidden="true" />
        Pennie agent feedback
      </h2>
      <p className="text-xs text-pennie-graphite/70 mb-3 leading-5">
        Submitted by the Pennie agent who transferred the client and observed the Achieve welcome
        call. Not every transfer gets a submission.
      </p>
      <div className="space-y-3">
        {feedback.map(item => (
          <AgentFeedbackItem key={item.id} item={item} />
        ))}
      </div>
    </>
  )

  // compact: caller provides the surrounding section chrome (e.g. the alert
  // drawer's spaced sections); default: standalone dashboard card.
  if (compact) return <section>{body}</section>
  return <section className="pennie-card">{body}</section>
}

function AgentFeedbackItem({ item }: { item: AchieveAgentFeedback }) {
  const flags = [
    item.accent === true ? 'Accent' : null,
    item.background_noise === true ? 'Background noise' : null,
    item.connection_issues === true ? 'Connection issues' : null,
  ].filter((f): f is string => f !== null)

  return (
    <div className="rounded-2xl border border-border bg-pennie-beige/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {item.call_quality && (
          <span className={`pennie-pill ${qualityTone(item.call_quality)}`}>
            {item.call_quality}
          </span>
        )}
        {flags.map(flag => (
          <span
            key={flag}
            className="rounded-full bg-pennie-yellow-light px-2 py-0.5 text-[11px] font-semibold text-pennie-yellow-dark"
          >
            {flag}
          </span>
        ))}
        {item.achieve_agent_name && (
          <span className="text-xs text-pennie-graphite/80">
            Welcome-call rep:{' '}
            <span className="font-semibold text-pennie-graphite">{item.achieve_agent_name}</span>
          </span>
        )}
      </div>
      {item.notes && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-pennie-graphite">
          {item.notes}
        </p>
      )}
      <p className="mt-2 text-xs text-pennie-graphite/60">
        {item.submitted_by ? `Submitted by ${item.submitted_by}` : 'Submitter not recorded'} ·{' '}
        {formatDateTime(item.submitted_at)}
      </p>
    </div>
  )
}
