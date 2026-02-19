# FYRK Agent Platform

A minimal, production-minded agent runtime service for executing automated tasks.

## Overview

The FYRK Agent Platform provides:

- **Runtime Service** - Fastify-based API for running agents (Fly.io)
- **Agent Registry** - Pluggable system for registering agents
- **Supabase Integration** - Persistent storage for runs and artifacts
- **n8n Workflows** - Visual automation via webhook triggers
- **Operational hygiene** - Env validation, health checks, failure monitoring, Slack alerts

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Supabase project (or local instance)

### Setup

```bash
# Clone the repo
git clone https://github.com/carlfrankalbert/fyrk-agent-platform.git
cd fyrk-agent-platform

# Install dependencies
cd runtime
pnpm install

# Copy environment file
cp ../.env.example .env
# Edit .env with your Supabase credentials

# Run development server
pnpm dev
```

### Run Migration

Apply the database schema to your Supabase project:

```bash
# Using Supabase CLI
supabase db push

# Or manually run the SQL
psql $DATABASE_URL -f supabase/migrations/0001_init.sql
```

### Test the API

```bash
# Health check (includes DB probe)
curl http://localhost:8787/health
# → { "ok": true, "db": "connected" }

# Recent failures
curl http://localhost:8787/health/failures?hours=24
# → { "ok": true, "hours": 24, "count": 0, "failures": [] }

# List agents
curl http://localhost:8787/agents

# Run release-notes agent (dry run)
curl -X POST http://localhost:8787/run/release-notes \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1",
    "input": {
      "mode": "fixture",
      "repo": "fyrk/test",
      "rangeLabel": "v0.1.0..v0.1.1",
      "commits": [
        {
          "sha": "abc123",
          "message": "feat: add login",
          "author": "dev",
          "url": "https://github.com/fyrk/test/commit/abc123"
        }
      ]
    },
    "dryRun": true
  }'
```

## Project Structure

```
fyrk-agent-platform/
├── runtime/                    # Node.js service
│   ├── src/
│   │   ├── agents/            # Agent implementations
│   │   │   ├── base.ts        # Agent interface + runAgent
│   │   │   ├── registry.ts    # Agent registry
│   │   │   └── release-notes/ # Release notes agent
│   │   ├── db/                # Database client
│   │   ├── lib/
│   │   │   ├── env.ts         # Zod env validation (fail-fast)
│   │   │   └── schemas.ts     # Request/response schemas
│   │   └── routes/
│   │       ├── health.ts      # /health + /health/failures
│   │       └── run.ts         # /run/:agentName
│   └── test/                  # Tests and fixtures
├── releases/                  # Auto-generated release notes (by n8n)
├── supabase/
│   └── migrations/            # SQL migrations
├── docs/
│   └── agents/                # Agent documentation
└── .env.example
```

## API Reference

### GET /health

Health check with Supabase DB probe.

**Response:** `{ "ok": true, "db": "connected" }`

### GET /health/failures

Recent failed agent runs. Accepts `?hours=N` (default 24, max 168).

**Response:**
```json
{
  "ok": true,
  "hours": 24,
  "count": 2,
  "failures": [
    { "id": "uuid", "agent_name": "release-notes", "status": "failed", "error": "...", "created_at": "..." }
  ]
}
```

### GET /agents

List available agents.

**Response:** `{ "agents": ["release-notes"] }`

### POST /run/:agentName

Execute an agent.

**Request Body:**
```json
{
  "version": "0.1",
  "input": {},
  "dryRun": false,
  "publish": true
}
```

**Response:**
```json
{
  "runId": "uuid",
  "agentName": "release-notes",
  "agentVersion": "0.1",
  "status": "ok",
  "publish": true,
  "artifactIds": ["uuid"],
  "artifacts": [{ "id": "uuid", "kind": "markdown", "content": "..." }],
  "output": {}
}
```

## Available Agents

### release-notes

Generates structured release notes from commit data with Norwegian-style markdown.

See [docs/agents/release-notes.md](docs/agents/release-notes.md) for full documentation.

## n8n Pipeline

The production pipeline runs automatically on every push to main:

```
GitHub push → Cloudflare tunnel (n8n.fyrk.no) → Run agent → Status OK? → Publish? → Commit release notes
                                                                │
                                                                └→ Slack alert (#alerts)
```

See [n8n/README.md](n8n/README.md) for workflow details.

## Infrastructure

| Service | URL | Description |
|---------|-----|-------------|
| Runtime | `fyrk-agent-runtime.fly.dev` | Fly.io (2 machines) |
| n8n | `n8n.fyrk.no` | Local + Cloudflare tunnel |
| DB | Supabase | agent_runs + artifacts |
| Alerts | Slack `#alerts` | Failed run notifications |

## Development

```bash
cd runtime

# Run tests
pnpm test

# Run linter
pnpm lint

# Type check
pnpm typecheck

# Development server with hot reload
pnpm dev
```

## Deployment

```bash
cd runtime
fly deploy
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | required |
| `SUPABASE_SERVICE_KEY` | Supabase service key | required |
| `PORT` | Server port | `8787` |
| `HOST` | Server host | `0.0.0.0` |
| `LOG_LEVEL` | Logging level (fatal/error/warn/info/debug/trace) | `info` |

## License

MIT
