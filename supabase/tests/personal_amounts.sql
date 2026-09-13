-- An amount one person carried alone, stored beside their share of the rest.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('a1110000-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','own-a@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Owner"}'),
 ('b2220000-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','own-b@brospayday.invalid','',now(),now(),now(),'{}','{"full_name":"Invited"}');

create temporary table findings (seq serial, check_name text, passed boolean, detail text);
grant all on findings to authenticated, anon;
grant usage, select on sequence findings_seq_seq to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000e1","role":"authenticated"}';

create temporary table ctx as select (public.create_group('Karaoke crew')).id as gid;
grant all on ctx to authenticated;

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select 'c3330000-0000-4000-8000-0000000000e3', gid, 'Karaoke night', current_date, 'THB',
       'a1110000-0000-4000-8000-0000000000e1' from ctx;

insert into public.party_people (id, party_id, name, sort_order) values
 ('d4440000-0000-4000-8000-0000000000a1','c3330000-0000-4000-8000-0000000000e3','A',0),
 ('d4440000-0000-4000-8000-0000000000b1','c3330000-0000-4000-8000-0000000000e3','B',1),
 ('d4440000-0000-4000-8000-0000000000c1','c3330000-0000-4000-8000-0000000000e3','C',2),
 ('d4440000-0000-4000-8000-0000000000d1','c3330000-0000-4000-8000-0000000000e3','D',3);

-- the room was 300 and A had 20 of snacks on the same bill
insert into public.expenses (id, party_id, name, amount, payer_id, sort_order, created_by)
values ('e5550000-0000-4000-8000-0000000000e5','c3330000-0000-4000-8000-0000000000e3',
        'Karaoke room', 30000, 'd4440000-0000-4000-8000-0000000000b1', 0,
        'a1110000-0000-4000-8000-0000000000e1');

insert into public.expense_shares (expense_id, person_id, weight, extra) values
 ('e5550000-0000-4000-8000-0000000000e5','d4440000-0000-4000-8000-0000000000a1',1,2000),
 ('e5550000-0000-4000-8000-0000000000e5','d4440000-0000-4000-8000-0000000000b1',1,0),
 ('e5550000-0000-4000-8000-0000000000e5','d4440000-0000-4000-8000-0000000000c1',1,0);

insert into findings (check_name, passed, detail)
select 'an amount carried alone is stored on the share row', count(*) = 1,
       coalesce(max(extra::text), 'none')
from public.expense_shares
where expense_id = 'e5550000-0000-4000-8000-0000000000e5' and extra > 0;

insert into findings (check_name, passed, detail)
select 'a share row with nothing set aside defaults to zero, not null', count(*) = 2, count(*) || ' rows'
from public.expense_shares
where expense_id = 'e5550000-0000-4000-8000-0000000000e5' and extra = 0;

-- rows written before the column existed read as zero, which is what they were
insert into public.expense_shares (expense_id, person_id, weight)
values ('e5550000-0000-4000-8000-0000000000e5','d4440000-0000-4000-8000-0000000000d1',1);
insert into findings (check_name, passed, detail)
select 'a share written without one reads as zero', count(*) = 1, coalesce(max(extra::text), 'none')
from public.expense_shares
where expense_id = 'e5550000-0000-4000-8000-0000000000e5'
  and person_id = 'd4440000-0000-4000-8000-0000000000d1';

do $$
begin
  update public.expense_shares set extra = -1
  where expense_id = 'e5550000-0000-4000-8000-0000000000e5'
    and person_id = 'd4440000-0000-4000-8000-0000000000a1';
  insert into findings (check_name, passed, detail)
  values ('an amount carried alone cannot be negative', false, 'allowed');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('an amount carried alone cannot be negative', true, 'refused');
end $$;

-- ── it travels with a link, both ways ─────────────────────────────────────
create temporary table codes as
select public.event_share_code('c3330000-0000-4000-8000-0000000000e3','view') as view_code,
       public.event_share_code('c3330000-0000-4000-8000-0000000000e3','edit') as edit_code;
grant all on codes to authenticated, anon;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into findings (check_name, passed, detail)
select 'a link shows what one person had to themselves',
       (public.share_read(view_code) #>> '{expenses,0,shares}')::jsonb @> '[{"extra": 2000}]'::jsonb,
       coalesce(public.share_read(view_code) #>> '{expenses,0,shares}', 'none')
from codes;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b2220000-0000-4000-8000-0000000000e2","role":"authenticated"}';

-- Somebody editing through an invite rewrites the share rows wholesale. If the
-- writer dropped the column, everyone's personal amounts would silently go to zero.
do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.edit_code, jsonb_build_array(jsonb_build_object(
    'table','expense_shares','expenseId','e5550000-0000-4000-8000-0000000000e5',
    'shares', jsonb_build_array(
      jsonb_build_object('personId','d4440000-0000-4000-8000-0000000000a1','weight',1,'extra',2000),
      jsonb_build_object('personId','d4440000-0000-4000-8000-0000000000b1','weight',2,'extra',0),
      jsonb_build_object('personId','d4440000-0000-4000-8000-0000000000c1','weight',1,'extra',500)
    ))));
end $$;

reset role;
insert into findings (check_name, passed, detail)
select 'an edit through a link keeps the personal amounts',
       count(*) = 2, string_agg(person_id::text || '=' || extra, ', ' order by extra desc)
from public.expense_shares
where expense_id = 'e5550000-0000-4000-8000-0000000000e5' and extra > 0;

insert into findings (check_name, passed, detail)
select 'and the weight alongside it', count(*) = 1, coalesce(max(weight::text), 'none')
from public.expense_shares
where expense_id = 'e5550000-0000-4000-8000-0000000000e5'
  and person_id = 'd4440000-0000-4000-8000-0000000000b1' and weight = 2;

do $$
declare c record;
begin
  select * into c from codes;
  perform public.share_write(c.edit_code, jsonb_build_array(jsonb_build_object(
    'table','expense_shares','expenseId','e5550000-0000-4000-8000-0000000000e5',
    'shares', jsonb_build_array(
      jsonb_build_object('personId','d4440000-0000-4000-8000-0000000000a1','weight',1,'extra',-99)
    ))));
end $$;

reset role;
insert into findings (check_name, passed, detail)
select 'a negative amount arriving through a link is floored at zero', count(*) = 1,
       coalesce(max(extra::text), 'none')
from public.expense_shares
where expense_id = 'e5550000-0000-4000-8000-0000000000e5' and extra = 0;

-- ── and does not outlive the person ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1110000-0000-4000-8000-0000000000e1","role":"authenticated"}';

delete from public.party_people where id = 'd4440000-0000-4000-8000-0000000000a1';
insert into findings (check_name, passed, detail)
select 'taking someone off the split removes their share row with it', count(*) = 0, count(*) || ' left'
from public.expense_shares
where expense_id = 'e5550000-0000-4000-8000-0000000000e5'
  and person_id = 'd4440000-0000-4000-8000-0000000000a1';

reset role;
select seq, case when passed then 'ok  ' else 'FAIL' end as result, check_name, detail
from findings order by seq;

rollback;
