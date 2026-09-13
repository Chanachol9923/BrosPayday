-- An inventory of what the database actually allows, read from the live catalogue
-- rather than from the migrations. Migrations say what was intended; this says
-- what is deployed.
--
-- Read-only. Nothing here changes anything.

-- ── 1. every table, and whether row-level security is on ──────────────────
select
  'TABLES' as section,
  c.relname as name,
  case when c.relrowsecurity then 'RLS on' else '*** RLS OFF ***' end as rls,
  case when c.relforcerowsecurity then 'forced' else '' end as forced,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::text
    || ' policies' as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- ── 2. every policy, in full ──────────────────────────────────────────────
select
  'POLICIES' as section,
  tablename as name,
  cmd,
  coalesce(array_to_string(roles, ','), '') as who,
  coalesce(qual, '—') as using_expr,
  coalesce(with_check, '—') as check_expr,
  policyname
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- ── 3. any policy that lets everything through ────────────────────────────
select
  'WIDE OPEN' as section,
  tablename as name,
  policyname,
  cmd,
  coalesce(qual, '') as using_expr,
  coalesce(with_check, '') as check_expr
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by tablename;

-- ── 4. functions: how they run, and who may call them ─────────────────────
select
  'FUNCTIONS' as section,
  p.proname as name,
  case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end as runs_as,
  case
    when not p.prosecdef then ''
    when array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path%' then 'search_path set'
    else '*** NO search_path ***'
  end as hardening,
  coalesce((
    select string_agg(r.rolname, ',' order by r.rolname)
    from pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ), 'nobody') as callable_by,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- ── 5. direct table grants, which bypass nothing but are worth seeing ─────
select
  'TABLE GRANTS' as section,
  table_name as name,
  grantee,
  string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- ── 6. storage: buckets and their policies ────────────────────────────────
select 'BUCKETS' as section, id as name,
       case when public then '*** PUBLIC ***' else 'private' end as visibility,
       coalesce(file_size_limit::text, 'no limit') as size_limit,
       coalesce(array_to_string(allowed_mime_types, ','), 'any type') as detail
from storage.buckets
order by id;

select
  'STORAGE POLICIES' as section,
  policyname as name,
  cmd,
  coalesce(array_to_string(roles, ','), '') as who,
  coalesce(qual, '—') as using_expr,
  coalesce(with_check, '—') as check_expr
from pg_policies
where schemaname = 'storage'
order by policyname;
