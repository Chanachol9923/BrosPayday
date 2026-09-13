-- End-to-end check of the policies, by impersonating two signed-in users the way
-- PostgREST does: set the role, set the JWT claims, then act. Everything created
-- here is removed at the end, so the project is left exactly as it was found.

begin;

-- two throwaway users --------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-probe-a@brospayday.invalid', '',
   now(), now(), now(), '{"provider":"email"}', '{"full_name":"Probe A"}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-probe-b@brospayday.invalid', '',
   now(), now(), now(), '{"provider":"email"}', '{"full_name":"Probe B"}'),
  ('cccccccc-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-probe-c@brospayday.invalid', '',
   now(), now(), now(), '{"provider":"email"}', '{"full_name":"Probe C"}');

create temporary table findings (seq serial, check_name text, passed boolean, detail text);
-- the probes run as other roles, so they need to be able to record what they found
grant all on findings to authenticated, anon;
grant usage, select on sequence findings_seq_seq to authenticated, anon;

-- ── A creates a crew and a party ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.groups (id, name, join_code, created_by)
values ('11111111-0000-4000-8000-000000000001', 'Probe crew', 'PRB123',
        'aaaaaaaa-0000-4000-8000-000000000001');
-- Membership is not something you write directly, even for yourself: the two
-- ways in are create_group and the join code, both of which run as the definer.
select public.join_group_by_code('PRB123');

insert into public.parties (id, group_id, title, party_date, currency_code, created_by)
values ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
        'Probe party', current_date, 'THB', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.party_people (id, party_id, name, sort_order) values
  ('33333333-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'Q', 0),
  ('33333333-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 'M', 1);

insert into public.expenses (id, party_id, name, amount, payer_id, sort_order, created_by) values
  ('44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'Pork',   40000, '33333333-0000-4000-8000-000000000001', 0, 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 'Booze', 66000, '33333333-0000-4000-8000-000000000001', 1, 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.expense_shares (expense_id, person_id, weight) values
  ('44444444-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001', 1),
  ('44444444-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', 1);

insert into findings (check_name, passed, detail)
select 'A sees the party they made', count(*) = 1, count(*) || ' row'
from public.parties where id = '22222222-0000-4000-8000-000000000001';

insert into findings (check_name, passed, detail)
select 'A sees both expenses', count(*) = 2, count(*) || ' rows'
from public.expenses where party_id = '22222222-0000-4000-8000-000000000001';

-- ── B is a stranger and must see nothing ───────────────────────────────────
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

insert into findings (check_name, passed, detail)
select 'a stranger sees no parties', count(*) = 0, count(*) || ' rows visible'
from public.parties where id = '22222222-0000-4000-8000-000000000001';

insert into findings (check_name, passed, detail)
select 'a stranger sees no expenses', count(*) = 0, count(*) || ' rows visible'
from public.expenses where party_id = '22222222-0000-4000-8000-000000000001';

insert into findings (check_name, passed, detail)
select 'a stranger sees no people', count(*) = 0, count(*) || ' rows visible'
from public.party_people where party_id = '22222222-0000-4000-8000-000000000001';

insert into findings (check_name, passed, detail)
select 'a stranger cannot see the crew', count(*) = 0, count(*) || ' rows visible'
from public.groups where id = '11111111-0000-4000-8000-000000000001';

-- a stranger must not be able to write into someone else's party either
do $$
begin
  insert into public.expenses (id, party_id, name, amount, sort_order)
  values ('44444444-0000-4000-8000-0000000000ff', '22222222-0000-4000-8000-000000000001', 'injected', 999, 9);
  insert into findings (check_name, passed, detail) values ('a stranger cannot insert an expense', false, 'the insert SUCCEEDED');
exception when insufficient_privilege or others then
  insert into findings (check_name, passed, detail) values ('a stranger cannot insert an expense', true, 'refused: ' || sqlerrm);
end $$;

-- ── B joins with the code and now sees everything ──────────────────────────
select public.join_group_by_code('PRB123');

insert into findings (check_name, passed, detail)
select 'after joining, B sees the party', count(*) = 1, count(*) || ' row'
from public.parties where id = '22222222-0000-4000-8000-000000000001';

insert into findings (check_name, passed, detail)
select 'after joining, B sees both expenses', count(*) = 2, count(*) || ' rows'
from public.expenses where party_id = '22222222-0000-4000-8000-000000000001';

-- and can add what they bought
insert into public.expenses (id, party_id, name, amount, payer_id, sort_order, created_by)
values ('44444444-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000001',
        'Ice', 5000, '33333333-0000-4000-8000-000000000002', 2, 'bbbbbbbb-0000-4000-8000-000000000002');

insert into findings (check_name, passed, detail)
select 'a crew member can add an expense', count(*) = 3, count(*) || ' expenses now'
from public.expenses where party_id = '22222222-0000-4000-8000-000000000001';

-- ── share links ────────────────────────────────────────────────────────────
insert into public.party_shares (token, party_id, role, created_by) values
  ('probe-view-token', '22222222-0000-4000-8000-000000000001', 'view', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('probe-edit-token', '22222222-0000-4000-8000-000000000001', 'edit', 'bbbbbbbb-0000-4000-8000-000000000002');

-- now act as a complete outsider holding only a link
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into findings (check_name, passed, detail)
select 'a view link reads the party',
       (public.share_read('probe-view-token') -> 'expenses') is not null
         and jsonb_array_length(public.share_read('probe-view-token') -> 'expenses') = 3,
       jsonb_array_length(public.share_read('probe-view-token') -> 'expenses') || ' expenses returned';

do $$
begin
  perform public.share_write('probe-view-token', '[]'::jsonb);
  insert into findings (check_name, passed, detail) values ('a view link cannot write', false, 'the write SUCCEEDED');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('a view link cannot write, and is not told to sign in',
          sqlerrm not like '%sign in%', 'refused: ' || sqlerrm);
end $$;

-- An edit link changes what other people owe, so it needs a name behind it.
-- Signed out it reads and nothing more; signed in it does the job it was sent for.
do $$
begin
  perform public.share_write('probe-edit-token', jsonb_build_array(
    jsonb_build_object('table','expenses','op','upsert','id','44444444-0000-4000-8000-000000000009',
                       'order',9,'item', jsonb_build_object('name','Signed out','amount',100,'payerId',null))
  ));
  insert into findings (check_name, passed, detail)
  values ('an edit link cannot write until someone signs in', false, 'the write SUCCEEDED');
exception when others then
  insert into findings (check_name, passed, detail)
  values ('an edit link cannot write until someone signs in', true, 'refused: ' || sqlerrm);
end $$;

insert into findings (check_name, passed, detail)
select 'the signed-out attempt left the party untouched',
       jsonb_array_length(public.share_read('probe-view-token') -> 'expenses') = 3,
       jsonb_array_length(public.share_read('probe-view-token') -> 'expenses') || ' expenses';

-- C is signed in and on nothing: no crew, no party, only the link.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';

select public.share_write('probe-edit-token', jsonb_build_array(
  jsonb_build_object('table','expenses','op','upsert','id','44444444-0000-4000-8000-000000000004',
                     'order',3,'item', jsonb_build_object('name','Snacks','amount',12000,'payerId','33333333-0000-4000-8000-000000000002'))
));

insert into findings (check_name, passed, detail)
select 'a signed-in edit link can add what they bought',
       jsonb_array_length(public.share_read('probe-view-token') -> 'expenses') = 4,
       jsonb_array_length(public.share_read('probe-view-token') -> 'expenses') || ' expenses now';

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- an edit link must not reach a different party
insert into findings (check_name, passed, detail)
select 'an edit link cannot reach another party', count(*) = 0, count(*) || ' rows'
from public.parties where id <> '22222222-0000-4000-8000-000000000001';

do $$
begin
  perform public.share_write('nope-not-a-real-token', '[]'::jsonb);
  insert into findings (check_name, passed, detail) values ('an unknown token is refused', false, 'it was accepted');
exception when others then
  insert into findings (check_name, passed, detail) values ('an unknown token is refused', true, 'refused');
end $$;

-- ── results, then leave no trace ───────────────────────────────────────────
reset role;
select seq, case when passed then 'ok  ' else 'FAIL' end as result, check_name, detail
from findings order by seq;

rollback;
