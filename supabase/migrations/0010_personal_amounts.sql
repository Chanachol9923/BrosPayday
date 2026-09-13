-- Someone carrying part of an expense alone.
--
-- The karaoke room was 300, but A ate 20 of snacks on that same bill. Until now
-- the only way to say that was a share weight — ×2, ×3 — which can only ever
-- describe a ratio, so an exact 20 had to become its own expense or be argued
-- about. This records it where it happened: 20 comes off the top and goes to A,
-- and the remaining 280 is divided as usual.
--
-- Nothing else changes. An expense with no personal amounts behaves exactly as
-- before, which is what every existing row is.

alter table public.expense_shares
  add column if not exists extra bigint not null default 0 check (extra >= 0);

-- The share-link writer has to carry it too, or an edit made through an invite
-- would quietly flatten everyone's personal amounts back to zero.
create or replace function public.share_write(tok text, ops jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pid uuid;
  op jsonb;
  share_row jsonb;
begin
  -- Order matters only for what the message says: a view link is never going to
  -- write, so telling its holder to sign in would send them round a pointless
  -- loop. Both roads end in a refusal either way.
  pid := public.share_party_id(tok, true);
  if pid is null then
    raise exception 'this link cannot make changes';
  end if;

  if auth.uid() is null then
    raise exception 'sign in to change anything with this link';
  end if;

  for op in select * from jsonb_array_elements(ops)
  loop
    case op ->> 'table'

      when 'party_people' then
        if op ->> 'op' = 'upsert' then
          insert into public.party_people (id, party_id, name, sort_order)
          values ((op ->> 'id')::uuid, pid, coalesce(op ->> 'name', ''), coalesce((op ->> 'order')::int, 0))
          on conflict (id) do update
            set name = excluded.name, sort_order = excluded.sort_order
            where public.party_people.party_id = pid;
        else
          delete from public.party_people where id = (op ->> 'id')::uuid and party_id = pid;
        end if;

      when 'expenses' then
        if op ->> 'op' = 'upsert' then
          insert into public.expenses (id, party_id, name, amount, payer_id, sort_order)
          values (
            (op ->> 'id')::uuid, pid,
            coalesce(op #>> '{item,name}', ''),
            coalesce((op #>> '{item,amount}')::bigint, 0),
            nullif(op #>> '{item,payerId}', '')::uuid,
            coalesce((op ->> 'order')::int, 0)
          )
          on conflict (id) do update
            set name = excluded.name,
                amount = excluded.amount,
                payer_id = excluded.payer_id,
                sort_order = excluded.sort_order,
                updated_at = now()
            where public.expenses.party_id = pid;
        else
          delete from public.expenses where id = (op ->> 'id')::uuid and party_id = pid;
        end if;

      when 'expense_shares' then
        if exists (select 1 from public.expenses e where e.id = (op ->> 'expenseId')::uuid and e.party_id = pid) then
          delete from public.expense_shares where expense_id = (op ->> 'expenseId')::uuid;
          for share_row in select * from jsonb_array_elements(op -> 'shares')
          loop
            insert into public.expense_shares (expense_id, person_id, weight, extra)
            values (
              (op ->> 'expenseId')::uuid,
              (share_row ->> 'personId')::uuid,
              greatest(1, coalesce((share_row ->> 'weight')::int, 1)),
              greatest(0, coalesce((share_row ->> 'extra')::bigint, 0))
            )
            on conflict (expense_id, person_id) do update
              set weight = excluded.weight, extra = excluded.extra;
          end loop;
        end if;

      when 'repayments' then
        if op ->> 'op' = 'upsert' then
          insert into public.repayments (party_id, from_person, to_person, amount_paid, updated_by)
          values (pid, (op ->> 'fromId')::uuid, (op ->> 'toId')::uuid,
                  greatest(0, coalesce((op ->> 'amountPaid')::bigint, 0)), auth.uid())
          on conflict (party_id, from_person, to_person) do update
            set amount_paid = excluded.amount_paid, updated_at = now(), updated_by = auth.uid();
        else
          delete from public.repayments
          where party_id = pid
            and from_person = (op ->> 'fromId')::uuid
            and to_person = (op ->> 'toId')::uuid;
        end if;

      else
        null;
    end case;
  end loop;

  update public.parties set updated_at = now() where id = pid;
end;
$$;

-- And the reader, so a link shows the same division the owner sees.
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
    ), '[]'::jsonb)
  )
  into result
  from public.parties p
  where p.id = pid;

  return result;
end;
$$;
