-- Manager change: Jason Campbell (jcampbell@trypennie.com) took over Bobby
-- Flanagan's (bflanagan@trypennie.com) team effective Monday 2026-06-01 (ET).
--
-- Context: the live snapshot agent_manager_mapping was already switched to
-- jcampbell (so the alerts view + scope already show Jason). But the
-- effective-dated history table (agent_manager_mapping_history) still had
-- Bobby owning every agent on an OPEN interval [1900-01-01, NULL) from the
-- original backfill -- the Regal-sync history-append rewrite that would record
-- re-orgs (see 20260430190000_agent_manager_mapping_history.sql) has not landed
-- yet. So the god-mode Team rollup (which resolves managers via
-- agent_manager_mapping_at(window_end)) showed Bobby for ALL dates, including
-- current ones. This migration records the cutover by hand. Until the sync
-- rewrite lands, future re-orgs need the same manual treatment.
--
-- Effect (half-open [from_date, to_date) semantics):
--   Bobby:  [1900-01-01, 2026-06-01)  -> owns all dates before 2026-06-01
--   Jason:  [2026-06-01, NULL)        -> owns 2026-06-01 onward
--
-- Affected agents = Jason's current team (agent_manager_mapping where
-- manager_email = 'jcampbell@trypennie.com'). 24 carry a backfilled Bobby
-- interval; 2 (jsaminu@, mclark@) have no prior history row (not in the
-- mapping at the 2026-04-30 backfill) so they get only the Jason interval
-- and remain unattributed before the cutover -- we have no evidence of their
-- prior manager and do not fabricate one.
--
-- Idempotent: the UPDATE only closes still-open Bobby rows; the INSERT uses
-- ON CONFLICT DO NOTHING against the (agent_email, manager_email, from_date)
-- unique index. No materialized-view refresh is required -- mv_agent_daily_metrics
-- is per-agent and manager grouping is applied client-side via the RPC.

-- 1) Close Bobby's open intervals for the agents now on Jason's team.
UPDATE public.agent_manager_mapping_history h
SET to_date = DATE '2026-06-01'
WHERE h.manager_email = 'bflanagan@trypennie.com'
  AND h.to_date IS NULL
  AND h.agent_email IN (
    SELECT agent_email FROM public.agent_manager_mapping
    WHERE manager_email = 'jcampbell@trypennie.com'
  );

-- 2) Open Jason's interval from the cutover for every agent on his current team.
INSERT INTO public.agent_manager_mapping_history
  (agent_email, manager_email, from_date, to_date, source)
SELECT agent_email, 'jcampbell@trypennie.com', DATE '2026-06-01', NULL, 'reorg'
FROM public.agent_manager_mapping
WHERE manager_email = 'jcampbell@trypennie.com'
ON CONFLICT (agent_email, manager_email, from_date) DO NOTHING;
