import { useEffect, useRef, type ReactNode } from 'react'
import { useCallDetail } from '@/hooks/use-queries'
import { TranscriptView } from '@/components/call-detail/TranscriptView'
import { ErrorState } from '@/components/states/ErrorState'

/** Mounted only after the reviewer asks to inspect context; reuses the call-detail cache. */
export function AlertTranscript({ callId, evidence, focusRequest = 0, renderAudioLink }: { callId: string; evidence: string[]; focusRequest?: number; renderAudioLink?: (quote: string) => ReactNode }) {
  const { data: call, isPending, isError, refetch } = useCallDetail(callId)
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
    {isPending ? <p role="status" className="text-sm text-muted-foreground">Loading transcript…</p>
      : isError ? <ErrorState compact message="Couldn't load the transcript. Retry, or use the external transcript link above." onRetry={() => refetch()} />
        : hasTranscript ? <TranscriptView transcript={transcript} evidence={evidence} constrainHeight={false} focusRequest={focusRequest} renderAudioLink={renderAudioLink} />
          : <p className="text-sm text-muted-foreground">No transcript text is available for this call. Use the recording or external transcript link above.</p>}
  </section>
}
