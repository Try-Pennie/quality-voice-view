import { useCallDetail } from '@/hooks/use-queries'
import { TranscriptView } from '@/components/call-detail/TranscriptView'
import { ErrorState } from '@/components/states/ErrorState'

/** Mounted only after the reviewer asks to inspect context; reuses the call-detail cache. */
export function AlertTranscript({ callId, evidence }: { callId: string; evidence: string[] }) {
  const { data: call, isPending, isError, refetch } = useCallDetail(callId)
  if (isPending) return <p role="status" className="text-sm text-muted-foreground">Loading transcript…</p>
  if (isError) return <ErrorState compact message="Couldn't load the transcript. Retry, or use the external transcript link above." onRetry={() => refetch()} />
  const transcript = call?.qa?.original_transcript
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return <p className="text-sm text-muted-foreground">No transcript text is available for this call. Use the recording or external transcript link above.</p>
  }
  return <TranscriptView transcript={transcript} evidence={evidence} constrainHeight={false} />
}
