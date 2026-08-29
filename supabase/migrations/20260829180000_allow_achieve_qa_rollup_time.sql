-- The all-history sparse QA rollup is intentionally heavier than interactive RPCs.
-- Scope the timeout override to this service-only export function.

alter function public.get_achieve_first_pay_export_qa_rollups()
  set statement_timeout = '60s';
