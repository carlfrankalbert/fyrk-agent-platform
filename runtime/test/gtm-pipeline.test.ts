import { describe, it, expect, beforeEach, vi } from 'vitest';
import { evaluatePivotTriggers } from '../src/agents/gtm-pipeline/triggers.js';
import { buildDashboardBlocks } from '../src/agents/gtm-pipeline/slack.js';
import type { GtmMetrics, GtmLead, PivotTrigger } from '../src/agents/gtm-pipeline/schemas.js';

// --- Mock env, supabase, slack for agent tests ---
vi.mock('../src/lib/env.js', () => ({
  getEnv: () => ({
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_KEY: 'fake-key',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_CHANNEL_GTM: '#gtm-carl',
    PORT: 8787,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
  }),
}));

const mockPostMessage = vi.fn().mockResolvedValue({ ok: true, ts: '123' });
vi.mock('../src/lib/slack.js', () => ({
  postMessage: (...args: unknown[]) => mockPostMessage(...args),
}));

const mockFrom = vi.fn();
vi.mock('../src/lib/supabase.js', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { gtmPipelineAgent } from '../src/agents/gtm-pipeline/index.js';
import { createTestContext } from './helpers/claude-agent.js';

function makeLead(overrides: Partial<GtmLead> = {}): GtmLead {
  return {
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    score: null,
    company_name: 'Test AS',
    company_size: null,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<GtmMetrics> = {}): GtmMetrics {
  return {
    activeCalls: 0,
    offersSent: 0,
    paidDays: null,
    folqInbound: null,
    icpComments: null,
    ...overrides,
  };
}

describe('evaluatePivotTriggers', () => {
  it('returns T1 when week >= 6, conversations >= 15, offers = 0', () => {
    const leads = [
      ...Array.from({ length: 10 }, () => makeLead({ status: 'active' })),
      ...Array.from({ length: 5 }, () => makeLead({ status: 'not_relevant' })),
    ];
    const metrics = makeMetrics({ activeCalls: 10, offersSent: 0 });

    const triggers = evaluatePivotTriggers(metrics, 6, leads);
    expect(triggers).toContainEqual(expect.objectContaining({ id: 'T1', severity: 'critical' }));
  });

  it('does not return T1 before week 6', () => {
    const leads = Array.from({ length: 15 }, () => makeLead({ status: 'active' }));
    const metrics = makeMetrics({ offersSent: 0 });

    const triggers = evaluatePivotTriggers(metrics, 5, leads);
    expect(triggers.find((t) => t.id === 'T1')).toBeUndefined();
  });

  it('returns T2 when signed leads all have company_size < 30', () => {
    const leads = [
      makeLead({ status: 'signed', company_size: 20 }),
      makeLead({ status: 'signed', company_size: 25 }),
    ];
    const metrics = makeMetrics();

    const triggers = evaluatePivotTriggers(metrics, 4, leads);
    expect(triggers).toContainEqual(expect.objectContaining({ id: 'T2', severity: 'warning' }));
  });

  it('skips T2 silently when signed leads have no company_size', () => {
    const leads = [
      makeLead({ status: 'signed', company_size: null }),
      makeLead({ status: 'signed', company_size: null }),
    ];
    const metrics = makeMetrics();

    const triggers = evaluatePivotTriggers(metrics, 4, leads);
    expect(triggers.find((t) => t.id === 'T2')).toBeUndefined();
  });

  it('returns T3 at week >= 12 and paidDays = 0', () => {
    const metrics = makeMetrics({ paidDays: 0 });
    const triggers = evaluatePivotTriggers(metrics, 12, []);
    expect(triggers).toContainEqual(expect.objectContaining({ id: 'T3', severity: 'critical' }));
  });

  it('skips T3 silently when paidDays is null', () => {
    const metrics = makeMetrics({ paidDays: null });
    const triggers = evaluatePivotTriggers(metrics, 14, []);
    expect(triggers.find((t) => t.id === 'T3')).toBeUndefined();
  });

  it('returns T5 when Folq inbound is strong', () => {
    const metrics = makeMetrics({ activeCalls: 4, folqInbound: 3 });
    const triggers = evaluatePivotTriggers(metrics, 4, []);
    expect(triggers).toContainEqual(expect.objectContaining({ id: 'T5', severity: 'warning' }));
  });

  it('skips T5 silently when folqInbound is null', () => {
    const metrics = makeMetrics({ activeCalls: 4, folqInbound: null });
    const triggers = evaluatePivotTriggers(metrics, 4, []);
    expect(triggers.find((t) => t.id === 'T5')).toBeUndefined();
  });

  it('returns empty array for healthy pipeline', () => {
    const leads = [
      makeLead({ status: 'active' }),
      makeLead({ status: 'offer_sent' }),
      makeLead({ status: 'signed', company_size: 50 }),
    ];
    const metrics = makeMetrics({
      activeCalls: 1,
      offersSent: 1,
      paidDays: 5,
      folqInbound: 0,
    });

    const triggers = evaluatePivotTriggers(metrics, 8, leads);
    expect(triggers).toHaveLength(0);
  });
});

describe('buildDashboardBlocks', () => {
  it('shows "_ikke logget_" for null metrics', () => {
    const metrics = makeMetrics();
    const blocks = buildDashboardBlocks(metrics, [], 10);

    const sectionBlock = blocks.find((b) => b.type === 'section' && b.fields);
    expect(sectionBlock).toBeDefined();

    const fields = sectionBlock!.fields as Array<{ text: string }>;
    const paidField = fields.find((f) => f.text.includes('Betalte dager'));
    expect(paidField?.text).toContain('_ikke logget_');
  });

  it('shows hint when manual metrics are missing', () => {
    const metrics = makeMetrics();
    const blocks = buildDashboardBlocks(metrics, [], 10);

    const contextBlock = blocks.find((b) => b.type === 'context');
    expect(contextBlock).toBeDefined();
    const elements = contextBlock!.elements as Array<{ text: string }>;
    expect(elements[0].text).toContain('gtm-log');
  });

  it('does not show hint when all metrics are logged', () => {
    const metrics = makeMetrics({ paidDays: 5, folqInbound: 2, icpComments: 3 });
    const blocks = buildDashboardBlocks(metrics, [], 10);

    const contextBlock = blocks.find((b) => b.type === 'context');
    expect(contextBlock).toBeUndefined();
  });

  it('shows pivot triggers when present', () => {
    const triggers: PivotTrigger[] = [
      { id: 'T1', message: 'Test trigger', severity: 'critical' },
    ];
    const blocks = buildDashboardBlocks(makeMetrics(), triggers, 10);

    const triggerBlock = blocks.find(
      (b) => b.type === 'section' && (b.text as { text: string })?.text?.includes('Pivot-triggere'),
    );
    expect(triggerBlock).toBeDefined();
    expect((triggerBlock!.text as { text: string }).text).toContain('🚨');
    expect((triggerBlock!.text as { text: string }).text).toContain('Test trigger');
  });

  it('shows checkmark when no triggers', () => {
    const blocks = buildDashboardBlocks(makeMetrics(), [], 10);

    const noTriggerBlock = blocks.find(
      (b) => b.type === 'section' && (b.text as { text: string })?.text?.includes('Ingen pivot-triggere'),
    );
    expect(noTriggerBlock).toBeDefined();
  });
});

describe('gtm-pipeline agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries leads with gtm_context filter', async () => {
    // Set up Supabase mock chain
    const selectMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockImplementation(function (this: unknown) {
      return this;
    });
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });

    // First call: leads query
    const leadsChain = {
      select: selectMock,
      eq: eqMock,
      then: undefined as unknown,
    };
    // Make it return data on await
    (leadsChain as Record<string, unknown>).then = (resolve: (v: unknown) => void) =>
      resolve({ data: [makeLead({ status: 'active' })], error: null });

    // Second call: log query
    const logChain = {
      select: selectMock,
      eq: vi.fn().mockReturnThis(),
      maybeSingle: maybeSingleMock,
    };

    // Third call: upsert
    const upsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [makeLead({ status: 'active' })],
              error: null,
            }),
          }),
        };
      }
      if (table === 'gtm_pipeline_log' && callCount <= 2) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      // upsert call
      return {
        upsert: upsertMock,
      };
    });

    const ctx = createTestContext({ dryRun: true });
    const result = await gtmPipelineAgent.execute({ weekOverride: 10 }, ctx);

    expect(result.output.weekNumber).toBe(10);
    expect(result.output.metrics.activeCalls).toBe(1);
    expect(result.output.slackPosted).toBe(false);
  });

  it('does not post to Slack when dryRun is true', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'gtm_pipeline_log') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const ctx = createTestContext({ dryRun: true });
    const result = await gtmPipelineAgent.execute({ weekOverride: 10 }, ctx);

    expect(result.output.slackPosted).toBe(false);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('posts to Slack when dryRun is false', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'gtm_pipeline_log') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const ctx = createTestContext({ dryRun: false });
    const result = await gtmPipelineAgent.execute({ weekOverride: 10 }, ctx);

    expect(result.output.slackPosted).toBe(true);
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });

  it('produces a markdown artifact', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'gtm_pipeline_log') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const ctx = createTestContext({ dryRun: true });
    const result = await gtmPipelineAgent.execute({ weekOverride: 10 }, ctx);

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].kind).toBe('gtm-dashboard');
    expect(result.artifacts[0].content).toContain('GTM Dashboard — Uke 10');
  });
});
