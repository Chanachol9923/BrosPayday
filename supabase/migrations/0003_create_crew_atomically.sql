-- Creating a crew could not read back the crew it had just created.
--
-- The client inserted the group and then inserted the membership row. But an
-- INSERT ... RETURNING has to satisfy the select policy to return anything, and
-- that policy asks whether you are a member — which you were not yet, by one
-- statement. So the insert succeeded, the read came back empty, the client saw an
-- error, and a group with no members was left behind: invisible to everyone,
-- including the person who had just made it.
--
-- Two fixes, because either alone would have been enough and both are worth having.

-- 1. Do the whole thing in one call, so a crew and its first member are created
--    together or not at all. The join code is generated here too, which keeps the
--    uniqueness retry next to the constraint it is retrying against.
create or replace function public.create_group(name text)
returns public.groups
language plpgsql
security definer set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  uid uuid := auth.uid();
  code text;
  made public.groups;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  for attempt in 1..8 loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    begin
      insert into public.groups (name, join_code, created_by)
      values (coalesce(nullif(btrim(name), ''), 'My crew'), code, uid)
      returning * into made;

      insert into public.group_members (group_id, user_id, role)
      values (made.id, uid, 'owner');

      return made;
    exception when unique_violation then
      -- that code was taken; go round again
    end;
  end loop;

  raise exception 'could not allocate a join code';
end;
$$;

grant execute on function public.create_group(text) to authenticated;

-- 2. Let people see a group they created even before the membership row lands.
--    Nothing widens here: created_by is already theirs.
drop policy if exists "you see groups you belong to" on public.groups;
create policy "you see groups you belong to"
  on public.groups for select
  using (public.is_group_member(id) or created_by = auth.uid());

-- Sweep up any crew stranded by the old path: no members, and nothing in it.
delete from public.groups g
where not exists (select 1 from public.group_members m where m.group_id = g.id)
  and not exists (select 1 from public.parties p where p.group_id = g.id);
