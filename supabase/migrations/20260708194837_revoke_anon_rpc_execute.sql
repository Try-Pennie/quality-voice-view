-- Close the remaining anon exposure after the 2026-07-07 table lockdown
-- (20260707182147_rls_harden_internal_tables): the Supabase security advisor
-- (lint 0028, anon_security_definer_function_executable) still flags 10
-- SECURITY DEFINER functions that the `anon` role can call via /rest/v1/rpc/*.
-- Because they are SECURITY DEFINER they run with the owner's rights and
-- bypass RLS, so anyone holding the browser-shipped anon key can invoke them.
-- Two return lead/call PII:
--   eavesly_call_data(call_id)                  — full call row by call_id
--   get_lead_profile_recap_agent_view(lead_id)  — lead profile recap by SFDC id
--
-- Fix: revoke EXECUTE from anon (and PUBLIC, which anon inherits). We KEEP the
-- `authenticated` grant — the manager dashboard calls agent_daily_metrics,
-- team_daily_metrics, and agent_manager_mapping_at as a signed-in user (verified
-- by grep of quality-voice-view/src). The remaining lint-0029 warnings
-- (same functions callable by `authenticated`) are a much smaller, internal
-- blast radius and are left for a per-function decision — some of these funcs
-- may back agent-facing surfaces not in this repo, so a blanket authenticated
-- revoke is deliberately NOT done here.
--
-- Trigger/auth-flow functions (handle_new_manager_login, get_current_user_email)
-- are included: revoking anon EXECUTE does not affect trigger invocation
-- (triggers run the function regardless of the caller's EXECUTE grant), and the
-- login/session path runs through GoTrue, not an anon RPC call.

revoke execute on function public.agent_daily_metrics(p_agent_email text, p_start date, p_end date) from anon, public;
revoke execute on function public.team_daily_metrics(p_start date, p_end date)                       from anon, public;
revoke execute on function public.agent_manager_mapping_at(p_as_of date)                             from anon, public;
revoke execute on function public.eavesly_call_data(call_id text)                                    from anon, public;
revoke execute on function public.get_lead_profile_recap_agent_view(p_sfdc_lead_id text)             from anon, public;
revoke execute on function public.check_call_completed(call_id text)                                 from anon, public;
revoke execute on function public.check_transcription_completed(call_id text)                        from anon, public;
revoke execute on function public.is_god_mode_user(user_email text)                                  from anon, public;
revoke execute on function public.get_current_user_email()                                           from anon, public;
revoke execute on function public.handle_new_manager_login()                                         from anon, public;
