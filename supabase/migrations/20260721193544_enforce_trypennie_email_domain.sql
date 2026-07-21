-- Restrict dashboard auth to @trypennie.com accounts (GOTA/report access review 2026-07-21).
-- The Google OAuth app is not workspace-internal, signups are enabled, and RLS grants
-- `authenticated using (true)` reads on QA tables — so any Google account could sign in
-- and read all QA data. Enforce the domain at the auth.users insert boundary and ban
-- the existing non-trypennie accounts.

-- 1) Block future signups (any provider) for non-trypennie emails.
create or replace function public.enforce_trypennie_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.email is null or lower(split_part(new.email, '@', 2)) <> 'trypennie.com' then
    raise exception 'Sign-ups are restricted to trypennie.com accounts';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_trypennie_email on auth.users;
create trigger enforce_trypennie_email
  before insert on auth.users
  for each row execute function public.enforce_trypennie_email();

-- 2) Ban existing non-trypennie users (far-future timestamp; GoTrue rejects login
--    while banned_until > now()) and revoke their sessions/refresh tokens so any
--    live session dies immediately.
update auth.users
   set banned_until = '2999-12-31 00:00:00+00'
 where email is null or lower(split_part(email, '@', 2)) <> 'trypennie.com';

delete from auth.sessions
 where user_id in (
   select id from auth.users
   where email is null or lower(split_part(email, '@', 2)) <> 'trypennie.com'
 );

delete from auth.refresh_tokens
 where user_id in (
   select id::text from auth.users
   where email is null or lower(split_part(email, '@', 2)) <> 'trypennie.com'
 );
