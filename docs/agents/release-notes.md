# Release Notes Agent

**Name:** `release-notes`
**Version:** `0.1`

Generates structured release notes from commit data.

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
| `chore:` | Chores |
| `docs:` | Chores |
| `refactor:` | Chores |
| `test:` | Chores |
| `style:` | Chores |
| `perf:` | Features |
| `ci:` | Chores |
| `build:` | Chores |

## Risk Detection

The agent scans commit messages for risk keywords:

- `breaking` - Breaking changes
- `migration` - Database or data migrations
- `security` - Security-related changes
- `pii` - Personal identifiable information
- `auth` - Authentication/authorization
- `db` - Database changes
- `payment` - Payment processing

Commits with risk keywords are flagged in the Risk Notes section.

## Output

### JSON Response

```json
{
  "title": "Release Notes: v0.1.0..v0.1.1",
  "highlights": ["Add new feature", "Fix critical bug"],
  "changes": {
    "features": [...],
    "fixes": [...],
    "chores": [...]
  },
  "riskNotes": ["⚠️ feat: add breaking change (keywords: breaking)"]
}
```

### Markdown Artifact

Generates a markdown document with:

- Title and metadata (repo, range, date)
- Highlights section (top 5 notable changes)
- Features section
- Fixes section
- Chores section
- Risk Notes section (if risks detected)

Each commit includes a link to the GitHub commit page.

## Usage Example

```bash
curl -X POST http://localhost:8787/run/release-notes \
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
    "dryRun": false
  }'
```

## Dry Run Mode

Set `"dryRun": true` to test the agent without writing to the database.

```bash
curl -X POST http://localhost:8787/run/release-notes \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1",
    "input": { ... },
    "dryRun": true
  }'
```
