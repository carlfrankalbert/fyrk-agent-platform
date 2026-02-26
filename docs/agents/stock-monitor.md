# Codex Prompt — Implement FYRK Stock Monitor Agent

You are working inside an existing FYRK agent runtime.

The platform already provides:

* `AgentDefinition` interface with `name`, `version`, `inputSchema`, `outputSchema`, `execute(input, ctx)`
* `runAgent` execution system
* Agent registry via `Map` in `registry.ts`
* Slack notification via `postMessage()` from `lib/slack.ts`
* Supabase client for persistence
* Fly.io deployment (always running)
* n8n cron trigger calling `POST /run/:agentName`

---

## Objective

Create a stock monitoring agent that:

* Calls the Power.no product API to check stock status
* Detects stock availability changes
* Persists last known status in Supabase
* Sends Slack notification when item becomes available
* Avoids duplicate notifications
* Runs safely and reliably inside the existing runtime

---

## Required Files

Create:

```
runtime/src/agents/stock-monitor/
  index.ts       — agent definition + execute
  scraper.ts     — Power.no API client
  schemas.ts     — Zod input/output schemas
supabase/migrations/
  0017_agent_state.sql  — generic agent state table
```

Modify:

```
runtime/src/agents/registry.ts   — register new agent
runtime/src/lib/env.ts           — add SLACK_CHANNEL_STOCK env var
```

---

## Power.no API

Power.no exposes an unauthenticated REST API. Do NOT scrape HTML.

### Product endpoint

```
GET https://www.power.no/api/v2/products?ids={productId}
Accept: application/json
```

Returns an array of product objects. Key stock fields:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | number | Product ID |
| `title` | string | Product name |
| `price` | number | Price in NOK (incl. VAT) |
| `stockCount` | number | Web warehouse stock quantity |
| `storesStockCount` | number | Total stock across all physical stores |
| `webStockStatus` | 1 \| 2 \| 3 | 1=InStock, 2=ComingIn, 3=OutOfStock |
| `webStockMeta` | string | `"InStock"` or `"OutOfStock"` |
| `canAddToCart` | boolean | Whether add-to-cart is enabled |
| `clickNCollectStoreCount` | number | Stores offering Click & Collect |
| `stockDeliveryDate` | string? | ISO date for expected restock (when status=2) |
| `stockDeliveryDateConfirmed` | boolean | Whether delivery date is confirmed |

### `webStockStatus` enum

| Value | Meaning | `canAddToCart` |
|-------|---------|----------------|
| 1 | In Stock (web warehouse) | true |
| 2 | Coming In (backorder, expected date may be set) | true |
| 3 | Out of Stock | varies |

### Product ID

The numeric value from the URL path. Example: `/p-1216498/` → `productId = 1216498`

---

## scraper.ts Requirements

Implement a typed Power.no API client:

```ts
export interface PowerStockResult {
  productId: number
  title: string
  price: number
  stockCount: number
  storesStockCount: number
  webStockStatus: 1 | 2 | 3
  canAddToCart: boolean
  clickNCollectStoreCount: number
  stockDeliveryDate: string | null
}

export async function fetchStockStatus(productId: number): Promise<PowerStockResult>
```

Implementation requirements:

* Call `https://www.power.no/api/v2/products?ids={productId}`
* Set `Accept: application/json` header
* Validate response is an array with at least one element
* Map the API response to `PowerStockResult`
* Throw descriptive error if product not found or API returns non-200
* Never throw unhandled exceptions — wrap in try/catch at call site

---

## schemas.ts Requirements

Define Zod schemas following existing patterns:

```ts
import { z } from 'zod'

export const StockMonitorInputSchema = z.object({
  productId: z.number().int().positive(),
  productUrl: z.string().url().optional(),
})

export type StockMonitorInput = z.infer<typeof StockMonitorInputSchema>

export const StockMonitorOutputSchema = z.object({
  productId: z.number(),
  title: z.string(),
  webStockStatus: z.number(),
  stockCount: z.number(),
  storesStockCount: z.number(),
  canAddToCart: z.boolean(),
  previousStatus: z.number().nullable(),
  statusChanged: z.boolean(),
  notificationSent: z.boolean(),
})

export type StockMonitorOutput = z.infer<typeof StockMonitorOutputSchema>
```

---

## index.ts Requirements

Register agent using the actual `AgentDefinition` interface:

```ts
import type { AgentDefinition, AgentContext, AgentResult } from '../base.js'
import { StockMonitorInputSchema, StockMonitorOutputSchema, type StockMonitorInput, type StockMonitorOutput } from './schemas.js'
import { fetchStockStatus } from './scraper.js'
import { postMessage, type SlackBlock } from '../../lib/slack.js'
import { getEnv } from '../../lib/env.js'

export const stockMonitorAgent: AgentDefinition<StockMonitorInput, StockMonitorOutput> = {
  name: 'stock-monitor',
  version: '0.1',
  inputSchema: StockMonitorInputSchema,
  outputSchema: StockMonitorOutputSchema,
  execute,
}
```

---

## Execution Logic

Inside `execute(input: StockMonitorInput, ctx: AgentContext)`:

1. Call scraper:

```ts
const result = await fetchStockStatus(input.productId)
```

2. Fetch last known state from Supabase `agent_state` table:

```ts
const { data: prev } = await supabase
  .from('agent_state')
  .select('value')
  .eq('agent_id', 'stock-monitor')
  .eq('key', `stock_status_${input.productId}`)
  .maybeSingle()
```

3. Compare previous vs current `webStockStatus`

4. If status changed to available (webStockStatus === 1):

* Upsert new state in Supabase
* Send Slack notification

5. If status changed to anything else:

* Upsert new state (track all transitions)
* Do NOT send Slack notification

6. Return structured output + markdown artifact summarizing the check

---

## Slack Notification

Import and call `postMessage` directly from `lib/slack.ts`:

```ts
const env = getEnv()
const token = env.SLACK_BOT_TOKEN
const channel = env.SLACK_CHANNEL_STOCK

await postMessage(token, channel, blocks, fallbackText)
```

Build Block Kit message with:

* Product title
* Status: "På nettlager" / "Kommer inn" / "Ikke på lager"
* Price
* Stock count
* Link to product page
* Previous status for context

Do NOT reimplement Slack client. Do NOT use `ctx.postMessage()` (it does not exist).

---

## Supabase Migration

Create `supabase/migrations/0017_agent_state.sql`:

```sql
create table if not exists agent_state (
  agent_id text not null,
  key text not null,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (agent_id, key)
);

alter table agent_state enable row level security;

create policy "Service role full access"
  on agent_state
  for all
  using (true)
  with check (true);
```

This is a generic key-value table reusable by any agent.

---

## Environment Variable

Add to `runtime/src/lib/env.ts` in the optional section:

```ts
SLACK_CHANNEL_STOCK: z.string().optional(),
```

Also add as Fly secret:

```bash
fly secrets set SLACK_CHANNEL_STOCK="#stock-alerts" --app fyrk-agent-runtime
```

---

## Agent Registration

In `runtime/src/agents/registry.ts`, add:

```ts
import { stockMonitorAgent } from './stock-monitor/index.js'

agents.set('stock-monitor', stockMonitorAgent as AgentDefinition<unknown, unknown>)
```

Follow the exact same pattern as existing agents.

---

## n8n Trigger (optional, later)

Cron workflow calling:

```
POST https://fyrk-agent-runtime.fly.dev/run/stock-monitor
Content-Type: application/json

{
  "input": {
    "productId": 1216498,
    "productUrl": "https://www.power.no/data-og-tilbehoer/datamus/logitech-g-pro-x-superlight-2-tradloes-mus-svart/p-1216498/"
  }
}
```

Suggested interval: every 15 minutes.

---

## Reliability Requirements

Must:

* Never crash the runtime
* Handle network errors safely (Power.no API down, timeouts)
* Log failures via `ctx.db` (runAgent already handles this)
* Continue execution normally next run
* Skip Slack notification if `SLACK_BOT_TOKEN` or `SLACK_CHANNEL_STOCK` is not set (log warning instead)

---

## Design Constraints

Must:

* Follow existing runtime patterns exactly
* Reuse platform infrastructure (Supabase client, Slack, env validation)
* Not introduce new dependencies (no Puppeteer, no Playwright)
* Use the Power.no REST API, not HTML scraping
* Keep implementation minimal and clean

---

## Deliverables

1. `runtime/src/agents/stock-monitor/index.ts`
2. `runtime/src/agents/stock-monitor/scraper.ts`
3. `runtime/src/agents/stock-monitor/schemas.ts`
4. `supabase/migrations/0017_agent_state.sql`
5. Modified: `runtime/src/agents/registry.ts`
6. Modified: `runtime/src/lib/env.ts`

Fully compatible with existing FYRK runtime.
