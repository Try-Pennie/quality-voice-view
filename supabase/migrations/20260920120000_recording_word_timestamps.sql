-- Audio navigation only. Never replaces Regal transcripts or QA evidence.
create table public.eavesly_recording_word_timestamps (
  call_id text not null,
  recording_reference text not null check (length(recording_reference) between 1 and 2048),
  recording_fingerprint text generated always as
    (encode(extensions.digest(recording_reference, 'sha256'), 'hex')) stored,
  status text not null check (status in ('processing', 'ready', 'failed')),
  model text not null default 'grok-voice-transcribe-2.0' check (model = 'grok-voice-transcribe-2.0'),
  duration double precision,
  words jsonb,
  error_code text check (error_code in ('cancelled','transport','http','too_large','invalid_response','invalid_source','storage')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (call_id, recording_fingerprint),
  check (
    (status = 'processing' and words is null and duration is null and error_code is null and completed_at is null)
    or (status = 'ready' and words is not null and duration is not null and jsonb_typeof(words) = 'array' and jsonb_array_length(words) between 1 and 100000
      and duration > 0 and duration <= 36000 and error_code is null and completed_at is not null)
    or (status = 'failed' and words is null and duration is null and error_code is not null and completed_at is not null)
  )
);
alter table public.eavesly_recording_word_timestamps enable row level security;
revoke all on public.eavesly_recording_word_timestamps from public, anon, authenticated;
grant select, insert, update on public.eavesly_recording_word_timestamps to service_role;

-- No client-supplied recording URLs or caller identity. Reuse internal-review auth,
-- bind the returned cache to the current persisted alert recording, not just call ID.
create function public.get_recording_word_timestamps(p_call_id text, p_module_name text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor text := private.internal_alert_actor_email();
  v_reference text;
  v_result jsonb;
begin
  if p_module_name is null or p_module_name not in ('full_qa','budget_inputs','warm_transfer','litigation_check','program_expectations','active_settlements','gota_check')
    or not private.alert_visible_to(v_actor, p_call_id, p_module_name) then
    raise exception using errcode = 'P0001', message = 'EAVESLY_FORBIDDEN';
  end if;
  select m.recording_link into v_reference from public.eavesly_module_results m
  where m.call_id = p_call_id and m.module_name = p_module_name and m.alert_sent;
  if v_reference is null then return null; end if;
  select jsonb_build_object('recording_reference', t.recording_reference,
    'original_transcript', coalesce(
      (select nullif(q.original_transcript, '') from public.eavesly_transcription_qa q where q.call_id = p_call_id order by q.created_at desc nulls last, q.id desc limit 1),
      (select nullif(tr.full_transcript, '') from public.eavesly_transcriptions tr where tr.call_id = p_call_id order by tr.created_at desc nulls last, tr.id desc limit 1)),
    'duration', t.duration, 'words', t.words) into v_result
  from public.eavesly_recording_word_timestamps t
  where t.call_id = p_call_id and t.recording_reference = v_reference and t.status = 'ready';
  return v_result;
end;
$$;
revoke all on function public.get_recording_word_timestamps(text,text) from public, anon;
grant execute on function public.get_recording_word_timestamps(text,text) to authenticated;
