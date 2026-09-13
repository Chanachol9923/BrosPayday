-- A link has to say how to pay people back.
--
-- The settle-up screen is the point of sending someone an event, and it was
-- telling every link holder that nobody had a payment QR. The details were never
-- in what a link returns.
--
-- Only the people actually on this event are included, matched the way the app
-- matches them — by name, case-insensitively. The rest of the group's payment
-- details are none of a link holder's business, and this is the difference
-- between sharing one night out and handing over an address book.

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
            select jsonb_agg(jsonb_build_object(
              'person_id', s.person_id,
              'weight',    s.weight,
              'extra',     s.extra
            ))
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
    ), '[]'::jsonb),
    -- A pasted QR image lives in storage, which a link holder cannot read, so
    -- only the PromptPay number travels. That is the better half anyway: the app
    -- builds a code from it with the exact amount already in it.
    'payees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', y.display_name,
        'promptpay_id', y.promptpay_id
      ))
      from public.payees y
      where y.group_id = p.group_id
        and y.promptpay_id is not null
        and exists (
          select 1 from public.party_people pp
          where pp.party_id = pid and lower(pp.name) = lower(y.display_name)
        )
    ), '[]'::jsonb)
  )
  into result
  from public.parties p
  where p.id = pid;

  return result;
end;
$$;
