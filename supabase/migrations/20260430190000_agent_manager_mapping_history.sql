-- Effective-dated agent → manager mapping (issue #15).
--
-- Replaces the implicit "current snapshot" reading of agent_manager_mapping
-- for historical aggregations. The current table stays as the live snapshot
-- (Regal sync continues to update it weekly); the new history table records
-- every (agent, manager) interval so god-mode reports can resolve "who was
-- on Bobby's team in February" instead of "who is on Bobby's team today".
--
-- This migration ships the **read path** only — table, backfill, RPC. The
-- Regal sync rewrite (so future mapping changes append history rows instead
-- of overwriting) is a separate change that lives in the sync repo, not here.
-- Until that lands, history is frozen at backfill — call ranges that span
-- a future re-org will under-attribute.

-- 1) History table. Half-open interval [from_date, to_date) — to_date NULL
--    means "still active". Sentinel manager_email values from the current
--    table ("No longer at Pennie", "Excluded", "AI Agent") are preserved
--    so god-mode reports can show those agents under their housekeeping
--    bucket as of any date.
CREATE TABLE IF NOT EXISTS public.agent_manager_mapping_history (
  id              BIGSERIAL PRIMARY KEY,
  agent_email     TEXT NOT NULL,
  manager_email   TEXT NOT NULL,
  from_date       DATE NOT NULL,
  to_date         DATE,
  source          TEXT NOT NULL DEFAULT 'backfill',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_manager_mapping_history_interval_chk
    CHECK (to_date IS NULL OR to_date > from_date)
);

CREATE INDEX IF NOT EXISTS agent_manager_mapping_history_agent_idx
  ON public.agent_manager_mapping_history (agent_email, from_date DESC);

CREATE INDEX IF NOT EXISTS agent_manager_mapping_history_manager_idx
  ON public.agent_manager_mapping_history (manager_email, from_date DESC);

-- Prevent overlapping rows for the same (agent, manager) — keeps backfill
-- idempotent and protects against duplicate sync writes when the Regal
-- rewrite eventually lands.
CREATE UNIQUE INDEX IF NOT EXISTS agent_manager_mapping_history_unique_open
  ON public.agent_manager_mapping_history (agent_email, manager_email, from_date);

ALTER TABLE public.agent_manager_mapping_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read mapping history" ON public.agent_manager_mapping_history;
-- Read access is intentionally permissive: the mapping is metadata, not
-- per-agent scope. Actual data RLS still gates the underlying alerts /
-- calls / metrics RPCs.
CREATE POLICY "Read mapping history"
  ON public.agent_manager_mapping_history
  FOR SELECT
  TO authenticated
  USING (true);

-- 2) Backfill. Every existing row is treated as if it has been true forever
--    (from_date = 1900-01-01). This is intentionally lossy — we don't know
--    when each pairing started, so we accept some historical fuzz per the
--    issue's note: "For prior mappings we don't know — accept some
--    historical fuzz." Spot-check (Bobby Feb count) should still improve
--    materially because the dominant signal is "agent left the company"
--    (now in 'No longer at Pennie' sentinel) — we recover those by keeping
--    sentinels in the history.
INSERT INTO public.agent_manager_mapping_history
  (agent_email, manager_email, from_date, to_date, source)
SELECT
  am.agent_email,
  am.manager_email,
  DATE '1900-01-01',
  NULL,
  'backfill'
FROM public.agent_manager_mapping am
ON CONFLICT (agent_email, manager_email, from_date) DO NOTHING;

-- 3) As-of lookup. Returns the mapping snapshot active on a given date.
--    Multiple managers per agent are possible if the source data ever
--    contained dupes; we surface every active row and let the client pick
--    a strategy (today: aggregateManagerRollups uses the first one it sees
--    via Map<agent_email, manager_email>).
CREATE OR REPLACE FUNCTION public.agent_manager_mapping_at(p_as_of date)
RETURNS TABLE(manager_email text, agent_email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT h.manager_email, h.agent_email
  FROM public.agent_manager_mapping_history h
  WHERE h.from_date <= p_as_of
    AND (h.to_date IS NULL OR h.to_date > p_as_of);
$$;

GRANT EXECUTE ON FUNCTION public.agent_manager_mapping_at(date) TO authenticated;
GRANT SELECT ON public.agent_manager_mapping_history TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.agent_manager_mapping_history_id_seq TO authenticated;
