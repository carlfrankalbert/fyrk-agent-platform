# n8n Workflows

This directory contains n8n workflow exports for the FYRK Agent Platform.

## Available Workflows

### release-notes-cron.json

Triggers the release-notes agent on a daily schedule.

**What it does:**
1. Runs daily via cron trigger
2. POSTs to the runtime service at `/run/release-notes`
3. Uses fixture mode with sample commits
4. Checks response status and logs result

## How to Import

1. Open n8n at http://localhost:5678
2. Go to **Workflows** in the left sidebar
3. Click **Add Workflow** → **Import from File**
4. Select `workflows/release-notes-cron.json`
5. Click **Save**

## Configuration

After importing, you may want to:

1. **Update the cron schedule** - Click the "Daily Trigger" node and adjust the interval
2. **Update the payload** - Click the "Call Release Notes Agent" node and modify the JSON body
3. **Add notifications** - Add Slack, email, or other notification nodes after the status check

## Environment Variables

When using Docker Compose, the runtime service is available at `http://runtime:8787`.

For local development, change the URL to `http://localhost:8787`.

## Testing Manually

You can test the workflow without waiting for the cron trigger:

1. Open the workflow in n8n
2. Click **Execute Workflow** in the top right
3. View the execution results in each node
