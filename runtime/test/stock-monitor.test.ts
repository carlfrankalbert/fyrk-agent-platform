import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NullDbClient } from '../src/db/client.js';
import type { AgentContext } from '../src/agents/base.js';

// Mock env
vi.mock('../src/lib/env.js', () => ({
  getEnv: vi.fn(() => ({
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_KEY: 'fake-key',
    SLACK_STOCK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_CHANNEL_STOCK: '#stock-alerts',
    PORT: 8787,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
  })),
}));

// Mock slack
vi.mock('../src/lib/slack.js', () => ({
  postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '123.456' }),
}));

import { stockMonitorAgent } from '../src/agents/stock-monitor/index.js';
import { fetchStockStatus } from '../src/agents/stock-monitor/scraper.js';
import { postMessage } from '../src/lib/slack.js';
import { getEnv } from '../src/lib/env.js';

const mockPostMessage = vi.mocked(postMessage);
const mockGetEnv = vi.mocked(getEnv);

function createTestContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    db: new NullDbClient(),
    dryRun: true,
    publish: false,
    runId: 'test-run-id',
    ...overrides,
  };
}

const SAMPLE_API_RESPONSE = [
  {
    productId: 1216498,
    title: 'Logitech G Pro X Superlight 2',
    price: 1299,
    stockCount: 5,
    storesStockCount: 12,
    webStockStatus: 1,
    webStockMeta: 'InStock',
    canAddToCart: true,
    clickNCollectStoreCount: 3,
    stockDeliveryDate: null,
    stockDeliveryDateConfirmed: false,
  },
];

describe('stock-monitor scraper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse API response correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }),
    );

    const result = await fetchStockStatus(1216498);
    expect(result.productId).toBe(1216498);
    expect(result.title).toBe('Logitech G Pro X Superlight 2');
    expect(result.price).toBe(1299);
    expect(result.webStockStatus).toBe(1);
    expect(result.stockCount).toBe(5);
    expect(result.storesStockCount).toBe(12);
    expect(result.canAddToCart).toBe(true);
    expect(result.clickNCollectStoreCount).toBe(3);
    expect(result.stockDeliveryDate).toBeNull();
  });

  it('should throw on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    );

    await expect(fetchStockStatus(1216498)).rejects.toThrow('Power.no API returned HTTP 500');
  });

  it('should throw when product not found (empty array)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await expect(fetchStockStatus(999999)).rejects.toThrow('Product 999999 not found');
  });

  it('should call correct URL with product ID', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }),
    );

    await fetchStockStatus(1216498);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://www.power.no/api/v2/products?ids=1216498',
      { headers: { 'Accept': 'application/json' } },
    );
  });
});

describe('stock-monitor agent', () => {
  let ctx: AgentContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('first run (no previous state)', () => {
    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }),
      );
    });

    it('should set state and not send notification on first run', async () => {
      const result = await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      expect(result.output.previousStatus).toBeNull();
      expect(result.output.statusChanged).toBe(false);
      expect(result.output.notificationSent).toBe(false);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should persist state after first run', async () => {
      await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      const state = await ctx.db.getAgentState<{ webStockStatus: number }>(
        'stock-monitor',
        'stock_status_1216498',
      );
      expect(state).not.toBeNull();
      expect(state!.webStockStatus).toBe(1);
    });

    it('should return correct output fields', async () => {
      const result = await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      expect(result.output.productId).toBe(1216498);
      expect(result.output.title).toBe('Logitech G Pro X Superlight 2');
      expect(result.output.webStockStatus).toBe(1);
      expect(result.output.stockCount).toBe(5);
      expect(result.output.canAddToCart).toBe(true);
    });

    it('should produce a markdown artifact', async () => {
      const result = await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('stock-check');
      expect(result.artifacts[0].content).toContain('Logitech G Pro X Superlight 2');
      expect(result.artifacts[0].content).toContain('På nettlager');
    });
  });

  describe('same status (no change)', () => {
    it('should not send notification when status unchanged', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }));

      // First run sets state
      await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      // Second run — same status
      const result = await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      expect(result.output.statusChanged).toBe(false);
      expect(result.output.notificationSent).toBe(false);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  describe('status change to InStock', () => {
    it('should send notification when status changes to InStock', async () => {
      // First run: OutOfStock
      const outOfStock = [{ ...SAMPLE_API_RESPONSE[0], webStockStatus: 3, stockCount: 0, canAddToCart: false }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(outOfStock), { status: 200 }),
      );

      await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      // Second run: InStock
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }),
      );

      const result = await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      expect(result.output.statusChanged).toBe(true);
      expect(result.output.previousStatus).toBe(3);
      expect(result.output.notificationSent).toBe(true);
      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage).toHaveBeenCalledWith(
        'xoxb-test-token',
        '#stock-alerts',
        expect.any(Array),
        expect.stringContaining('tilgjengelig'),
      );
    });

    it('should include product URL in notification when provided', async () => {
      const outOfStock = [{ ...SAMPLE_API_RESPONSE[0], webStockStatus: 3, stockCount: 0 }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(outOfStock), { status: 200 }),
      );

      await stockMonitorAgent.execute({
        productId: 1216498,
        productUrl: 'https://www.power.no/p-1216498/',
      }, ctx);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }),
      );

      const result = await stockMonitorAgent.execute({
        productId: 1216498,
        productUrl: 'https://www.power.no/p-1216498/',
      }, ctx);

      expect(result.output.notificationSent).toBe(true);
      const blocks = mockPostMessage.mock.calls[0][2];
      const actionsBlock = blocks.find((b: { type: string }) => b.type === 'actions');
      expect(actionsBlock).toBeDefined();
    });
  });

  describe('status change away from InStock', () => {
    it('should update state but not send notification', async () => {
      // First run: InStock
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }),
      );

      await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      // Second run: OutOfStock
      const outOfStock = [{ ...SAMPLE_API_RESPONSE[0], webStockStatus: 3, stockCount: 0, canAddToCart: false }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(outOfStock), { status: 200 }),
      );

      const result = await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      expect(result.output.statusChanged).toBe(true);
      expect(result.output.previousStatus).toBe(1);
      expect(result.output.notificationSent).toBe(false);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  describe('missing Slack config', () => {
    it('should skip notification when SLACK_BOT_TOKEN is missing', async () => {
      mockGetEnv.mockReturnValue({
        SUPABASE_URL: 'https://fake.supabase.co',
        SUPABASE_SERVICE_KEY: 'fake-key',
        SLACK_STOCK_BOT_TOKEN: undefined,
        SLACK_CHANNEL_STOCK: '#stock-alerts',
        PORT: 8787,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
      } as ReturnType<typeof getEnv>);

      const outOfStock = [{ ...SAMPLE_API_RESPONSE[0], webStockStatus: 3, stockCount: 0 }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(outOfStock), { status: 200 }),
      );
      await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_API_RESPONSE), { status: 200 }),
      );
      const result = await stockMonitorAgent.execute({ productId: 1216498 }, ctx);

      expect(result.output.statusChanged).toBe(true);
      expect(result.output.notificationSent).toBe(false);
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  describe('API error handling', () => {
    it('should throw on API failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(
        stockMonitorAgent.execute({ productId: 1216498 }, ctx),
      ).rejects.toThrow('Power.no API returned HTTP 500');
    });

    it('should throw on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      await expect(
        stockMonitorAgent.execute({ productId: 1216498 }, ctx),
      ).rejects.toThrow('Network error');
    });
  });

  describe('input validation', () => {
    it('should reject negative productId', () => {
      const result = stockMonitorAgent.inputSchema.safeParse({ productId: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer productId', () => {
      const result = stockMonitorAgent.inputSchema.safeParse({ productId: 1.5 });
      expect(result.success).toBe(false);
    });

    it('should accept valid input with productUrl', () => {
      const result = stockMonitorAgent.inputSchema.safeParse({
        productId: 1216498,
        productUrl: 'https://www.power.no/p-1216498/',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid input without productUrl', () => {
      const result = stockMonitorAgent.inputSchema.safeParse({ productId: 1216498 });
      expect(result.success).toBe(true);
    });
  });
});
