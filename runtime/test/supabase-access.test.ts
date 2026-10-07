import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Emulates Supabase's API roles and its default grants: every new table/view/function/sequence in `public` is granted
// to anon and authenticated, so RLS policies (and explicit revokes) are what actually decide access.
const SUPABASE_ROLES = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`;

const migration = (name: string): string =>
  readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const BASE = ['0012_food_nutrients', '0017_agent_state', '0020_hub_auth', '0021_hub_reminders', '0022_drop_slack_tables'];
const LOCKDOWN = '20261007100000_lock_down_internal_tables';
const USAGE = '0023_hub_usage_events';
const INTERNAL = ['hub_sessions', 'agent_state', 'hub_reminders', 'hub_usage_events'];
const API_ROLES = ['anon', 'authenticated'];

async function setup(order: string[]): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_ROLES);
  for (const name of [...BASE, ...order]) await db.exec(migration(name));
  return db;
}

async function as<T>(db: PGlite, role: string, sql: string): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try { return (await db.query<T>(sql)).rows; } finally { await db.exec('reset role'); }
}

async function expectInternalOnly(db: PGlite): Promise<void> {
  for (const table of INTERNAL) {
    for (const role of API_ROLES) {
      const { rows } = await db.query(`select has_table_privilege($1, $2, 'SELECT') s, has_table_privilege($1, $2, 'INSERT') i,
        has_table_privilege($1, $2, 'UPDATE') u, has_table_privilege($1, $2, 'DELETE') d`, [role, `public.${table}`]);
      expect(rows[0], `${role} on ${table}`).toEqual({ s: false, i: false, u: false, d: false });
      await expect(as(db, role, `select * from public.${table}`), `${role} reads ${table}`).rejects.toThrow(/permission denied/);
    }
    const { rows: [rls] } = await db.query<{ on: boolean }>('select relrowsecurity as on from pg_class where oid = $1::regclass', [`public.${table}`]);
    expect(rls.on, `RLS on ${table}`).toBe(true);
  }
  const { rows: open } = await db.query(`select tablename, policyname from pg_policies where schemaname = 'public'
    and tablename = any($1) and roles && array['public','anon','authenticated']::name[]`, [INTERNAL]);
  expect(open).toEqual([]);
}

async function expectServiceRoleWorks(db: PGlite): Promise<void> {
  await as(db, 'service_role', `insert into public.hub_sessions(email, token, expires_at) values ('svc@example.test', 'svc-token', now() + interval '1 day')`);
  await as(db, 'service_role', `update public.hub_sessions set expires_at = now() where token = 'svc-token'`);
  expect(await as(db, 'service_role', `select token from public.hub_sessions where token = 'svc-token'`)).toHaveLength(1);
  await as(db, 'service_role', `delete from public.hub_sessions where token = 'svc-token'`);
  await as(db, 'service_role', `insert into public.agent_state(agent_id, key, value) values ('a', 'k', '{}') on conflict do nothing`);
  expect(await as(db, 'service_role', 'select * from public.agent_state')).toHaveLength(1);
  expect(await as(db, 'service_role', 'select * from public.hub_reminders')).toHaveLength(3);
  await as(db, 'service_role', `insert into public.hub_usage_events(feature, action) values ('voice', 'tap')`);
  expect(await as(db, 'service_role', 'select * from public.hub_usage_summary')).toHaveLength(1);
}

async function expectFoodNutrientsPublicRead(db: PGlite): Promise<void> {
  expect(await as(db, 'anon', 'select id from public.food_nutrients')).toEqual([]);
  await expect(as(db, 'anon', `insert into public.food_nutrients(id, food_name) values ('x', 'x')`)).rejects.toThrow(/row-level security/);
}

async function expectUsageViewInternal(db: PGlite): Promise<void> {
  const { rows: [view] } = await db.query<{ opts: string[] }>(`select reloptions as opts from pg_class where oid = 'public.hub_usage_summary'::regclass`);
  expect(view.opts).toContain('security_invoker=true');
  for (const role of API_ROLES) {
    await expect(as(db, role, 'select * from public.hub_usage_summary')).rejects.toThrow(/permission denied/);
  }
}

describe('internal table access: production order (lockdown applied before 0023)', () => {
  let db: PGlite;
  beforeAll(async () => { db = await setup([]); }, 30000);
  afterAll(async () => { await db.close(); });

  it('reproduces the vulnerability before the fix', async () => {
    expect(await as(db, 'anon', 'select * from public.hub_reminders')).toHaveLength(3);
    await as(db, 'anon', `insert into public.hub_sessions(email, token, expires_at) values ('x@example.test', 'forged', now() + interval '1 day')`);
    expect(await as(db, 'authenticated', 'select token from public.hub_sessions')).toEqual([{ token: 'forged' }]);
    await db.exec(`delete from public.hub_sessions`);
  });

  it('locks hub_sessions, agent_state and hub_reminders to service_role', async () => {
    await db.exec(migration(LOCKDOWN));
    await db.exec(migration(USAGE));
    await expectInternalOnly(db);
    await expectServiceRoleWorks(db);
    await expectUsageViewInternal(db);
  });

  it('keeps food_nutrients public-read and write-protected', async () => {
    await expectFoodNutrientsPublicRead(db);
  });

  it('is idempotent and changes no data', async () => {
    const before = await db.query('select count(*)::int n from public.hub_reminders');
    await db.exec(migration(LOCKDOWN));
    await db.exec(migration(LOCKDOWN));
    expect((await db.query('select count(*)::int n from public.hub_reminders')).rows).toEqual(before.rows);
    await expectInternalOnly(db);
  });
});

describe('internal table access: fresh install order (0023 then lockdown)', () => {
  let db: PGlite;
  beforeAll(async () => { db = await setup([USAGE]); }, 30000);
  afterAll(async () => { await db.close(); });

  it('0023 creates hub_usage_events and its view internal-only on its own', async () => {
    for (const role of API_ROLES) {
      await expect(as(db, role, 'select * from public.hub_usage_events')).rejects.toThrow(/permission denied/);
    }
    const { rows } = await db.query(`select policyname from pg_policies where tablename = 'hub_usage_events'`);
    expect(rows).toEqual([]);
    await expectUsageViewInternal(db);
  });

  it('after the lockdown every internal table is service_role only', async () => {
    await db.exec(migration(LOCKDOWN));
    await expectInternalOnly(db);
    await expectServiceRoleWorks(db);
    await expectFoodNutrientsPublicRead(db);
  });
});

describe('lockdown migration on an environment without the optional tables', () => {
  it('skips absent tables and views without error', async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_ROLES);
    await expect(db.exec(migration(LOCKDOWN))).resolves.toBeDefined();
    await db.close();
  });
});
