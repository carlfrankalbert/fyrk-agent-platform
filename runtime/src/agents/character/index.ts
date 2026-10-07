import type { z } from 'zod';
import type { AgentArtifact, AgentDefinition, AgentResult } from '../base.js';
import { callClaudeJson, DEFAULT_MODEL } from '../../lib/claude-json.js';
import { getEnv } from '../../lib/env.js';
import {
  CharacterInputSchema, CharacterOutputSchema, ContentDraftSchema, MemoryClassificationSchema, RecallPlanSchema,
  type CharacterInput, type CharacterMemory, type CharacterOutput, type CharacterProfile, type CreateContentRequest,
  type MarkPublicRequest, type MemoryInput, type MemorySource, type NewMemory, type RecallPlan, type RecallRequest,
  type RememberRequest, type CreateContentOutput, type RememberOutput, type RecallOutput, type MarkPublicOutput,
} from './schemas.js';
import { keyCatalog, lockedNamespaces, planWrite, recallMemories, selectForContent } from './memory.js';
import {
  buildClassifySystemPrompt, buildClassifyUserPrompt, buildContentSystemPrompt, buildContentUserPrompt,
  buildRecallSystemPrompt, buildRecallUserPrompt,
} from './prompt.js';
import { SupabaseCharacterStore, type CharacterStore } from './store.js';
import { persistedCharacterInput, persistedCharacterOutput } from './persistence.js';

const CONTENT_MODEL = 'claude-sonnet-4-5-20250929';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CharacterModel {
  json<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, req: { tier: 'quality' | 'fast'; system: string; user: string; label: string }): Promise<T>;
}

/** Claude-backed model. Errors are reduced to a label so prompts (private state) never end up in run errors. */
export const claudeCharacterModel: CharacterModel = {
  async json(schema, req) {
    try {
      const { parsed } = await callClaudeJson(schema as z.ZodSchema<z.infer<typeof schema>>, {
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        model: req.tier === 'quality' ? CONTENT_MODEL : DEFAULT_MODEL,
        maxTokens: req.tier === 'quality' ? 4096 : 2048,
      });
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const reason = /ANTHROPIC_API_KEY|Claude API error \d+|truncated/.exec(message)?.[0] ?? 'invalid model response';
      throw new Error(`${req.label} failed: ${reason}`);
    }
  },
};

export interface CharacterDeps {
  store: CharacterStore;
  model: CharacterModel;
  runId: string;
  dryRun: boolean;
  /** Real-world today (YYYY-MM-DD); the default in-world date. */
  today: string;
}

async function loadProfile(store: CharacterStore, slug: string): Promise<CharacterProfile> {
  const profile = await store.getProfile(slug);
  if (!profile) throw new Error(`Character '${slug}' not found. Bootstrap it with: pnpm character:upsert --file <private file>`);
  return profile;
}

const BASE_CHECKLIST = [
  'Same identity and approximate age as stable canon',
  'Face, hair, facial hair, skin texture and expression match visual canon',
  'Clothing follows the established clothing language',
  'Recurring home, kitchen and view: the same place as earlier scenes, not a new interior',
  'No contradiction of current preferences/opinions on the scene date',
  'No contradiction of the public profile or previously revealed facts',
  'No accidental reveal of private memories (check revealsMemoryIds before publishing)',
  'No invented biography: family, birthdays, jobs, childhood, relationships and favourite foods stay unknown unless stored',
];

function contentArtifact(profile: CharacterProfile, out: CreateContentOutput, scene: string, runId: string): AgentArtifact {
  // The proposal itself plus ids for traceability. The loaded canon/memory context is deliberately not stored.
  const lines = [
    `# Content proposal: ${profile.displayName} (${out.date})`, '', `Scene: ${scene}`, '', '## Captions',
    ...out.captionOptions.map((c, i) => `${i + 1}. ${c}`), '', '## Image prompt', out.imagePrompt, '',
    '## Continuity checklist', ...out.continuityChecklist.map(c => `- [ ] ${c}`), '',
    '## Memory candidates (not persisted; approve via remember)',
    ...(out.memoryCandidates.length
      ? out.memoryCandidates.map(c => `- ${c.memoryType} \`${c.memoryKey}\`${c.occurredAt ? ` (${c.occurredAt})` : ''}: ${c.value.summary}`)
      : ['- none']),
    '', '## Trace', `- run: ${runId}`, `- character: ${out.characterId}`,
    `- used memories: ${out.usedMemoryIds.join(', ') || 'none'}`,
    `- reveals private memories: ${out.revealsMemoryIds.join(', ') || 'none'}`,
  ];
  return {
    kind: 'character-content',
    content: lines.join('\n'),
    meta: { characterId: out.characterId, usedMemoryIds: out.usedMemoryIds, revealsMemoryIds: out.revealsMemoryIds },
  };
}

async function createContent(input: CreateContentRequest, profile: CharacterProfile, deps: CharacterDeps): Promise<AgentResult<CharacterOutput>> {
  const date = input.date ?? deps.today;
  const memories = await deps.store.listMemories(profile.id);
  const selection = selectForContent(memories, input.scene, date, profile.displayName);
  const draft = await deps.model.json(ContentDraftSchema, {
    tier: 'quality', label: 'Content generation',
    system: buildContentSystemPrompt(),
    user: buildContentUserPrompt(profile, selection, input.scene, date),
  });

  const provided = new Map(selection.memories.map(m => [m.id, m]));
  const output: CreateContentOutput = {
    action: 'create_content',
    characterId: profile.id,
    date,
    imagePrompt: draft.imagePrompt,
    captionOptions: draft.captionOptions,
    continuityChecklist: [...new Set([...BASE_CHECKLIST, ...draft.continuityChecklist])],
    memoryCandidates: draft.memoryCandidates.map(c => (c.memoryType === 'episode' && !c.occurredAt ? { ...c, occurredAt: date } : c)),
    usedMemoryIds: [...new Set(draft.usedMemoryIds.filter(id => provided.has(id)))],
    revealsMemoryIds: [...new Set(draft.revealsMemoryIds.filter(id => provided.get(id)?.audienceVisibility === 'private'))],
    memoryCandidatesPersisted: false,
  };
  return { output, artifacts: [contentArtifact(profile, output, input.scene, deps.runId)] };
}

function toNewMemory(profile: CharacterProfile, m: MemoryInput, at: { validFrom: string | null; occurredAt: string | null },
  source: MemorySource, sourceRunId: string | null, date: string): NewMemory {
  const audienceVisibility = m.audienceVisibility ?? 'private';
  return {
    characterId: profile.id, memoryType: m.memoryType, memoryKey: m.memoryKey, value: m.value, locked: false,
    confidence: m.confidence ?? 1, validFrom: at.validFrom, occurredAt: at.occurredAt, source, sourceRunId,
    tags: m.tags ?? [], audienceVisibility, revealedAt: audienceVisibility === 'public' ? date : null,
  };
}

/** Applies memories to history. Locked canon is rejected; changed values supersede, never overwrite. */
export async function applyMemories(
  store: CharacterStore, profile: CharacterProfile, inputs: MemoryInput[],
  opts: { date: string; source: MemorySource; sourceRunId: string | null; dryRun: boolean; allowLocked: boolean },
): Promise<RememberOutput['written']> {
  const existing = await store.listMemories(profile.id);
  const locked = lockedNamespaces(profile, existing);

  // Pass 1: validate everything against a simulated history so a rejection writes nothing.
  const simulated: CharacterMemory[] = existing.map(m => ({ ...m }));
  const rejected: string[] = [];
  const preview: RememberOutput['written'] = [];
  for (const m of inputs) {
    const plan = planWrite(simulated, m, { date: opts.date, locked, allowLocked: opts.allowLocked });
    if (plan.op === 'reject') { rejected.push(plan.reason); continue; }
    if (plan.op === 'unchanged') {
      preview.push({ id: plan.existing.id, memoryType: m.memoryType, memoryKey: m.memoryKey, operation: 'unchanged' });
      continue;
    }
    if (plan.op === 'supersede') plan.previous.status = 'superseded';
    simulated.push({ ...toNewMemory(profile, m, plan.op === 'insert' ? plan : { validFrom: plan.validFrom, occurredAt: null },
      opts.source, opts.sourceRunId, opts.date), id: `pending-${simulated.length}`, status: 'active', validTo: null,
      supersededBy: null, revealedSourceRunId: null });
    preview.push({ id: null, memoryType: m.memoryType, memoryKey: m.memoryKey,
      operation: plan.op === 'insert' ? 'inserted' : 'superseded', ...(plan.op === 'supersede' ? { supersededId: plan.previous.id } : {}) });
  }
  if (rejected.length) throw new Error(`Rejected: ${rejected.join('; ')}`);
  if (opts.dryRun) return preview;

  // Pass 2: write against live history.
  const live = existing;
  const written: RememberOutput['written'] = [];
  for (const m of inputs) {
    const plan = planWrite(live, m, { date: opts.date, locked, allowLocked: opts.allowLocked });
    if (plan.op === 'reject') throw new Error(`Rejected: ${plan.reason}`);
    if (plan.op === 'unchanged') {
      written.push({ id: plan.existing.id, memoryType: m.memoryType, memoryKey: m.memoryKey, operation: 'unchanged' });
      continue;
    }
    const at = plan.op === 'insert' ? plan : { validFrom: plan.validFrom, occurredAt: null };
    const row = toNewMemory(profile, m, at, opts.source, opts.sourceRunId, opts.date);
    if (plan.op === 'insert') {
      const stored = await store.insertMemory(row);
      live.push(stored);
      written.push({ id: stored.id, memoryType: m.memoryType, memoryKey: m.memoryKey, operation: 'inserted' });
    } else {
      const stored = await store.supersedeMemory(plan.previous.id, row, opts.allowLocked);
      Object.assign(plan.previous, { status: 'superseded', validTo: plan.validFrom, supersededBy: stored.id });
      live.push(stored);
      written.push({ id: stored.id, memoryType: m.memoryType, memoryKey: m.memoryKey, operation: 'superseded', supersededId: plan.previous.id });
    }
  }
  return written;
}

async function remember(input: RememberRequest, profile: CharacterProfile, deps: CharacterDeps): Promise<AgentResult<CharacterOutput>> {
  const date = input.date ?? deps.today;
  let inputs: MemoryInput[];
  if (input.text) {
    const existing = await deps.store.listMemories(profile.id);
    const classified = await deps.model.json(MemoryClassificationSchema, {
      tier: 'fast', label: 'Memory classification',
      system: buildClassifySystemPrompt(),
      user: buildClassifyUserPrompt(profile.displayName, input.text, date, lockedNamespaces(profile, existing), keyCatalog(existing)),
    });
    if (classified.touchesLockedCanon) {
      throw new Error(`Rejected: statement would change locked canon (${classified.lockedKeys?.join(', ') || 'canon'}); update canon through the private bootstrap file instead`);
    }
    if (!classified.memories.length) throw new Error('Rejected: no memory could be extracted from the statement');
    inputs = classified.memories; // model output never sets visibility: new memories are private
  } else {
    inputs = input.memories ?? [];
  }
  const runId = UUID_RE.test(deps.runId) ? deps.runId : null;
  const written = await applyMemories(deps.store, profile, inputs, {
    date, dryRun: deps.dryRun, allowLocked: false,
    source: input.memories && input.sourceRunId ? 'content' : 'operator',
    sourceRunId: input.sourceRunId ?? runId,
  });
  return { output: { action: 'remember', characterId: profile.id, dryRun: deps.dryRun, written }, artifacts: [] };
}

async function recall(input: RecallRequest, profile: CharacterProfile, deps: CharacterDeps): Promise<AgentResult<CharacterOutput>> {
  const memories = await deps.store.listMemories(profile.id);
  let plan: RecallPlan = RecallPlanSchema.parse({
    memoryKeys: input.memoryKeys, keyPrefixes: input.keyPrefixes, tags: input.tags, from: input.from, to: input.to,
  });
  if (input.query) {
    const planned = await deps.model.json(RecallPlanSchema, {
      tier: 'fast', label: 'Recall planning',
      system: buildRecallSystemPrompt(),
      user: buildRecallUserPrompt(profile.displayName, input.query, input.asOf ?? deps.today, keyCatalog(memories)),
    });
    plan = {
      scope: planned.scope,
      memoryKeys: [...plan.memoryKeys, ...planned.memoryKeys],
      keyPrefixes: [...plan.keyPrefixes, ...planned.keyPrefixes],
      tags: [...plan.tags, ...planned.tags],
      terms: planned.terms,
      memoryTypes: planned.memoryTypes,
      from: input.from ?? planned.from,
      to: input.to ?? planned.to,
    };
  }
  const scope = input.scope ?? plan.scope ?? 'internal';
  const result = recallMemories(memories, plan, scope, input.asOf ?? null, deps.today, profile.displayName);
  const output: RecallOutput = { action: 'recall', characterId: profile.id, scope, asOf: input.asOf ?? null, ...result };
  return { output, artifacts: [] };
}

async function markPublic(input: MarkPublicRequest, profile: CharacterProfile, deps: CharacterDeps): Promise<AgentResult<CharacterOutput>> {
  const memories = new Map((await deps.store.listMemories(profile.id)).map(m => [m.id, m]));
  const ids = [...new Set(input.memoryIds)];
  const notFound = ids.filter(id => !memories.has(id));
  const alreadyPublic = ids.filter(id => memories.get(id)?.audienceVisibility === 'public');
  const toReveal = ids.filter(id => memories.get(id)?.audienceVisibility === 'private');
  const revealedAt = input.revealedAt ?? deps.today;
  const sourceRunId = input.sourceRunId ?? (UUID_RE.test(deps.runId) ? deps.runId : null);
  const updated = deps.dryRun
    ? toReveal.map(id => memories.get(id) as CharacterMemory)
    : toReveal.length ? await deps.store.markPublic(profile.id, toReveal, revealedAt, sourceRunId) : [];
  const output: MarkPublicOutput = {
    action: 'mark_public', characterId: profile.id, dryRun: deps.dryRun,
    updated: updated.map(m => ({ id: m.id, memoryKey: m.memoryKey, revealedAt })), alreadyPublic, notFound,
  };
  return { output, artifacts: [] };
}

export async function executeCharacter(input: CharacterInput, slug: string, deps: CharacterDeps): Promise<AgentResult<CharacterOutput>> {
  const profile = await loadProfile(deps.store, slug);
  switch (input.action) {
    case 'create_content': return createContent(input, profile, deps);
    case 'remember': return remember(input, profile, deps);
    case 'recall': return recall(input, profile, deps);
    case 'mark_public': return markPublic(input, profile, deps);
  }
}

/**
 * A character agent is generic engine + a slug. All actions read or write private character state,
 * so they are internal operator actions: the run route requires a valid operator token.
 * Run history keeps ids and metadata only (see persistence.ts); the operator gets the full output in the response.
 */
export function createCharacterAgent(opts: {
  name: string;
  defaultSlug?: string;
  /** Override store/model (tests). Defaults to Supabase + Claude. */
  backend?: () => Pick<CharacterDeps, 'store' | 'model'>;
}): AgentDefinition<CharacterInput, CharacterOutput> {
  return {
    name: opts.name,
    version: '0.1.0',
    requiresOperator: true,
    inputSchema: CharacterInputSchema,
    outputSchema: CharacterOutputSchema,
    persistedInput: persistedCharacterInput,
    persistedOutput: persistedCharacterOutput,
    async execute(input, ctx): Promise<AgentResult<CharacterOutput>> {
      if (!ctx.operator) throw new Error('Character actions are internal operator actions');
      if (opts.defaultSlug && input.character && input.character !== opts.defaultSlug) {
        throw new Error(`Agent '${opts.name}' is bound to character '${opts.defaultSlug}'`);
      }
      const slug = input.character ?? opts.defaultSlug;
      if (!slug) throw new Error('input.character (slug) is required');
      const backend = opts.backend?.() ?? ((): Pick<CharacterDeps, 'store' | 'model'> => {
        const env = getEnv();
        return { store: new SupabaseCharacterStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY), model: claudeCharacterModel };
      })();
      return executeCharacter(input, slug, {
        ...backend,
        runId: ctx.runId,
        dryRun: ctx.dryRun,
        today: new Date().toISOString().slice(0, 10),
      });
    },
  };
}

export const characterAgent = createCharacterAgent({ name: 'character' });
/** Harold is configuration: the engine is generic, his state lives only in Supabase. */
export const haroldAgent = createCharacterAgent({ name: 'harold', defaultSlug: 'harold-bramson' });
