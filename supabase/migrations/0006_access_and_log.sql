-- Who can touch an event, and a record of who touched it.
--
-- Three things that only make sense together: showing the people with access,
-- being able to remove one of them, and a log that says what each of them did.
--
-- The log is written by triggers rather than by the app. Anything else would miss
-- the edits that arrive through an invite link, which is exactly the traffic
-- somebody would want to look back at.

-- ── bans ───────────────────────────────────────────────────────────────────

create table if not exists public.event_bans (
  party_id  uuid not null references public.parties on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  banned_by uuid references auth.users on delete set null,
  banned_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index if not exists event_bans_user_idx on public.event_bans (user_id);

alter table public.event_bans enable row level security;

-- A banned person must not see the event at all, so both the read policy and the
-- write helper have to know about it.
create or replace function public.is_banned_from(pid uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.event_bans where party_id = pid and user_id = uid);
$$;

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
  ) and not public.is_banned_from(pid, auth.uid());
$$;

drop policy if exists "group members read parties" on public.parties;
create policy "group members read parties"
  on public.parties for select
  using (
    public.is_group_member(group_id)
    and not exists (
      select 1 from public.party_hidden h
      where h.party_id = parties.id and h.user_id = auth.uid()
    )
    and not public.is_banned_from(parties.id, auth.uid())
  );

drop policy if exists "people with access see the ban list" on public.event_bans;
create policy "people with access see the ban list"
  on public.event_bans for select
  using (public.can_touch_party(party_id) or user_id = auth.uid());

/**
 * Remove someone from an event. Only whoever started it may do this — otherwise
 * a disagreement becomes a race to remove each other — and nobody can remove the
 * owner or themselves.
 */
create or replace function public.set_event_ban(p_party_id uuid, p_user_id uuid, p_banned boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owner uuid;
begin
  select created_by into owner from public.parties where id = p_party_id;
  if owner is null then
    raise exception 'no such event';
  end if;
  if uid is null or uid <> owner then
    raise exception 'only whoever started this event can change who is on it';
  end if;
  if p_user_id = owner then
    raise exception 'the person who started it cannot be removed';
  end if;

  if p_banned then
    insert into public.event_bans (party_id, user_id, banned_by)
    values (p_party_id, p_user_id, uid)
    on conflict (party_id, user_id) do nothing;
  else
    delete from public.event_bans where party_id = p_party_id and user_id = p_user_id;
  end if;
end;
$$;

grant execute on function public.set_event_ban(uuid, uuid, boolean) to authenticated;

/** Everyone who can reach this event, and whether they are currently removed. */
create or replace function public.event_access(p_party_id uuid)
returns table (user_id uuid, display_name text, avatar_url text, is_owner boolean, is_banned boolean)
language plpgsql
security definer set search_path = public
as $$
declare
  gid uuid;
  owner uuid;
begin
  select group_id, created_by into gid, owner from public.parties where id = p_party_id;
  if gid is null then
    return;
  end if;
  -- only someone who can reach the event may ask who else can
  if not public.can_touch_party(p_party_id) and not public.is_banned_from(p_party_id, auth.uid()) then
    raise exception 'not yours to look at';
  end if;

  return query
  select p.id,
         coalesce(nullif(p.display_name, ''), 'Someone'),
         p.avatar_url,
         p.id = owner,
         exists (select 1 from public.event_bans b where b.party_id = p_party_id and b.user_id = p.id)
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  where m.group_id = gid
  order by (p.id = owner) desc, p.display_name;
end;
$$;

grant execute on function public.event_access(uuid) to authenticated;

-- ── the log ────────────────────────────────────────────────────────────────

create table if not exists public.event_log (
  id         bigserial primary key,
  party_id   uuid not null references public.parties on delete cascade,
  actor_id   uuid references auth.users on delete set null,
  -- Snapshotted, so the log still reads properly after someone leaves or renames.
  actor_name text not null default '',
  action     text not null,
  subject    text not null default '',
  amount     bigint,
  at         timestamptz not null default now()
);

create index if not exists event_log_party_idx on public.event_log (party_id, at desc);

alter table public.event_log enable row level security;

drop policy if exists "people with access read the log" on public.event_log;
create policy "people with access read the log"
  on public.event_log for select using (public.can_touch_party(party_id));

/**
 * Whoever is making this change. Signed-in people get their profile name; an edit
 * made through an invite link has no account behind it, and says so.
 */
create or replace function public.log_actor_name()
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when auth.uid() is null then 'Someone with an invite link'
    else coalesce(nullif((select display_name from public.profiles where id = auth.uid()), ''), 'Someone')
  end;
$$;

create or replace function public.log_expense_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  act text;
  amt bigint;
  subj text;
begin
  if tg_op = 'INSERT' then
    act := 'added_expense'; subj := new.name; amt := new.amount;
  elsif tg_op = 'DELETE' then
    act := 'removed_expense'; subj := old.name; amt := old.amount;
  else
    -- a rename and a re-price are different stories; a no-op is not a story at all
    if new.name is not distinct from old.name and new.amount is not distinct from old.amount
       and new.payer_id is not distinct from old.payer_id then
      return new;
    end if;
    act := 'changed_expense'; subj := new.name; amt := new.amount;
  end if;

  insert into public.event_log (party_id, actor_id, actor_name, action, subject, amount)
  values (coalesce(new.party_id, old.party_id), auth.uid(), public.log_actor_name(), act, coalesce(subj, ''), amt);

  return coalesce(new, old);
end;
$$;

drop trigger if exists expenses_logged on public.expenses;
create trigger expenses_logged
  after insert or update or delete on public.expenses
  for each row execute function public.log_expense_change();

create or replace function public.log_person_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;

  insert into public.event_log (party_id, actor_id, actor_name, action, subject)
  values (
    coalesce(new.party_id, old.party_id),
    auth.uid(),
    public.log_actor_name(),
    case tg_op when 'INSERT' then 'added_person' when 'DELETE' then 'removed_person' else 'renamed_person' end,
    coalesce(new.name, old.name, '')
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists party_people_logged on public.party_people;
create trigger party_people_logged
  after insert or update or delete on public.party_people
  for each row execute function public.log_person_change();

create or replace function public.log_party_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.event_log (party_id, actor_id, actor_name, action, subject)
    values (new.id, auth.uid(), public.log_actor_name(), 'created_event', coalesce(new.title, ''));
    return new;
  end if;

  if new.title is distinct from old.title then
    insert into public.event_log (party_id, actor_id, actor_name, action, subject)
    values (new.id, auth.uid(), public.log_actor_name(), 'renamed_event', coalesce(new.title, ''));
  end if;

  if new.archived_at is distinct from old.archived_at and new.archived_at is not null then
    insert into public.event_log (party_id, actor_id, actor_name, action, subject)
    values (new.id, auth.uid(), public.log_actor_name(), 'archived_event', coalesce(new.title, ''));
  end if;

  return new;
end;
$$;

drop trigger if exists parties_logged on public.parties;
create trigger parties_logged
  after insert or update on public.parties
  for each row execute function public.log_party_change();

-- Bans are worth recording too, since they change what everyone else can see.
create or replace function public.log_ban_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  who text;
begin
  select coalesce(nullif(display_name, ''), 'Someone') into who
  from public.profiles where id = coalesce(new.user_id, old.user_id);

  insert into public.event_log (party_id, actor_id, actor_name, action, subject)
  values (
    coalesce(new.party_id, old.party_id),
    auth.uid(),
    public.log_actor_name(),
    case tg_op when 'INSERT' then 'removed_member' else 'restored_member' end,
    coalesce(who, 'Someone')
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists event_bans_logged on public.event_bans;
create trigger event_bans_logged
  after insert or delete on public.event_bans
  for each row execute function public.log_ban_change();

alter publication supabase_realtime add table public.event_log;
alter publication supabase_realtime add table public.event_bans;
