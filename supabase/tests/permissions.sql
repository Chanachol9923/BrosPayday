-- Things that must not be possible.
--
-- The other suites check that the app's own paths work for the right people.
-- This one goes the other way: it takes the roles PostgREST actually runs as and
-- tries the attacks the policy list suggests might be open, so a hole shows up
-- here rather than in somebody's group chat.
--
-- Everything runs inside a transaction that is rolled back.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('a0000000-0000-4000-8000-0000000000a0','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','perm-owner@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Owner"}'),
 ('b0000000-0000-4000-8000-0000000000b0','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','perm-outsider@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Outsider"}'),
 ('c0000000-0000-4000-8000-0000000000c0','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','perm-banned@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Banned"}');

create temporary table findings (seq serial, check_name text, passed boolean, detail text);
grant all on findings to authenticated, anon;
grant usage, select on sequence findings_seq_seq to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a0","role":"authenticated"}';

create temporary table ctx as select (public.create_group('Permission crew')).id as gid;
grant all on ctx to authenticated, anon;

-- the code is how anyone else is meant to get in, so keep it to hand
alter table ctx add column code text;
update ctx set code = (select join_code from public.groups where id = ctx.gid);

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select 'd0000000-0000-4000-8000-0000000000d0', gid, 'Private night', current_date, 'THB',
       'a0000000-0000-4000-8000-0000000000a0' from ctx;

insert into public.party_people (id, party_id, name, sort_order)
values ('e0000000-0000-4000-8000-0000000000e0','d0000000-0000-4000-8000-0000000000d0','Q',0);

insert into public.expenses (id, party_id, name, amount, payer_id, sort_order, created_by)
values ('f0000000-0000-4000-8000-0000000000f0','d0000000-0000-4000-8000-0000000000d0','Pork',40000,
        'e0000000-0000-4000-8000-0000000000e0',0,'a0000000-0000-4000-8000-0000000000a0');

-- Someone who joined properly and was then removed. Note that the owner cannot
-- put them in: joining is something you do to yourself, with the code.
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000000c0","role":"authenticated"}';
do $$
declare c record;
begin
  select * into c from ctx;
  perform public.join_group_by_code(c.code);
end $$;

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a0","role":"authenticated"}';
select public.set_event_ban('d0000000-0000-4000-8000-0000000000d0','c0000000-0000-4000-8000-0000000000c0', true);

-- ══ 1. TRUNCATE, which row-level security does not filter ═════════════════
--
-- Every table is granted to anon and authenticated so that RLS can do the
-- gating. TRUNCATE is the one write RLS never sees: whoever holds the privilege
-- empties the table outright. The publishable key in the browser is the anon
-- role, so this must not be grantable to it.

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

savepoint probe_truncate_anon;
do $$
begin
  truncate table public.event_log;
  insert into findings (check_name, passed, detail)
  values ('anon cannot TRUNCATE a table', false, '*** THE TABLE WAS EMPTIED ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('anon cannot TRUNCATE a table', true, 'refused');
end $$;
-- whatever happened, put the table back before anything else reads it
release savepoint probe_truncate_anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b0","role":"authenticated"}';
do $$
begin
  truncate table public.expenses cascade;
  insert into findings (check_name, passed, detail)
  values ('a signed-in stranger cannot TRUNCATE a table', false, '*** THE TABLE WAS EMPTIED ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-in stranger cannot TRUNCATE a table', true, 'refused');
end $$;

-- ══ 1b. what a signed-in stranger can see of somebody else's workspace ════

insert into findings (check_name, passed, detail)
select 'a stranger reads no parties', count(*) = 0, count(*) || ' visible' from public.parties;

insert into findings (check_name, passed, detail)
select 'a stranger reads no expenses', count(*) = 0, count(*) || ' visible' from public.expenses;

insert into findings (check_name, passed, detail)
select 'a stranger reads no people', count(*) = 0, count(*) || ' visible' from public.party_people;

insert into findings (check_name, passed, detail)
select 'a stranger reads no repayments', count(*) = 0, count(*) || ' visible' from public.repayments;

insert into findings (check_name, passed, detail)
select 'a stranger reads no share codes', count(*) = 0, count(*) || ' visible' from public.party_shares;

insert into findings (check_name, passed, detail)
select 'a stranger reads no payees', count(*) = 0, count(*) || ' visible' from public.payees;

insert into findings (check_name, passed, detail)
select 'a stranger reads no photo rows', count(*) = 0, count(*) || ' visible' from public.photos;

insert into findings (check_name, passed, detail)
select 'a stranger reads no workspaces', count(*) = 0, count(*) || ' visible' from public.groups;

insert into findings (check_name, passed, detail)
select 'a stranger reads nobody else''s profile', count(*) = 0, count(*) || ' visible'
from public.profiles where id <> 'b0000000-0000-4000-8000-0000000000b0';

insert into findings (check_name, passed, detail)
select 'a stranger reads no log', count(*) = 0, count(*) || ' visible' from public.event_log;

-- ══ 2. joining a workspace without being asked ════════════════════════════
--
-- The way in is join_group_by_code. Adding yourself to group_members directly
-- would skip the code entirely, and a group id is not a secret — it is only a
-- number somebody might come by.

do $$
declare g uuid;
begin
  select gid into g from ctx;
  insert into public.group_members (group_id, user_id)
  values (g, 'b0000000-0000-4000-8000-0000000000b0');
  insert into findings (check_name, passed, detail)
  values ('a stranger cannot add themselves to a workspace', false, '*** THEY ARE IN ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a stranger cannot add themselves to a workspace', true, 'refused');
end $$;

insert into findings (check_name, passed, detail)
select 'and still sees nothing of it', count(*) = 0, count(*) || ' parties visible'
from public.parties;

do $$
declare g uuid;
begin
  select gid into g from ctx;
  delete from public.group_members
  where group_id = g and user_id = 'b0000000-0000-4000-8000-0000000000b0';
end $$;

do $$
begin
  perform public.join_group_by_code('NOSUCH');
  insert into findings (check_name, passed, detail)
  values ('a made-up join code is refused', false, 'accepted');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a made-up join code is refused', true, 'refused');
end $$;

-- ══ 3. what a removed person can still reach ══════════════════════════════
--
-- The read policy on parties excludes them. The write policies were written
-- against group membership alone, which is not the same question.

set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000000c0","role":"authenticated"}';

insert into findings (check_name, passed, detail)
select 'a removed person sees no parties', count(*) = 0, count(*) || ' visible'
from public.parties where id = 'd0000000-0000-4000-8000-0000000000d0';

do $$
declare n int;
begin
  update public.parties set title = 'Renamed by a removed person'
  where id = 'd0000000-0000-4000-8000-0000000000d0';
  get diagnostics n = row_count;
  insert into findings (check_name, passed, detail)
  values ('a removed person cannot rename the event', n = 0,
          case when n = 0 then 'no rows changed' else '*** ' || n || ' ROWS CHANGED ***' end);
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a removed person cannot rename the event', true, 'refused');
end $$;

do $$
declare n int;
begin
  delete from public.parties where id = 'd0000000-0000-4000-8000-0000000000d0';
  get diagnostics n = row_count;
  insert into findings (check_name, passed, detail)
  values ('a removed person cannot delete the event', n = 0,
          case when n = 0 then 'no rows deleted' else '*** ' || n || ' ROWS DELETED ***' end);
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a removed person cannot delete the event', true, 'refused');
end $$;

do $$
declare n int;
begin
  update public.expenses set amount = 1 where id = 'f0000000-0000-4000-8000-0000000000f0';
  get diagnostics n = row_count;
  insert into findings (check_name, passed, detail)
  values ('a removed person cannot change an expense', n = 0,
          case when n = 0 then 'no rows changed' else '*** ' || n || ' ROWS CHANGED ***' end);
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a removed person cannot change an expense', true, 'refused');
end $$;

reset role;
insert into findings (check_name, passed, detail)
select 'the event is still there, still called what it was', count(*) = 1,
       coalesce(max(title), 'GONE')
from public.parties where id = 'd0000000-0000-4000-8000-0000000000d0' and title = 'Private night';

-- ══ 4. what signed-out callers can do to the functions ════════════════════
--
-- Every function is callable by anon, because that is how PostgREST exposes
-- them. Each one that changes anything has to turn a signed-out caller away by
-- itself; a SECURITY DEFINER function is not protected by RLS.

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  perform public.create_group('Made by nobody');
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot create a workspace', false, '*** CREATED ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot create a workspace', true, 'refused');
end $$;

do $$
begin
  perform public.hide_event('d0000000-0000-4000-8000-0000000000d0');
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot hide someone else''s event', false, '*** HIDDEN ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot hide someone else''s event', true, 'refused');
end $$;

do $$
declare g uuid;
begin
  select gid into g from ctx;
  perform public.sweep_hidden_events(g);
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot sweep a workspace', false, '*** SWEPT ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot sweep a workspace', true, 'refused');
end $$;

do $$
begin
  perform public.set_event_ban('d0000000-0000-4000-8000-0000000000d0',
                               'a0000000-0000-4000-8000-0000000000a0', true);
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot remove people', false, '*** REMOVED ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot remove people', true, 'refused');
end $$;

do $$
begin
  perform public.event_access('d0000000-0000-4000-8000-0000000000d0');
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot list who is on an event', false, '*** LISTED ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-out caller cannot list who is on an event', true, 'refused');
end $$;

-- ══ 5. the log has to be a record, not a guestbook ════════════════════════
do $$
begin
  insert into public.event_log (party_id, actor_name, action, subject)
  values ('d0000000-0000-4000-8000-0000000000d0','Someone else','added_expense','a lie');
  insert into findings (check_name, passed, detail)
  values ('nobody can write their own entry into the log', false, '*** WRITTEN ***');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('nobody can write their own entry into the log', true, 'refused');
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b0","role":"authenticated"}';
do $$
declare n int;
begin
  delete from public.event_log where party_id = 'd0000000-0000-4000-8000-0000000000d0';
  get diagnostics n = row_count;
  insert into findings (check_name, passed, detail)
  values ('a stranger cannot erase the log', n = 0,
          case when n = 0 then 'nothing deleted' else '*** ' || n || ' ENTRIES DELETED ***' end);
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a stranger cannot erase the log', true, 'refused');
end $$;

reset role;
select seq, case when passed then 'ok  ' else 'FAIL' end as result, check_name, detail
from findings order by seq;

rollback;
