import { CharacterInputSchema, type CharacterOutput } from './schemas.js';

// What character runs leave behind in agent_runs. Traceability (who, what action, which memory ids/keys, which
// source run, success/failure via run status + timestamps) without copying private character values into run history.
// The operator still receives the full output in the API response.

/** Run input as persisted: never the natural-language statement, memory values or recall question. */
export function persistedCharacterInput(raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = CharacterInputSchema.safeParse(raw);
  if (!parsed.success) {
    const action = typeof raw.action === 'string' && /^[a-z_]{1,40}$/.test(raw.action) ? raw.action : null;
    return { redacted: true, valid: false, action };
  }
  const input = parsed.data;
  const base = { redacted: true, action: input.action, character: input.character ?? null };
  switch (input.action) {
    case 'create_content':
      // The scene is the operator's creative brief for a proposal that is retained anyway.
      return { ...base, scene: input.scene, date: input.date ?? null };
    case 'remember':
      return {
        ...base,
        inputKind: input.text ? 'text' : 'structured',
        date: input.date ?? null,
        sourceRunId: input.sourceRunId ?? null,
        memories: input.memories?.map(m => ({
          memoryType: m.memoryType, memoryKey: m.memoryKey, occurredAt: m.occurredAt ?? null,
          validFrom: m.validFrom ?? null, audienceVisibility: m.audienceVisibility ?? 'private',
        })) ?? null,
      };
    case 'recall':
      return {
        ...base,
        hasQuery: Boolean(input.query),
        scope: input.scope ?? null,
        memoryKeys: input.memoryKeys ?? [], keyPrefixes: input.keyPrefixes ?? [], tags: input.tags ?? [],
        from: input.from ?? null, to: input.to ?? null, asOf: input.asOf ?? null,
      };
    case 'mark_public':
      return { ...base, memoryIds: input.memoryIds, revealedAt: input.revealedAt ?? null, sourceRunId: input.sourceRunId ?? null };
  }
}

/** Run output as persisted: ids, keys and counts. create_content keeps the generated proposal. */
export function persistedCharacterOutput(output: CharacterOutput): Record<string, unknown> {
  switch (output.action) {
    case 'create_content':
    case 'remember':     // ids, keys, types and operations only
    case 'mark_public':  // ids, keys and reveal dates only
      return output;
    case 'recall':
      return {
        redacted: true,
        action: output.action,
        characterId: output.characterId,
        scope: output.scope,
        asOf: output.asOf,
        matchedCount: output.memoryIds.length,
        memoryIds: output.memoryIds,
        unrevealedMemoryIds: output.unrevealedMemoryIds ?? null,
      };
  }
}
