import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toMemory } from '../src/agents/character/store.js';

const db = new PGlite();
let characterId: string;

const insertMemory = (key: string, value: object, extra: Record<string, unknown> = {}) => {
  const row = { memory_type: 'preference', valid_from: '2026-10-01', source: 'operator', ...extra };
  return db.query<{ id: string }>(
    `insert into public.character_memories(character_id, memory_key, value, memory_type, valid_from, occurred_at, source, locked)
     values ($1, $2, $3::jsonb, $4, $5::date, $6::date, $7, $8) returning id`,
    [characterId, key, JSON.stringify(value), row.memory_type, row.valid_from, row.occurred_at ?? null, row.source, row.locked ?? false]);
};
const supersede = (id: string, memory: object, allowLocked = false) => db.query<{ row: Record<string, unknown> }>(
  'select to_jsonb(public.character_memory_supersede($1::uuid, $2::jsonb, $3)) as row', [id, JSON.stringify(memory), allowLocked]);

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261007120000_character_memory.sql', import.meta.url), 'utf8'));
  const res = await db.query<{ id: string }>(
    "insert into public.character_profiles(slug, display_name, private_canon) values ('test-character', 'Test Character', '{\"identity\": {}}') returning id");
  characterId = res.rows[0].id;
}, 20000);
afterAll(async () => { await db.close(); });

describe('character memory migration', () => {
  it('enables RLS and denies anon/authenticated access to profiles, memories and the supersede RPC', async () => {
    const tables = (await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname in ('character_profiles','character_memories')")).rows;
    expect(tables).toHaveLength(2);
    expect(tables.every(t => t.relrowsecurity)).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      const checks = await db.query("select has_table_privilege($1, 'public.character_profiles', 'SELECT') as profiles, has_table_privilege($1, 'public.character_memories', 'SELECT') as memories, has_function_privilege($1, 'public.character_memory_supersede(uuid,jsonb,boolean)', 'EXECUTE') as rpc", [role]);
      expect(checks.rows[0]).toEqual({ profiles: false, memories: false, rpc: false });
    }
  });

  it('allows only one current value per key', async () => {
    await insertMemory('food.olives', { summary: 'Dislikes olives.', stance: 'dislike' });
    await expect(insertMemory('food.olives', { summary: 'Likes olives.', stance: 'like' })).rejects.toThrow(/character_memories_one_current/);
  });

  it('supersedes atomically and preserves history', async () => {
    const [{ id: oldId }] = (await db.query<{ id: string }>("select id from public.character_memories where memory_key = 'food.olives'")).rows;
    const res = await supersede(oldId, { character_id: characterId, memory_type: 'preference', memory_key: 'food.olives',
      value: { summary: 'Likes some olives.', stance: 'likes_some' }, valid_from: '2027-02-12', source: 'operator', tags: ['food'] });
    const created = toMemory(res.rows[0].row);
    expect(created).toMatchObject({ status: 'active', validFrom: '2027-02-12', validTo: null, tags: ['food'], audienceVisibility: 'private' });

    const rows = (await db.query<{ row: Record<string, unknown> }>("select to_jsonb(m) as row from public.character_memories m where memory_key = 'food.olives' order by valid_from")).rows.map(r => toMemory(r.row));
    expect(rows.map(r => [r.status, r.validFrom, r.validTo, r.value.stance])).toEqual([
      ['superseded', '2026-10-01', '2027-02-12', 'dislike'],
      ['active', '2027-02-12', null, 'likes_some'],
    ]);
    expect(rows[0].supersededBy).toBe(created.id);
  });

  it('refuses to supersede backwards in time, stale rows or locked canon', async () => {
    const current = (await db.query<{ id: string }>("select id from public.character_memories where memory_key = 'food.olives' and status = 'active'")).rows[0].id;
    const base = { character_id: characterId, memory_type: 'preference', memory_key: 'food.olives', value: { summary: 'x' }, source: 'operator' };
    await expect(supersede(current, { ...base, valid_from: '2026-01-01' })).rejects.toThrow('on or after');
    const stale = (await db.query<{ id: string }>("select id from public.character_memories where memory_key = 'food.olives' and status = 'superseded'")).rows[0].id;
    await expect(supersede(stale, { ...base, valid_from: '2027-03-01' })).rejects.toThrow('no longer current');

    const { rows: [locked] } = await insertMemory('identity.age', { summary: 'Is 41.' }, { memory_type: 'fact', locked: true });
    const lockedBase = { ...base, memory_type: 'fact', memory_key: 'identity.age', valid_from: '2027-01-01' };
    await expect(supersede(locked.id, lockedBase)).rejects.toThrow('locked canon');
    await expect(supersede(locked.id, lockedBase, true)).resolves.toBeTruthy();
  });

  it('requires occurred_at for episodes and keeps reveals consistent with visibility', async () => {
    await expect(insertMemory('cafe.visit', { summary: 'Visited a café.' }, { memory_type: 'episode', valid_from: null })).rejects.toThrow(/check/);
    await insertMemory('cafe.visit', { summary: 'Visited a café.' }, { memory_type: 'episode', valid_from: null, occurred_at: '2026-11-03' });
    await expect(insertMemory('cafe.visit', { summary: 'Same day again.' }, { memory_type: 'episode', valid_from: null, occurred_at: '2026-11-03' })).rejects.toThrow(/episode_once/);
    await expect(db.query("update public.character_memories set revealed_at = '2026-12-01' where memory_key = 'cafe.visit'")).rejects.toThrow(/check/);
    await db.query("update public.character_memories set audience_visibility = 'public', revealed_at = '2026-12-01' where memory_key = 'cafe.visit'");
  });
});
