-- Keep recent QA visibility and Calls/QA statistics fresh using the existing
-- daemon. At current sizes: ~6k QA inserts / ~5k QA changes / ~8.5k Calls
-- changes, rather than ~100k / ~50k / ~85k. Eligibility is not a schedule.
-- Inherit base thresholds, cost throttling and dead-row/freeze settings.
set local lock_timeout = '2s';

alter table public.eavesly_transcription_qa set (
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01
);

alter table public.eavesly_calls set (
  autovacuum_analyze_scale_factor = 0.01
);
