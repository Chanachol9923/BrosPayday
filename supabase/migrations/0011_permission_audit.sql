-- Closing what a permission audit turned up.
--
-- Every table already had row-level security on and no policy let everything
-- through. These are the gaps that only show up when you stop reading the
-- policies and start trying things as the roles the browser actually uses.

-- ── 1. joining a workspace is something you are invited to ────────────────
--
-- The insert policy on group_members only asked that the row be about yourself,
-- which is not the same as being allowed in: anyone signed in who came by a
-- workspace id could add themselves to it and read everything inside. A id is
-- not a secret, only a number that is hard to guess, and that is not a control.
--
-- The two ways in stay exactly as they were — create_group makes you the first
-- member, join_group_by_code puts you in if you have the code — and both run as
-- the definer, so they are unaffected by this. Nothing else may write the table.
-- The app only ever reads it and deletes its own row (leaving), both of which
-- keep their policies.

drop policy if exists "you may add yourself to a group" on public.group_members;

-- ── 2. a function that deletes has to know who is asking ──────────────────
--
-- sweep_hidden_events removes events everybody has deleted for themselves. It
-- had no caller check at all, and a signed-out caller could run it against any
-- workspace id. In practice it can only finish a deletion the members had
-- already asked for between them, but a SECURITY DEFINER function that deletes
-- rows on the word of a stranger is not something to leave standing.

create or replace function public.sweep_hidden_events(gid uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  removed int;
begin
  if not public.is_group_member(gid) then
    raise exception 'not yours to sweep';
  end if;

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

-- Same treatment for the way in: without this a signed-out caller reached a
-- not-null violation instead of an answer.
create or replace function public.join_group_by_code(code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  gid uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in before joining a workspace';
  end if;

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

-- ── 3. say out loud that a removed person cannot write ────────────────────
--
-- They already could not: an UPDATE or DELETE has to find its row first, and the
-- read policy excludes them. But that is a consequence of another policy rather
-- than a statement of intent, and the next person to touch these will not know
-- it. Now each policy answers the question it is actually being asked.

drop policy if exists "group members update parties" on public.parties;
create policy "group members update parties"
  on public.parties for update
  using (public.is_group_member(group_id) and not public.is_banned_from(id, auth.uid()))
  with check (public.is_group_member(group_id) and not public.is_banned_from(id, auth.uid()));

drop policy if exists "group members delete parties" on public.parties;
create policy "group members delete parties"
  on public.parties for delete
  using (public.is_group_member(group_id) and not public.is_banned_from(id, auth.uid()));

-- ── 4. privileges row-level security never sees ───────────────────────────
--
-- Tables are granted to anon and authenticated so that RLS can do the gating.
-- TRUNCATE is the one write RLS is not consulted about: whoever holds it empties
-- the table outright, policies or no policies. PostgREST offers no way to ask
-- for one, so this was never reachable from the browser key — but it costs
-- nothing to take away, and REFERENCES and TRIGGER are no use to either role
-- either.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- ── 5. functions a signed-out caller has no business calling ──────────────
--
-- The project grants execute on everything in public to both roles by default,
-- which is why the grants in earlier migrations looked narrower than reality.
-- Each of these already turns a signed-out caller away by itself; this makes the
-- refusal happen at the door instead.
--
-- Deliberately left callable by anon: share_read, share_capability and
-- share_party_id, because a view link has to work with no account at all, and
-- share_write, which does its own checking and must be able to say why. The
-- helpers that appear inside policy expressions stay granted too — a policy is
-- evaluated as the querying role, and revoking those would turn "you see
-- nothing" into "permission denied".

revoke execute on function public.create_group(text) from anon;
revoke execute on function public.join_group_by_code(text) from anon;
revoke execute on function public.set_event_ban(uuid, uuid, boolean) from anon;
revoke execute on function public.hide_event(uuid) from anon;
revoke execute on function public.sweep_hidden_events(uuid) from anon;
revoke execute on function public.event_access(uuid) from anon;

-- Trigger functions are not an API. They only make sense with a row in hand.
revoke execute on function public.log_expense_change() from anon, authenticated;
revoke execute on function public.log_person_change() from anon, authenticated;
revoke execute on function public.log_party_change() from anon, authenticated;
revoke execute on function public.log_ban_change() from anon, authenticated;
revoke execute on function public.log_repayment_change() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;

-- ── 6. the photo bucket takes photos ──────────────────────────────────────
--
-- It was private, which is the part that matters, but it accepted a file of any
-- type and any size from anyone who could reach a workspace. The app uploads
-- JPEGs it has already squeezed to about 180KB; five megabytes is room to spare
-- and still a ceiling.

update storage.buckets
set file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'party-photos';
