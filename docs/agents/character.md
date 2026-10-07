# Character memory agent (Harold v1)

Harold Bramson is an experiment in **persistent autobiographical memory for fictional agents**: can an openly
fictional, AI-generated character keep a coherent life over time? That means a stable identity, a dated history,
opinions that change and are remembered as changed, and a gap between what the character knows and what the
audience has been told.

## Design principle

> **ENGINE PUBLIC. CHARACTER MIND PRIVATE.**

This repository contains the generic engine: schemas, migration, retrieval, prompts and the bootstrap command.
A character's actual mind (canon, biography, private memories, visual references, future narrative) lives only in
Supabase and in a gitignored local file under `private/`. Being transparent that Harold is fictional does not mean
his internal state is public.

## Concepts

| Concept | Meaning | Where |
|---|---|---|
| **Canon** | Stable identity and world: identity, personality, voice, home, appearance. Locked. | `character_profiles.private_canon`, `visual_canon` |
| **Memory** | Evolving preferences, opinions and facts. A change *supersedes* the old row; it is never overwritten. | `character_memories` (`preference`, `opinion`, `fact`) |
| **Episode** | Something that happened on a date (`occurred_at`). | `character_memories` (`episode`) |
| **Private state** | True and known internally, not yet revealed. Default for every new memory. | `audience_visibility = 'private'` |
| **Public state** | Something the character has revealed (`revealed_at`, `revealed_source_run_id`). | `audience_visibility = 'public'` |
| **Memory candidate** | Proposed by generated content, but not history until an operator approves it via `remember`. | `create_content` output only |

Locked canon: the top-level keys of `private_canon` and `visual_canon` (e.g. `identity`, `appearance`) are locked
namespaces. `remember` rejects any memory under them, and also rejects any memory marked `locked`. Canon changes
only through the privileged bootstrap file.

Unknown stays unknown: anything not in canon or memories is undecided. Prompts forbid inventing family,
birthdays, jobs, childhood, relationships or favourite foods, and `recall` answers "Unknown" rather than guessing.

### History, not overwrite

```
2026-10-01  food.olives = dislike       status=superseded  valid_to=2027-02-12
2027-02-12  food.olives = likes_some    status=active
```

A partial unique index allows one active value per key. The `character_memory_supersede` RPC closes the old row
and inserts the new one in one transaction. `recall` can answer both "what now?" and "has it always been so?",
and can also answer as of a past date (`asOf`). `create_content` uses the state valid on the scene date.

## Security and privacy

- **Operator only.** Every action reads or writes private state, so the agent sets `requiresOperator`. `POST /run/harold`
  returns 401 unless `x-operator-token` matches `AGENT_OPERATOR_TOKEN` (constant-time compare; unset = always refused).
- **Server-side storage.** Both tables have RLS enabled, all privileges revoked from `anon`/`authenticated`, and access
  granted to `service_role` only.
- **Minimal outputs.** `create_content` returns the proposal plus `usedMemoryIds`/`revealsMemoryIds`, never the loaded
  context. Artifacts store the proposal and ids. Error messages name keys and operations, never values. CLI output is ids
  and counts only.
- **Bounded retrieval.** Only a bounded, relevant selection of memories is sent to the model. Unrelated private facts
  are not included.

## Bootstrap a private character

```bash
# private/ is gitignored; verify before writing anything there
git check-ignore -v private/characters/my-character.json

# Start from the placeholder example, then fill in the real canon locally
mkdir -p private/characters
cp examples/characters/example-character.json private/characters/my-character.json

# Apply the migration once, then upsert (idempotent; refuses git-tracked files)
supabase db push
cd runtime && pnpm character:upsert --file ../private/characters/my-character.json
```

The file format is `CharacterFileSchema` in `runtime/src/agents/character/bootstrap.ts`: `slug`, `displayName`,
`publicProfile`, `privateCanon`, `visualCanon`, optional `asOf` and `memories`. Re-running applies changed memories
through the normal history rules. Changed canon replaces the stored canon (that is the privileged path).

## API

Use `/run/harold` (bound to slug `harold-bramson`) or `/run/character` with `"character": "<slug>"`.
`dryRun: true` reads real state but writes nothing.

Examples use the placeholder character. For Harold, call `/run/harold` and drop `"character"`.

```bash
H=(-H "content-type: application/json" -H "x-operator-token: $AGENT_OPERATOR_TOKEN")
URL=https://fyrk-agent-runtime.fly.dev/run/character
C='"character":"marta-example"'

# Content proposal (no image generated; candidates are NOT persisted)
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"create_content\",
  \"scene\":\"Marta tries a new coffee grinder on a rainy Sunday morning\",\"date\":\"2026-10-11\"}}"

# Remember: natural language or structured
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"remember\",\"text\":\"Marta dislikes olives.\",\"date\":\"2026-10-01\"}}"
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"remember\",\"date\":\"2027-02-12\",
  \"text\":\"Marta tried good green olives and now admits she likes some olives.\"}}"

# Approve candidates from a content run (traceable via source_run_id)
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"remember\",\"sourceRunId\":\"<content runId>\",
  \"memories\":[{\"memoryType\":\"episode\",\"memoryKey\":\"coffee.grinder.purchase\",\"occurredAt\":\"2026-10-11\",
  \"value\":{\"summary\":\"Marta Example bought a new coffee grinder.\"}}]}}"

# Recall: internal (default) or audience scope; the scope is also inferred from the question
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"recall\",\"query\":\"What does Marta think about olives?\"}}"
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"recall\",\"query\":\"What does the audience know about her aunt?\"}}"
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"recall\",\"keyPrefixes\":[\"family\"],\"scope\":\"audience\"}}"

# Mark revealed after the content is approved/published (content is unchanged)
curl -s "${H[@]}" $URL -d "{\"input\":{$C,\"action\":\"mark_public\",\"memoryIds\":[\"<id>\"],
  \"revealedAt\":\"2027-04-03\",\"sourceRunId\":\"<content runId>\"}}"
```

`recall` returns `{ answer, current[], history[], episodes[], memoryIds[], unrevealedMemoryIds? }`. The answer is
assembled deterministically from stored rows (the model only plans the lookup), so it cannot invent facts. In
audience scope, `unrevealedMemoryIds` lists matching private memories by id only, ready for `mark_public`.

## Example

`examples/characters/example-character.json` (Marta Example) is an obviously placeholder character with canon, one
preference, one changed preference, one episode, one private fact and one public fact. Tests use only this character.

## Deliberate v1 limitations

- No image generation, publishing, Instagram, n8n flows or UI.
- Retrieval is keyword/key/tag/date based (no embeddings). Up to 1000 memory rows are loaded per call server-side;
  only a bounded selection reaches the model.
- Multi-memory `remember` validates everything first but writes rows one by one (each supersede is atomic, the batch is not).
- Dates are in-world days. Yearly anniversaries are supported; there is no calendar engine.
- One operator token for all operator agents; no per-user authorization.
- Run history (`agent_runs`) keeps metadata only for character runs: no remember statements or values, no recall question or answer (see `persistence.ts`). `create_content` keeps its generated proposal.
