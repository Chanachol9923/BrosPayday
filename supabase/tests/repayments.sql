-- What has actually been repaid, and who is allowed to say so.
--
-- Two things are under test here. First, that a repayment is stored, read back and
-- logged like any other change. Second, the rule that an edit link is view-only
-- until somebody signs in: a link that changes what other people owe must have a
-- name behind it, while a view link stays open to anyone with the URL.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('a1110000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','owner@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Owner"}'),
 ('b2220000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','guest@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Invited Guest"}'),
 ('c9990000-0000-4000-8000-0000000000c9','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','stranger@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Stranger"}');

create temporary table findings (seq serial, check_name text, passed boolean, detail text);
grant all on findings to authenticated, anon;
grant usage, select on sequence findings_seq_seq to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000a1","role":"authenticated"}';

create temporary table ctx as select (public.create_group('Repay crew')).id as gid;
grant all on ctx to authenticated, anon;

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select 'c3330000-0000-4000-8000-0000000000c3', gid, 'Settled night', current_date, 'THB',
       'a1110000-0000-4000-8000-0000000000a1' from ctx;

-- Q and M, from the party this app was built to settle.
insert into public.party_people (id, party_id, name, sort_order)
values ('d4440000-0000-4000-8000-0000000000d4','c3330000-0000-4000-8000-0000000000c3','Q',0),
       ('d5550000-0000-4000-8000-0000000000d5','c3330000-0000-4000-8000-0000000000c3','M',1);

-- ── a repayment is an ordinary, recorded change ───────────────────────────
insert into public.repayments (party_id, from_person, to_person, amount_paid, updated_by)
values ('c3330000-0000-4000-8000-0000000000c3','d5550000-0000-4000-8000-0000000000d5',
        'd4440000-0000-4000-8000-0000000000d4', 50000, auth.uid());

insert into findings (check_name, passed, detail)
select 'a repayment is stored against the pair it belongs to', count(*) = 1,
       coalesce(max(amount_paid::text), 'none')
from public.repayments
where party_id = 'c3330000-0000-4000-8000-0000000000c3'
  and from_person = 'd5550000-0000-4000-8000-0000000000d5';

insert into findings (check_name, passed, detail)
select 'recording it says who paid whom, and how much', count(*) = 1,
       coalesce(max(actor_name || ' · ' || subject || ' · ' || amount), 'none')
from public.event_log
where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'recorded_repayment';

-- the same figure written again is not a new story
update public.repayments set amount_paid = 50000
where party_id = 'c3330000-0000-4000-8000-0000000000c3';
insert into findings (check_name, passed, detail)
select 'writing the same figure again is not logged twice', count(*) = 1, count(*) || ' entries'
from public.event_log
where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'recorded_repayment';

-- and a real change is
update public.repayments set amount_paid = 74000
where party_id = 'c3330000-0000-4000-8000-0000000000c3';
insert into findings (check_name, passed, detail)
select 'changing the figure is logged', count(*) = 2, count(*) || ' entries'
from public.event_log
where party_id = 'c3330000-0000-4000-8000-0000000000c3' and action = 'recorded_repayment';

-- the amount cannot be negative, whatever the client does
do $$
begin
  update public.repayments set amount_paid = -1
  where party_id = 'c3330000-0000-4000-8000-0000000000c3';
  insert into findings (check_name, passed, detail)
  values ('a repayment cannot be negative', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a repayment cannot be negative', true, 'refused');
end $$;

-- ── who may read and write one ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"c9990000-0000-4000-8000-0000000000c9","role":"authenticated"}';
insert into findings (check_name, passed, detail)
select 'someone outside the event cannot read repayments', count(*) = 0, count(*) || ' visible'
from public.repayments where party_id = 'c3330000-0000-4000-8000-0000000000c3';

do $$
begin
  insert into public.repayments (party_id, from_person, to_person, amount_paid)
  values ('c3330000-0000-4000-8000-0000000000c3','d4440000-0000-4000-8000-0000000000d4',
          'd5550000-0000-4000-8000-0000000000d5', 999);
  insert into findings (check_name, passed, detail)
  values ('someone outside the event cannot record one', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('someone outside the event cannot record one', true, 'refused');
end $$;

-- ── the links ─────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000a1","role":"authenticated"}';

create temporary table codes as
select public.event_share_code('c3330000-0000-4000-8000-0000000000c3','edit') as edit_code,
       public.event_share_code('c3330000-0000-4000-8000-0000000000c3','view') as view_code;
grant all on codes to authenticated, anon;

-- a view link is for anyone, signed in or not
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into findings (check_name, passed, detail)
select 'a view link still reads without signing in',
       (public.share_read(view_code) -> 'party' ->> 'title') = 'Settled night',
       coalesce(public.share_read(view_code) -> 'party' ->> 'title', 'nothing')
from codes;

insert into findings (check_name, passed, detail)
select 'a view link carries the repayments with it',
       jsonb_array_length(public.share_read(view_code) -> 'repayments') = 1,
       coalesce((public.share_read(view_code) -> 'repayments' -> 0 ->> 'amount_paid'), 'none')
from codes;

insert into findings (check_name, passed, detail)
select 'a view link says it is a view link', public.share_capability(view_code) = 'view',
       public.share_capability(view_code)
from codes;

-- an edit link, in nobody's hands
insert into findings (check_name, passed, detail)
select 'an edit link is view-only until someone signs in',
       public.share_capability(edit_code) = 'view_until_signed_in',
       public.share_capability(edit_code)
from codes;

insert into findings (check_name, passed, detail)
select 'an edit link still reads while signed out',
       (public.share_read(edit_code) -> 'party' ->> 'title') = 'Settled night',
       coalesce(public.share_read(edit_code) -> 'party' ->> 'title', 'nothing')
from codes;

do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.edit_code, jsonb_build_array(jsonb_build_object(
    'table','expenses','op','upsert','id','f6660000-0000-4000-8000-0000000000f6','order',1,
    'item', jsonb_build_object('name','Sneaked in','amount',5000,'payerId',null))));
  insert into findings (check_name, passed, detail)
  values ('a signed-out edit link cannot change anything', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-out edit link cannot change anything', true, 'refused: ' || sqlerrm);
end $$;

insert into findings (check_name, passed, detail)
select 'nothing was written by the signed-out attempt', count(*) = 0, count(*) || ' rows'
from public.expenses where party_id = 'c3330000-0000-4000-8000-0000000000c3';

insert into findings (check_name, passed, detail)
select 'a made-up code can do nothing at all', public.share_capability('not-a-real-code') = 'none',
       public.share_capability('not-a-real-code');

-- the same link, once somebody signs in
set local role authenticated;
set local request.jwt.claims = '{"sub":"b2220000-0000-4000-8000-0000000000b2","role":"authenticated"}';

insert into findings (check_name, passed, detail)
select 'signing in turns the edit link into an edit link',
       public.share_capability(edit_code) = 'edit', public.share_capability(edit_code)
from codes;

insert into findings (check_name, passed, detail)
select 'a view link does not become editable by signing in',
       public.share_capability(view_code) = 'view', public.share_capability(view_code)
from codes;

do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.view_code, jsonb_build_array(jsonb_build_object(
    'table','expenses','op','upsert','id','f7770000-0000-4000-8000-0000000000f7','order',2,
    'item', jsonb_build_object('name','Not allowed','amount',100,'payerId',null))));
  insert into findings (check_name, passed, detail)
  values ('a view link cannot write even for a signed-in person', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a view link cannot write even for a signed-in person', true, 'refused');
end $$;

do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.edit_code, jsonb_build_array(jsonb_build_object(
    'table','repayments','op','upsert',
    'fromId','d5550000-0000-4000-8000-0000000000d5',
    'toId','d4440000-0000-4000-8000-0000000000d4',
    'amountPaid', 124000)));
  insert into findings (check_name, passed, detail)
  values ('a signed-in edit link can record a repayment', true, 'written');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a signed-in edit link can record a repayment', false, 'refused: ' || sqlerrm);
end $$;

reset role;
insert into findings (check_name, passed, detail)
select 'the repayment made through the link is the one stored', count(*) = 1,
       coalesce(max(amount_paid::text), 'none')
from public.repayments
where party_id = 'c3330000-0000-4000-8000-0000000000c3' and amount_paid = 124000;

insert into findings (check_name, passed, detail)
select 'an edit through a link is attributed to the person who signed in',
       count(*) = 1, coalesce(max(actor_name), 'none')
from public.event_log
where party_id = 'c3330000-0000-4000-8000-0000000000c3'
  and action = 'recorded_repayment' and actor_id = 'b2220000-0000-4000-8000-0000000000b2';

-- clearing it through the link
set local role authenticated;
set local request.jwt.claims = '{"sub":"b2220000-0000-4000-8000-0000000000b2","role":"authenticated"}';
do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.edit_code, jsonb_build_array(jsonb_build_object(
    'table','repayments','op','delete',
    'fromId','d5550000-0000-4000-8000-0000000000d5',
    'toId','d4440000-0000-4000-8000-0000000000d4')));
end $$;

reset role;
insert into findings (check_name, passed, detail)
select 'clearing a repayment through the link removes the row', count(*) = 0, count(*) || ' rows'
from public.repayments where party_id = 'c3330000-0000-4000-8000-0000000000c3';

-- ── repayments do not outlive what they refer to ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000a1","role":"authenticated"}';

insert into public.repayments (party_id, from_person, to_person, amount_paid)
values ('c3330000-0000-4000-8000-0000000000c3','d5550000-0000-4000-8000-0000000000d5',
        'd4440000-0000-4000-8000-0000000000d4', 30000);

delete from public.party_people where id = 'd5550000-0000-4000-8000-0000000000d5';
insert into findings (check_name, passed, detail)
select 'taking someone off the split takes their repayments with them', count(*) = 0,
       count(*) || ' left'
from public.repayments where party_id = 'c3330000-0000-4000-8000-0000000000c3';

-- and the event itself can still be deleted with repayments on it
insert into public.repayments (party_id, from_person, to_person, amount_paid)
values ('c3330000-0000-4000-8000-0000000000c3','d4440000-0000-4000-8000-0000000000d4',
        'd4440000-0000-4000-8000-0000000000d4', 100);

do $$
begin
  delete from public.parties where id = 'c3330000-0000-4000-8000-0000000000c3';
  insert into findings (check_name, passed, detail)
  values ('an event with repayments on it can still be deleted', true, 'deleted');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('an event with repayments on it can still be deleted', false, 'refused: ' || sqlerrm);
end $$;

reset role;
select seq, case when passed then 'ok  ' else 'FAIL' end as result, check_name, detail
from findings order by seq;

rollback;
