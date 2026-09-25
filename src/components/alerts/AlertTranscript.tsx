import { useEffect, useRef, type ComponentProps } from 'react'
import { useCallDetail } from '@/hooks/use-queries'
import { TranscriptView } from '@/components/call-detail/TranscriptView'
import { ErrorState } from '@/components/states/ErrorState'
import type { UserScope } from '@/lib/alert-queries'

/** Scoped transcript state for the open call; Full QA mounts it eagerly and other reviews on request. */
export function AlertTranscript({ callId, scope, agentEmail, reviewedTranscript, reviewedTurns, focusRequest = 0, ...navigation }: {
  readonly callId: string
  readonly scope?: UserScope
  readonly agentEmail?: string | null
  /** Immutable source returned by the source-candidate review context. */
  readonly reviewedTranscript?: string
  readonly reviewedTurns?: readonly { readonly speaker: string; readonly text: string }[]
} & Omit<ComponentProps<typeof TranscriptView>, 'transcript' | 'sourceTurns' | 'constrainHeight'>) {
  const allowed = !scope || scope.isGodMode || (!!agentEmail && scope.managedAgents.some(email => email.toLowerCase() === agentEmail.toLowerCase()))
  const { data: call, isPending, isError, refetch } = useCallDetail(reviewedTranscript ? undefined : callId, scope, agentEmail)
  const contextRef = useRef<HTMLElement>(null)
  const transcript = reviewedTranscript ?? call?.qa?.original_transcript
  const hasTranscript = typeof transcript === 'string' && !!transcript.trim()
  useEffect(() => {
    // Search owns focus for a reviewed snapshot. Preserve legacy pending/error focus behavior.
    if (focusRequest <= 0 || (reviewedTranscript ? hasTranscript : (!isPending && !isError && hasTranscript))) return
    contextRef.current?.focus({ preventScroll: true })
    contextRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [focusRequest, reviewedTranscript, isPending, isError, hasTranscript])

  return <section ref={contextRef} tabIndex={-1} aria-label="Transcript context" className="pennie-focus-ring">
    {!allowed ? <p className="text-sm text-muted-foreground">Transcript unavailable outside your assigned team.</p>
      : !reviewedTranscript && isPending ? <p role="status" className="text-sm text-muted-foreground">Loading transcript…</p>
      : !reviewedTranscript && isError ? <ErrorState compact message="Couldn't load the transcript. Retry, or use the external transcript link above." onRetry={() => refetch()} />
        : hasTranscript ? <>{reviewedTranscript && <p className="mb-3 text-xs font-semibold text-pennie-graphite lg:hidden">Saved transcript</p>}<TranscriptView {...navigation} transcript={transcript} sourceTurns={reviewedTurns} constrainHeight={false} focusRequest={focusRequest} /></>
          : <p className="text-sm text-muted-foreground">No transcript text is available for this call. Use the recording or external transcript link above.</p>}
  </section>
}
