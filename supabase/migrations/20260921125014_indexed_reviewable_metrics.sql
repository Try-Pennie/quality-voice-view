-- Usable transcript IDs come from maintained partial indexes, not repeated
-- reads/decompression of historical transcript text. Build beside the serving
-- snapshot, then swap atomically; a failed build leaves existing metrics intact.
BEGIN;
SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '3s';
SET LOCAL work_mem = '32MB';

CREATE MATERIALIZED VIEW private.mv_agent_daily_metrics_indexed AS
WITH managers AS (
  SELECT DISTINCT lower(manager_email) AS email FROM public.agent_manager_mapping
  UNION
  SELECT DISTINCT lower(manager_email) FROM public.manager_coaching_prompts
),
latest_qa AS MATERIALIZED (
  SELECT DISTINCT ON (call_id) call_id, id, compliance_rating,
    manager_escalation, customer_satisfaction_likely
  FROM public.eavesly_transcription_qa
  WHERE call_id IS NOT NULL
  ORDER BY call_id, created_at DESC NULLS LAST, id DESC
),
-- Keep these predicates identical to the partial indexes. Selecting only their
-- keys permits index-only scans: no transcript values enter the refresh plan.
qa_transcripts AS MATERIALIZED (
  SELECT id FROM public.eavesly_transcription_qa
  WHERE original_transcript ~ '[^[:space:]]'
),
regal_transcripts AS MATERIALIZED (
  SELECT regal_task_id FROM public.eavesly_regal_call_events
  WHERE event_type = 'transcript_available'
    AND jsonb_typeof(payload->'transcript') = 'string'
    AND payload->>'transcript' ~ '[^[:space:]]'
),
call_population AS MATERIALIZED (
  SELECT
    c.agent_email, c.started_at, c.talk_time,
    qa.call_id AS qa_call_id, qa.compliance_rating,
    qa.manager_escalation, qa.customer_satisfaction_likely,
    c.conversation_happened IS TRUE AND (
      qt.id IS NOT NULL OR e.regal_task_id IS NOT NULL
    ) AS reviewable
  FROM public.eavesly_calls c
  LEFT JOIN latest_qa qa ON qa.call_id = c.call_id
  LEFT JOIN qa_transcripts qt ON qt.id = qa.id
  LEFT JOIN regal_transcripts e ON e.regal_task_id = c.call_id
  WHERE c.agent_email IS NOT NULL
    AND c.started_at IS NOT NULL
    AND lower(c.agent_email) NOT IN (SELECT email FROM managers)
    AND EXTRACT(DOW FROM (c.started_at AT TIME ZONE 'America/New_York')) <> 0
),
call_day AS (
  SELECT
    agent_email,
    (started_at AT TIME ZONE 'America/New_York')::date AS bucket_day,
    COUNT(*) AS call_count,
    COUNT(*) FILTER (WHERE reviewable) AS reviewable_call_count,
    COALESCE(SUM(talk_time) FILTER (WHERE reviewable), 0) AS talk_time_sum,
    COUNT(*) FILTER (WHERE reviewable AND talk_time IS NOT NULL) AS talk_time_n,
    COUNT(qa_call_id) FILTER (WHERE reviewable) AS qa_count,
    COUNT(*) FILTER (WHERE reviewable AND compliance_rating = 'pass') AS compliance_pass_count,
    COUNT(*) FILTER (WHERE reviewable AND compliance_rating IN ('pass','fail')) AS compliance_total_count,
    COUNT(*) FILTER (WHERE reviewable AND manager_escalation = true) AS escalation_count,
    COUNT(*) FILTER (WHERE reviewable AND customer_satisfaction_likely = 'high') AS csat_high_count,
    COUNT(*) FILTER (WHERE reviewable AND customer_satisfaction_likely = 'medium') AS csat_medium_count,
    COUNT(*) FILTER (WHERE reviewable AND customer_satisfaction_likely = 'low') AS csat_low_count
  FROM call_population
  GROUP BY agent_email, (started_at AT TIME ZONE 'America/New_York')::date
),
alert_day AS (
  SELECT
    m.agent_email,
    (m.created_at AT TIME ZONE 'America/New_York')::date AS bucket_day,
    COUNT(*) AS total_alerts_count,
    COUNT(*) FILTER (WHERE m.has_violation = true) AS open_alerts,
    COUNT(*) FILTER (WHERE m.has_violation = true AND f.id IS NULL) AS unreviewed_alerts,
    COUNT(*) FILTER (WHERE m.has_violation = true AND f.accurate IS FALSE) AS false_positive_count
  FROM public.eavesly_module_results m
  LEFT JOIN public.eavesly_alert_feedback f
    ON f.call_id = m.call_id AND f.module_name = m.module_name
  WHERE m.alert_sent = true
    AND m.module_name <> 'disposition_review'
    AND m.agent_email IS NOT NULL
    AND m.created_at IS NOT NULL
    AND lower(m.agent_email) NOT IN (SELECT email FROM managers)
    AND EXTRACT(DOW FROM (m.created_at AT TIME ZONE 'America/New_York')) <> 0
  GROUP BY m.agent_email, (m.created_at AT TIME ZONE 'America/New_York')::date
),
agent_name AS (
  SELECT DISTINCT ON (agent_email) agent_email, agent_full_name
  FROM public.eavesly_calls
  WHERE agent_email IS NOT NULL AND agent_full_name IS NOT NULL
    AND lower(agent_email) NOT IN (SELECT email FROM managers)
  ORDER BY agent_email, started_at DESC NULLS LAST
)
SELECT
  COALESCE(c.agent_email, a.agent_email) AS agent_email,
  COALESCE(c.bucket_day, a.bucket_day) AS bucket_day,
  n.agent_full_name,
  COALESCE(c.call_count, 0) AS call_count,
  COALESCE(c.reviewable_call_count, 0) AS reviewable_call_count,
  COALESCE(c.talk_time_sum, 0) AS talk_time_sum,
  COALESCE(c.talk_time_n, 0) AS talk_time_n,
  COALESCE(c.qa_count, 0) AS qa_count,
  COALESCE(c.compliance_pass_count, 0) AS compliance_pass_count,
  COALESCE(c.compliance_total_count, 0) AS compliance_total_count,
  COALESCE(c.escalation_count, 0) AS escalation_count,
  COALESCE(c.csat_high_count, 0) AS csat_high_count,
  COALESCE(c.csat_medium_count, 0) AS csat_medium_count,
  COALESCE(c.csat_low_count, 0) AS csat_low_count,
  COALESCE(a.total_alerts_count, 0) AS total_alerts_count,
  COALESCE(a.open_alerts, 0) AS open_alerts,
  COALESCE(a.unreviewed_alerts, 0) AS unreviewed_alerts,
  COALESCE(a.false_positive_count, 0) AS false_positive_count
FROM call_day c
FULL OUTER JOIN alert_day a USING (agent_email, bucket_day)
LEFT JOIN agent_name n ON n.agent_email = COALESCE(c.agent_email, a.agent_email);

CREATE UNIQUE INDEX mv_agent_daily_metrics_indexed_pk
  ON private.mv_agent_daily_metrics_indexed (agent_email, bucket_day);
CREATE INDEX mv_agent_daily_metrics_indexed_day_idx
  ON private.mv_agent_daily_metrics_indexed (bucket_day);

-- RPC signatures, scope checks and grants are unchanged. PostgreSQL invalidates
-- their cached relation plans when the old snapshot is dropped.
DROP MATERIALIZED VIEW private.mv_agent_daily_metrics;
ALTER MATERIALIZED VIEW private.mv_agent_daily_metrics_indexed RENAME TO mv_agent_daily_metrics;
ALTER INDEX private.mv_agent_daily_metrics_indexed_pk RENAME TO mv_agent_daily_metrics_pk;
ALTER INDEX private.mv_agent_daily_metrics_indexed_day_idx RENAME TO mv_agent_daily_metrics_day_idx;
COMMIT;
