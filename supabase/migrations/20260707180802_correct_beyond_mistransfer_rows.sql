-- One-off data correction: three Achieve calls that were mis-transferred to the
-- competitor Beyond Finance were graded + flagged as violations before the
-- competitor-exclusion fix (eavesly #42) shipped. Reset them to the withheld
-- `competitor_transfer` skip the fixed pipeline now produces (deterministic,
-- no-LLM path — values verified by replaying the real transcripts through the
-- deployed segmenter). Original rows are preserved in
-- eavesly_module_results_achieve_beyond_backup_20260707 (see rollback below).
--
-- Idempotent: re-running sets the same values. Scoped to these 3 call_ids only.

update eavesly_module_results set
  has_violation  = false,
  violation_type = null,
  alert_sent     = false,
  alert_sent_at  = null,
  result_json = case call_id
    when 'WTd1273b4e20311fc00b0c6e666c06cb4f' then '{"partner_id":"achieve","script_version":"fdr_wholesale_db_pilot_v1","grading_skipped":true,"skip_reason":"competitor_transfer","transcript_segment":{"segment_type":"fdr_disclosure_and_welcome_call","start_line":401,"marker":"beyond_finance_transfer","segmentation_confidence":"high","segmentation_score":0.95,"used_full_transcript_fallback":false,"segment_found":false,"skip_reason":"competitor_transfer","transfer_agent_lines":36}}'::jsonb
    when 'WTc3764c2896f1c367f9e00078afdd9aed' then '{"partner_id":"achieve","script_version":"fdr_wholesale_db_pilot_v1","grading_skipped":true,"skip_reason":"competitor_transfer","transcript_segment":{"segment_type":"fdr_disclosure_and_welcome_call","start_line":458,"marker":"beyond_finance_transfer","segmentation_confidence":"high","segmentation_score":0.95,"used_full_transcript_fallback":false,"segment_found":false,"skip_reason":"competitor_transfer","transfer_agent_lines":118}}'::jsonb
    when 'WTd7705f069a007c7571caf055eb734566' then '{"partner_id":"achieve","script_version":"fdr_wholesale_db_pilot_v1","grading_skipped":true,"skip_reason":"competitor_transfer","transcript_segment":{"segment_type":"fdr_disclosure_and_welcome_call","start_line":549,"marker":"beyond_finance_transfer","segmentation_confidence":"high","segmentation_score":0.95,"used_full_transcript_fallback":false,"segment_found":false,"skip_reason":"competitor_transfer","transfer_agent_lines":72}}'::jsonb
  end
where module_name = 'achieve_welcome_call_qa'
  and call_id in ('WTd1273b4e20311fc00b0c6e666c06cb4f',
                  'WTc3764c2896f1c367f9e00078afdd9aed',
                  'WTd7705f069a007c7571caf055eb734566');

-- Rollback (run manually if ever needed):
--   update eavesly_module_results m set
--     has_violation=b.has_violation, violation_type=b.violation_type,
--     alert_sent=b.alert_sent, alert_sent_at=b.alert_sent_at, result_json=b.result_json
--   from eavesly_module_results_achieve_beyond_backup_20260707 b
--   where m.call_id=b.call_id and m.module_name='achieve_welcome_call_qa';
