-- BrosPayday — schema, row level security and storage.
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- Two ideas shape it:
--
-- 1. Everything hangs off a GROUP. You see a party because you are a member of the
--    group that owns it, never because you happen to know its id. Every policy
--    below reduces to that one question.
--
-- 2. Expenses are rows, not a blob. Two people editing different expenses in the
--    same party never collide, which is the whole point of settling up together.

-- ── helpers ────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── profiles ───────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone you share a group with can see your name; that is how the member list
-- and "who paid" read as people rather than as uuids.
create policy "profiles are visible to people you share a group with"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.group_members mine
      join public.group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy "you may edit only your own profile"
  on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "you may create your own profile"
  on public.profiles for insert with check (id = auth.uid());

-- Fill the profile in automatically the first time someone signs in with Google.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── groups ─────────────────────────────────────────────────────────────────

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'My crew',
  join_code  text not null unique,
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  role      text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- security definer, so the policy on group_members can ask "am I in this group?"
-- without recursing back into the very policy being evaluated.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create policy "you see groups you belong to"
  on public.groups for select using (public.is_group_member(id));

create policy "anyone signed in may start a group"
  on public.groups for insert with check (created_by = auth.uid());

create policy "members may rename their group"
  on public.groups for update using (public.is_group_member(id)) with check (public.is_group_member(id));

create policy "you see the membership of your own groups"
  on public.group_members for select using (public.is_group_member(group_id));

create policy "you may add yourself to a group"
  on public.group_members for insert with check (user_id = auth.uid());

create policy "you may remove yourself from a group"
  on public.group_members for delete using (user_id = auth.uid());

-- Joining by code has to read a group you cannot yet see, so it runs as definer
-- and adds you in one step. It reveals nothing about a code that does not exist.
create or replace function public.join_group_by_code(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  gid uuid;
begin
  select id into gid from public.groups where join_code = upper(trim(code));
  if gid is null then
    raise exception 'no such join code';
  end if;

  insert into public.group_members (group_id, user_id)
  values (gid, auth.uid())
  on conflict do nothing;

  return gid;
end;
$$;

-- ── parties ────────────────────────────────────────────────────────────────

create table if not exists public.parties (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups on delete cascade,
  title         text not null default '',
  party_date    date not null default current_date,
  currency_code text not null default 'THB',
  -- null while it is the party being worked on; set when it moves to history
  archived_at   timestamptz,
  created_by    uuid not null references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists parties_group_idx on public.parties (group_id, archived_at, updated_at desc);

create table if not exists public.party_people (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.parties on delete cascade,
  name       text not null default '',
  sort_order int not null default 0
);

create index if not exists party_people_party_idx on public.party_people (party_id);

create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.parties on delete cascade,
  name       text not null default '',
  -- minor units (satang), so the arithmetic stays in integers end to end
  amount     bigint not null default 0,
  payer_id   uuid references public.party_people on delete set null,
  sort_order int not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_party_idx on public.expenses (party_id);

create table if not exists public.expense_shares (
  expense_id uuid not null references public.expenses on delete cascade,
  person_id  uuid not null references public.party_people on delete cascade,
  weight     int not null default 1 check (weight > 0),
  primary key (expense_id, person_id)
);

create table if not exists public.settlements (
  party_id    uuid not null references public.parties on delete cascade,
  from_person uuid not null references public.party_people on delete cascade,
  to_person   uuid not null references public.party_people on delete cascade,
  amount      bigint not null,
  settled_at  timestamptz not null default now(),
  settled_by  uuid references auth.users on delete set null,
  primary key (party_id, from_person, to_person, amount)
);

-- ── payees and presets, remembered per group ───────────────────────────────

create table if not exists public.payees (
  group_id       uuid not null references public.groups on delete cascade,
  name_key       text not null,
  display_name   text not null default '',
  promptpay_id   text,
  qr_storage_path text,
  updated_at     timestamptz not null default now(),
  primary key (group_id, name_key)
);

create table if not exists public.presets (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups on delete cascade,
  name          text not null default '',
  title         text not null default '',
  currency_code text not null default 'THB',
  people        text[] not null default '{}',
  item_names    text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  party_id     uuid not null references public.parties on delete cascade,
  expense_id   uuid references public.expenses on delete set null,
  storage_path text not null,
  bytes        int not null default 0,
  w            int not null default 0,
  h            int not null default 0,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists photos_party_idx on public.photos (party_id);

-- ── row level security for everything party-shaped ─────────────────────────

create or replace function public.can_touch_party(pid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.parties p
    join public.group_members m on m.group_id = p.group_id
    where p.id = pid and m.user_id = auth.uid()
  );
$$;

alter table public.parties        enable row level security;
alter table public.party_people   enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements    enable row level security;
alter table public.payees         enable row level security;
alter table public.presets        enable row level security;
alter table public.photos         enable row level security;

create policy "group members read parties"   on public.parties for select using (public.is_group_member(group_id));
create policy "group members write parties"  on public.parties for insert with check (public.is_group_member(group_id));
create policy "group members update parties" on public.parties for update using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy "group members delete parties" on public.parties for delete using (public.is_group_member(group_id));

create policy "party members read people"   on public.party_people for select using (public.can_touch_party(party_id));
create policy "party members write people"  on public.party_people for insert with check (public.can_touch_party(party_id));
create policy "party members update people" on public.party_people for update using (public.can_touch_party(party_id)) with check (public.can_touch_party(party_id));
create policy "party members delete people" on public.party_people for delete using (public.can_touch_party(party_id));

create policy "party members read expenses"   on public.expenses for select using (public.can_touch_party(party_id));
create policy "party members write expenses"  on public.expenses for insert with check (public.can_touch_party(party_id));
create policy "party members update expenses" on public.expenses for update using (public.can_touch_party(party_id)) with check (public.can_touch_party(party_id));
create policy "party members delete expenses" on public.expenses for delete using (public.can_touch_party(party_id));

create policy "party members read shares" on public.expense_shares for select
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.can_touch_party(e.party_id)));
create policy "party members write shares" on public.expense_shares for insert
  with check (exists (select 1 from public.expenses e where e.id = expense_id and public.can_touch_party(e.party_id)));
create policy "party members update shares" on public.expense_shares for update
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.can_touch_party(e.party_id)));
create policy "party members delete shares" on public.expense_shares for delete
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.can_touch_party(e.party_id)));

create policy "party members read settlements"   on public.settlements for select using (public.can_touch_party(party_id));
create policy "party members write settlements"  on public.settlements for insert with check (public.can_touch_party(party_id));
create policy "party members delete settlements" on public.settlements for delete using (public.can_touch_party(party_id));

create policy "party members read photos"   on public.photos for select using (public.can_touch_party(party_id));
create policy "party members write photos"  on public.photos for insert with check (public.can_touch_party(party_id));
create policy "party members update photos" on public.photos for update using (public.can_touch_party(party_id)) with check (public.can_touch_party(party_id));
create policy "party members delete photos" on public.photos for delete using (public.can_touch_party(party_id));

create policy "group members read payees"   on public.payees for select using (public.is_group_member(group_id));
create policy "group members write payees"  on public.payees for insert with check (public.is_group_member(group_id));
create policy "group members update payees" on public.payees for update using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy "group members delete payees" on public.payees for delete using (public.is_group_member(group_id));

create policy "group members read presets"   on public.presets for select using (public.is_group_member(group_id));
create policy "group members write presets"  on public.presets for insert with check (public.is_group_member(group_id));
create policy "group members update presets" on public.presets for update using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy "group members delete presets" on public.presets for delete using (public.is_group_member(group_id));

-- ── photo storage ──────────────────────────────────────────────────────────
-- Private bucket. Files are keyed <party_id>/<uuid>, and access is granted by
-- membership of the group that owns that party — the same question as above.

insert into storage.buckets (id, name, public)
values ('party-photos', 'party-photos', false)
on conflict (id) do nothing;

drop policy if exists "group members read photos" on storage.objects;
create policy "group members read photos" on storage.objects for select
  using (bucket_id = 'party-photos' and public.can_touch_party((storage.foldername(name))[1]::uuid));

drop policy if exists "group members upload photos" on storage.objects;
create policy "group members upload photos" on storage.objects for insert
  with check (bucket_id = 'party-photos' and public.can_touch_party((storage.foldername(name))[1]::uuid));

drop policy if exists "group members delete photos" on storage.objects;
create policy "group members delete photos" on storage.objects for delete
  using (bucket_id = 'party-photos' and public.can_touch_party((storage.foldername(name))[1]::uuid));

-- ── live updates ───────────────────────────────────────────────────────────
-- So one person adding an expense shows up on everyone else's screen.

alter publication supabase_realtime add table public.parties;
alter publication supabase_realtime add table public.party_people;
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.expense_shares;
alter publication supabase_realtime add table public.settlements;
alter publication supabase_realtime add table public.photos;
alter publication supabase_realtime add table public.payees;
alter publication supabase_realtime add table public.presets;

-- ── share links ────────────────────────────────────────────────────────────
-- Two kinds: one to look, one to add what you bought. A link holder never signs
-- in, so none of the policies above apply to them. Instead every access goes
-- through a function that is handed the token, checks it, and does exactly what
-- that token's role allows — the authorisation lives in the database, not in the
-- client that happens to hold the link.

create table if not exists public.party_shares (
  token      text primary key,
  party_id   uuid not null references public.parties on delete cascade,
  role       text not null check (role in ('view', 'edit')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists party_shares_party_idx on public.party_shares (party_id);

alter table public.party_shares enable row level security;

create policy "group members manage their share links"
  on public.party_shares for all
  using (public.can_touch_party(party_id))
  with check (public.can_touch_party(party_id));

create or replace function public.share_party_id(tok text, need_edit boolean default false)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select party_id from public.party_shares
  where token = tok
    and revoked_at is null
    and (not need_edit or role = 'edit');
$$;

-- Everything a link holder needs to render the party, in one round trip.
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
    ), '[]'::jsonb)
  )
  into result
  from public.parties p
  where p.id = pid;

  return result;
end;
$$;

/**
 * Apply a batch of row operations on behalf of an edit link.
 *
 * The ops are the same shape the app produces for a signed-in member, so one code
 * path serves both. Every op is pinned to the token's own party before it runs:
 * a link cannot be aimed at a party it was not issued for, and a view link cannot
 * write at all.
 */
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
  pid := public.share_party_id(tok, true);
  if pid is null then
    raise exception 'this link cannot make changes';
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
        -- only for an expense that belongs to this token's party
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

      else
        -- photos, presets, payees and party metadata stay with the group.
        -- A link is for saying what you bought, not for renaming the night.
        null;
    end case;
  end loop;

  update public.parties set updated_at = now() where id = pid;
end;
$$;

grant execute on function public.share_read(text) to anon, authenticated;
grant execute on function public.share_write(text, jsonb) to anon, authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
