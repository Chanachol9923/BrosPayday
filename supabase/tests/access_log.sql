-- Who can reach an event, removing one of them, and the record of what everyone did.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('a1110000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','owner@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Owner"}'),
 ('b2220000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mate@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Mate"}');

create temporary table findings (seq serial, check_name text, passed boolean, detail text);
grant all on findings to authenticated, anon;
grant usage, select on sequence findings_seq_seq to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000a1","role":"authenticated"}';

create temporary table ctx as select (public.create_group('Log crew')).id as gid;
alter table ctx add column code text;
update ctx set code = (select join_code from public.groups where id = ctx.gid);
grant all on ctx to authenticated;

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select 'c3330000-0000-4000-8000-0000000000c3', gid, 'Logged night', current_date, 'THB',
       'a1110000-0000-4000-8000-0000000000a1' from ctx;

insert into public.party_people (id, party_id, name, sort_order)
values ('d4440000-0000-4000-8000-0000000000d4','c3330000-0000-4000-8000-0000000000c3','Q',0);

insert into public.expenses (id, party_id, name, amount, payer_id, sort_order, created_by)
values ('e5550000-0000-4000-8000-0000000000e5','c3330000-0000-4000-8000-0000000000c3','Pork',40000,
        'd4440000-0000-4000-8000-0000000000d4',0,'a1110000-0000-4000-8000-0000000000a1');

-- ── the log records what happened, and who ────────────────────────────────
insert into findings (check_name, passed, detail)
select 'creating the event is logged', count(*) = 1, count(*) || ' row'
from public.event_log where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'created_event';

insert into findings (check_name, passed, detail)
select 'adding an expense is logged with who and how much',
       count(*) = 1, coalesce(max(actor_name || ' · ' || subject || ' · ' || amount), 'none')
from public.event_log
where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'added_expense';

-- a no-op update should not clutter it
update public.expenses set name = 'Pork' where id = 'e5550000-0000-4000-8000-0000000000e5';
insert into findings (check_name, passed, detail)
select 'an update that changes nothing is not logged', count(*) = 0, count(*) || ' rows'
from public.event_log where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'changed_expense';

update public.expenses set amount = 45000 where id = 'e5550000-0000-4000-8000-0000000000e5';
insert into findings (check_name, passed, detail)
select 'a real change is logged', count(*) = 1, count(*) || ' row'
from public.event_log where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'changed_expense';

-- ── an edit through a link is attributed, not lost ────────────────────────
--
-- An edit link needs an account behind it, which is what makes this worth having:
-- the log can say who, by name, even though they are not on the event.
create temporary table codes as
select public.event_share_code('c3330000-0000-4000-8000-0000000000c3','edit') as edit_code;
grant all on codes to anon, authenticated;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.edit_code, jsonb_build_array(jsonb_build_object(
    'table','expenses','op','upsert','id','f6660000-0000-4000-8000-0000000000f6','order',1,
    'item', jsonb_build_object('name','Ice','amount',5000,'payerId','d4440000-0000-4000-8000-0000000000d4'))));
  insert into findings (check_name, passed, detail)
  values ('a link cannot make a change nobody can be named for', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a link cannot make a change nobody can be named for', true, 'refused');
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b2220000-0000-4000-8000-0000000000b2","role":"authenticated"}';
do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.edit_code, jsonb_build_array(jsonb_build_object(
    'table','expenses','op','upsert','id','f6660000-0000-4000-8000-0000000000f6','order',1,
    'item', jsonb_build_object('name','Ice','amount',5000,'payerId','d4440000-0000-4000-8000-0000000000d4'))));
end $$;

reset role;
insert into findings (check_name, passed, detail)
select 'an edit made with a link is attributed to whoever signed in',
       count(*) = 1, coalesce(max(actor_name), 'none')
from public.event_log
where party_id = 'c3330000-0000-4000-8000-0000000000c3'
  and action = 'added_expense' and subject = 'Ice'
  and actor_id = 'b2220000-0000-4000-8000-0000000000b2';

-- ── who can reach it ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b2220000-0000-4000-8000-0000000000b2","role":"authenticated"}';
do $$
declare c record;
begin
  select * into c from ctx;
  perform public.join_group_by_code(c.code);
end $$;

set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000a1","role":"authenticated"}';
insert into findings (check_name, passed, detail)
select 'both people show as having access', count(*) = 2,
       string_agg(display_name || case when is_owner then ' (owner)' else '' end, ', ')
from public.event_access('c3330000-0000-4000-8000-0000000000c3');

-- ── removing someone ──────────────────────────────────────────────────────
select public.set_event_ban('c3330000-0000-4000-8000-0000000000c3','b2220000-0000-4000-8000-0000000000b2', true);

set local request.jwt.claims = '{"sub":"b2220000-0000-4000-8000-0000000000b2","role":"authenticated"}';
insert into findings (check_name, passed, detail)
select 'a removed person loses sight of the event', count(*) = 0, count(*) || ' visible'
from public.parties where id = 'c3330000-0000-4000-8000-0000000000c3';

do $$
begin
  insert into public.expenses (id, party_id, name, amount, sort_order)
  values ('07770000-0000-4000-8000-000000000077','c3330000-0000-4000-8000-0000000000c3','sneaky',1,9);
  insert into findings (check_name, passed, detail) values ('a removed person cannot write', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail) values ('a removed person cannot write', true, 'refused');
end $$;

-- and cannot remove the person who removed them
do $$
begin
  perform public.set_event_ban('c3330000-0000-4000-8000-0000000000c3','a1110000-0000-4000-8000-0000000000a1', true);
  insert into findings (check_name, passed, detail) values ('only the owner can remove people', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail) values ('only the owner can remove people', true, 'refused');
end $$;

set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000a1","role":"authenticated"}';
do $$
begin
  perform public.set_event_ban('c3330000-0000-4000-8000-0000000000c3','a1110000-0000-4000-8000-0000000000a1', true);
  insert into findings (check_name, passed, detail) values ('the owner cannot remove themselves', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail) values ('the owner cannot remove themselves', true, 'refused');
end $$;

insert into findings (check_name, passed, detail)
select 'removing is recorded in the log', count(*) = 1, coalesce(max(actor_name || ' removed ' || subject), 'none')
from public.event_log where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'removed_member';

-- ── and putting them back ─────────────────────────────────────────────────
select public.set_event_ban('c3330000-0000-4000-8000-0000000000c3','b2220000-0000-4000-8000-0000000000b2', false);

set local request.jwt.claims = '{"sub":"b2220000-0000-4000-8000-0000000000b2","role":"authenticated"}';
insert into findings (check_name, passed, detail)
select 'restoring gives the event back', count(*) = 1, count(*) || ' visible'
from public.parties where id = 'c3330000-0000-4000-8000-0000000000c3';

insert into findings (check_name, passed, detail)
select 'the log is readable by people with access', count(*) > 0, count(*) || ' entries'
from public.event_log where party_id = 'c3330000-0000-4000-8000-0000000000c3';

reset role;
select seq, case when passed then 'ok  ' else 'FAIL' end as result, check_name, detail
from findings order by seq;

rollback;
