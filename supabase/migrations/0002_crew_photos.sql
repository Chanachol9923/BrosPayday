-- Payment QRs belong to a crew, not to any one party.
--
-- The policies in 0001 read the first path segment as a party id, which is right
-- for receipts (<party_id>/<photo_id>) but has nowhere to put the QR image a
-- person adds once and reuses every party. Those live under crew/<group_id>/…
-- instead, and need their own rule: membership of that group rather than access
-- to a party.

create or replace function public.storage_path_allows(name text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case
    -- crew/<group_id>/<file>
    when (storage.foldername(name))[1] = 'crew'
      then public.is_group_member(nullif((storage.foldername(name))[2], '')::uuid)
    -- <party_id>/<file>
    else public.can_touch_party(nullif((storage.foldername(name))[1], '')::uuid)
  end;
$$;

drop policy if exists "group members read photos" on storage.objects;
create policy "group members read photos" on storage.objects for select
  using (bucket_id = 'party-photos' and public.storage_path_allows(name));

drop policy if exists "group members upload photos" on storage.objects;
create policy "group members upload photos" on storage.objects for insert
  with check (bucket_id = 'party-photos' and public.storage_path_allows(name));

drop policy if exists "group members delete photos" on storage.objects;
create policy "group members delete photos" on storage.objects for delete
  using (bucket_id = 'party-photos' and public.storage_path_allows(name));

drop policy if exists "group members update photos" on storage.objects;
create policy "group members update photos" on storage.objects for update
  using (bucket_id = 'party-photos' and public.storage_path_allows(name))
  with check (bucket_id = 'party-photos' and public.storage_path_allows(name));

-- A malformed path must fail closed rather than error out mid-policy.
create or replace function public.storage_path_allows(name text)
returns boolean
language plpgsql
stable
security definer set search_path = public
as $$
declare
  parts text[];
begin
  parts := storage.foldername(name);
  if array_length(parts, 1) is null then
    return false;
  end if;

  if parts[1] = 'crew' then
    if array_length(parts, 1) < 2 then return false; end if;
    return public.is_group_member(parts[2]::uuid);
  end if;

  return public.can_touch_party(parts[1]::uuid);
exception when others then
  return false;
end;
$$;
