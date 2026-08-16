-- Individual Pennie Form submissions behind one exact Achieve representative
-- rollup. The projection intentionally excludes phone numbers, call IDs,
-- Salesforce IDs, and all other internal call identifiers.

create or replace function public.list_achieve_agent_feedback_for_rep(
  p_agent_email text,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_agent_email text := nullif(lower(btrim(p_agent_email)), '');
  result jsonb;
begin
  if normalized_agent_email is null
    or length(normalized_agent_email) > 254
    or normalized_agent_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using
      errcode = '22023',
      message = 'valid representative email is required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception using
      errcode = '22023',
      message = 'feedback detail limit must be between 1 and 200';
  end if;
  if p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'feedback detail offset must be nonnegative';
  end if;

  with attributed as materialized (
    select attributed.*
    from private.achieve_agent_feedback_attributed(null, null) as attributed
    where attributed.achieve_agent_email = normalized_agent_email
  ),
  detail as (
    select
      attributed.feedback_id,
      attributed.submitted_at,
      attributed.rating,
      attributed.accent,
      attributed.background_noise,
      attributed.connection_issues,
      nullif(btrim(feedback.notes), '') as notes,
      nullif(btrim(feedback.submitted_by), '') as submitted_by
    from attributed
    join public.achieve_agent_feedback as feedback
      on feedback.id = attributed.feedback_id
  ),
  page as (
    select detail.*
    from detail
    order by detail.submitted_at desc, detail.feedback_id desc
    limit p_limit
    offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.submitted_at desc, page.feedback_id desc)
      from page
    ), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'total', (select count(*) from detail),
      'loaded', (select count(*) from page),
      'limit', p_limit,
      'offset', p_offset,
      'cap_reached', p_offset + (select count(*) from page) < (select count(*) from detail)
    )
  )
  into result;

  return result;
end;
$$;

comment on function public.list_achieve_agent_feedback_for_rep(text, integer, integer) is
  'Service-only individual Pennie Form feedback for one exactly attributed Achieve representative; excludes call and lead identifiers.';

revoke execute on function public.list_achieve_agent_feedback_for_rep(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_achieve_agent_feedback_for_rep(text, integer, integer)
  to service_role;
