import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { executeCharacter, haroldAgent, type CharacterModel } from '../src/agents/character/index.js';
import { CharacterFileSchema, upsertCharacter, type CharacterFile } from '../src/agents/character/bootstrap.js';
import { InMemoryCharacterStore } from '../src/agents/character/store.js';
import { nextAnniversary, selectForContent } from '../src/agents/character/memory.js';
import {
  CharacterInputSchema, type ContentDraft, type CharacterOutput, type MemoryClassification, type RecallPlan,
  type CreateContentOutput, type RememberOutput, type RecallOutput, type MarkPublicOutput,
} from '../src/agents/character/schemas.js';
import { runAgent } from '../src/agents/base.js';
import { createTestContext } from './helpers/claude-agent.js';

// Placeholder character only: real character state never appears in tests.
const exampleFile = CharacterFileSchema.parse(JSON.parse(readFileSync(new URL('../../examples/characters/example-character.json', import.meta.url), 'utf8')));
const SLUG = exampleFile.slug;
const RUN_ID = '11111111-1111-4111-8111-111111111111';

interface ModelCall { label: string; system: string; user: string }

/** Scripted model: classifications and plans keyed by text, content drafts built from the prompt. */
function fakeModel(script: {
  classify?: Record<string, MemoryClassification>;
  plan?: Record<string, Partial<RecallPlan>>;
  content?: (user: string) => ContentDraft;
}): CharacterModel & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    calls,
    json<T>(schema: { parse(v: unknown): T }, req: { label: string; system: string; user: string }): Promise<T> {
      calls.push(req);
      const statement = req.user.split('\n').at(-1) ?? '';
      if (req.label === 'Memory classification') return Promise.resolve(schema.parse(script.classify?.[statement]));
      if (req.label === 'Recall planning') return Promise.resolve(schema.parse(script.plan?.[statement] ?? {}));
      return Promise.resolve(schema.parse(script.content?.(req.user)));
    },
  };
}

const pref = (key: string, summary: string, stance: string): MemoryClassification =>
  ({ touchesLockedCanon: false, memories: [{ memoryType: 'preference', memoryKey: key, value: { summary, stance }, tags: ['food'] }] });

const SCRIPT = {
  classify: {
    'Marta dislikes olives.': pref('food.olives', 'Marta Example dislikes olives.', 'dislike'),
    'Marta tried good green olives and now admits she likes some olives.': {
      touchesLockedCanon: false,
      memories: [
        { memoryType: 'episode' as const, memoryKey: 'food.green_olives.tasting', value: { summary: 'Marta Example tried good green olives.' }, occurredAt: '2027-02-12' },
        { memoryType: 'preference' as const, memoryKey: 'food.olives', value: { summary: 'Marta Example likes some olives.', stance: 'likes_some' } },
      ],
    },
    "Marta's uncle was born on 12 May 1938.": {
      touchesLockedCanon: false,
      memories: [{ memoryType: 'fact' as const, memoryKey: 'family.uncle.birth_date', value: { summary: "Marta Example's uncle was born on 12 May 1938.", date: '1938-05-12', recursYearly: true }, tags: ['family', 'birthday'] }],
    },
    'Marta is actually 25 years old.': { touchesLockedCanon: true, lockedKeys: ['identity.age'], memories: [] },
  } satisfies Record<string, MemoryClassification>,
  plan: {
    'What does Marta think about olives?': { memoryKeys: ['food.olives'], terms: ['olives'] },
    'What does the audience know about her uncle?': { scope: 'audience' as const, keyPrefixes: ['family.uncle'], terms: ['uncle'] },
    'What do we internally know about her uncle?': { scope: 'internal' as const, keyPrefixes: ['family.uncle'] },
    'What do we know about her father?': { keyPrefixes: ['family.father'], terms: ['father'] },
    'What did Marta do last Christmas?': { memoryTypes: ['episode' as const], from: '2026-12-24', to: '2026-12-26' },
  },
  content: (user: string): ContentDraft => {
    const ids = [...user.matchAll(/id=([0-9a-f-]{36})/g)].map(m => m[1]);
    return {
      imagePrompt: 'Photograph of the recurring flat, rainy morning, new coffee grinder on the counter.',
      captionOptions: ['New grinder. Same rain.', 'It grinds. I approve, mostly.', 'Progress, in a small way.'],
      continuityChecklist: ['Grinder sits in the same kitchen as before'],
      memoryCandidates: [{ memoryType: 'episode', memoryKey: 'coffee.grinder.purchase', value: { summary: 'Marta Example bought a new coffee grinder.' } }],
      usedMemoryIds: [...ids.slice(0, 2), 'not-a-provided-id'],
      revealsMemoryIds: [],
    };
  },
};

let store: InMemoryCharacterStore;
let model: ReturnType<typeof fakeModel>;

async function run(input: unknown, opts: { dryRun?: boolean; today?: string } = {}): Promise<CharacterOutput> {
  const parsed = CharacterInputSchema.parse(input);
  const result = await executeCharacter(parsed, SLUG, { store, model, runId: RUN_ID, dryRun: opts.dryRun ?? false, today: opts.today ?? '2026-10-07' });
  return result.output;
}
const recall = async (query: string, extra: Record<string, unknown> = {}): Promise<RecallOutput> =>
  await run({ action: 'recall', query, ...extra }) as RecallOutput;
const remember = async (text: string, date: string): Promise<RememberOutput> =>
  await run({ action: 'remember', text, date }) as RememberOutput;

async function bootstrap(file: CharacterFile): Promise<string> {
  return (await upsertCharacter(store, file, '2026-10-07')).characterId;
}

beforeEach(() => {
  store = new InMemoryCharacterStore();
  model = fakeModel(SCRIPT);
});

describe('character bootstrap', () => {
  it('loads a generic character profile and its history from the example file', async () => {
    const summary = await upsertCharacter(store, exampleFile, '2026-10-07');
    expect(summary).toMatchObject({ slug: 'marta-example', inserted: 4, superseded: 1, unchanged: 0 });
    const profile = await store.getProfile(SLUG);
    expect(profile?.displayName).toBe('Marta Example');
    expect(profile?.privateCanon).toHaveProperty('identity');
  });

  it('is idempotent: re-running the same file changes nothing', async () => {
    await bootstrap(exampleFile);
    const again = await upsertCharacter(store, exampleFile, '2026-10-07');
    expect(again).toMatchObject({ inserted: 0, superseded: 0, unchanged: 5 });
  });
});

describe('remember / recall (definition of done)', () => {
  beforeEach(async () => { await bootstrap({ ...exampleFile, memories: [] }); });

  it('persists a new preference and recalls it as current', async () => {
    const out = await remember('Marta dislikes olives.', '2026-10-01');
    expect(out.written).toEqual([expect.objectContaining({ memoryKey: 'food.olives', operation: 'inserted' })]);
    expect(store.memories[0]).toMatchObject({ validFrom: '2026-10-01', source: 'operator', sourceRunId: RUN_ID });

    const r = await recall('What does Marta think about olives?');
    expect(r.current).toEqual(['Marta Example dislikes olives.']);
    expect(r.history).toEqual([]);
  });

  it('changing a preference supersedes the old value and keeps history', async () => {
    await remember('Marta dislikes olives.', '2026-10-01');
    const out = await remember('Marta tried good green olives and now admits she likes some olives.', '2027-02-12');
    expect(out.written.map(w => w.operation)).toEqual(['inserted', 'superseded']);

    const olives = store.memories.filter(m => m.memoryKey === 'food.olives');
    expect(olives).toHaveLength(2);
    const [old, current] = olives;
    expect(old).toMatchObject({ status: 'superseded', validFrom: '2026-10-01', validTo: '2027-02-12', supersededBy: current.id });
    expect(old.value.stance).toBe('dislike');
    expect(current).toMatchObject({ status: 'active', validFrom: '2027-02-12', validTo: null });

    const r = await recall('What does Marta think about olives?');
    expect(r.current).toEqual(['Marta Example likes some olives.']);
    expect(r.history).toEqual([
      '2026-10-01 → 2027-02-12: Marta Example dislikes olives.',
      '2027-02-12 → now: Marta Example likes some olives.',
    ]);
    expect(r.answer).toBe('Currently: Marta Example likes some olives. Previously: Marta Example dislikes olives (2026-10-01 → 2027-02-12). Episodes: 2027-02-12: Marta Example tried good green olives.');
  });

  it('recall as of an earlier date returns the value valid then', async () => {
    await remember('Marta dislikes olives.', '2026-10-01');
    await remember('Marta tried good green olives and now admits she likes some olives.', '2027-02-12');
    const r = await recall('What does Marta think about olives?', { asOf: '2026-12-01' });
    expect(r.current).toEqual(['Marta Example dislikes olives.']);
  });

  it('re-asserting the same stance is a no-op, not new history', async () => {
    await remember('Marta dislikes olives.', '2026-10-01');
    const out = await remember('Marta dislikes olives.', '2026-11-01');
    expect(out.written[0].operation).toBe('unchanged');
    expect(store.memories).toHaveLength(1);
  });

  it('rejects writes that would rewrite history backwards', async () => {
    await remember('Marta dislikes olives.', '2026-10-01');
    await expect(run({ action: 'remember', memories: [{ memoryType: 'preference', memoryKey: 'food.olives',
      value: { summary: 'x', stance: 'loves' }, validFrom: '2026-09-01' }] })).rejects.toThrow('history must move forward');
  });

  it('stores dated episodes and recalls them by date range', async () => {
    await run({ action: 'remember', memories: [
      { memoryType: 'episode', memoryKey: 'holiday.christmas_eve', value: { summary: 'Marta Example spent Christmas Eve alone and cooked cod.' }, occurredAt: '2026-12-24' },
      { memoryType: 'episode', memoryKey: 'garden.frost', value: { summary: 'First frost on the allotment.' }, occurredAt: '2026-11-20' },
    ] });
    const r = await recall('What did Marta do last Christmas?', { asOf: '2027-01-15' });
    expect(r.episodes).toEqual(['2026-12-24: Marta Example spent Christmas Eve alone and cooked cod.']);
    expect(r.memoryIds).toHaveLength(1);
  });

  it('new memories are private by default; mark_public reveals without changing content', async () => {
    await remember("Marta's uncle was born on 12 May 1938.", '2026-10-07');
    const fact = store.memories[0];
    expect(fact.audienceVisibility).toBe('private');

    const audience = await recall('What does the audience know about her uncle?');
    expect(audience.scope).toBe('audience');
    expect(audience.current).toEqual([]);
    expect(audience.answer).toMatch(/^Not publicly revealed/);
    expect(audience.unrevealedMemoryIds).toEqual([fact.id]);
    expect(JSON.stringify(audience)).not.toContain('1938');

    const internal = await recall('What do we internally know about her uncle?');
    expect(internal.current[0]).toContain('born on 12 May 1938');
    expect(internal.current[0]).toContain('next 2027-05-12, 89 years');

    const contentRun = '22222222-2222-4222-8222-222222222222';
    const before = structuredClone(store.memories[0].value);
    const marked = await run({ action: 'mark_public', memoryIds: [fact.id], revealedAt: '2027-05-12', sourceRunId: contentRun }) as MarkPublicOutput;
    expect(marked.updated).toEqual([{ id: fact.id, memoryKey: 'family.uncle.birth_date', revealedAt: '2027-05-12' }]);
    expect(store.memories[0]).toMatchObject({ audienceVisibility: 'public', revealedAt: '2027-05-12', revealedSourceRunId: contentRun });
    expect(store.memories[0].value).toEqual(before);

    const after = await recall('What does the audience know about her uncle?');
    expect(after.answer).toMatch(/^Publicly revealed:/);
    expect(after.unrevealedMemoryIds).toEqual([]);

    const again = await run({ action: 'mark_public', memoryIds: [fact.id] }) as MarkPublicOutput;
    expect(again).toMatchObject({ updated: [], alreadyPublic: [fact.id] });
  });

  it('rejects locked canon changes from natural language and structured input, writing nothing', async () => {
    await expect(remember('Marta is actually 25 years old.', '2026-10-07')).rejects.toThrow(/locked canon/);
    await expect(run({ action: 'remember', memories: [
      { memoryType: 'preference', memoryKey: 'food.cake', value: { summary: 'Marta Example likes cake.', stance: 'like' } },
      { memoryType: 'fact', memoryKey: 'identity.age', value: { summary: 'Marta Example is 25.' } },
    ] })).rejects.toThrow("'identity.age' is locked canon");
    expect(store.memories).toHaveLength(0);
    expect((await store.getProfile(SLUG))?.privateCanon).toEqual(exampleFile.privateCanon);
  });

  it('unknown family details stay unknown instead of being invented', async () => {
    const r = await recall('What do we know about her father?');
    expect(r.current).toEqual([]);
    expect(r.answer).toMatch(/^Unknown/);
    expect(model.calls.filter(c => c.label === 'Recall planning')).toHaveLength(1);
  });

  it('dry-run remember plans writes without persisting', async () => {
    const out = await run({ action: 'remember', text: 'Marta dislikes olives.', date: '2026-10-01' }, { dryRun: true }) as RememberOutput;
    expect(out).toMatchObject({ dryRun: true, written: [{ id: null, operation: 'inserted' }] });
    expect(store.memories).toHaveLength(0);
  });
});

describe('create_content', () => {
  let characterId: string;
  beforeEach(async () => { characterId = await bootstrap(exampleFile); });

  it('sends stable canon and bounded memories to the model and returns a structured proposal', async () => {
    const out = await run({ action: 'create_content', scene: 'Marta tries a new coffee grinder on a rainy Sunday morning', date: '2026-10-11' }) as CreateContentOutput;
    const call = model.calls[0];
    expect(call.label).toBe('Content generation');
    expect(call.user).toContain('slow kettles');          // private canon is used internally
    expect(call.user).toContain('green rain jacket');     // visual canon
    expect(call.system).toMatch(/UNKNOWN STAYS UNKNOWN/);

    expect(out.imagePrompt).toBeTruthy();
    expect(out.captionOptions).toHaveLength(3);
    expect(out.continuityChecklist).toEqual(expect.arrayContaining([expect.stringMatching(/approximate age/), 'Grinder sits in the same kitchen as before']));
    expect(out.memoryCandidates).toEqual([expect.objectContaining({ memoryKey: 'coffee.grinder.purchase', occurredAt: '2026-10-11' })]);
    expect(out.usedMemoryIds).not.toContain('not-a-provided-id');
    expect(out.characterId).toBe(characterId);
    expect(out.memoryCandidatesPersisted).toBe(false);
  });

  it('does not persist memory candidates', async () => {
    const before = store.memories.length;
    await run({ action: 'create_content', scene: 'Marta buys a grinder', date: '2026-10-11' });
    expect(store.memories).toHaveLength(before);
    expect(store.memories.some(m => m.memoryKey === 'coffee.grinder.purchase')).toBe(false);
  });

  it('approved candidates become history only through remember, traced to the content run', async () => {
    const out = await run({ action: 'create_content', scene: 'Marta buys a grinder', date: '2026-10-11' }) as CreateContentOutput;
    const contentRun = '33333333-3333-4333-8333-333333333333';
    await run({ action: 'remember', memories: out.memoryCandidates, sourceRunId: contentRun });
    expect(store.memories.find(m => m.memoryKey === 'coffee.grinder.purchase')).toMatchObject({
      source: 'content', sourceRunId: contentRun, occurredAt: '2026-10-11', audienceVisibility: 'private',
    });
  });

  it('keeps private canon and unrelated private memories out of output and artifacts', async () => {
    const result = await executeCharacter(CharacterInputSchema.parse({ action: 'create_content', scene: 'Marta waters tomatoes', date: '2026-10-11' }),
      SLUG, { store, model, runId: RUN_ID, dryRun: false, today: '2026-10-07' });
    const published = JSON.stringify(result);
    for (const secret of ['slow kettles', 'Placeholder Town', 'aunt', '1950']) expect(published).not.toContain(secret);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].meta).toEqual({ characterId, usedMemoryIds: expect.any(Array), revealsMemoryIds: [] });
    // The unrelated private birthday fact is not even sent to the model.
    expect(model.calls[0].user).not.toContain('aunt');
  });

  it('uses the state valid on the scene date (before a later change of mind)', async () => {
    const memories = await store.listMemories(characterId);
    const early = selectForContent(memories, 'olives at a market', '2026-02-01').memories.filter(m => m.memoryKey === 'food.olives');
    expect(early.map(m => m.value.stance)).toEqual(['dislike']);
    const later = selectForContent(memories, 'olives at a market', '2026-06-01').memories.filter(m => m.memoryKey === 'food.olives');
    expect(later.map(m => m.value.stance).sort()).toEqual(['dislike', 'likes_some']); // current + remembered history
    const future = selectForContent(memories, 'garden', '2026-01-05').memories;
    expect(future.some(m => m.memoryKey === 'garden.first_tomato')).toBe(false); // not happened yet
  });

  it('surfaces yearly anniversaries on the matching date', () => {
    expect(nextAnniversary('1938-05-12', '2027-05-12')).toEqual({ on: '2027-05-12', years: 89 });
    expect(nextAnniversary('1938-05-12', '2027-05-13')).toEqual({ on: '2028-05-12', years: 90 });
    expect(nextAnniversary('1960-02-29', '2027-03-01')).toEqual({ on: '2028-02-29', years: 68 });
  });

  it('includes the anniversary memory when the scene falls on it', async () => {
    const memories = await store.listMemories(characterId);
    const sel = selectForContent(memories, 'quiet evening', '2026-04-03');
    expect(sel.anniversaries.map(a => [a.memory.memoryKey, a.years])).toEqual([['family.aunt.birth_date', 76]]);
  });
});

describe('character agent wiring', () => {
  it('refuses to run without operator authorization', async () => {
    const result = await runAgent(haroldAgent, { action: 'recall', query: 'anything' }, createTestContext());
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/internal operator actions/);
    expect(haroldAgent.requiresOperator).toBe(true);
  });

  it('a slug-bound agent cannot be pointed at another character', async () => {
    const result = await runAgent(haroldAgent, { action: 'recall', query: 'x', character: 'marta-example' }, createTestContext({ operator: true }));
    expect(result.error).toMatch(/bound to character/);
  });
});
