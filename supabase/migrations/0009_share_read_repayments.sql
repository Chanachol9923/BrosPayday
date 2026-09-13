-- A link has to show what has already been repaid.
--
-- Without this, someone opening a share link sees every settle-up row as fully
-- outstanding, and an edit-link holder recording their own repayment would be
-- writing on top of figures they were never shown. Same shape as every other
-- list in here, so the client folds it in the same way.

create or replace function public.share_read(tok text)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  pid uuid;
  result jsonb;
begin
  pid := public.share_party_id(tok, false);
  if pid is null then
    raise exception 'link not found';
  end if;

  select jsonb_build_object(
    'role',   (select role from public.party_shares where token = tok),
    'party',  to_jsonb(p) - 'group_id' - 'created_by',
    'people', coalesce((
      select jsonb_agg(to_jsonb(pp) order by pp.sort_order)
      from public.party_people pp where pp.party_id = pid
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(
        to_jsonb(e) - 'created_by' || jsonb_build_object(
          'shares', coalesce((
            select jsonb_agg(jsonb_build_object('person_id', s.person_id, 'weight', s.weight))
            from public.expense_shares s where s.expense_id = e.id
          ), '[]'::jsonb)
        ) order by e.sort_order
      )
      from public.expenses e where e.party_id = pid
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(to_jsonb(ph) - 'created_by')
      from public.photos ph where ph.party_id = pid
    ), '[]'::jsonb),
    'repayments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from_person', r.from_person,
        'to_person',   r.to_person,
        'amount_paid', r.amount_paid
      ))
      from public.repayments r where r.party_id = pid
    ), '[]'::jsonb)
  )
  into result
  from public.parties p
  where p.id = pid;

  return result;
end;
$$;
