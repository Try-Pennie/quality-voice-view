-- Replay the timing migration against representative duplicate legacy transcripts.
-- Runs only in the disposable database owned by the Full QA integration harness.
create table public.eavesly_transcription_qa (
  id bigint primary key, call_id text, created_at timestamptz, original_transcript text
);
create table public.eavesly_transcriptions (
  id bigint primary key, call_id text, created_at timestamptz, full_transcript text
);
insert into public.eavesly_transcription_qa values
  (1,'CALL-COACHED','2026-09-01','older QA transcript'),
  (2,'CALL-COACHED','2026-09-02','same-time lower ID'),
  (3,'CALL-COACHED','2026-09-02','latest QA transcript'),
  (4,'CALL-COACHED',null,'undated QA transcript');
insert into public.eavesly_transcriptions values
  (1,'CALL-COACHED','2026-09-01','older fallback'),
  (2,'CALL-COACHED','2026-09-02','latest fallback');
update public.eavesly_module_results set recording_link='https://recordings.example.test/call.mp3'
where call_id='CALL-COACHED' and module_name='full_qa';
insert into public.eavesly_recording_word_timestamps(call_id,recording_reference,status,duration,words,completed_at)
values ('CALL-COACHED','https://recordings.example.test/call.mp3','ready',10,'[{"text":"hello","start":0,"end":1}]',now());
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"manager@trypennie.com"}',false);
set role authenticated;
do $$ declare result jsonb; begin
  result:=public.get_recording_word_timestamps('CALL-COACHED','full_qa');
  if result->>'original_transcript' is distinct from 'latest QA transcript' then
    raise exception 'duplicate QA rows did not select the newest timestamp and ID'; end if;
  if public.get_recording_word_timestamps('CALL-PENDING','full_qa') is not null then
    raise exception 'uncached recording returned timing'; end if;
  if has_table_privilege('authenticated','public.eavesly_recording_word_timestamps','SELECT')
    or has_table_privilege('authenticated','public.eavesly_recording_word_timestamps','INSERT')
    or has_function_privilege('anon','public.get_recording_word_timestamps(text,text)','EXECUTE') then
    raise exception 'timing privilege boundary failed'; end if;
  begin
    perform public.get_recording_word_timestamps('CALL-COACHED','disposition_review');
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then if sqlerrm<>'EAVESLY_FORBIDDEN' then raise; end if; end;
end $$;
reset role;
-- An empty latest QA row falls back to the latest original transcript, not an older QA row.
update public.eavesly_transcription_qa set original_transcript='' where id=3;
set role authenticated;
do $$ begin
  if public.get_recording_word_timestamps('CALL-COACHED','full_qa')->>'original_transcript'
    is distinct from 'latest fallback' then raise exception 'latest transcript fallback failed'; end if;
end $$;
reset role;
-- Stale cache cannot attach to a replacement recording.
update public.eavesly_module_results set recording_link='https://recordings.example.test/replacement.mp3'
where call_id='CALL-COACHED' and module_name='full_qa';
set role authenticated;
do $$ begin
  if public.get_recording_word_timestamps('CALL-COACHED','full_qa') is not null then
    raise exception 'stale recording reference returned timing'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","email":"outsider@trypennie.com"}',false);
set role authenticated;
do $$ begin
  begin
    perform public.get_recording_word_timestamps('CALL-COACHED','full_qa');
    raise exception 'TEST_EXPECTED_FAILURE_MISSING';
  exception when others then if sqlerrm<>'EAVESLY_FORBIDDEN' then raise; end if; end;
end $$;
reset role;
select 'recording-word-timestamps.sql: all assertions passed' result;
