-- Read-only baseline for internal manager-visible alerts.
-- Change start_at/end_at for the cohort of alerts CREATED in that window.
-- Feedback is latest persisted state, NOT review activity during the window.
-- Does not return transcripts, comments, call IDs, or reviewer identities.
-- The boundary is [start_at, end_at); business dates are America/New_York.
WITH business_date AS (
  SELECT (current_timestamp AT TIME ZONE 'America/New_York')::date AS today
), bounds AS (
  SELECT (today - 29)::timestamp AT TIME ZONE 'America/New_York' AS start_at,
         (today + 1)::timestamp AT TIME ZONE 'America/New_York' AS end_at
  FROM business_date
), alerts AS (
  SELECT m.module_name, m.created_at, f.id AS feedback_id, f.accurate,
         f.manager_email = 'system@pennie' AS system_closed,
         f.inaccuracy_reason, nullif(btrim(f.comment), '') IS NOT NULL AS has_rationale
  FROM public.eavesly_module_results m
  LEFT JOIN public.eavesly_alert_feedback f USING (call_id, module_name)
  CROSS JOIN bounds b
  WHERE m.alert_sent = true
    AND m.module_name NOT IN ('disposition_review', 'achieve_welcome_call_qa')
    AND m.created_at >= b.start_at AND m.created_at < b.end_at
)
SELECT module_name,
       count(*) AS received,
       count(*) FILTER (WHERE feedback_id IS NULL) AS awaiting_first_review,
       count(*) FILTER (WHERE system_closed) AS administrative_closures,
       count(*) FILTER (WHERE feedback_id IS NOT NULL AND NOT system_closed) AS recorded_human_reviews,
       count(*) FILTER (WHERE accurate = true AND NOT system_closed) AS marked_real,
       count(*) FILTER (WHERE accurate = false AND NOT system_closed) AS marked_false,
       round(100.0 * count(*) FILTER (WHERE accurate = false AND NOT system_closed) /
         nullif(count(*) FILTER (WHERE feedback_id IS NOT NULL AND NOT system_closed), 0), 1) AS false_pct_of_reviewed,
       count(*) FILTER (WHERE accurate = false AND NOT system_closed AND NOT has_rationale) AS false_missing_rationale
FROM alerts
GROUP BY module_name
ORDER BY marked_false DESC, module_name;
