-- Preserve alert index ordering through feedback lookup. A hash join forced
-- Outstanding to evaluate all historical decisions before returning page one.
-- OFFSET 0 is an optimization barrier, not a row limit or an access change.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

create or replace view public.eavesly_alerts_with_feedback as
select
  m.id                   as module_result_id,
  m.created_at           as alert_created_at,
  m.alert_sent_at,
  m.call_id,
  m.module_name,
  m.violation_type,
  m.has_violation,
  m.alert_sent,
  m.agent_email,
  m.contact_name,
  m.contact_phone,
  m.recording_link,
  m.transcript_url,
  m.call_summary,
  m.sfdc_lead_id,
  m.processing_time_ms,
  m.result_json,
  am.manager_email       as assigned_manager_email,
  f.id                   as feedback_id,
  f.manager_email        as feedback_by,
  f.accurate,
  f.action_taken,
  f.inaccuracy_reason,
  f.comment              as feedback_comment,
  f.reviewed_at,
  (f.id is not null)     as is_reviewed,
  coalesce(msg.message_count, 0) as message_count,
  msg.last_message_at,
  coalesce(ack.acker_emails, array[]::text[]) as acker_emails,
  case when access.can_read then f.violation_details end as violation_details,
  case when access.can_read then f.action_details end as action_details,
  case when access.can_read then f.review_revision end as review_revision,
  case when access.can_read then f.initial_manager_review end as initial_manager_review,
  case when access.can_read then decision.current_decision_id end as current_decision_id,
  case when access.can_read then decision.current_decision end as current_decision,
  case when access.can_read then decision.current_decision_by end as current_decision_by,
  case when access.can_read then decision.current_decision_instructions end as current_decision_instructions,
  case when access.can_read then decision.current_decided_at end as current_decided_at,
  case when access.can_read then decision.current_decision_source end as current_decision_source
from public.eavesly_module_results m
left join public.agent_manager_mapping am
  on am.agent_email = m.agent_email
left join lateral (
  select feedback.*
  from public.eavesly_alert_feedback feedback
  where feedback.call_id = m.call_id and feedback.module_name = m.module_name
  offset 0
) f on true
left join lateral (
  select
    count(*) filter (where deleted_at is null) as message_count,
    max(posted_at) filter (where deleted_at is null) as last_message_at
  from public.eavesly_alert_messages msgs
  where msgs.call_id = m.call_id and msgs.module_name = m.module_name
) msg on true
left join lateral (
  select array_agg(distinct acker_email) as acker_emails
  from public.eavesly_alert_acks acks
  where acks.call_id = m.call_id and acks.module_name = m.module_name
) ack on true
left join lateral (
  select private.alert_visible_to(
    lower(auth.jwt() ->> 'email'), m.call_id, m.module_name
  ) and m.module_name not in ('disposition_review', 'achieve_welcome_call_qa') as can_read
) access on true
left join lateral (
  select candidate.current_decision_id,
         candidate.current_decision,
         candidate.current_decision_by,
         candidate.current_decision_instructions,
         candidate.current_decided_at,
         candidate.current_decision_source
  from (
    select d.id as current_decision_id,
           d.decision as current_decision,
           d.reviewer_email as current_decision_by,
           d.instructions as current_decision_instructions,
           d.decided_at as current_decided_at,
           'typed'::text as current_decision_source,
           0 as priority
    from public.eavesly_alert_review_decisions d
    where d.call_id = m.call_id
      and d.module_name = m.module_name
      and d.feedback_revision = f.review_revision
    union all
    select -a.id,
           'approved'::text,
           lower(a.acker_email),
           null::text,
           a.acknowledged_at,
           'legacy_superadmin_ack'::text,
           1
    from public.eavesly_alert_acks a
    join public.manager_coaching_prompts p
      on lower(p.manager_email) = lower(a.acker_email) and p.is_god_mode
    where a.call_id = m.call_id
      and a.module_name = m.module_name
      and f.review_revision = 1
      and a.acknowledged_at >= f.updated_at
  ) candidate
  order by candidate.priority, candidate.current_decided_at, candidate.current_decision_id
  limit 1
) decision on access.can_read
where m.alert_sent = true;

COMMIT;
