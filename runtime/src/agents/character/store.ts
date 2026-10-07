import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { MemoryValueSchema, type CharacterMemory, type CharacterProfile, type NewMemory } from './schemas.js';

export interface ProfileUpsert {
  slug: string;
  displayName: string;
  publicProfile: Record<string, unknown>;
  privateCanon: Record<string, unknown>;
  visualCanon: Record<string, unknown>;
}

export interface CharacterStore {
  getProfile(slug: string): Promise<CharacterProfile | null>;
  /** Privileged: only the local bootstrap path writes canon. */
  upsertProfile(profile: ProfileUpsert): Promise<CharacterProfile>;
  listMemories(characterId: string): Promise<CharacterMemory[]>;
  insertMemory(memory: NewMemory): Promise<CharacterMemory>;
  /** Atomically closes `previousId` (valid_to = memory.validFrom) and inserts the replacement. */
  supersedeMemory(previousId: string, memory: NewMemory, allowLocked?: boolean): Promise<CharacterMemory>;
  /** Flips audience visibility of private memories; never touches their content. */
  markPublic(characterId: string, ids: string[], revealedAt: string, sourceRunId: string | null): Promise<CharacterMemory[]>;
}

/** Upper bound on rows loaded per call. Only a bounded selection of these is ever sent to a model. */
export const MEMORY_LOAD_LIMIT = 1000;

type Row = Record<string, unknown>;

const PROFILE_COLUMNS = 'id,slug,display_name,public_profile,private_canon,visual_canon';

function toProfile(row: Row): CharacterProfile {
  return {
    id: row.id as string,
    slug: row.slug as string,
    displayName: row.display_name as string,
    publicProfile: (row.public_profile ?? {}) as Record<string, unknown>,
    privateCanon: (row.private_canon ?? {}) as Record<string, unknown>,
    visualCanon: (row.visual_canon ?? {}) as Record<string, unknown>,
  };
}

export function toMemory(row: Row): CharacterMemory {
  const date = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
  return {
    id: row.id as string,
    characterId: row.character_id as string,
    memoryType: row.memory_type as CharacterMemory['memoryType'],
    memoryKey: row.memory_key as string,
    value: MemoryValueSchema.parse(row.value),
    status: row.status as CharacterMemory['status'],
    locked: Boolean(row.locked),
    confidence: Number(row.confidence ?? 1),
    validFrom: date(row.valid_from),
    validTo: date(row.valid_to),
    occurredAt: date(row.occurred_at),
    supersededBy: (row.superseded_by as string | null) ?? null,
    source: row.source as CharacterMemory['source'],
    sourceRunId: (row.source_run_id as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    audienceVisibility: row.audience_visibility as CharacterMemory['audienceVisibility'],
    revealedAt: date(row.revealed_at),
    revealedSourceRunId: (row.revealed_source_run_id as string | null) ?? null,
  };
}

function toRow(m: NewMemory): Row {
  return {
    character_id: m.characterId, memory_type: m.memoryType, memory_key: m.memoryKey, value: m.value,
    locked: m.locked, confidence: m.confidence, valid_from: m.validFrom, occurred_at: m.occurredAt,
    source: m.source, source_run_id: m.sourceRunId, tags: m.tags,
    audience_visibility: m.audienceVisibility, revealed_at: m.revealedAt,
  };
}

// Errors name the operation only — never row contents, so private state cannot leak via error messages.
export class SupabaseCharacterStore implements CharacterStore {
  private client;
  constructor(url: string, key: string) { this.client = createClient(url, key); }

  async getProfile(slug: string): Promise<CharacterProfile | null> {
    const { data, error } = await this.client.from('character_profiles').select(PROFILE_COLUMNS).eq('slug', slug).maybeSingle();
    if (error) throw new Error(`Character profile read failed: ${error.message}`);
    return data ? toProfile(data as Row) : null;
  }

  async upsertProfile(p: ProfileUpsert): Promise<CharacterProfile> {
    const { data, error } = await this.client.from('character_profiles').upsert({
      slug: p.slug, display_name: p.displayName, public_profile: p.publicProfile,
      private_canon: p.privateCanon, visual_canon: p.visualCanon, updated_at: new Date().toISOString(),
    }, { onConflict: 'slug' }).select(PROFILE_COLUMNS).single();
    if (error) throw new Error(`Character profile upsert failed: ${error.message}`);
    return toProfile(data as Row);
  }

  async listMemories(characterId: string): Promise<CharacterMemory[]> {
    const { data, error } = await this.client.from('character_memories').select('*')
      .eq('character_id', characterId).order('created_at', { ascending: false }).range(0, MEMORY_LOAD_LIMIT - 1);
    if (error) throw new Error(`Character memory read failed: ${error.message}`);
    return (data as Row[]).map(toMemory);
  }

  async insertMemory(m: NewMemory): Promise<CharacterMemory> {
    const result = await this.client.from('character_memories').insert(toRow(m)).select('*').single();
    const data: unknown = result.data;
    const error = result.error;
    if (error) throw new Error(`Character memory insert failed (${m.memoryKey}): ${error.message}`);
    return toMemory(data as Row);
  }

  async supersedeMemory(previousId: string, m: NewMemory, allowLocked = false): Promise<CharacterMemory> {
    const result = await this.client.rpc('character_memory_supersede', {
      p_previous_id: previousId, p_memory: toRow(m), p_allow_locked: allowLocked,
    });
    const data: unknown = result.data;
    const error = result.error;
    if (error) throw new Error(`Character memory supersede failed (${m.memoryKey}): ${error.message}`);
    return toMemory(data as Row);
  }

  async markPublic(characterId: string, ids: string[], revealedAt: string, sourceRunId: string | null): Promise<CharacterMemory[]> {
    const { data, error } = await this.client.from('character_memories')
      .update({ audience_visibility: 'public', revealed_at: revealedAt, revealed_source_run_id: sourceRunId, updated_at: new Date().toISOString() })
      .eq('character_id', characterId).eq('audience_visibility', 'private').in('id', ids).select('*');
    if (error) throw new Error(`Character memory reveal failed: ${error.message}`);
    return (data as Row[]).map(toMemory);
  }
}

/** In-memory store with the same semantics as the database (used by tests and local experiments). */
export class InMemoryCharacterStore implements CharacterStore {
  readonly profiles = new Map<string, CharacterProfile>();
  readonly memories: CharacterMemory[] = [];

  getProfile(slug: string): Promise<CharacterProfile | null> {
    return Promise.resolve(this.profiles.get(slug) ?? null);
  }

  upsertProfile(p: ProfileUpsert): Promise<CharacterProfile> {
    const profile = { id: this.profiles.get(p.slug)?.id ?? randomUUID(), ...p };
    this.profiles.set(p.slug, profile);
    return Promise.resolve(profile);
  }

  listMemories(characterId: string): Promise<CharacterMemory[]> {
    return Promise.resolve(this.memories.filter(m => m.characterId === characterId).map(m => structuredClone(m)));
  }

  insertMemory(m: NewMemory): Promise<CharacterMemory> {
    const clash = this.memories.some(e => e.characterId === m.characterId && e.memoryKey === m.memoryKey && (m.memoryType === 'episode'
      ? e.memoryType === 'episode' && e.occurredAt === m.occurredAt
      : e.memoryType !== 'episode' && e.status === 'active'));
    if (clash) return Promise.reject(new Error(`Character memory insert failed (${m.memoryKey}): duplicate`));
    const stored: CharacterMemory = { ...structuredClone(m), id: randomUUID(), status: 'active', validTo: null,
      supersededBy: null, revealedSourceRunId: null };
    this.memories.push(stored);
    return Promise.resolve(structuredClone(stored));
  }

  async supersedeMemory(previousId: string, m: NewMemory, allowLocked = false): Promise<CharacterMemory> {
    const prev = this.memories.find(e => e.id === previousId);
    if (!prev || prev.status !== 'active' || (prev.locked && !allowLocked) || prev.memoryKey !== m.memoryKey
      || !m.validFrom || (prev.validFrom && m.validFrom < prev.validFrom)) {
      throw new Error(`Character memory supersede failed (${m.memoryKey})`);
    }
    prev.status = 'superseded';
    prev.validTo = m.validFrom;
    const created = await this.insertMemory(m);
    prev.supersededBy = created.id;
    return created;
  }

  markPublic(characterId: string, ids: string[], revealedAt: string, sourceRunId: string | null): Promise<CharacterMemory[]> {
    const updated = this.memories.filter(m => m.characterId === characterId && ids.includes(m.id) && m.audienceVisibility === 'private');
    for (const m of updated) Object.assign(m, { audienceVisibility: 'public', revealedAt, revealedSourceRunId: sourceRunId });
    return Promise.resolve(updated.map(m => structuredClone(m)));
  }
}
