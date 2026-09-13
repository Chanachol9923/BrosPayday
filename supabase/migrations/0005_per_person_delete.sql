-- Deleting an event should delete it for you, not for everyone.
--
-- Until now a delete was a delete: one person tidying up took the night out of
-- everybody's history, including the people still settling it. That is a
-- surprising amount of damage for a button labelled "delete this event".
--
-- Now each person can put an event out of their own sight. The row survives while
-- anyone still wants it, and goes for good once the last person has let it go —
-- so nothing lingers in the database that nobody can see either.

create table if not exists public.party_hidden (
  party_id  uuid not null references public.parties on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index if not exists party_hidden_user_idx on public.party_hidden (user_id);

alter table public.party_hidden enable row level security;

drop policy if exists "you manage your own hidden list" on public.party_hidden;
create policy "you manage your own hidden list"
  on public.party_hidden for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Hidden means gone, everywhere: reads, lists and realtime all stop mentioning it
-- without a single call site having to remember to filter.
drop policy if exists "group members read parties" on public.parties;
create policy "group members read parties"
  on public.parties for select
  using (
    public.is_group_member(group_id)
    and not exists (
      select 1 from public.party_hidden h
      where h.party_id = parties.id and h.user_id = auth.uid()
    )
  );

/**
 * Put an event out of your own sight, and out of the database entirely if nobody
 * else is still holding on to it.
 *
 * Runs as definer for the last step only: deleting the row has to happen after
 * the caller can no longer see it, which is precisely when their own policy would
 * stop them.
 */
create or replace function public.hide_event(p_party_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  holders int;
  hidden int;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select group_id into gid from public.parties where id = p_party_id;
  if gid is null then
    return 'gone'; -- already deleted by the last other person
  end if;

  if not exists (select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception 'not yours to delete';
  end if;

  insert into public.party_hidden (party_id, user_id)
  values (p_party_id, uid)
  on conflict do nothing;

  select count(*) into holders from public.group_members where group_id = gid;
  select count(*) into hidden
  from public.party_hidden h
  join public.group_members m on m.group_id = gid and m.user_id = h.user_id
  where h.party_id = p_party_id;

  if hidden >= holders then
    delete from public.parties where id = p_party_id;
    return 'deleted';
  end if;

  return 'hidden';
end;
$$;

grant execute on function public.hide_event(uuid) to authenticated;

/**
 * Leaving a group must not strand an event that everyone remaining has already
 * hidden — the count it was waiting for just got smaller.
 */
create or replace function public.sweep_hidden_events(gid uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  removed int;
begin
  with holders as (select count(*) as n from public.group_members where group_id = gid),
  done as (
    select p.id
    from public.parties p
    join holders on true
    where p.group_id = gid
      and holders.n > 0
      and (
        select count(*)
        from public.party_hidden h
        join public.group_members m on m.group_id = gid and m.user_id = h.user_id
        where h.party_id = p.id
      ) >= holders.n
  )
  delete from public.parties where id in (select id from done);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

grant execute on function public.sweep_hidden_events(uuid) to authenticated;
