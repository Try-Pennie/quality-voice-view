-- Let the internal Eavesly dashboard read Pennie agent feedback.
--
-- achieve_agent_feedback was created service-role-only (read via the external
-- achieve-portal edge function). Internal managers also need to see what
-- Pennie agents are saying about Achieve welcome calls, and the internal
-- dashboard queries tables directly with the authenticated role (Google login,
-- @trypennie.com enforced by 20260721193544_enforce_trypennie_email_domain).
-- Same pattern as eavesly_module_results / eavesly_alert_feedback.
--
-- Read-only: writes stay service-role-only (the achieve-feedback-sync edge
-- function is the single writer).
create policy "Authenticated read access"
  on public.achieve_agent_feedback
  for select
  to authenticated
  using (true);
