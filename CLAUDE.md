# FYRK Agent Platform

Agent runtime + Husmor family assistant backend. Fastify API on Fly.io with Claude AI, Supabase, and n8n orchestration.

## Project Structure

```
runtime/
  src/
    agents/
      base.ts              — AgentDefinition, AgentContext, runAgent
      registry.ts          — agent registration (release-notes, meal-plan, cv-tailor)
      release-notes/       — commit categorization, changelog generation
      meal-plan/           — weekly meal planning via Claude
      cv-tailor/           — CV tailoring with gap analysis via Claude
    db/
      client.ts            — SupabaseDbClient + NullDbClient
    lib/
      env.ts               — Zod-validated env vars, validateEnv() + getEnv()
      claude.ts            — Claude API client with retry (429/500/529, exponential backoff)
      schemas.ts           — RunRequestSchema, RunResponseSchema
      types.ts             — shared types (Logger)
      slack.ts             — Slack client: replyInThread, updateMessage, getThreadHistory, verifySignature
      slack-events.ts      — raw-body JSON parser for Slack signature verification
    slack-bot/             — FYRK Slack bot core (knows nothing about module content)
      routes.ts            — POST /slack/fyrk-bot-events: signature, url_verification, retries, filtering, async ack
      events.ts            — envelope schemas, classifyEvent (app_mention, message.im, un-mentioned replies in bot threads; no bots/subtypes)
      dedup.ts             — event_id claim in slack_bot_event_dedup
      conversation.ts      — thread history → Claude stream → Slack placeholder updates, error message, usage log
      stream.ts            — createSlackStreamUpdater (500 ms / 80 char debounce)
      select.ts            — selectModule(event): SLACK_BOT_CHANNEL_MODULES override, else SLACK_BOT_DEFAULT_MODULE
      types.ts             — BotModule, SlackBotEvent
      modules/
        registry.ts        — module registration (same pattern as agents/registry.ts)
        handbook/          — Kvitsøy personalhåndbok Q&A (claude-sonnet-5-5, handbook as cached context)
    routes/
      health.ts            — GET /health, GET /health/failures
      run.ts               — POST /run/:agentName
      cv-tailor.ts         — CV tailor web UI + learnings persistence
      hub/                 — Family dashboard API (14 route modules)
        auth.ts            — session management (access code → bearer token)
        meals.ts           — weekly plan, ratings, generation
        meals-chat.ts      — meal chat with Claude
        shopping.ts        — shopping list CRUD
        calendar.ts        — calendar integration
        weather.ts         — weather data
        transport.ts       — Entur transport data
        voice.ts           — voice intent parsing via Claude
        reminders.ts       — reminder scheduling
        children.ts        — child reaction tracking
        oda.ts             — Oda grocery cart sync
        proactive.ts       — contextual family tips via Claude Haiku
        settings.ts        — family preferences
        analytics.ts       — usage event tracking
  test/
    release-notes.test.ts
    meal-plan.test.ts
    cv-tailor.test.ts
    oda.test.ts
    claude-stream.test.ts
    slack-bot.test.ts
    fixtures/              — test fixtures (JSON)
  static/
    handbook/kvitsoy-personalhandbok.md — handbook as Markdown, point numbers as headings
hub/                       — React/Vite frontend for family dashboard
n8n/
  workflows/
    release-notes-github-push.json  — internal release notes on push
    fyrk-releaselog.json            — fyrk.no user-facing releaselog
    meal-plan-weekly.json           — weekly meal plan generation
    husmor-proactive.json           — proactive Slack reminders
    husmor-monday-morning.json      — Monday morning kickoff
    release-notes-cron.json         — scheduled release notes
supabase/
  migrations/              — 23 numbered migrations
  seed/                    — food traditions, nutrition, seasonal produce, pantry staples
docs/
  agents/release-notes.md
  slack-bot/slack-app-manifest.yml — Slack app manifest for the FYRK bot
  husmor-overview.md
  husmor-user-guide.md
  husmor/deferred-features.md
tools/
  cv-tailor.html           — standalone CV tailor dev tool
```

## Infrastructure

- **Runtime:** Fly.io at `fyrk-agent-runtime.fly.dev`
- **DB:** Supabase (agent_runs, artifacts, husmor tables with RLS)
- **n8n:** Docker at localhost:5678, exposed via Cloudflare tunnel at `n8n.fyrk.no`
- **Tunnel:** `cloudflared tunnel run fyrk-n8n`
- **Hub frontend:** React/Vite, built and deployed with runtime via `deploy.sh`

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
- Claude retry: exponential backoff on 429/500/529, max 3 retries
- `NullDbClient` for dry-run mode (no DB writes)

## n8n Gotchas

- Code nodes cannot use `fetch()` — use `this.helpers.httpRequest()`
- Code nodes sandbox blocks `process.env` and `$env` — use HTTP Request node with `$env.VAR` in header expressions instead
- HTTP Request nodes can't handle expression-based JSON bodies — use Code node to prepare body, then HTTP Request node for the call
