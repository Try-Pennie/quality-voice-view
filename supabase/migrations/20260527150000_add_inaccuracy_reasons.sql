-- Widen the inaccuracy_reason CHECK to add two categories that managers were
-- previously forced to log as 'other' (the single largest false-positive bucket,
-- ~40% of FPs). Mining the free-text on those 'other' rows surfaced two recurring
-- patterns with no matching structured reason:
--   covered_not_verbatim     -- required content was covered, just not read verbatim
--   call_dropped_incomplete  -- call dropped / enrollment not finished, so no real violation
-- 'addressed_off_call' is unchanged here (its value stays the same; only its UI
-- label is updated to 'Covered on a prior call', which needs no migration).

alter table public.eavesly_alert_feedback
  drop constraint if exists eavesly_alert_feedback_inaccuracy_reason_check;

alter table public.eavesly_alert_feedback
  add constraint eavesly_alert_feedback_inaccuracy_reason_check
  check (
    inaccuracy_reason is null
    or inaccuracy_reason = any (array[
      'soft_inquiry_misclassified',
      'wrong_context',
      'evidence_misquoted',
      'policy_does_not_apply',
      'addressed_off_call',
      'covered_not_verbatim',
      'call_dropped_incomplete',
      'other'
    ]::text[])
  );
