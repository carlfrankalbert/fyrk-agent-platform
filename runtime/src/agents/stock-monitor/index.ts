import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import {
  StockMonitorInputSchema,
  StockMonitorOutputSchema,
  type StockMonitorInput,
  type StockMonitorOutput,
  type StoreWithStock,
} from './schemas.js';
import { fetchStockStatus, fetchStoreStock } from './scraper.js';
import { postMessage, type SlackBlock } from '../../lib/slack.js';
import { getEnv } from '../../lib/env.js';

const STATUS_LABELS: Record<number, string> = {
  1: 'På nettlager',
  2: 'Kommer inn',
  3: 'Ikke på lager',
};

function buildSlackBlocks(
  result: { title: string; price: number; stockCount: number; storesStockCount: number; webStockStatus: number; canAddToCart: boolean },
  previousStatus: number | null,
  productUrl?: string,
): SlackBlock[] {
  const statusLabel = STATUS_LABELS[result.webStockStatus] ?? `Ukjent (${result.webStockStatus})`;
  const prevLabel = previousStatus != null ? (STATUS_LABELS[previousStatus] ?? `Ukjent (${previousStatus})`) : 'Ingen tidligere status';

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🟢 ${result.title} er tilgjengelig!` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Status:*\n${statusLabel}` },
        { type: 'mrkdwn', text: `*Pris:*\n${result.price} kr` },
        { type: 'mrkdwn', text: `*Nettlager:*\n${result.stockCount} stk` },
        { type: 'mrkdwn', text: `*Butikker:*\n${result.storesStockCount} stk` },
      ],
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Forrige status: ${prevLabel}` },
      ],
    },
  ];

  if (productUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Se på Power.no' },
          url: productUrl,
          action_id: 'open_product',
        },
      ],
    });
  }

  return blocks;
}

function buildStoreStockBlocks(
  title: string,
  newStores: StoreWithStock[],
  productUrl?: string,
): SlackBlock[] {
  const storeLines = newStores
    .map((s) => `• *${s.name}*: ${s.stockCount} stk`)
    .join('\n');

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🏬 ${title} på lager i butikk!` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `Nye butikker med lager:\n${storeLines}` },
    },
  ];

  if (productUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Se på Power.no' },
          url: productUrl,
          action_id: 'open_product_store',
        },
      ],
    });
  }

  return blocks;
}

interface StoreStockState {
  storeIds: number[];
  updatedAt: string;
}

async function execute(
  input: StockMonitorInput,
  ctx: AgentContext,
): Promise<AgentResult<StockMonitorOutput>> {
  const result = await fetchStockStatus(input.productId);

  // --- Web stock monitoring (existing) ---
  const prev = await ctx.db.getAgentState<{ webStockStatus: number }>(
    'stock-monitor',
    `stock_status_${input.productId}`,
  );
  const previousStatus = prev?.webStockStatus ?? null;
  const statusChanged = previousStatus !== null && previousStatus !== result.webStockStatus;

  if (statusChanged || previousStatus === null) {
    await ctx.db.setAgentState('stock-monitor', `stock_status_${input.productId}`, {
      webStockStatus: result.webStockStatus,
      stockCount: result.stockCount,
      title: result.title,
      updatedAt: new Date().toISOString(),
    });
  }

  let webNotificationSent = false;
  const env = getEnv();
  const token = env.SLACK_STOCK_BOT_TOKEN;
  const channel = env.SLACK_CHANNEL_STOCK;

  if (statusChanged && result.webStockStatus === 1) {
    if (token && channel) {
      const blocks = buildSlackBlocks(result, previousStatus, input.productUrl);
      await postMessage(token, channel, blocks, `${result.title} er nå tilgjengelig på Power.no!`);
      webNotificationSent = true;
    } else {
      console.warn('stock-monitor: SLACK_STOCK_BOT_TOKEN or SLACK_CHANNEL_STOCK not set, skipping notification');
    }
  }

  // --- Store stock monitoring (new) ---
  let storesWithStock: StoreWithStock[] = [];
  let storeStockChanged = false;
  let storeNotificationSent = false;

  if (input.watchedStoreIds && input.watchedStoreIds.length > 0 && input.postalCode) {
    const allStores = await fetchStoreStock(input.productId, input.postalCode);

    const watchedSet = new Set(input.watchedStoreIds);
    storesWithStock = allStores
      .filter((s) => watchedSet.has(s.storeId) && s.storeStockCount > 0)
      .map((s) => ({ storeId: s.storeId, name: s.name, stockCount: s.storeStockCount }));

    // Read previous store state
    const prevStoreState = await ctx.db.getAgentState<StoreStockState>(
      'stock-monitor',
      `store_stock_${input.productId}`,
    );
    const prevStoreIds = new Set(prevStoreState?.storeIds ?? []);
    const currentStoreIds = storesWithStock.map((s) => s.storeId);

    // Detect newly available stores
    const newStores = storesWithStock.filter((s) => !prevStoreIds.has(s.storeId));
    storeStockChanged = newStores.length > 0;

    // Upsert store state (always, to track current stock)
    await ctx.db.setAgentState('stock-monitor', `store_stock_${input.productId}`, {
      storeIds: currentStoreIds,
      updatedAt: new Date().toISOString(),
    } satisfies StoreStockState);

    // Send store notification only for newly available stores (not on first run)
    if (storeStockChanged && prevStoreState !== null) {
      if (token && channel) {
        const blocks = buildStoreStockBlocks(result.title, newStores, input.productUrl);
        const storeNames = newStores.map((s) => s.name).join(', ');
        await postMessage(token, channel, blocks, `${result.title} på lager i: ${storeNames}`);
        storeNotificationSent = true;
      }
    }
  }

  const notificationSent = webNotificationSent || storeNotificationSent;

  const output: StockMonitorOutput = {
    productId: result.productId,
    title: result.title,
    webStockStatus: result.webStockStatus,
    stockCount: result.stockCount,
    storesStockCount: result.storesStockCount,
    canAddToCart: result.canAddToCart,
    previousStatus,
    statusChanged,
    notificationSent,
    storesWithStock,
    storeStockChanged,
  };

  // Build markdown artifact
  const statusLabel = STATUS_LABELS[result.webStockStatus] ?? `Ukjent (${result.webStockStatus})`;
  const lines = [
    `# Lagersjekk: ${result.title}`,
    '',
    `- **Status:** ${statusLabel}`,
    `- **Nettlager:** ${result.stockCount} stk`,
    `- **Butikker:** ${result.storesStockCount} stk`,
    `- **Kan legges i handlekurv:** ${result.canAddToCart ? 'Ja' : 'Nei'}`,
    `- **Pris:** ${result.price} kr`,
    '',
    `Forrige status: ${previousStatus !== null ? (STATUS_LABELS[previousStatus] ?? previousStatus) : 'Ingen'}`,
    `Endret: ${statusChanged ? 'Ja' : 'Nei'}`,
    `Varsling sendt: ${notificationSent ? 'Ja' : 'Nei'}`,
  ];

  if (storesWithStock.length > 0) {
    lines.push('', '## Butikker med lager');
    for (const store of storesWithStock) {
      lines.push(`- ${store.name}: ${store.stockCount} stk`);
    }
  }

  return {
    output,
    artifacts: [
      {
        kind: 'stock-check',
        content: lines.join('\n'),
        meta: {
          productId: result.productId,
          statusChanged,
          storeStockChanged,
          notificationSent,
        },
      },
    ],
  };
}

export const stockMonitorAgent: AgentDefinition<StockMonitorInput, StockMonitorOutput> = {
  name: 'stock-monitor',
  version: '0.1',
  inputSchema: StockMonitorInputSchema,
  outputSchema: StockMonitorOutputSchema,
  execute,
};
