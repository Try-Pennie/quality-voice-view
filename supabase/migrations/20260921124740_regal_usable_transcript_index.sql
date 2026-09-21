-- On populated production, build CONCURRENTLY out-of-band before applying;
-- IF NOT EXISTS registers the completed build without write-locking ingestion.
CREATE INDEX IF NOT EXISTS eavesly_regal_usable_transcript_idx
  ON public.eavesly_regal_call_events (regal_task_id)
  WHERE event_type = 'transcript_available'
    AND jsonb_typeof(payload->'transcript') = 'string'
    AND payload->>'transcript' ~ '[^[:space:]]';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index
    WHERE indexrelid = 'public.eavesly_regal_usable_transcript_idx'::regclass AND indisvalid) THEN
    RAISE EXCEPTION 'Concurrent transcript index build must finish successfully before deployment';
  END IF;
END $$;
