-- Manager preferences may be self-created, but director authority is assigned
-- administratively. Existing rows and the UPDATE policy are unchanged.
alter policy "Users can insert own prompt data"
  on public.manager_coaching_prompts
  with check (
    manager_email = (auth.jwt() ->> 'email')
    and is_god_mode is false
  );
