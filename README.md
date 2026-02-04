# FYRK Agent Platform

A minimal, production-minded agent runtime service for executing automated tasks.

## Overview

The FYRK Agent Platform provides:

- **Runtime Service** - Fastify-based API for running agents
- **Agent Registry** - Pluggable system for registering agents
- **Supabase Integration** - Persistent storage for runs and artifacts
- **n8n Workflows** - Visual automation via webhook triggers

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
# Health check
curl http://localhost:8787/health

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
│   │   │   ├── base.ts        # Agent interface
│   │   │   ├── registry.ts    # Agent registry
│   │   │   └── release-notes/ # Release notes agent
│   │   ├── db/                # Database client
│   │   ├── lib/               # Shared schemas
│   │   └── routes/            # API routes
│   └── test/                  # Tests and fixtures
├── supabase/
│   └── migrations/            # SQL migrations
├── docs/
│   └── agents/                # Agent documentation
├── n8n/
│   └── workflows/             # n8n workflow exports
├── docker-compose.yml
└── .env.example
```

## API Reference

### GET /health

Health check endpoint.

**Response:** `{ "ok": true }`

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
  "dryRun": false
}
```

**Response:**
```json
{
  "runId": "uuid",
  "agentName": "release-notes",
  "agentVersion": "0.1",
  "status": "ok",
  "artifactIds": ["uuid"],
  "output": {}
}
```

## Available Agents

### release-notes

Generates structured release notes from commit data.

See [docs/agents/release-notes.md](docs/agents/release-notes.md) for full documentation.

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

## Docker

### Build and Run

```bash
# Build runtime image
docker build -t fyrk-agent-runtime ./runtime

# Run with Docker Compose
docker-compose up -d
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| runtime | 8787 | Agent runtime API |
| n8n | 5678 | n8n workflow editor |

## n8n Integration

Import the workflow from `n8n/workflows/release-notes-cron.json`:

1. Open n8n at http://localhost:5678
2. Go to Workflows → Add Workflow → Import from File
3. Select the JSON file
4. Save and activate

See [n8n/README.md](n8n/README.md) for more details.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8787` |
| `HOST` | Server host | `0.0.0.0` |
| `LOG_LEVEL` | Logging level | `info` |
| `SUPABASE_URL` | Supabase project URL | - |
| `SUPABASE_SERVICE_KEY` | Supabase service key | - |

## License

MIT
