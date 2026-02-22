# Docs-Sync Agent

Analyserer kodeendringer i nettside_fyrk og oppretter PR med oppdaterte innholdssider.

## Arkitektur

```
Push til nettside_fyrk main
  → GitHub webhook → n8n.fyrk.no/webhook/docs-sync
  → n8n henter diffs + .astro-sider (GitHub API)
  → POST /run/docs-sync (fyrk-agent-runtime.fly.dev)
  → Claude Haiku analyserer diffs mot sider
  → n8n oppretter branch, committer oppdateringer, åpner PR
```

## Filer

### Runtime (Fly.io)

| Fil | Formål |
|-----|--------|
| `runtime/src/lib/claude.ts` | Claude API-wrapper (native fetch) |
| `runtime/src/agents/docs-sync/schemas.ts` | Zod input/output-skjemaer |
| `runtime/src/agents/docs-sync/index.ts` | Agent: bygger prompt, kaller Claude, parser svar |
| `runtime/src/lib/env.ts` | `ANTHROPIC_API_KEY` (optional) |
| `runtime/src/agents/registry.ts` | Registrerer `docs-sync` |

### n8n

| Fil | Formål |
|-----|--------|
| `n8n/workflows/docs-sync-nettside.json` | Komplett pipeline |

### Tester

| Fil | Formål |
|-----|--------|
| `runtime/test/docs-sync.test.ts` | 16 tester (mocked Claude) |
| `runtime/test/fixtures/docs_sync_basic.json` | Testdata |

## Agent input (bygget av n8n)

```json
{
  "repo": "carlfrankalbert/nettside_fyrk",
  "ref": "refs/heads/main",
  "beforeSha": "abc1234",
  "afterSha": "def5678",
  "changedFiles": [
    { "path": "src/lib/api/okr.ts", "diff": "...", "status": "modified" }
  ],
  "contentPages": [
    { "path": "src/pages/verktoy.astro", "content": "..." }
  ],
  "commitMessages": ["feat: add OKR progress tracking"]
}
```

## Agent output

```json
{
  "hasUpdates": true,
  "summary": "Verktøysiden bør oppdateres med info om OKR-fremdrift.",
  "suggestedUpdates": [
    {
      "path": "src/pages/verktoy.astro",
      "originalContent": "...",
      "updatedContent": "...",
      "reason": "Ny funksjonalitet bør reflekteres."
    }
  ],
  "prTitle": "docs: oppdater verktøyside",
  "prBody": "## Endringer\n- ..."
}
```

`hasUpdates` styrer n8n IF-noden. Når `false` → ingen branch/PR.

## n8n-pipeline (noder)

```
Webhook → Resolve Token (Set) → Fetch Context & Run Agent (Code)
  → Status OK? (IF) → Has Updates? (IF)
  → Create Branch & Commit Updates & PR (Code) → Success
```

### Viktige detaljer

- **Resolve Token**: Set-node som resolver `$env.GITHUB_TOKEN` via n8n expression, passerer token gjennom dataflyt til Code-noder (Code-noder kan ikke bruke `$vars`/`$env` direkte)
- **Fetch Context & Run Agent**: Henter compare-diff, tree, .astro-sideinnhold fra GitHub API, kaller agent runtime
- **Create Branch & Commit & PR**: Oppretter branch, committer filer, oppretter PR — alt via `this.helpers.httpRequest` i en Code-node (HTTP Request-noder feiler med expression-baserte JSON-bodies)
- Chore-only pushes filtreres ut tidlig
- Maks 20 .astro-sider hentes per kjøring

## Kalle agenten direkte

```bash
curl -X POST https://fyrk-agent-runtime.fly.dev/run/docs-sync \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1",
    "input": { ... },
    "dryRun": false,
    "publish": true
  }'
```

## Secrets

- **Fly.io**: `ANTHROPIC_API_KEY` (fly secrets)
- **n8n container**: `GITHUB_TOKEN` (env var, tilgjengelig via `$env` i expressions)
