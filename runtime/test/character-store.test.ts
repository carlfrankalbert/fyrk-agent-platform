import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const profileRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'marta-example', display_name: 'Marta Example',
  public_profile: { fictional: true }, private_canon: { identity: { age: 41 } }, visual_canon: { appearance: {} },
};
const calls: Array<[string, unknown[]]> = [];

// Minimal PostgREST-style chain: records calls and resolves to the profile row.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'maybeSingle']) {
      chain[method] = (...args: unknown[]): unknown => {
        calls.push([method, args]);
        return method === 'maybeSingle' ? Promise.resolve({ data: profileRow, error: null }) : chain;
      };
    }
    return chain;
  }),
}));

vi.mock('../src/lib/env.js', () => ({
  getEnv: vi.fn(() => ({ AGENT_OPERATOR_TOKEN: 'x'.repeat(32), SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k' })),
}));

import { SupabaseCharacterStore, InMemoryCharacterStore } from '../src/agents/character/store.js';
import { CharacterFileSchema, upsertCharacter } from '../src/agents/character/bootstrap.js';
import { isOperatorToken } from '../src/lib/operator.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });

describe('SupabaseCharacterStore', () => {
  it('loads a character profile from Supabase by slug', async () => {
    const profile = await new SupabaseCharacterStore('https://fake.supabase.co', 'service-key').getProfile('marta-example');
    expect(calls).toContainEqual(['from', ['character_profiles']]);
    expect(calls).toContainEqual(['eq', ['slug', 'marta-example']]);
    expect(profile).toEqual({
      id: profileRow.id, slug: 'marta-example', displayName: 'Marta Example', publicProfile: { fictional: true },
      privateCanon: { identity: { age: 41 } }, visualCanon: { appearance: {} },
    });
  });
});

describe('operator guard', () => {
  it('compares tokens in constant time and fails closed', () => {
    const token = 'x'.repeat(32);
    expect(isOperatorToken(token, token)).toBe(true);
    expect(isOperatorToken('x'.repeat(31), token)).toBe(false);
    expect(isOperatorToken(undefined, token)).toBe(false);
    expect(isOperatorToken(token, undefined)).toBe(false);
  });

  it('the run route rejects character agents without an operator token, before creating a run', async () => {
    const Fastify = (await import('fastify')).default;
    const { runRoutes } = await import('../src/routes/run.js');
    const app = Fastify();
    await app.register(runRoutes);
    const denied = await app.inject({ method: 'POST', url: '/run/harold', payload: { input: { action: 'recall', query: 'x' }, dryRun: true } });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ status: 'error', output: {} });
    const wrong = await app.inject({ method: 'POST', url: '/run/character', headers: { 'x-operator-token': 'nope' }, payload: { input: {} } });
    expect(wrong.statusCode).toBe(401);
    await app.close();
  });
});

describe('private character state stays out of git', () => {
  it('the engine needs no character-specific tracked data: no tracked or unignored files under private/', () => {
    const visible = `${git('ls-files')}\n${git('ls-files', '--others', '--exclude-standard')}`.split('\n');
    expect(visible.filter(f => f.startsWith('private/'))).toEqual([]);
    expect(visible.filter(f => /characters\/.+\.json$/.test(f) && !f.startsWith('examples/'))).toEqual([]);
  });

  it('bootstraps from a gitignored local file', async () => {
    const dir = `${repoRoot}private/characters`;
    const file = `${dir}/vitest-${randomUUID()}.json`;
    mkdirSync(dir, { recursive: true });
    const example = readFileSync(`${repoRoot}examples/characters/example-character.json`, 'utf8');
    writeFileSync(file, example.replace(/marta-example/g, 'vitest-character'));
    try {
      expect(() => git('check-ignore', '-q', file)).not.toThrow(); // exits non-zero if not ignored
      const store = new InMemoryCharacterStore();
      const summary = await upsertCharacter(store, CharacterFileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))), '2026-10-07');
      expect(summary).toMatchObject({ slug: 'vitest-character', inserted: 4, superseded: 1 });
      expect((await store.getProfile('vitest-character'))?.privateCanon).toHaveProperty('identity');
    } finally {
      rmSync(file);
    }
  });
});
