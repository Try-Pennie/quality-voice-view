-- Durable, structured manager review and shared super-admin approval for
-- Pennie-internal Eavesly alerts. Partner/disposition feedback keeps its
-- existing direct-writer behavior.

alter table public.eavesly_alert_feedback
  add column violation_details text,
  add column action_details text,
  add column review_revision integer not null default 1,
  add column initial_manager_review jsonb;

alter table public.eavesly_alert_feedback
  add constraint eavesly_alert_feedback_review_revision_positive
    check (review_revision > 0),
  add constraint eavesly_alert_feedback_structured_complete
    check (
      module_name in ('disposition_review', 'achieve_welcome_call_qa')
      or (
        accurate
        and action_taken is not null
        and inaccuracy_reason is null
        and comment is null
        and violation_details is not null
        and action_details is not null
        and char_length(btrim(violation_details)) between 12 and 4000
        and char_length(btrim(action_details)) between 12 and 4000
        and lower(btrim(violation_details)) <> lower(btrim(action_details))
      )
      or (
        not accurate
        and action_taken is null
        and inaccuracy_reason is not null
        and violation_details is null
        and action_details is null
        and comment is not null
        and char_length(btrim(comment)) between 12 and 4000
      )
    ) not valid;

create table public.eavesly_alert_review_decisions (
  id                 bigserial primary key,
  call_id            text not null,
  module_name        text not null,
  feedback_revision  integer not null check (feedback_revision > 0),
  reviewer_email     text not null,
  decision           text not null check (decision in ('approved', 'changes_requested')),
  instructions       text,
  source_message_id  bigint references public.eavesly_alert_messages(id),
  decided_at         timestamptz not null default now(),
  constraint eavesly_alert_review_decisions_feedback_fk
    foreign key (call_id, module_name)
    references public.eavesly_alert_feedback(call_id, module_name),
  constraint eavesly_alert_review_decisions_revision_unique
    unique (call_id, module_name, feedback_revision),
  constraint eavesly_alert_review_decisions_message_unique
    unique (source_message_id),
  constraint eavesly_alert_review_decisions_shape check (
    (decision = 'approved' and instructions is null and source_message_id is null)
    or
    (decision = 'changes_requested'
      and instructions is not null
      and char_length(btrim(instructions)) between 12 and 4000
      and source_message_id is not null)
  )
);

create index eavesly_alert_review_decisions_reviewer_idx
  on public.eavesly_alert_review_decisions (reviewer_email, decided_at desc);

alter table public.eavesly_alert_review_decisions enable row level security;

create policy "Read decisions on visible internal alerts"
  on public.eavesly_alert_review_decisions
  for select
  to authenticated
  using (
    module_name not in ('disposition_review', 'achieve_welcome_call_qa')
    and private.alert_visible_to(lower(auth.jwt() ->> 'email'), call_id, module_name)
  );

revoke all on table public.eavesly_alert_review_decisions from anon, public;
revoke all on sequence public.eavesly_alert_review_decisions_id_seq from anon, public;
grant select on table public.eavesly_alert_review_decisions to authenticated;

-- Existing browser writers remain available only for the two excluded modules.
drop policy if exists "Manager inserts own feedback" on public.eavesly_alert_feedback;
drop policy if exists "Manager updates own feedback" on public.eavesly_alert_feedback;

create policy "Excluded module writers insert own feedback"
  on public.eavesly_alert_feedback
  for insert
  to authenticated
  with check (
    module_name in ('disposition_review', 'achieve_welcome_call_qa')
    and lower(manager_email) = lower(auth.jwt() ->> 'email')
  );

create policy "Excluded module writers update own feedback"
  on public.eavesly_alert_feedback
  for update
  to authenticated
  using (
    module_name in ('disposition_review', 'achieve_welcome_call_qa')
    and lower(manager_email) = lower(auth.jwt() ->> 'email')
  )
  with check (
    module_name in ('disposition_review', 'achieve_welcome_call_qa')
    and lower(manager_email) = lower(auth.jwt() ->> 'email')
  );

create or replace function private.internal_alert_actor_email()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt_email text := lower(btrim(auth.jwt() ->> 'email'));
  v_email text;
begin
  if v_uid is null or v_jwt_email is null or v_jwt_email = '' then
    raise exception using errcode = 'P0001', message = 'EAVESLY_UNAUTHENTICATED';
  end if;

  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_uid
    and lower(btrim(u.email)) = v_jwt_email
    and lower(split_part(u.email, '@', 2)) = 'trypennie.com';

  if v_email is null then
    raise exception using errcode = 'P0001', message = 'EAVESLY_UNAUTHENTICATED';
  end if;

  return v_email;
end;
$$;

revoke all on function private.internal_alert_actor_email() from public, anon, authenticated;

create or replace function private.eavesly_initial_review_snapshot(p_row public.eavesly_alert_feedback)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'manager_email', lower(p_row.manager_email),
    'accurate', p_row.accurate,
    'action_taken', p_row.action_taken,
    'inaccuracy_reason', p_row.inaccuracy_reason,
    'comment', p_row.comment,
    'violation_details', p_row.violation_details,
    'action_details', p_row.action_details,
    'reviewed_at', p_row.reviewed_at
  );
$$;

revoke all on function private.eavesly_initial_review_snapshot(public.eavesly_alert_feedback)
  from public, anon, authenticated;

create or replace function private.guard_internal_alert_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
begin
  if new.module_name in ('disposition_review', 'achieve_welcome_call_qa') then
    return new;
  end if;

  v_actor := private.internal_alert_actor_email();
  new.manager_email := v_actor;
  new.reviewed_at := now();

  if tg_op = 'INSERT' then
    new.review_revision := 1;
    new.initial_manager_review := private.eavesly_initial_review_snapshot(new);
  else
    if new.call_id is distinct from old.call_id
      or new.module_name is distinct from old.module_name then
      raise exception using errcode = 'P0001', message = 'EAVESLY_FEEDBACK_IDENTITY_IMMUTABLE';
    end if;
    new.review_revision := old.review_revision + 1;
    new.initial_manager_review := coalesce(
      old.initial_manager_review,
      private.eavesly_initial_review_snapshot(old)
    );
  end if;

  return new;
end;
$$;

revoke all on function private.guard_internal_alert_feedback() from public, anon, authenticated;

drop trigger if exists eavesly_alert_feedback_guard_internal on public.eavesly_alert_feedback;
create trigger eavesly_alert_feedback_guard_internal
  before insert or update on public.eavesly_alert_feedback
  for each row execute function private.guard_internal_alert_feedback();

create or replace function private.reject_alert_review_decision_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'EAVESLY_DECISION_IMMUTABLE';
end;
$$;

revoke all on function private.reject_alert_review_decision_mutation() from public, anon, authenticated;

create trigger eavesly_alert_review_decisions_append_only
  before update or delete on public.eavesly_alert_review_decisions
  for each row execute function private.reject_alert_review_decision_mutation();

create or replace function public.submit_internal_alert_feedback(
  p_call_id text,
  p_module_name text,
  p_expected_revision integer,
  p_expected_decision_id bigint,
  p_verdict boolean,
  p_action text,
  p_reason text,
  p_violation_details text,
  p_action_details text,
  p_false_alarm_details text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.internal_alert_actor_email();
  v_agent text;
  v_is_god boolean;
  v_feedback public.eavesly_alert_feedback%rowtype;
  v_has_feedback boolean := false;
  v_current_decision_id bigint;
  v_previous_decision_id bigint;
  v_violation text := nullif(btrim(p_violation_details), '');
  v_action_details text := nullif(btrim(p_action_details), '');
  v_false_details text := nullif(btrim(p_false_alarm_details), '');
  v_action text := nullif(btrim(p_action), '');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_module_name in ('disposition_review', 'achieve_welcome_call_qa') then
    raise exception using errcode = 'P0001', message = 'EAVESLY_MODULE_EXCLUDED';
  end if;

  if p_expected_revision is null or p_expected_revision < 0
    or p_verdict is null
    or (p_verdict and (
      v_action is null
      or v_action not in ('coached', 'escalated', 'follow_up_later', 'no_action_needed')
      or v_reason is not null
      or v_false_details is not null
      or v_violation is null
      or v_action_details is null
      or char_length(v_violation) not between 12 and 4000
      or char_length(v_action_details) not between 12 and 4000
      or lower(v_violation) = lower(v_action_details)
    ))
    or (not p_verdict and (
      v_action is not null
      or v_reason is null
      or v_reason not in (
        'soft_inquiry_misclassified', 'wrong_context', 'evidence_misquoted',
        'policy_does_not_apply', 'addressed_off_call', 'covered_not_verbatim',
        'call_dropped_incomplete', 'other'
      )
      or v_violation is not null
      or v_action_details is not null
      or v_false_details is null
      or char_length(v_false_details) not between 12 and 4000
    )) then
    raise exception using errcode = 'P0001', message = 'EAVESLY_INVALID_FEEDBACK';
  end if;

  select m.agent_email into v_agent
  from public.eavesly_module_results m
  where m.call_id = p_call_id and m.module_name = p_module_name
  order by m.id
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EAVESLY_ALERT_NOT_FOUND';
  end if;

  select exists (
    select 1 from public.manager_coaching_prompts p
    where lower(p.manager_email) = v_actor and p.is_god_mode
  ) into v_is_god;

  if not v_is_god and not exists (
    select 1 from public.agent_manager_mapping am
    where lower(am.agent_email) = lower(v_agent)
      and lower(am.manager_email) = v_actor
  ) then
    raise exception using errcode = 'P0001', message = 'EAVESLY_FORBIDDEN';
  end if;

  select f.* into v_feedback
  from public.eavesly_alert_feedback f
  where f.call_id = p_call_id and f.module_name = p_module_name
  for update;
  v_has_feedback := found;

  if not v_has_feedback then
    if p_expected_revision <> 0 or p_expected_decision_id is not null then
      raise exception using errcode = 'P0001', message = 'EAVESLY_STALE_REVIEW';
    end if;

    insert into public.eavesly_alert_feedback (
      call_id, module_name, manager_email, accurate, action_taken,
      inaccuracy_reason, comment, violation_details, action_details
    ) values (
      p_call_id, p_module_name, v_actor, p_verdict,
      case when p_verdict then v_action end,
      case when not p_verdict then v_reason end,
      case when not p_verdict then v_false_details end,
      case when p_verdict then v_violation end,
      case when p_verdict then v_action_details end
    ) returning * into v_feedback;

    return jsonb_build_object(
      'feedback_id', v_feedback.id,
      'review_revision', v_feedback.review_revision,
      'reviewed_at', v_feedback.reviewed_at,
      'idempotent', false
    );
  end if;

  select d.id into v_current_decision_id
  from public.eavesly_alert_review_decisions d
  where d.call_id = p_call_id
    and d.module_name = p_module_name
    and d.feedback_revision = v_feedback.review_revision;

  if v_current_decision_id is null and v_feedback.review_revision = 1 then
    select -a.id into v_current_decision_id
    from public.eavesly_alert_acks a
    join public.manager_coaching_prompts p
      on lower(p.manager_email) = lower(a.acker_email) and p.is_god_mode
    where a.call_id = p_call_id and a.module_name = p_module_name
    order by a.acknowledged_at, a.id
    limit 1;
  end if;

  -- A lost response can be replayed with its original optimistic-lock values.
  if v_feedback.review_revision = p_expected_revision + 1
    and lower(v_feedback.manager_email) = v_actor
    and v_current_decision_id is null
    and v_feedback.accurate = p_verdict
    and v_feedback.action_taken is not distinct from (case when p_verdict then v_action end)
    and v_feedback.inaccuracy_reason is not distinct from (case when not p_verdict then v_reason end)
    and v_feedback.comment is not distinct from (case when not p_verdict then v_false_details end)
    and v_feedback.violation_details is not distinct from (case when p_verdict then v_violation end)
    and v_feedback.action_details is not distinct from (case when p_verdict then v_action_details end) then

    if p_expected_revision = 0 then
      v_previous_decision_id := null;
    else
      select d.id into v_previous_decision_id
      from public.eavesly_alert_review_decisions d
      where d.call_id = p_call_id
        and d.module_name = p_module_name
        and d.feedback_revision = p_expected_revision;

      if v_previous_decision_id is null and p_expected_revision = 1 then
        select -a.id into v_previous_decision_id
        from public.eavesly_alert_acks a
        join public.manager_coaching_prompts p
          on lower(p.manager_email) = lower(a.acker_email) and p.is_god_mode
        where a.call_id = p_call_id and a.module_name = p_module_name
        order by a.acknowledged_at, a.id
        limit 1;
      end if;
    end if;

    if v_previous_decision_id is not distinct from p_expected_decision_id then
      return jsonb_build_object(
        'feedback_id', v_feedback.id,
        'review_revision', v_feedback.review_revision,
        'reviewed_at', v_feedback.reviewed_at,
        'idempotent', true
      );
    end if;
  end if;

  if v_feedback.review_revision <> p_expected_revision
    or v_current_decision_id is distinct from p_expected_decision_id then
    raise exception using errcode = 'P0001', message = 'EAVESLY_STALE_REVIEW';
  end if;

  update public.eavesly_alert_feedback f
  set accurate = p_verdict,
      action_taken = case when p_verdict then v_action end,
      inaccuracy_reason = case when not p_verdict then v_reason end,
      comment = case when not p_verdict then v_false_details end,
      violation_details = case when p_verdict then v_violation end,
      action_details = case when p_verdict then v_action_details end
  where f.id = v_feedback.id
  returning * into v_feedback;

  if p_expected_decision_id is not null then
    insert into public.eavesly_alert_messages (
      call_id, module_name, author_email, body, requires_acknowledgment
    ) values (
      p_call_id,
      p_module_name,
      v_actor,
      'Submitted revision ' || v_feedback.review_revision || ' for re-approval.',
      false
    );
  end if;

  return jsonb_build_object(
    'feedback_id', v_feedback.id,
    'review_revision', v_feedback.review_revision,
    'reviewed_at', v_feedback.reviewed_at,
    'idempotent', false
  );
end;
$$;

create or replace function public.decide_internal_alert_feedback(
  p_call_id text,
  p_module_name text,
  p_expected_revision integer,
  p_decision text,
  p_instructions text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := private.internal_alert_actor_email();
  v_feedback public.eavesly_alert_feedback%rowtype;
  v_existing public.eavesly_alert_review_decisions%rowtype;
  v_decision public.eavesly_alert_review_decisions%rowtype;
  v_instructions text := nullif(btrim(p_instructions), '');
  v_message_id bigint;
begin
  if p_module_name in ('disposition_review', 'achieve_welcome_call_qa') then
    raise exception using errcode = 'P0001', message = 'EAVESLY_MODULE_EXCLUDED';
  end if;

  if p_expected_revision is null or p_expected_revision < 1
    or p_decision is null
    or p_decision not in ('approved', 'changes_requested')
    or (p_decision = 'approved' and v_instructions is not null)
    or (p_decision = 'changes_requested'
      and (v_instructions is null
        or char_length(v_instructions) not between 12 and 4000)) then
    raise exception using errcode = 'P0001', message = 'EAVESLY_INVALID_DECISION';
  end if;

  perform 1
  from public.eavesly_module_results m
  where m.call_id = p_call_id and m.module_name = p_module_name
  order by m.id
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EAVESLY_ALERT_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.manager_coaching_prompts p
    where lower(p.manager_email) = v_actor and p.is_god_mode
  ) then
    raise exception using errcode = 'P0001', message = 'EAVESLY_FORBIDDEN';
  end if;

  select f.* into v_feedback
  from public.eavesly_alert_feedback f
  where f.call_id = p_call_id and f.module_name = p_module_name
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EAVESLY_REVIEW_NOT_FOUND';
  end if;

  if v_feedback.review_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'EAVESLY_STALE_REVIEW';
  end if;

  select d.* into v_existing
  from public.eavesly_alert_review_decisions d
  where d.call_id = p_call_id
    and d.module_name = p_module_name
    and d.feedback_revision = p_expected_revision;

  if found then
    if v_existing.decision = p_decision
      and v_existing.instructions is not distinct from v_instructions then
      return jsonb_build_object(
        'decision_id', v_existing.id,
        'feedback_revision', v_existing.feedback_revision,
        'decision', v_existing.decision,
        'decided_at', v_existing.decided_at,
        'idempotent', true
      );
    end if;
    raise exception using errcode = 'P0001', message = 'EAVESLY_DECISION_CONFLICT';
  end if;

  if p_decision = 'changes_requested' then
    insert into public.eavesly_alert_messages (
      call_id, module_name, author_email, body, requires_acknowledgment
    ) values (
      p_call_id, p_module_name, v_actor, v_instructions, true
    ) returning id into v_message_id;
  end if;

  insert into public.eavesly_alert_review_decisions (
    call_id, module_name, feedback_revision, reviewer_email,
    decision, instructions, source_message_id
  ) values (
    p_call_id, p_module_name, p_expected_revision, v_actor,
    p_decision, v_instructions, v_message_id
  ) returning * into v_decision;

  return jsonb_build_object(
    'decision_id', v_decision.id,
    'feedback_revision', v_decision.feedback_revision,
    'decision', v_decision.decision,
    'decided_at', v_decision.decided_at,
    'idempotent', false
  );
end;
$$;

revoke all on function public.submit_internal_alert_feedback(
  text, text, integer, bigint, boolean, text, text, text, text, text
) from public, anon;
revoke all on function public.decide_internal_alert_feedback(
  text, text, integer, text, text
) from public, anon;
grant execute on function public.submit_internal_alert_feedback(
  text, text, integer, bigint, boolean, text, text, text, text, text
) to authenticated;
grant execute on function public.decide_internal_alert_feedback(
  text, text, integer, text, text
) to authenticated;

-- Preserve the established view column order and append the structured review
-- projection. A negative current_decision_id identifies a revision-1 legacy
-- super-admin acknowledgment; typed decision ids are positive.
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
left join public.eavesly_alert_feedback f
  on f.call_id = m.call_id and f.module_name = m.module_name
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
  ) candidate
  order by candidate.priority, candidate.current_decided_at, candidate.current_decision_id
  limit 1
) decision on access.can_read
where m.alert_sent = true;

comment on table public.eavesly_alert_review_decisions is
  'Append-only, one authoritative shared super-admin decision per feedback revision.';
comment on column public.eavesly_alert_feedback.comment is
  'Required false-alarm explanation for internal reviews; also contains nullable historic legacy notes.';
comment on column public.eavesly_alert_feedback.initial_manager_review is
  'Immutable snapshot of feedback fields and original reviewer identity only; never customer/call data.';
