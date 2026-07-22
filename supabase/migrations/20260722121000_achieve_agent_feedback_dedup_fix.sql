-- The sheet-sync upsert targets the dedup key via PostgREST on_conflict, which
-- requires a plain-column unique index (expression indexes are not usable).
-- Make submitted_by non-null ('' when the form omits it) and rebuild the index.
update public.achieve_agent_feedback set submitted_by = '' where submitted_by is null;
alter table public.achieve_agent_feedback
  alter column submitted_by set default '',
  alter column submitted_by set not null;
drop index if exists achieve_agent_feedback_dedup_idx;
create unique index achieve_agent_feedback_dedup_idx
  on public.achieve_agent_feedback (submitted_at, lead_phone_raw, submitted_by);
