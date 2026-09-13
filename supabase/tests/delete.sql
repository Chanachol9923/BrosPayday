-- Deleting an event takes it out of your history only, and the row survives while
-- anyone still wants it. Two people share one event; each deletes in turn.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('11110000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','del-a@brospayday.invalid','',now(),now(),now(),'{}','{}'),
 ('22220000-0000-4000-8000-000000000022','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','del-b@brospayday.invalid','',now(),now(),now(),'{}','{}'),
 ('33330000-0000-4000-8000-000000000099','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','del-c@brospayday.invalid','',now(),now(),now(),'{}','{}');

create temporary table findings (seq serial, check_name text, passed boolean, detail text);
grant all on findings to authenticated, anon;
grant usage, select on sequence findings_seq_seq to authenticated, anon;

-- A makes a group and an event, B joins
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000011","role":"authenticated"}';

create temporary table ctx as select (public.create_group('Shared')).id as gid;
grant all on ctx to authenticated;

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select '33330000-0000-4000-8000-000000000033', gid, 'Shared night', current_date, 'THB',
       '11110000-0000-4000-8000-000000000011' from ctx;

insert into public.party_people (id, party_id, name, sort_order)
values ('44440000-0000-4000-8000-000000000044','33330000-0000-4000-8000-000000000033','Q',0);

insert into public.expenses (id, party_id, name, amount, payer_id, sort_order, created_by)
values ('55550000-0000-4000-8000-000000000055','33330000-0000-4000-8000-000000000033','Pork',40000,
        '44440000-0000-4000-8000-000000000044',0,'11110000-0000-4000-8000-000000000011');

set local request.jwt.claims = '{"sub":"22220000-0000-4000-8000-000000000022","role":"authenticated"}';
insert into public.group_members (group_id, user_id) select gid, '22220000-0000-4000-8000-000000000022' from ctx;

insert into findings (check_name, passed, detail)
select 'both can see it to begin with', count(*) = 1, count(*) || ' visible to B'
from public.parties where id = '33330000-0000-4000-8000-000000000033';

-- ── A deletes ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000011","role":"authenticated"}';
insert into findings (check_name, passed, detail)
select 'A deleting reports it only hidden', public.hide_event('33330000-0000-4000-8000-000000000033') = 'hidden',
       public.hide_event('33330000-0000-4000-8000-000000000033');

insert into findings (check_name, passed, detail)
select 'A can no longer see it', count(*) = 0, count(*) || ' visible to A'
from public.parties where id = '33330000-0000-4000-8000-000000000033';

set local request.jwt.claims = '{"sub":"22220000-0000-4000-8000-000000000022","role":"authenticated"}';
insert into findings (check_name, passed, detail)
select 'B still has it', count(*) = 1, count(*) || ' visible to B'
from public.parties where id = '33330000-0000-4000-8000-000000000033';

insert into findings (check_name, passed, detail)
select 'and its expenses survive', count(*) = 1, count(*) || ' expenses'
from public.expenses where party_id = '33330000-0000-4000-8000-000000000033';

-- ── B deletes too: now it should go for good ───────────────────────────────
insert into findings (check_name, passed, detail)
select 'the last person deleting removes it', public.hide_event('33330000-0000-4000-8000-000000000033') = 'deleted',
       'hide_event returned that';

reset role;
insert into findings (check_name, passed, detail)
select 'the row is gone from the database', count(*) = 0, count(*) || ' rows left'
from public.parties where id = '33330000-0000-4000-8000-000000000033';

insert into findings (check_name, passed, detail)
select 'its expenses went with it', count(*) = 0, count(*) || ' expenses left'
from public.expenses where party_id = '33330000-0000-4000-8000-000000000033';

-- ── an outsider cannot delete someone else's event ─────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11110000-0000-4000-8000-000000000011","role":"authenticated"}';
insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select '66660000-0000-4000-8000-000000000066', gid, 'Second night', current_date, 'THB',
       '11110000-0000-4000-8000-000000000011' from ctx;

set local request.jwt.claims = '{"sub":"33330000-0000-4000-8000-000000000099","role":"authenticated"}';
do $$
begin
  perform public.hide_event('66660000-0000-4000-8000-000000000066');
  insert into findings (check_name, passed, detail) values ('a stranger cannot delete it', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail) values ('a stranger cannot delete it', true, 'refused');
end $$;

reset role;
insert into findings (check_name, passed, detail)
select 'it survived the stranger', count(*) = 1, count(*) || ' rows'
from public.parties where id = '66660000-0000-4000-8000-000000000066';

select seq, case when passed then 'ok  ' else 'FAIL' end as result, check_name, detail
from findings order by seq;

rollback;
