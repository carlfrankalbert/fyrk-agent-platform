# FYRK Agent Platform

A minimal, production-minded agent runtime service for executing automated tasks.

## Overview

The FYRK Agent Platform provides:

- **Runtime Service** - Fastify-based API for running agents (Fly.io)
- **Agent Registry** - Pluggable system for registering agents
- **Supabase Integration** - Persistent storage for runs, artifacts, leads, and household data
- **n8n Workflows** - Visual automation via webhook triggers
- **Slack Integration** - FYRK Slack bot (pluggable modules, first: Kvitsøy personalhåndbok), lead notifications (Timing Radar)
- **Operational hygiene** - Env validation, health checks, failure monitoring

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

### Run Migrations

Apply the database schema to your Supabase project:

```bash
supabase db push
```

### Test the API

```bash
# Health check (includes DB probe)
curl http://localhost:8787/health
# → { "ok": true, "db": "connected" }

# Recent failures
curl http://localhost:8787/health/failures?hours=24

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
├── runtime/                       # Node.js service
│   ├── src/
│   │   ├── agents/                # Agent implementations
│   │   │   ├── base.ts            # Agent interface + runAgent
│   │   │   ├── registry.ts        # Agent registry
│   │   │   ├── release-notes/     # Release notes agent
│   │   │   ├── docs-sync/         # Docs sync agent
│   │   │   └── linkedin-post/     # LinkedIn post agent
│   │   ├── db/                    # Database client
│   │   ├── lib/                   # Shared libraries
│   │   │   ├── env.ts             # Zod env validation (fail-fast)
│   │   │   ├── claude.ts          # Claude API wrapper
│   │   │   ├── slack.ts           # Slack client (thread replies, updates, history, signature)
│   │   │   ├── slack-events.ts    # Raw-body JSON parser for Slack signature verification
│   │   │   ├── schemas.ts         # Request/response schemas
│   │   │   └── types.ts           # Shared types
│   │   ├── slack-bot/             # FYRK Slack bot core: events, signature, dedup, threads, streaming
│   │   │   ├── routes.ts          # POST /slack/fyrk-bot-events
│   │   │   ├── conversation.ts    # Thread history → Claude stream → Slack updates
│   │   │   ├── select.ts          # selectModule(event)
│   │   │   └── modules/           # Bot modules (registry.ts, handbook/)
│   │   └── routes/                # Bounded context directories
│   │       ├── health.ts          # /health + /health/failures
│   │       ├── run.ts             # /run/:agentName
│   │       ├── leads/             # Timing Radar — lead scoring + Slack alerts
│   │       │   ├── index.ts
│   │       │   ├── blocks.ts
│   │       │   └── schemas.ts
│   │       └── husmor/            # Husmor — Slack-based meal planning assistant
│   │           ├── index.ts
│   │           ├── conversation.ts
│   │           ├── proactive.ts
│   │           ├── actions.ts
│   │           ├── prompt.ts
│   │           ├── db.ts
│   │           ├── schemas.ts
│   │           ├── canvas.ts
│   │           ├── cache.ts
│   │           └── learnings/     # Learning system (extraction, patterns, metrics, signals)
│   └── test/                      # Tests (299 tests, vitest)
├── n8n/
│   └── workflows/                 # n8n pipeline definitions
├── supabase/
│   ├── migrations/                # SQL migrations
│   └── seed/                      # Seed data
└── .env.example
```

## Available Agents

| Agent | Description | Trigger |
|-------|-------------|---------|
| **release-notes** | Generates structured release notes from commit data (Norwegian markdown) | Push to main |
| **docs-sync** | Detects code changes that need documentation updates, opens PRs | Push to nettside_fyrk |
| **linkedin-post** | Synthesizes tech news into a contrarian LinkedIn post draft | Cron (Mon/Wed/Fri) |
| **character** / **harold** | Persistent fictional-character memory: canon, evolving memories, episodes, public/private reveals ([docs](docs/agents/character.md)) | Manual, operator token |

## Slack Integrations

### FYRK Slack bot

A general Slack bot for the FYRK workspace. The core (`runtime/src/slack-bot/`) handles Slack events, signature verification, dedup, threads, streaming and errors; what the bot knows comes from a module (`runtime/src/slack-bot/modules/<id>/`) implementing `BotModule` and registered in `modules/registry.ts`. Adding a module needs no core changes.

- Answers `app_mention` and direct messages, always in a thread, streaming the answer into a `...` placeholder. Follow-ups include the thread history.
- Module per event: `SLACK_BOT_CHANNEL_MODULES` (per-channel JSON override), otherwise `SLACK_BOT_DEFAULT_MODULE`.
- First module, `handbook`: answers only from the Kvitsøy kommune personalhåndbok (`runtime/static/handbook/kvitsoy-personalhandbok.md`, sent as a cached system block), citing point numbers.
- Slack app: [docs/slack-bot/slack-app-manifest.yml](docs/slack-bot/slack-app-manifest.yml). Dedup table: `slack_bot_event_dedup`.

### Husmor

A Slack-based meal planning assistant that manages weekly meal plans, shopping lists, and learns household preferences over time. Uses Claude for conversation and a learning system that tracks patterns, contradictions, and knowledge gaps.

### Timing Radar

Monitors new CPO/Head of Product hires in Nordic companies. Scores leads across 5 dimensions (fit, trigger, timing, authority, intent) and sends Slack notifications with emoji-based feedback (contacted, planned, not relevant, warm, cold good account).

## API Reference

### POST /slack/fyrk-bot-events

Slack Events API endpoint for the FYRK bot. Verifies the Slack signature, answers `url_verification`, acks every event immediately and answers asynchronously. Ignores retries, bot messages and message subtypes; dedups on `event_id`. Returns 503 when `SLACK_FYRK_BOT_TOKEN`/`SLACK_FYRK_SIGNING_SECRET` are not set.

### GET /health

Health check with Supabase DB probe.

**Response:** `{ "ok": true, "db": "connected" }`

### GET /health/failures

Recent failed agent runs. Accepts `?hours=N` (default 24, max 168).

### GET /agents

List available agents.

**Response:** `{ "agents": ["release-notes", "docs-sync", "linkedin-post"] }`

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

### POST /leads

Create a new lead (Timing Radar). Auto-links to target accounts by domain.

### POST /leads/:id/notify

Send a Slack notification for a lead with Block Kit formatting.

### POST /slack/events

Handle Slack reaction events for lead status updates.

## n8n Pipelines

| Pipeline | Webhook | Description |
|----------|---------|-------------|
| Release notes | `/webhook/release-notes` | Internal release notes on push to fyrk-agent-platform |
| Releaselog | `/webhook/fyrk-releaselog` | User-facing changelog on push to nettside_fyrk |
| Docs sync | `/webhook/docs-sync` | Documentation PR on push to nettside_fyrk |
| LinkedIn post | Cron schedule | Mon/Wed/Fri 07:00, RSS feeds to Slack draft |

## Infrastructure

| Service | URL | Description |
|---------|-----|-------------|
| Runtime | `fyrk-agent-runtime.fly.dev` | Fly.io (2 machines) |
| n8n | `n8n.fyrk.no` | Local Docker + Cloudflare tunnel |
| DB | Supabase | agent_runs, artifacts, leads, household data |

## Development

```bash
cd runtime

pnpm test          # Run tests (299 tests)
pnpm lint          # Run linter
pnpm build         # Type check + compile
pnpm dev           # Development server with hot reload
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
| `ANTHROPIC_API_KEY` | Claude API key (for docs-sync, linkedin-post, Husmor) | optional |
| `SLACK_BOT_TOKEN` | Slack bot token (Timing Radar) | optional |
| `SLACK_SIGNING_SECRET` | Slack signing secret (event verification) | optional |
| `SLACK_CHANNEL_LEADS` | Slack channel for lead notifications | `#fyrk-leads` |
| `SLACK_HUSMOR_BOT_TOKEN` | Slack bot token (Husmor) | optional |
| `SLACK_HUSMOR_SIGNING_SECRET` | Slack signing secret (Husmor) | optional |
| `SLACK_FYRK_BOT_TOKEN` | Bot token for the FYRK Slack bot | optional |
| `SLACK_FYRK_SIGNING_SECRET` | Signing secret for the FYRK Slack bot (required for it to accept events) | optional |
| `SLACK_BOT_DEFAULT_MODULE` | FYRK Slack bot module used when no channel override matches | `handbook` |
| `SLACK_BOT_CHANNEL_MODULES` | Per-channel module overrides as JSON, e.g. `{"C0123ABC":"handbook"}` | optional |
| `AGENT_OPERATOR_TOKEN` | Operator token (`x-operator-token`) for agents touching private state, e.g. character agents. Unset = they refuse | optional |
| `PORT` | Server port | `8787` |
| `HOST` | Server host | `0.0.0.0` |
| `LOG_LEVEL` | Logging level (fatal/error/warn/info/debug/trace) | `info` |

## License

MIT

## Assignment radar

Ny konsulentoppdragsradar: `POST /run/assignment-radar`. Se [oppsett, kilder, deduplisering og utvidelse med ny portal](runtime/src/agents/assignment-radar/README.md).
