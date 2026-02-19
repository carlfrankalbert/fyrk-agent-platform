# n8n Workflows

This directory contains documentation for the FYRK Agent Platform n8n workflows.

## Production Pipeline

**Workflow:** Release Notes — GitHub Push → Runtime → Publish

Automatically generates and publishes release notes on every push to main.

### Flow

```
Webhook → Run agent → Status OK? ─ True → Publish? ─ True → Commit release notes
                           │                    │
                           └─ False → Alert      └─ False → (stop)
```

### Nodes

| Node | Type | Description |
|------|------|-------------|
| Webhook | Webhook | Receives GitHub push events at `/webhook/release-notes` |
| Run agent | Code | Maps webhook data and calls `POST /run/release-notes` on Fly.io |
| Status OK? | IF | Checks `$json.status === "ok"` |
| Publish? | IF | Checks `$json.publish === "true"` |
| Commit release notes | Code | Base64-encodes markdown artifact and commits to `releases/YYYY-MM-DD.md` via GitHub API |
| Alert — agent failed | Slack | Posts error details to `#alerts` channel |

### Webhook URL

Production: `https://n8n.fyrk.no/webhook/release-notes`

Configured in GitHub repo → Settings → Webhooks.

### Cloudflare Tunnel

n8n runs locally and is exposed via a named Cloudflare tunnel:

```bash
# Start the tunnel
cloudflared tunnel run fyrk-n8n

# Config location
~/.cloudflared/config.yml
```

The tunnel routes `n8n.fyrk.no` → `localhost:5678`.

### Technical Notes

- n8n Code nodes cannot use `fetch()` — use `this.helpers.httpRequest()` instead
- n8n HTTP Request nodes do not support expression-based JSON bodies — use Code nodes with `this.helpers.httpRequest()` for dynamic payloads
- The `publish` flag is echoed in the API response so the IF node can check `$json.publish` directly

### Testing

1. Push any commit to main
2. Check n8n Executions tab for the new run
3. Verify `releases/YYYY-MM-DD.md` was created in the repo
