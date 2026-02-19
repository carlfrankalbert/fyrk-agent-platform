# FYRK Agent Platform

Agent runtime for automated workflows — release notes, releaselog, and more.

## Project Structure

```
runtime/
  src/
    agents/
      base.ts              — AgentDefinition, AgentContext, runAgent
      registry.ts          — agent registration
      release-notes/
        index.ts            — release-notes agent logic
        schemas.ts          — Zod schemas (input, output, commits)
    db/
      client.ts             — SupabaseDbClient + NullDbClient
    lib/
      env.ts                — Zod-validated env vars, validateEnv() + getEnv()
      schemas.ts            — RunRequestSchema, RunResponseSchema
    routes/
      health.ts             — GET /health, GET /health/failures
      run.ts                — POST /run/:agentName
  test/
    release-notes.test.ts   — 29 vitest tests
    fixtures/               — test fixtures
n8n/
  workflows/
    release-notes-github-push.json  — internal release notes pipeline
    fyrk-releaselog.json            — fyrk.no releaselog pipeline
docs/
  agents/
    release-notes.md        — agent documentation
```

## Infrastructure

- **Runtime:** Fly.io at `fyrk-agent-runtime.fly.dev`
- **DB:** Supabase (agent_runs, artifacts tables with RLS)
- **n8n:** Docker at localhost:5678, exposed via Cloudflare tunnel at `n8n.fyrk.no`
- **Tunnel:** `cloudflared tunnel run fyrk-n8n`

## n8n Pipelines

### Pipeline 1: Internal Release Notes

Triggers on push to `fyrk-agent-platform` main. Generates technical release notes stored in Supabase.

- Webhook: `https://n8n.fyrk.no/webhook/release-notes`
- Workflow: `n8n/workflows/release-notes-github-push.json`

### Pipeline 2: fyrk.no Releaselog

Triggers on push to `nettside_fyrk` main. Transforms agent output to user-facing Norwegian markdown and commits to `src/content/releaselog/` in nettside_fyrk via GitHub API.

- Webhook: `https://n8n.fyrk.no/webhook/fyrk-releaselog`
- Workflow: `n8n/workflows/fyrk-releaselog.json`
- Chores-only pushes are skipped
- Requires `GITHUB_TOKEN` env var in n8n container

## Development

```bash
cd runtime
pnpm install
pnpm test          # run vitest
pnpm dev           # local dev server on :8787
```

```bash
docker compose up -d   # start runtime + n8n
```

## Conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Norwegian prose in user-facing output (Lagt til, Rettet, Forbedret, Oppdatert, Fjernet)
- Zod for all schema validation
- Env vars validated at startup via `validateEnv()`
- `publish` flag flows through request → AgentContext → response

## n8n Gotchas

- Code nodes cannot use `fetch()` — use `this.helpers.httpRequest()`
- Code nodes sandbox blocks `process.env` and `$env` — use HTTP Request node with `$env.VAR` in header expressions instead
- HTTP Request nodes can't handle expression-based JSON bodies — use Code node to prepare body, then HTTP Request node for the call
