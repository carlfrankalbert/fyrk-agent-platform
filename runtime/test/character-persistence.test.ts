import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Everything the run route/runAgent persists (agent_runs insert/update, artifacts) is captured here.
const shared = vi.hoisted(() => ({
  persisted: [] as Array<{ op: string; data: unknown }>,
  backend: null as unknown,
}));
const TOKEN = 'operator-token-for-tests-0123456789';

vi.mock('../src/lib/env.js', () => ({
  getEnv: vi.fn(() => ({ AGENT_OPERATOR_TOKEN: TOKEN, SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k' })),
}));

vi.mock('../src/db/client.js', () => {
  class RecordingDb {
    createRun(run: Record<string, unknown>): Promise<unknown> {
      shared.persisted.push({ op: 'createRun', data: run });
      return Promise.resolve({ ...run, id: globalThis.crypto.randomUUID(), created_at: '', finished_at: null });
    }
    updateRun(id: string, updates: Record<string, unknown>): Promise<unknown> {
      shared.persisted.push({ op: 'updateRun', data: updates });
      return Promise.resolve({ id, ...updates });
    }
    createArtifact(artifact: Record<string, unknown>): Promise<unknown> {
      shared.persisted.push({ op: 'createArtifact', data: artifact });
      return Promise.resolve({ ...artifact, id: globalThis.crypto.randomUUID(), created_at: '' });
    }
  }
  return { SupabaseDbClient: RecordingDb, NullDbClient: RecordingDb };
});

vi.mock('../src/agents/registry.js', async () => {
  const { createCharacterAgent } = await import('../src/agents/character/index.js');
  const agent = createCharacterAgent({ name: 'character', backend: () => shared.backend as never });
  return { getAgent: (name: string) => (name === 'character' ? agent : undefined), listAgents: () => ['character'] };
});

import Fastify from 'fastify';
import { runRoutes } from '../src/routes/run.js';
import { InMemoryCharacterStore } from '../src/agents/character/store.js';
import { CharacterFileSchema, upsertCharacter } from '../src/agents/character/bootstrap.js';
import { persistedCharacterInput } from '../src/agents/character/persistence.js';
import type { CharacterModel } from '../src/agents/character/index.js';

const example = CharacterFileSchema.parse(JSON.parse(readFileSync(new URL('../../examples/characters/example-character.json', import.meta.url), 'utf8')));

const SECRET_FACT = "Marta's uncle was born on 12 May 1938.";
const SECRET_VALUE = 'Marta Example secretly hates jazz.';
const PRIVATE_VALUES = ['1938', 'uncle was born', 'hates jazz', 'slow kettles', 'Placeholder Town', 'aunt', '1950', '25 years'];

const model: CharacterModel = {
  json<T>(schema: { parse(v: unknown): T }, req: { label: string; user: string }): Promise<T> {
    const last = req.user.split('\n').at(-1);
    if (req.label === 'Memory classification') {
      return Promise.resolve(schema.parse(last === SECRET_FACT
        ? { touchesLockedCanon: false, memories: [{ memoryType: 'fact', memoryKey: 'family.uncle.birth_date',
          value: { summary: "Marta Example's uncle was born on 12 May 1938.", date: '1938-05-12', recursYearly: true } }] }
        : { touchesLockedCanon: true, lockedKeys: ['identity.age'], memories: [] }));
    }
    if (req.label === 'Recall planning') return Promise.resolve(schema.parse({ keyPrefixes: ['family'] }));
    return Promise.resolve(schema.parse({
      imagePrompt: 'Recurring flat, grinder on the counter.', captionOptions: ['New grinder.', 'It grinds.', 'Fine.'],
      continuityChecklist: [], usedMemoryIds: [], revealsMemoryIds: [],
      memoryCandidates: [{ memoryType: 'episode', memoryKey: 'coffee.grinder.purchase', value: { summary: 'Bought a grinder.' } }],
    }));
  },
};

let store: InMemoryCharacterStore;
const app = Fastify();
await app.register(runRoutes);

async function call(input: Record<string, unknown>): Promise<{ status: string; output: Record<string, unknown>; error?: string; runId: string }> {
  const res = await app.inject({ method: 'POST', url: '/run/character', headers: { 'x-operator-token': TOKEN },
    payload: { input: { character: 'marta-example', ...input } } });
  return res.json();
}
const persistedText = (): string => JSON.stringify(shared.persisted);
function expectNoPrivateValues(): void {
  const text = persistedText();
  for (const v of PRIVATE_VALUES) expect(text, `persisted run data contains "${v}"`).not.toContain(v);
}
const persistedRun = (op: 'createRun' | 'updateRun'): Record<string, unknown> =>
  shared.persisted.filter(p => p.op === op).at(-1)?.data as Record<string, unknown>;

beforeEach(async () => {
  store = new InMemoryCharacterStore();
  shared.backend = { store, model };
  await upsertCharacter(store, example, '2026-10-07');
  shared.persisted.length = 0;
});

describe('character runs do not duplicate private values into run history', () => {
  it('remember (natural language): response and memory have the fact, agent_runs only metadata', async () => {
    const res = await call({ action: 'remember', text: SECRET_FACT, date: '2026-10-07' });
    expect(res.status).toBe('ok');
    const stored = store.memories.find(m => m.memoryKey === 'family.uncle.birth_date');
    expect(stored?.value.summary).toContain('1938');
    expect(stored?.sourceRunId).toBe(res.runId);

    expect(persistedRun('createRun').input).toEqual({ redacted: true, action: 'remember', character: 'marta-example',
      inputKind: 'text', date: '2026-10-07', sourceRunId: null, memories: null });
    expect(persistedRun('updateRun')).toMatchObject({ status: 'completed', finished_at: expect.any(String),
      output: { action: 'remember', written: [{ id: stored?.id, memoryType: 'fact', memoryKey: 'family.uncle.birth_date', operation: 'inserted' }] } });
    expect(shared.persisted.some(p => p.op === 'createArtifact')).toBe(false);
    expectNoPrivateValues();
  });

  it('remember (structured): keeps keys/types/source run, drops values', async () => {
    const sourceRunId = '44444444-4444-4444-8444-444444444444';
    const res = await call({ action: 'remember', sourceRunId, memories: [
      { memoryType: 'preference', memoryKey: 'music.jazz', value: { summary: SECRET_VALUE, stance: 'hate' } }] });
    expect(res.status).toBe('ok');
    expect(persistedRun('createRun').input).toMatchObject({ inputKind: 'structured', sourceRunId,
      memories: [{ memoryType: 'preference', memoryKey: 'music.jazz', audienceVisibility: 'private' }] });
    expectNoPrivateValues();
  });

  it('recall (internal): operator response contains the private answer, agent_runs only ids/counts/scope', async () => {
    await call({ action: 'remember', text: SECRET_FACT, date: '2026-10-07' });
    shared.persisted.length = 0;
    const res = await call({ action: 'recall', query: 'What do we know about her uncle and aunt?' });
    expect(JSON.stringify(res.output)).toContain('1938');
    expect(persistedRun('createRun').input).toMatchObject({ action: 'recall', hasQuery: true, keyPrefixes: [] });
    expect(persistedRun('updateRun').output).toEqual({ redacted: true, action: 'recall', characterId: expect.any(String),
      scope: 'internal', asOf: null, matchedCount: 2, memoryIds: res.output.memoryIds, unrevealedMemoryIds: null });
    expectNoPrivateValues();
  });

  it('recall (audience) and mark_public persist ids and metadata only', async () => {
    await call({ action: 'remember', text: SECRET_FACT, date: '2026-10-07' });
    const id = store.memories.find(m => m.memoryKey === 'family.uncle.birth_date')?.id;
    const audience = await call({ action: 'recall', keyPrefixes: ['family.uncle'], scope: 'audience' });
    expect(persistedRun('updateRun').output).toMatchObject({ scope: 'audience', matchedCount: 0, unrevealedMemoryIds: [id] });
    expect(audience.output.unrevealedMemoryIds).toEqual([id]);

    await call({ action: 'mark_public', memoryIds: [id], revealedAt: '2027-05-12' });
    expect(persistedRun('createRun').input).toMatchObject({ action: 'mark_public', memoryIds: [id], revealedAt: '2027-05-12' });
    expect(persistedRun('updateRun').output).toMatchObject({ updated: [{ id, memoryKey: 'family.uncle.birth_date', revealedAt: '2027-05-12' }] });
    expectNoPrivateValues();
  });

  it('create_content keeps the proposal but not canon or loaded private memory context', async () => {
    const res = await call({ action: 'create_content', scene: 'Marta buys a grinder', date: '2026-10-11' });
    expect(res.status).toBe('ok');
    expect(persistedRun('updateRun').output).toMatchObject({ imagePrompt: expect.any(String), captionOptions: expect.any(Array),
      memoryCandidates: [expect.objectContaining({ memoryKey: 'coffee.grinder.purchase' })], usedMemoryIds: [] });
    expect(shared.persisted.filter(p => p.op === 'createArtifact')).toHaveLength(1);
    expectNoPrivateValues();
  });

  it('failures persist the reason without the private statement', async () => {
    const res = await call({ action: 'remember', text: 'Marta is actually 25 years old.' });
    expect(res.status).toBe('error');
    expect(persistedRun('updateRun')).toMatchObject({ status: 'failed', error: expect.stringContaining('identity.age') });
    expectNoPrivateValues();
  });

  it('invalid input is persisted as a minimal stub', () => {
    expect(persistedCharacterInput({ action: 'remember', text: SECRET_FACT, memories: [] })).toEqual({ redacted: true, valid: false, action: 'remember' });
    expect(persistedCharacterInput({ action: 'x; drop', text: SECRET_FACT })).toEqual({ redacted: true, valid: false, action: null });
  });
});
