-- Two things: partial repayments, and closing a hole in the edit link.

-- ── how much has actually been handed over ─────────────────────────────────
--
-- The split says M owes Q 1,240. Real life says M gave Q 500 last night. This
-- records the second without disturbing the first: the arithmetic and its proof
-- stay exactly as they were, and the settle-up screen simply says what is left.

create table if not exists public.repayments (
  party_id    uuid not null references public.parties on delete cascade,
  from_person uuid not null references public.party_people on delete cascade,
  to_person   uuid not null references public.party_people on delete cascade,
  -- minor units, like every other amount here
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users on delete set null,
  primary key (party_id, from_person, to_person)
);

alter table public.repayments enable row level security;

drop policy if exists "people with access read repayments" on public.repayments;
create policy "people with access read repayments"
  on public.repayments for select using (public.can_touch_party(party_id));

drop policy if exists "people with access write repayments" on public.repayments;
create policy "people with access write repayments"
  on public.repayments for insert with check (public.can_touch_party(party_id));

drop policy if exists "people with access update repayments" on public.repayments;
create policy "people with access update repayments"
  on public.repayments for update
  using (public.can_touch_party(party_id))
  with check (public.can_touch_party(party_id));

drop policy if exists "people with access delete repayments" on public.repayments;
create policy "people with access delete repayments"
  on public.repayments for delete using (public.can_touch_party(party_id));

create or replace function public.log_repayment_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pid uuid := coalesce(new.party_id, old.party_id);
  payer text;
  payee text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.amount_paid is not distinct from old.amount_paid then
    return new;
  end if;

  select name into payer from public.party_people where id = new.from_person;
  select name into payee from public.party_people where id = new.to_person;

  insert into public.event_log (party_id, actor_id, actor_name, action, subject, amount)
  values (pid, auth.uid(), public.log_actor_name(), 'recorded_repayment',
          coalesce(payer, 'someone') || ' to ' || coalesce(payee, 'someone'), new.amount_paid);

  return new;
end;
$$;

drop trigger if exists repayments_logged on public.repayments;
create trigger repayments_logged
  after insert or update or delete on public.repayments
  for each row execute function public.log_repayment_change();

-- Idempotent, because these files get re-run: adding a table to a publication
-- twice is an error rather than a no-op.
do $$
begin
  alter publication supabase_realtime add table public.repayments;
exception when duplicate_object then
  null;
end $$;

-- ── an edit link now needs an account behind it ────────────────────────────
--
-- A view link is for anyone: it reads and cannot write, so there is nobody to
-- hold responsible and nothing to hold them responsible for. An edit link is
-- different, because it changes what other people owe, and until now it did that
-- with no name attached. Whoever uses one has to sign in first, so the log can
-- say who, and so a link that leaks cannot be used by whoever finds it.
--
-- Reading with either kind of link is unchanged.

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
            insert into public.expense_shares (expense_id, person_id, weight)
            values (
              (op ->> 'expenseId')::uuid,
              (share_row ->> 'personId')::uuid,
              greatest(1, coalesce((share_row ->> 'weight')::int, 1))
            )
            on conflict (expense_id, person_id) do update set weight = excluded.weight;
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

/** What a link can do right now, for whoever is holding it. */
create or replace function public.share_capability(tok text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when not exists (select 1 from public.party_shares where token = tok and revoked_at is null)
      then 'none'
    when (select role from public.party_shares where token = tok and revoked_at is null) = 'view'
      then 'view'
    when auth.uid() is null
      then 'view_until_signed_in'
    else 'edit'
  end;
$$;

grant execute on function public.share_capability(text) to anon, authenticated;
