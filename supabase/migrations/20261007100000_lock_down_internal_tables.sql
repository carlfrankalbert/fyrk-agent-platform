-- Lock internal runtime/Hub tables to service_role only.
--
-- These tables had RLS enabled but a policy `for all using (true)` with no role restriction, which applies to every
-- role. Combined with Supabase's default grants, anon and authenticated could read and write them through the REST
-- API (including hub_sessions tokens). The runtime only uses the service-role key, which bypasses RLS, so no policy
-- is needed: RLS on + no permissive policy + revoked grants = no anon/authenticated access.
--
-- Additive and idempotent: no data is changed or deleted. Objects that do not exist are skipped.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['hub_sessions', 'agent_state', 'hub_reminders', 'hub_usage_events'] loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    -- Drop every policy that applies to public/anon/authenticated, whatever it is called.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t and roles && array['public', 'anon', 'authenticated']::name[]
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;

  -- Views run with their owner's rights by default and would bypass RLS; make it invoker-scoped and internal.
  if to_regclass('public.hub_usage_summary') is not null then
    execute 'alter view public.hub_usage_summary set (security_invoker = true)';
    execute 'revoke all on table public.hub_usage_summary from anon, authenticated';
    execute 'grant select on table public.hub_usage_summary to service_role';
  end if;
end $$;
