import { z } from 'zod';
import { IsoDateSchema, MemoryInputSchema, SlugSchema } from './schemas.js';
import type { CharacterStore } from './store.js';
import { applyMemories } from './index.js';

/**
 * Character bootstrap file. Real characters' files live in the gitignored private/ directory;
 * only placeholder examples (examples/characters/) are tracked.
 */
export const CharacterFileSchema = z.object({
  slug: SlugSchema,
  displayName: z.string().min(1).max(120),
  publicProfile: z.record(z.unknown()).optional(),
  /** Stable canon. Its top-level keys become locked namespaces that remember cannot change. */
  privateCanon: z.record(z.unknown()),
  visualCanon: z.record(z.unknown()).optional(),
  /** In-world date for memories without their own dates. */
  asOf: IsoDateSchema.optional(),
  memories: z.array(MemoryInputSchema).max(500).optional(),
});
export type CharacterFile = z.infer<typeof CharacterFileSchema>;

export interface UpsertSummary {
  characterId: string;
  slug: string;
  inserted: number;
  superseded: number;
  unchanged: number;
}

/**
 * Privileged upsert: replaces canon and applies listed memories through the normal history rules
 * (idempotent; changed values supersede). Returns counts only, so CLI output never echoes private state.
 */
export async function upsertCharacter(store: CharacterStore, file: CharacterFile, today: string): Promise<UpsertSummary> {
  const profile = await store.upsertProfile({
    slug: file.slug,
    displayName: file.displayName,
    publicProfile: file.publicProfile ?? {},
    privateCanon: file.privateCanon,
    visualCanon: file.visualCanon ?? {},
  });
  const written = file.memories?.length
    ? await applyMemories(store, profile, file.memories, {
      date: file.asOf ?? today, source: 'bootstrap', sourceRunId: null, dryRun: false, allowLocked: true,
    })
    : [];
  const count = (op: string): number => written.filter(w => w.operation === op).length;
  return { characterId: profile.id, slug: profile.slug, inserted: count('inserted'), superseded: count('superseded'), unchanged: count('unchanged') };
}
