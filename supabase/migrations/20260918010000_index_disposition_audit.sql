-- The audit list filters these JSON values and orders/pages by created_at.
-- The generic violations index scans all disposition violations (including old
-- calls) and sorts after joining feedback/calls, exceeding the API's 8s timeout.
-- Keep this predicate aligned with 20260820165000_add_talk_time_to_disposition_audit.sql.
-- call_id also remains an index condition for the audit drawer's point lookup,
-- even if the planner prefers this partial index over the existing call_id index.
-- No view, grants, result semantics, or global timeout changes are needed.
create index eavesly_module_results_disposition_audit_created_idx
  on public.eavesly_module_results (created_at desc, call_id)
  where module_name = 'disposition_review'
    and has_violation = true
    and alert_sent = true
    and result_json->>'conversation_happened' = 'yes'
    and result_json->>'current_disposition' = '1.5 - Not Interested > END CAMPAIGNS'
    and result_json->>'suggested_disposition' in (
      '1.2 - Interested > No Call Scheduled',
      '1.3 - Interested > Call Scheduled',
      '1.3A - First Call Completed - Interested',
      '1.3B - Turnbull Pending',
      '1.4 - Converted/Won > END CAMPAIGNS'
    );
