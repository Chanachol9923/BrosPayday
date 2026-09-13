-- Deleting an event broke as soon as it was being logged.
--
-- Removing a party cascades to its expenses and people, and each of those fires
-- an AFTER DELETE trigger that tries to write a log row. By then the party is
-- already gone, so the log's own foreign key rejects the write and the whole
-- delete fails. Nothing could be deleted at all.
--
-- There is nothing to record in that case: the thing the log belongs to is on its
-- way out, and the log rows cascade with it. So the triggers now say nothing when
-- the parent has gone, and speak normally when a row is removed on its own.

create or replace function public.log_expense_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  act text;
  amt bigint;
  subj text;
  pid uuid := coalesce(new.party_id, old.party_id);
begin
  -- the event itself is being deleted; its log goes with it
  if tg_op = 'DELETE' and not exists (select 1 from public.parties where id = pid) then
    return old;
  end if;

  if tg_op = 'INSERT' then
    act := 'added_expense'; subj := new.name; amt := new.amount;
  elsif tg_op = 'DELETE' then
    act := 'removed_expense'; subj := old.name; amt := old.amount;
  else
    if new.name is not distinct from old.name and new.amount is not distinct from old.amount
       and new.payer_id is not distinct from old.payer_id then
      return new;
    end if;
    act := 'changed_expense'; subj := new.name; amt := new.amount;
  end if;

  insert into public.event_log (party_id, actor_id, actor_name, action, subject, amount)
  values (pid, auth.uid(), public.log_actor_name(), act, coalesce(subj, ''), amt);

  return coalesce(new, old);
end;
$$;

create or replace function public.log_person_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pid uuid := coalesce(new.party_id, old.party_id);
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.parties where id = pid) then
    return old;
  end if;

  if tg_op = 'UPDATE' and new.name is not distinct from old.name then
    return new;
  end if;

  insert into public.event_log (party_id, actor_id, actor_name, action, subject)
  values (
    pid,
    auth.uid(),
    public.log_actor_name(),
    case tg_op when 'INSERT' then 'added_person' when 'DELETE' then 'removed_person' else 'renamed_person' end,
    coalesce(new.name, old.name, '')
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.log_ban_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pid uuid := coalesce(new.party_id, old.party_id);
  who text;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.parties where id = pid) then
    return old;
  end if;

  select coalesce(nullif(display_name, ''), 'Someone') into who
  from public.profiles where id = coalesce(new.user_id, old.user_id);

  insert into public.event_log (party_id, actor_id, actor_name, action, subject)
  values (
    pid,
    auth.uid(),
    public.log_actor_name(),
    case tg_op when 'INSERT' then 'removed_member' else 'restored_member' end,
    coalesce(who, 'Someone')
  );

  return coalesce(new, old);
end;
$$;
