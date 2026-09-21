-- On populated production, build this index CONCURRENTLY out-of-band first
-- (see the refresh recovery runbook). This migration then only registers it.
-- PostgreSQL maintains the predicate when a transcript changes.
CREATE INDEX IF NOT EXISTS eavesly_qa_usable_transcript_idx
  ON public.eavesly_transcription_qa (id)
  WHERE original_transcript ~ '[^[:space:]]';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index
    WHERE indexrelid = 'public.eavesly_qa_usable_transcript_idx'::regclass AND indisvalid) THEN
    RAISE EXCEPTION 'Concurrent transcript index build must finish successfully before deployment';
  END IF;
END $$;
