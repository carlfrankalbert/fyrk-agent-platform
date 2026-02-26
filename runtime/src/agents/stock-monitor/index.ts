import type { AgentDefinition, AgentContext, AgentResult } from '../base.js';
import {
  StockMonitorInputSchema,
  StockMonitorOutputSchema,
  type StockMonitorInput,
  type StockMonitorOutput,
} from './schemas.js';
import { fetchStockStatus } from './scraper.js';
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

async function execute(
  input: StockMonitorInput,
  ctx: AgentContext,
): Promise<AgentResult<StockMonitorOutput>> {
  const result = await fetchStockStatus(input.productId);

  // Read previous state
  const prev = await ctx.db.getAgentState<{ webStockStatus: number }>(
    'stock-monitor',
    `stock_status_${input.productId}`,
  );
  const previousStatus = prev?.webStockStatus ?? null;
  const statusChanged = previousStatus !== null && previousStatus !== result.webStockStatus;

  // Upsert state on any change (or first run)
  if (statusChanged || previousStatus === null) {
    await ctx.db.setAgentState('stock-monitor', `stock_status_${input.productId}`, {
      webStockStatus: result.webStockStatus,
      stockCount: result.stockCount,
      title: result.title,
      updatedAt: new Date().toISOString(),
    });
  }

  // Send Slack notification only when status changes to InStock (1)
  let notificationSent = false;
  if (statusChanged && result.webStockStatus === 1) {
    const env = getEnv();
    const token = env.SLACK_BOT_TOKEN;
    const channel = env.SLACK_CHANNEL_STOCK;

    if (token && channel) {
      const blocks = buildSlackBlocks(result, previousStatus, input.productUrl);
      await postMessage(token, channel, blocks, `${result.title} er nå tilgjengelig på Power.no!`);
      notificationSent = true;
    } else {
      console.warn('stock-monitor: SLACK_BOT_TOKEN or SLACK_CHANNEL_STOCK not set, skipping notification');
    }
  }

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

  return {
    output,
    artifacts: [
      {
        kind: 'stock-check',
        content: lines.join('\n'),
        meta: {
          productId: result.productId,
          statusChanged,
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
