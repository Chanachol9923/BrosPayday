-- Per-event codes: the same code comes back on asking twice, roles are separate,
-- a code reaches only its own event, and someone outside cannot mint one.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('eeeeeeee-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','codes-a@brospayday.invalid','',now(),now(),now(),'{}','{}'),
 ('ffffffff-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','codes-b@brospayday.invalid','',now(),now(),now(),'{}','{}');

create temporary table findings (seq serial, check_name text, passed boolean, detail text);
grant all on findings to authenticated, anon;
grant usage, select on sequence findings_seq_seq to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000005","role":"authenticated"}';

select public.create_group('Owner space');

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select 'aaaa1111-0000-4000-8000-00000000000a', g.id, 'Night one', current_date, 'THB',
       'eeeeeeee-0000-4000-8000-000000000005'
from public.groups g where g.created_by = 'eeeeeeee-0000-4000-8000-000000000005';

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
select 'bbbb2222-0000-4000-8000-00000000000b', g.id, 'Night two', current_date, 'THB',
       'eeeeeeee-0000-4000-8000-000000000005'
from public.groups g where g.created_by = 'eeeeeeee-0000-4000-8000-000000000005';

insert into public.party_people (id, party_id, name, sort_order)
values ('cccc3333-0000-4000-8000-00000000000c', 'aaaa1111-0000-4000-8000-00000000000a', 'Q', 0);

insert into public.expenses (id, party_id, name, amount, payer_id, sort_order, created_by)
values ('dddd4444-0000-4000-8000-00000000000d','aaaa1111-0000-4000-8000-00000000000a','Pork',40000,
        'cccc3333-0000-4000-8000-00000000000c',0,'eeeeeeee-0000-4000-8000-000000000005');

-- ── the code is stable ─────────────────────────────────────────────────────
do $$
declare a text; b text;
begin
  a := public.event_share_code('aaaa1111-0000-4000-8000-00000000000a', 'view');
  b := public.event_share_code('aaaa1111-0000-4000-8000-00000000000a', 'view');
  insert into findings (check_name, passed, detail)
  values ('asking twice gives the same code', a = b, a || ' then ' || b);
  insert into findings (check_name, passed, detail)
  values ('the code is 8 characters', length(a) = 8, a);
  insert into findings (check_name, passed, detail)
  values ('no lookalike characters in it', a !~ '[IO01]', a);
end $$;

-- ── view and edit are different codes ──────────────────────────────────────
do $$
declare v text; e text;
begin
  v := public.event_share_code('aaaa1111-0000-4000-8000-00000000000a', 'view');
  e := public.event_share_code('aaaa1111-0000-4000-8000-00000000000a', 'edit');
  insert into findings (check_name, passed, detail)
  values ('view and edit get separate codes', v <> e, v || ' vs ' || e);
end $$;

-- ── a second event gets its own ────────────────────────────────────────────
do $$
declare one text; two text;
begin
  one := public.event_share_code('aaaa1111-0000-4000-8000-00000000000a', 'view');
  two := public.event_share_code('bbbb2222-0000-4000-8000-00000000000b', 'view');
  insert into findings (check_name, passed, detail)
  values ('each event has its own code', one <> two, one || ' vs ' || two);
end $$;

-- ── an outsider cannot mint a code for someone else's event ────────────────
set local request.jwt.claims = '{"sub":"ffffffff-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  perform public.event_share_code('aaaa1111-0000-4000-8000-00000000000a', 'edit');
  insert into findings (check_name, passed, detail)
  values ('a stranger cannot mint a code', false, 'it was allowed');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a stranger cannot mint a code', true, 'refused');
end $$;

-- ── the code reads only its own event ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000005","role":"authenticated"}';
create temporary table codes as
select public.event_share_code('aaaa1111-0000-4000-8000-00000000000a','view') as view_one,
       public.event_share_code('aaaa1111-0000-4000-8000-00000000000a','edit') as edit_one,
       public.event_share_code('bbbb2222-0000-4000-8000-00000000000b','view') as view_two;
grant all on codes to anon;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into findings (check_name, passed, detail)
select 'a code opens its own event',
       (public.share_read(view_one) #>> '{party,title}') = 'Night one',
       public.share_read(view_one) #>> '{party,title}'
from codes;

insert into findings (check_name, passed, detail)
select 'the other event''s code opens the other event',
       (public.share_read(view_two) #>> '{party,title}') = 'Night two',
       public.share_read(view_two) #>> '{party,title}'
from codes;

do $$
declare c record;
begin
  select * into c from codes;
  begin
    perform public.share_write(c.view_one, '[]'::jsonb);
    insert into findings (check_name, passed, detail) values ('a view code cannot write', false, 'allowed');
  exception when others then
    insert into findings (check_name, passed, detail) values ('a view code cannot write', true, 'refused');
  end;

  -- an edit code may add to its own event
  perform public.share_write(c.edit_one, jsonb_build_array(jsonb_build_object(
    'table','expenses','op','upsert','id','eeee5555-0000-4000-8000-00000000000e','order',1,
    'item', jsonb_build_object('name','Ice','amount',5000,'payerId','cccc3333-0000-4000-8000-00000000000c'))));
  insert into findings (check_name, passed, detail)
  select 'an edit code adds to its own event',
         jsonb_array_length(public.share_read(c.view_one) -> 'expenses') = 2,
         jsonb_array_length(public.share_read(c.view_one) -> 'expenses') || ' expenses';

  -- but must not touch the other event, even by naming its rows
  perform public.share_write(c.edit_one, jsonb_build_array(jsonb_build_object(
    'table','expenses','op','upsert','id','ffff6666-0000-4000-8000-00000000000f','order',9,
    'item', jsonb_build_object('name','sneaky','amount',99999,'payerId',null))));
  insert into findings (check_name, passed, detail)
  select 'the other event is untouched',
         jsonb_array_length(public.share_read(c.view_two) -> 'expenses') = 0,
         jsonb_array_length(public.share_read(c.view_two) -> 'expenses') || ' expenses in the other event';
end $$;

do $$
begin
  perform public.share_read('NOTACODE');
  insert into findings (check_name, passed, detail) values ('an unknown code is refused', false, 'accepted');
exception when others then
  insert into findings (check_name, passed, detail) values ('an unknown code is refused', true, 'refused');
end $$;

reset role;
select seq, case when passed then 'ok  ' else 'FAIL' end as result, check_name, detail
from findings order by seq;

rollback;
