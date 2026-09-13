-- One code per event, per role.
--
-- Sharing used to happen at the account level: a code let someone into everything
-- you had. Now a code belongs to one event and reaches nothing else, which is both
-- easier to explain and far less to hand over by accident.
--
-- Codes are typed by people, so they are short and use an alphabet with no I, O,
-- 0 or 1 in it. Eight characters of 32 is about 10^12 combinations — small enough
-- to read down a phone line, large enough that guessing is not a strategy.

create or replace function public.make_share_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

-- At most one live code per event per role: asking again gives you the same one
-- back rather than quietly leaving a trail of codes you cannot remember issuing.
create unique index if not exists party_shares_one_live_per_role
  on public.party_shares (party_id, role)
  where revoked_at is null;

/**
 * Get this event's code for a role, making it the first time it is asked for.
 * Runs as the caller: the policy on party_shares still decides whether they are
 * allowed anywhere near this event.
 */
create or replace function public.event_share_code(p_party_id uuid, p_role text)
returns text
language plpgsql
security invoker set search_path = public
as $$
declare
  found text;
  fresh text;
begin
  if p_role not in ('view', 'edit') then
    raise exception 'unknown role';
  end if;

  select token into found
  from public.party_shares
  where party_id = p_party_id and role = p_role and revoked_at is null;

  if found is not null then
    return found;
  end if;

  for attempt in 1..8 loop
    fresh := public.make_share_code();
    begin
      insert into public.party_shares (token, party_id, role, created_by)
      values (fresh, p_party_id, p_role, auth.uid());
      return fresh;
    exception
      when unique_violation then
        -- either the code collided, or someone else made one for this role a
        -- moment ago; re-read before trying again
        select token into found
        from public.party_shares
        where party_id = p_party_id and role = p_role and revoked_at is null;
        if found is not null then
          return found;
        end if;
    end;
  end loop;

  raise exception 'could not allocate a code';
end;
$$;

grant execute on function public.event_share_code(uuid, text) to authenticated;

-- Revoking is by event and role rather than by a token nobody has written down.
create or replace function public.revoke_event_share(p_party_id uuid, p_role text)
returns void
language sql
security invoker set search_path = public
as $$
  update public.party_shares
  set revoked_at = now()
  where party_id = p_party_id and role = p_role and revoked_at is null;
$$;

grant execute on function public.revoke_event_share(uuid, text) to authenticated;

-- Older links were long random tokens. They keep working; they are simply not
-- what gets handed out any more.
