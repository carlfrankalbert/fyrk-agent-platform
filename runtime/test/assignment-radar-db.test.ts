import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { normalize } from '../src/agents/assignment-radar/normalize.js';
import { scoreAssignment } from '../src/agents/assignment-radar/score.js';
import { AssignmentSchema, ProfileSchema } from '../src/agents/assignment-radar/schemas.js';

const db = new PGlite();
const token = randomUUID(), id = randomUUID();
const now = '2026-09-30T01:00:00.000Z';
const a = normalize('ic', { external_id: 'one', url: 'https://ic.no/oppdrag/one', title: 'Produktleder', description: 'Bank smidig', customer: 'Bank' }, now);
const score = scoreAssignment(a, ProfileSchema.parse({}), '2026-09-30');
const save = (recordId = id, observations = [a], lease = token, isNew = true) => db.query(
  'select public.assignment_radar_save($1::uuid, $2::jsonb, $3, true)',
  [lease, JSON.stringify({ id: recordId, assignment: a, observations, score }), isNew]);
const acquire = (t: string) => db.query<{ acquired: boolean }>('select public.assignment_radar_acquire($1::uuid) as acquired', [t]);
beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260930003838_assignment_radar.sql', import.meta.url), 'utf8'));
}, 20000);
afterAll(async () => { await db.close(); });
describe('radar PostgreSQL migration and transactions', () => {
  it('permits one run lease and blocks a competing run', async () => {
    expect((await acquire(token)).rows[0].acquired).toBe(true);
    expect((await acquire(randomUUID())).rows[0].acquired).toBe(false);
  });
  it('stores one canonical assignment and preserves source observations on updates', async () => {
    await save();
    const b = { ...a, source: 'kons' as const, external_id: 'two', url: 'https://kons.no/assignment/two' };
    await save(id, [{ ...a, first_seen_at: '2026-10-01T01:00:00.000Z', last_seen_at: '2026-10-01T01:00:00.000Z' }, b], token, false);
    expect((await db.query('select * from public.assignment_radar_assignments')).rows).toHaveLength(1);
    const observations = (await db.query<{ source: string; first_seen_at: Date }>('select * from public.assignment_radar_observations order by source')).rows;
    expect(observations).toHaveLength(2);
    expect(new Date(observations[0].first_seen_at).toISOString()).toBe(now);
    expect((await db.query('select * from public.assignment_radar_deliveries')).rows).toHaveLength(1);
  });
  it('rolls back the canonical insert when an identity belongs to another assignment', async () => {
    const other = randomUUID(); await expect(save(other)).rejects.toThrow('another assignment');
    expect((await db.query('select * from public.assignment_radar_assignments where id=$1', [other])).rows).toHaveLength(0);
  });
  it('accepts PostgreSQL JSON timestamps when reading saved observations', async () => {
    const result = await db.query<{ observation: unknown }>('select to_jsonb(o) as observation from public.assignment_radar_observations o order by source');
    const observation = AssignmentSchema.parse(result.rows[0].observation);
    expect(observation.first_seen_at).toBe(now);
    expect(observation.last_seen_at).toBe('2026-10-01T01:00:00.000Z');
  });
  it('atomically claims notification once and never claims sending again', async () => {
    const claim = () => db.query<{ claimed: boolean }>('select public.assignment_radar_claim($1::uuid,$2::uuid) as claimed', [token, id]);
    expect((await claim()).rows[0].claimed).toBe(true); expect((await claim()).rows[0].claimed).toBe(false);
  });
  it('does not allow writes or notification claims after lease loss', async () => {
    await expect(save(id, [a], randomUUID())).rejects.toThrow('lease lost');
    await db.exec("update public.assignment_radar_lease set expires_at = now() - interval '1 second'");
    await expect(save()).rejects.toThrow('lease lost');
    const next = randomUUID(); expect((await acquire(next)).rows[0].acquired).toBe(true);
    await db.query('select public.assignment_radar_release($1::uuid)', [token]);
    expect((await acquire(randomUUID())).rows[0].acquired).toBe(false);
    await db.query('select public.assignment_radar_release($1::uuid)', [next]);
  });
  it('enables RLS and denies anon/authenticated privileges on all tables and RPCs', async () => {
    const tables = (await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname like 'assignment_radar_%' and relkind='r'")).rows;
    expect(tables).toHaveLength(4); expect(tables.every(t => t.relrowsecurity)).toBe(true);
    for (const role of ['anon','authenticated']) {
      const checks = await db.query<{ can_read: boolean; can_execute: boolean }>("select has_table_privilege($1, 'public.assignment_radar_assignments', 'SELECT') as can_read, has_function_privilege($1, 'public.assignment_radar_save(uuid,jsonb,boolean,boolean)', 'EXECUTE') as can_execute", [role]);
      expect(checks.rows[0]).toEqual({ can_read: false, can_execute: false });
    }
    await db.exec('set role service_role');
    expect((await acquire(randomUUID())).rows[0].acquired).toBe(true);
    expect((await db.query('select * from public.assignment_radar_observations')).rows).toHaveLength(2);
    await db.exec('reset role');
  });
});
