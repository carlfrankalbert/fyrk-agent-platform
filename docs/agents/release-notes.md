# Release Notes Agent

**Name:** `release-notes`
**Version:** `0.1`

Generates structured release notes from commit data with Norwegian-style markdown output.

## Input Modes

### Fixture Mode (Implemented)

Use fixture mode to generate release notes from pre-provided commit data.

```json
{
  "mode": "fixture",
  "repo": "owner/name",
  "rangeLabel": "v0.1.0..v0.1.1",
  "commits": [
    {
      "sha": "abc123",
      "message": "feat: add new feature",
      "author": "developer",
      "url": "https://github.com/owner/name/commit/abc123"
    }
  ]
}
```

### GitHub Mode (Not Implemented)

Future mode to fetch commits directly from GitHub API.

```json
{
  "mode": "github",
  "repo": "owner/name",
  "from": "v0.1.0",
  "to": "v0.1.1"
}
```

Returns error: `"github mode not implemented yet"`

## Commit Categorization

Commits are categorized based on conventional commit prefixes:

| Prefix | Category |
|--------|----------|
| `feat:` | Features |
| `fix:` | Fixes |
| `chore:` | Maintenance |
| `docs:` | Maintenance |
| `refactor:` | Maintenance |
| `test:` | Maintenance |
| `style:` | Maintenance |
| `perf:` | Features |
| `ci:` | Maintenance |
| `build:` | Maintenance |

## Risk Detection

The agent scans commit messages for risk keywords using word-boundary regex (`\bkw\b`):

- `breaking` - Breaking changes
- `migration` - Database or data migrations
- `security` - Security-related changes
- `pii` - Personal identifiable information
- `auth` - Authentication/authorization
- `db` - Database changes
- `payment` - Payment processing

Commits with risk keywords are flagged in the Risk Notes section. When risks are present, a rollback/mitigation section is included.

## Output

### JSON Response

```json
{
  "title": "Release Notes: v0.1.0..v0.1.1",
  "date": "2026-02-19",
  "executiveSummary": "Denne releasen inneholder 2 nye funksjoner og 1 feilretting.",
  "highlights": ["Add new feature", "Fix critical bug"],
  "changes": {
    "features": [...],
    "fixes": [...],
    "chores": [...]
  },
  "impact": ["2 nye funksjoner påvirker brukeropplevelsen"],
  "maintenance": ["Update dependencies"],
  "riskNotes": [],
  "rollback": null
}
```

### Markdown Artifact

Generates a Norwegian-style markdown document with:

- **Title:** `# Release notes — main`
- **Date**
- **Executive summary**
- **Highlights** (max 3)
- **Changes** with subsections: Features, Fixes, Maintenance
- **Impact**
- **Links** to commits
- **Risk & Notes** (only when risks detected)
- **Rollback / Mitigation** (only when risks detected)

Norwegian verbs are used for change items:

| Action | Norwegian |
|--------|-----------|
| feat/add | Lagt til |
| fix | Rettet |
| improve/refactor | Forbedret |
| update | Oppdatert |
| remove/delete | Fjernet |

Conventional commit prefixes (`feat`, `fix`, `chore`, `refactor`) are stripped from all markdown output.

## Usage Example

```bash
curl -X POST https://fyrk-agent-runtime.fly.dev/run/release-notes \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1",
    "input": {
      "mode": "fixture",
      "repo": "fyrk/my-project",
      "rangeLabel": "v1.0.0..v1.1.0",
      "commits": [
        {
          "sha": "abc123",
          "message": "feat: add user dashboard",
          "author": "alice",
          "url": "https://github.com/fyrk/my-project/commit/abc123"
        }
      ]
    },
    "publish": true
  }'
```

## Dry Run Mode

Set `"dryRun": true` to test the agent without writing to the database.

## Publish Flag

Set `"publish": true` to signal downstream systems (n8n) to publish the output. The flag is echoed in the response for easy IF-node checking.

## Tests

29 tests covering categorization, highlights, risk detection, output fields, markdown generation, and error handling.

```bash
cd runtime
pnpm test
```
