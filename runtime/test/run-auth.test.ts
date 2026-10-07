import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Route-level auth through the real registry and run route. DB writes are recorded, Supabase reads return nothing,
// and every outbound fetch is captured so no portal or Slack request can leave the test.
const shared = vi.hoisted(() => ({ persisted: [] as Array<{ op: string; data: unknown }>, fetched: [] as string[] }));
const TOKEN = 'operator-token-for-tests-0123456789abcdef';

vi.mock('../src/lib/env.js', () => ({
  getEnv: vi.fn(() => ({
    AGENT_OPERATOR_TOKEN: TOKEN, SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'k',
    ASSIGNMENT_RADAR_THRESHOLD: 70,
  })),
}));

vi.mock('../src/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/client.js')>();
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
  return { ...actual, SupabaseDbClient: RecordingDb };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'order', 'in', 'maybeSingle', 'single']) chain[m] = (): unknown => chain;
    chain.range = (): Promise<unknown> => Promise.resolve({ data: [], error: null });
    return chain;
  }),
}));

const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn((url: string | URL) => {
  shared.fetched.push(String(url));
  return Promise.reject(new Error('network disabled in tests'));
}) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

import Fastify from 'fastify';
import { runRoutes } from '../src/routes/run.js';
import { assignmentRadarAgent } from '../src/agents/assignment-radar/index.js';

const app = Fastify();
await app.register(runRoutes);

const post = async (agent: string, body: Record<string, unknown>, token?: string): Promise<{ code: number; json: Record<string, unknown> }> => {
  const res = await app.inject({ method: 'POST', url: `/run/${agent}`, payload: body, headers: token ? { 'x-operator-token': token } : {} });
  return { code: res.statusCode, json: res.json() };
};

beforeEach(() => { shared.persisted.length = 0; shared.fetched.length = 0; });

describe('assignment-radar requires the operator token', () => {
  it('is declared operator-only', () => {
    expect(assignmentRadarAgent.requiresOperator).toBe(true);
  });

  it('A/D: no token → 401 and no run row, no network', async () => {
    const r = await post('assignment-radar', { input: { threshold: 70 }, dryRun: false, publish: true });
    expect(r.code).toBe(401);
    expect(r.json).toMatchObject({ status: 'error', error: 'Unauthorized: this agent requires an operator token' });
    expect(shared.persisted).toEqual([]);
    expect(shared.fetched).toEqual([]);
  });

  it('B/D: wrong token → 401 and no run row, no network', async () => {
    const r = await post('assignment-radar', { input: { threshold: 70 }, dryRun: false, publish: true }, 'wrong-token-wrong-token-wrong-token-00');
    expect(r.code).toBe(401);
    expect(shared.persisted).toEqual([]);
    expect(shared.fetched).toEqual([]);
  });

  it('C: correct token is accepted and reaches the agent', async () => {
    const r = await post('assignment-radar', { input: { sources: ['__not_a_source__'] }, dryRun: true }, TOKEN);
    expect(r.code).toBe(200);
    expect(r.json).toMatchObject({ agentName: 'assignment-radar', agentVersion: '0.2.1', status: 'error' });
    expect(String(r.json.error)).toContain('invalid_enum_value');
  });

  it('E: an authorized dryRun runs the radar without DB writes or Slack', async () => {
    const r = await post('assignment-radar', { input: { threshold: 70 }, dryRun: true, publish: false }, TOKEN);
    expect(r.code).toBe(200);
    expect(r.json).toMatchObject({ status: 'ok', runId: expect.stringMatching(/^dry-run-/) });
    expect(r.json.output).toMatchObject({ posted: 0, new: 0 });
    expect(shared.persisted).toEqual([]);
    expect(shared.fetched.length).toBeGreaterThan(0); // portals were attempted (and blocked)...
    expect(shared.fetched.some(u => u.includes('slack.com'))).toBe(false); // ...Slack never was
  });
});

describe('other agents are unchanged', () => {
  it('F: harold still requires the token; with it, the request passes auth', async () => {
    expect((await post('harold', { input: { action: 'recall', query: 'x' }, dryRun: true })).code).toBe(401);
    expect((await post('harold', { input: { action: 'recall', query: 'x' }, dryRun: true }, 'nope')).code).toBe(401);
    const ok = await post('harold', { input: { action: 'not-an-action' }, dryRun: true }, TOKEN);
    expect(ok.code).toBe(200);
    expect(ok.json).toMatchObject({ agentName: 'harold', status: 'error' });
    expect(shared.persisted).toEqual([]);
  });

  it('G: non-operator agents still run without a token', async () => {
    const r = await post('release-notes', { input: {} });
    expect(r.code).not.toBe(401);
    expect(r.json).toMatchObject({ agentName: 'release-notes' });
    expect(shared.persisted.some(p => p.op === 'createRun')).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/agents' });
    expect(list.statusCode).toBe(200);
    expect(list.json().agents).toEqual(expect.arrayContaining(['assignment-radar', 'harold', 'release-notes']));
  });
});
