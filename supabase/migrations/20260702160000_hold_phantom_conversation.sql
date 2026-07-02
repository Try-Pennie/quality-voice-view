-- HOLD the "phantom_conversation" audit category until the CRM gains a
-- human-applicable no-contact/voicemail disposition. The correct label for these
-- calls (Pre-recorded Voicemail / No Answer) is AI/dialer-only, so there's no
-- valid human target to suggest yet — surfacing them isn't actionable. The raw
-- flags remain in eavesly_module_results; this only narrows the audit surface.
-- Re-enable by restoring the phantom_conversation OR-branch in the WHERE clause.
CREATE OR REPLACE VIEW public.eavesly_disposition_audit AS
SELECT
  a.*,
  a.result_json->>'current_disposition'    AS current_disposition,
  a.result_json->>'suggested_disposition'  AS suggested_disposition,
  a.result_json->>'conversation_happened'  AS model_conversation_happened,
  (a.result_json->>'confidence')::numeric  AS model_confidence,
  CASE
    WHEN a.result_json->>'conversation_happened' = 'yes'
     AND a.result_json->>'current_disposition' = '1.5 - Not Interested > END CAMPAIGNS'
     AND a.result_json->>'suggested_disposition' IN (
       '1.2 - Interested > No Call Scheduled',
       '1.3 - Interested > Call Scheduled',
       '1.3A - First Call Completed - Interested',
       '1.3B - Turnbull Pending',
       '1.4 - Converted/Won > END CAMPAIGNS'
     )
      THEN 'ended_live_lead'
    -- phantom_conversation branch retained for easy re-enable; the WHERE below
    -- excludes it for now.
    WHEN a.result_json->>'conversation_happened' = 'no'
     AND EXISTS (
       SELECT 1 FROM public.eavesly_dispositions d
       WHERE d.name = a.result_json->>'current_disposition'
         AND d.conversation_happened = 'yes'
         AND d.ai_only = false
         AND d.active = true
     )
      THEN 'phantom_conversation'
  END AS audit_category
FROM public.eavesly_alerts_with_feedback a
WHERE a.module_name = 'disposition_review'
  AND a.has_violation = true
  -- Only "Ended a live lead" is surfaced. phantom_conversation is held (see header).
  AND a.result_json->>'conversation_happened' = 'yes'
  AND a.result_json->>'current_disposition' = '1.5 - Not Interested > END CAMPAIGNS'
  AND a.result_json->>'suggested_disposition' IN (
    '1.2 - Interested > No Call Scheduled',
    '1.3 - Interested > Call Scheduled',
    '1.3A - First Call Completed - Interested',
    '1.3B - Turnbull Pending',
    '1.4 - Converted/Won > END CAMPAIGNS'
  );

GRANT SELECT ON public.eavesly_disposition_audit TO authenticated;
