import { supabase } from '@/integrations/supabase/client'

type RecordingUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; error: 'invalid_recording' | 'recording_unavailable' }

/** Private copies are signed on open; existing HTTPS recordings are unchanged. */
export async function resolveRecordingUrl(reference: unknown): Promise<RecordingUrlResult> {
  if (reference == null || reference === '') return { ok: true, url: null }
  if (typeof reference !== 'string') return { ok: false, error: 'invalid_recording' }
  if (!reference.startsWith('storage://')) return { ok: true, url: reference }

  const match = /^storage:\/\/review-sample-recordings\/([a-f0-9]{32}\.mp3)$/.exec(reference)
  if (!match) return { ok: false, error: 'invalid_recording' }
  try {
    // Storage RLS authorizes the current session. Never use a privileged key here.
    const { data, error } = await supabase.storage.from('review-sample-recordings')
      // The sample includes recordings over two hours; allow one listening session.
      .createSignedUrl(match[1], 10800)
    if (error || typeof data?.signedUrl !== 'string') {
      return { ok: false, error: 'recording_unavailable' }
    }
    return { ok: true, url: data.signedUrl }
  } catch {
    // The SDK may reject on a network failure; never expose URLs/tokens in errors.
    return { ok: false, error: 'recording_unavailable' }
  }
}
