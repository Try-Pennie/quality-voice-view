-- Internal review queues page in this order. The old has_violation indexes
-- do not cover sent alerts whose model result was not a violation; keep every
-- sent internal alert and retain all-time queue semantics.
--
-- Plain (non-CONCURRENT) build, matching repo convention since migrations run
-- in a transaction: ingestion writes to eavesly_module_results WAIT for the
-- build (one table scan, expected seconds). To avoid even that, run the same
-- statement by hand with CREATE INDEX CONCURRENTLY first; IF NOT EXISTS then
-- makes this migration a no-op.
create index if not exists eavesly_module_results_internal_alert_order_idx
  on public.eavesly_module_results (created_at desc, call_id, module_name)
  where alert_sent = true
    and module_name not in ('disposition_review', 'achieve_welcome_call_qa');
