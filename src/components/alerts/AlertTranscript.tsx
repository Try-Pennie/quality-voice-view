import { useEffect, useRef, type ComponentProps } from 'react'
import { useCallDetail } from '@/hooks/use-queries'
import { TranscriptView } from '@/components/call-detail/TranscriptView'
import { ErrorState } from '@/components/states/ErrorState'
import type { UserScope } from '@/lib/alert-queries'

/** Scoped transcript state for the open call; Full QA mounts it eagerly and other reviews on request. */
export function AlertTranscript({ callId, scope, agentEmail, focusRequest = 0, ...navigation }: {
  readonly callId: string
  readonly scope?: UserScope
  readonly agentEmail?: string | null
} & Omit<ComponentProps<typeof TranscriptView>, 'transcript' | 'constrainHeight'>) {
  const allowed = !scope || scope.isGodMode || (!!agentEmail && scope.managedAgents.some(email => email.toLowerCase() === agentEmail.toLowerCase()))
  const { data: call, isPending, isError, refetch } = useCallDetail(callId, scope, agentEmail)
  const contextRef = useRef<HTMLElement>(null)
  const transcript = call?.qa?.original_transcript
  const hasTranscript = typeof transcript === 'string' && !!transcript.trim()
  useEffect(() => {
    // Search owns focus when available. Pending, empty and error outcomes must also be reachable.
    if (focusRequest <= 0 || (!isPending && !isError && hasTranscript)) return
    contextRef.current?.focus({ preventScroll: true })
    contextRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [focusRequest, isPending, isError, hasTranscript])

  return <section ref={contextRef} tabIndex={-1} aria-label="Transcript context" className="pennie-focus-ring">
    {!allowed ? <p className="text-sm text-muted-foreground">Transcript unavailable outside your assigned team.</p>
      : isPending ? <p role="status" className="text-sm text-muted-foreground">Loading transcript…</p>
      : isError ? <ErrorState compact message="Couldn't load the transcript. Retry, or use the external transcript link above." onRetry={() => refetch()} />
        : hasTranscript ? <TranscriptView {...navigation} transcript={transcript} constrainHeight={false} focusRequest={focusRequest} />
          : <p className="text-sm text-muted-foreground">No transcript text is available for this call. Use the recording or external transcript link above.</p>}
  </section>
}
