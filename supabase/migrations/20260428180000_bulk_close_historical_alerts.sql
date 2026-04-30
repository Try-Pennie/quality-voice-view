-- Bulk-close historical Eavesly alerts for the manager launch on 2026-04-28.
-- Inserts a system-attributed feedback row for every alert that fired before
-- this migration runs and has no feedback yet, so managers start with an empty
-- inbox at launch. Alerts that fire AFTER this migration are unaffected.
--
-- To reverse:
--   DELETE FROM public.eavesly_alert_feedback
--   WHERE manager_email = 'system@pennie'
--     AND comment = 'Bulk-closed at launch (2026-04-28) — pre-launch alert.';

INSERT INTO public.eavesly_alert_feedback
  (call_id, module_name, manager_email, accurate, action_taken, inaccuracy_reason, comment, reviewed_at)
SELECT DISTINCT ON (m.call_id, m.module_name)
  m.call_id,
  m.module_name,
  'system@pennie',
  true,
  'no_action_needed',
  NULL,
  'Bulk-closed at launch (2026-04-28) — pre-launch alert.',
  now()
FROM public.eavesly_module_results m
LEFT JOIN public.eavesly_alert_feedback f
  ON f.call_id = m.call_id
 AND f.module_name = m.module_name
WHERE m.alert_sent = true
  AND f.id IS NULL
ORDER BY m.call_id, m.module_name, m.created_at DESC
ON CONFLICT (call_id, module_name) DO NOTHING;
