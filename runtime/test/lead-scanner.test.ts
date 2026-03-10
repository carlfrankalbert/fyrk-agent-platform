import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ClaudeSignalsResponse, LeadScannerOutput } from '../src/agents/lead-scanner/schemas.js';
import leadScannerBasic from './fixtures/lead_scanner_basic.json';

// Mock env
vi.mock('../src/lib/env.js', () => ({
  getEnv: () => ({
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_KEY: 'fake-key',
    ANTHROPIC_API_KEY: 'test-api-key',
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_CHANNEL_LEADS: '#fyrk-leads',
    PORT: 8787,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
  }),
}));

// Mock Claude API
vi.mock('../src/lib/claude.js', () => ({
  callClaude: vi.fn(),
  extractText: vi.fn(),
}));

// Mock Slack
vi.mock('../src/lib/slack.js', () => ({
  postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456', channel: '#fyrk-leads' }),
}));

// Mock Supabase
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockInsertCalls: unknown[] = [];
const mockUpdateCalls: unknown[] = [];

vi.mock('../src/lib/supabase.js', () => ({
  getSupabase: () => ({
    from: vi.fn((table: string) => {
      if (table === 'target_accounts') {
        return {
          select: () => ({
            data: [
              { id: 'acc-1', name: 'Vipps', domain: 'vipps.no', industry: 'Fintech', segment: 'scaleup', tier: 'A' },
              { id: 'acc-2', name: 'Oda', domain: 'oda.com', industry: 'E-commerce', segment: 'scaleup', tier: 'B' },
            ],
            error: null,
          }),
        };
      }
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockMaybeSingle(),
            }),
          }),
          insert: (data: unknown) => {
            mockInsertCalls.push(data);
            return {
              select: () => ({
                single: () => mockSingle(),
              }),
            };
          },
          update: (data: unknown) => {
            mockUpdateCalls.push(data);
            return {
              eq: () => Promise.resolve({ error: null }),
            };
          },
        };
      }
      return { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    }),
  }),
}));

import { leadScannerAgent } from '../src/agents/lead-scanner/index.js';
import { buildDedupeKey, matchTargetAccount, type TargetAccount } from '../src/agents/lead-scanner/scoring.js';
import { buildSystemPrompt, buildUserPrompt } from '../src/agents/lead-scanner/prompt.js';
import { postMessage } from '../src/lib/slack.js';
import {
  mockCallClaude,
  createTestContext,
  makeMockClaudeResponse,
  makeBadJsonClaudeResponse,
} from './helpers/claude-agent.js';

const sampleTargets: TargetAccount[] = [
  { id: 'acc-1', name: 'Vipps', domain: 'vipps.no', industry: 'Fintech', segment: 'scaleup', tier: 'A' },
  { id: 'acc-2', name: 'Oda', domain: 'oda.com', industry: 'E-commerce', segment: 'scaleup', tier: 'B' },
];

const sampleClaudeResponse: ClaudeSignalsResponse = {
  signals: [
    {
      person: { name: 'Maria Hansen', role: 'Chief Product Officer', companyName: 'Vipps', companyDomain: 'vipps.no' },
      trigger: { type: 'new_hire', description: 'Appointed as new CPO, joining from Spotify' },
      scores: { fit: 28, trigger: 22, timing: 18, authority: 14, intent: 9 },
      scoreReasoning: 'Tier A target, strong new hire signal, C-suite role',
      outreach: {
        whyNow: 'New CPO in first 90 days, likely defining product strategy',
        recommendedAction: 'Send congratulatory message, offer product governance workshop',
        angle: 'Product strategy alignment for payment platform',
      },
      confidence: 'high',
      articleUrl: 'https://example.com/vipps-cpo',
    },
  ],
  totalArticlesAnalyzed: 3,
};

describe('lead-scanner agent', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
    mockInsertCalls.length = 0;
    mockUpdateCalls.length = 0;
    // Reset Supabase mocks to defaults
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSingle.mockResolvedValue({ data: { id: 'lead-1', score_total: 75 }, error: null });
  });

  describe('input validation', () => {
    it('should reject input with no articles', async () => {
      const input = { articles: [] };
      await expect(leadScannerAgent.execute(input as any, ctx)).rejects.toThrow();
    });

    it('should accept input with only articles', async () => {
      makeMockClaudeResponse({ signals: [], totalArticlesAnalyzed: 3 });
      const result = await leadScannerAgent.execute({ articles: leadScannerBasic.articles }, ctx);
      expect(result.output.hasLeads).toBe(false);
    });
  });

  describe('Claude prompt', () => {
    beforeEach(() => {
      makeMockClaudeResponse(sampleClaudeResponse);
    });

    it('should include target accounts in system prompt', async () => {
      await leadScannerAgent.execute(leadScannerBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('Vipps');
      expect(call[1].system).toContain('vipps.no');
      expect(call[1].system).toContain('Tier A');
    });

    it('should include articles in user prompt', async () => {
      await leadScannerAgent.execute(leadScannerBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      const userMsg = call[1].messages[0].content;
      expect(userMsg).toContain('Ny CPO i Vipps');
      expect(userMsg).toContain('Oda restructures tech leadership');
      expect(userMsg).toContain('Nordic startups raise record');
    });

    it('should call Claude with sonnet model', async () => {
      await leadScannerAgent.execute(leadScannerBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].model).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('signal processing — dryRun', () => {
    it('should create leads in dryRun without DB insert', async () => {
      makeMockClaudeResponse(sampleClaudeResponse);
      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.output.hasLeads).toBe(true);
      expect(result.output.leadsCreated).toHaveLength(1);
      expect(result.output.leadsCreated[0].personName).toBe('Maria Hansen');
      expect(result.output.leadsCreated[0].leadId).toMatch(/^dry-lead-/);
    });

    it('should skip Slack notifications in dryRun', async () => {
      makeMockClaudeResponse(sampleClaudeResponse);
      await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('should report matched tier for target accounts', async () => {
      makeMockClaudeResponse(sampleClaudeResponse);
      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.output.leadsCreated[0].tier).toBe('A');
    });
  });

  describe('signal processing — live', () => {
    let liveCtx: ReturnType<typeof createTestContext>;

    beforeEach(() => {
      liveCtx = createTestContext({ dryRun: false });
      makeMockClaudeResponse(sampleClaudeResponse);
    });

    it('should insert lead into DB', async () => {
      await leadScannerAgent.execute(leadScannerBasic, liveCtx);
      expect(mockInsertCalls.length).toBeGreaterThan(0);
    });

    it('should send Slack notification per lead', async () => {
      await leadScannerAgent.execute(leadScannerBasic, liveCtx);
      expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('should store slack_message_ts on lead', async () => {
      await leadScannerAgent.execute(leadScannerBasic, liveCtx);
      expect(mockUpdateCalls.length).toBeGreaterThan(0);
    });

    it('should report slackNotified true', async () => {
      const result = await leadScannerAgent.execute(leadScannerBasic, liveCtx);
      expect(result.output.leadsCreated[0].slackNotified).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('should skip signals with existing dedupe_key', async () => {
      mockMaybeSingle.mockResolvedValue({ data: { id: 'existing-lead' }, error: null });
      makeMockClaudeResponse(sampleClaudeResponse);

      const liveCtx = createTestContext({ dryRun: false });
      const result = await leadScannerAgent.execute(leadScannerBasic, liveCtx);

      expect(result.output.leadsCreated).toHaveLength(0);
      expect(result.output.signalsSkipped).toHaveLength(1);
      expect(result.output.signalsSkipped[0].reason).toBe('duplicate');
    });

    it('should handle unique_violation (23505) as duplicate', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });
      makeMockClaudeResponse(sampleClaudeResponse);

      const liveCtx = createTestContext({ dryRun: false });
      const result = await leadScannerAgent.execute(leadScannerBasic, liveCtx);

      expect(result.output.signalsSkipped).toHaveLength(1);
      expect(result.output.signalsSkipped[0].reason).toBe('duplicate');
    });
  });

  describe('score threshold', () => {
    it('should skip signals below threshold', async () => {
      const lowScoreResponse: ClaudeSignalsResponse = {
        signals: [
          {
            ...sampleClaudeResponse.signals[0],
            scores: { fit: 5, trigger: 5, timing: 5, authority: 5, intent: 2 },
          },
        ],
        totalArticlesAnalyzed: 3,
      };
      makeMockClaudeResponse(lowScoreResponse);

      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.output.leadsCreated).toHaveLength(0);
      expect(result.output.signalsSkipped[0].reason).toBe('below_threshold');
    });

    it('should respect custom scoreThreshold', async () => {
      makeMockClaudeResponse(sampleClaudeResponse);
      const input = { ...leadScannerBasic, scoreThreshold: 95 };
      const result = await leadScannerAgent.execute(input, ctx);
      // 28+22+18+14+9 = 91 < 95
      expect(result.output.leadsCreated).toHaveLength(0);
      expect(result.output.signalsSkipped[0].reason).toBe('below_threshold');
    });
  });

  describe('low confidence', () => {
    it('should skip low confidence signals', async () => {
      const lowConfResponse: ClaudeSignalsResponse = {
        signals: [
          { ...sampleClaudeResponse.signals[0], confidence: 'low' },
        ],
        totalArticlesAnalyzed: 3,
      };
      makeMockClaudeResponse(lowConfResponse);

      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.output.leadsCreated).toHaveLength(0);
      expect(result.output.signalsSkipped[0].reason).toBe('low_confidence');
    });
  });

  describe('unmatched signals', () => {
    it('should report unmatched signals for non-target companies', async () => {
      const unmatchedResponse: ClaudeSignalsResponse = {
        signals: [
          {
            ...sampleClaudeResponse.signals[0],
            person: { name: 'Erik Nord', role: 'CTO', companyName: 'Unknown Corp', companyDomain: 'unknown.com' },
          },
        ],
        totalArticlesAnalyzed: 3,
      };
      makeMockClaudeResponse(unmatchedResponse);

      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.output.leadsCreated).toHaveLength(1);
      expect(result.output.unmatchedSignals).toHaveLength(1);
      expect(result.output.unmatchedSignals[0].companyName).toBe('Unknown Corp');
      expect(result.output.leadsCreated[0].tier).toBeNull();
    });
  });

  describe('artifact', () => {
    it('should produce a markdown scan report artifact', async () => {
      makeMockClaudeResponse(sampleClaudeResponse);
      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('lead-scan-report');
    });

    it('should include leads in artifact content', async () => {
      makeMockClaudeResponse(sampleClaudeResponse);
      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.artifacts[0].content).toContain('Maria Hansen');
      expect(result.artifacts[0].content).toContain('Vipps');
    });

    it('should include metadata in artifact', async () => {
      makeMockClaudeResponse(sampleClaudeResponse);
      const result = await leadScannerAgent.execute(leadScannerBasic, ctx);
      expect(result.artifacts[0].meta).toMatchObject({
        totalArticles: 3,
        signalsDetected: 1,
        leadsCreated: 1,
        dryRun: true,
      });
    });
  });

  describe('error handling', () => {
    it('should throw when ANTHROPIC_API_KEY is missing', async () => {
      const envModule = await import('../src/lib/env.js');
      const original = envModule.getEnv;
      vi.spyOn(envModule, 'getEnv').mockReturnValue({
        SUPABASE_URL: 'https://fake.supabase.co',
        SUPABASE_SERVICE_KEY: 'fake-key',
        ANTHROPIC_API_KEY: undefined,
        PORT: 8787,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
      } as ReturnType<typeof original>);

      await expect(leadScannerAgent.execute(leadScannerBasic, ctx)).rejects.toThrow(
        'ANTHROPIC_API_KEY is required',
      );

      vi.mocked(envModule.getEnv).mockRestore();
    });

    it('should throw on invalid Claude JSON response', async () => {
      makeBadJsonClaudeResponse();
      await expect(leadScannerAgent.execute(leadScannerBasic, ctx)).rejects.toThrow();
    });
  });

  describe('version', () => {
    it('should be version 0.1', () => {
      expect(leadScannerAgent.version).toBe('0.1');
    });
  });
});

describe('buildDedupeKey', () => {
  it('should normalize to lowercase and trim', () => {
    expect(buildDedupeKey('Maria Hansen', 'Vipps', 'new_hire')).toBe('maria hansen:vipps:new_hire');
  });

  it('should handle whitespace', () => {
    expect(buildDedupeKey('  Maria Hansen  ', ' Vipps ', ' new_hire ')).toBe('maria hansen:vipps:new_hire');
  });
});

describe('matchTargetAccount', () => {
  it('should match by exact domain', () => {
    const result = matchTargetAccount('Some Name', 'vipps.no', sampleTargets);
    expect(result?.id).toBe('acc-1');
  });

  it('should match by fuzzy name containment', () => {
    const result = matchTargetAccount('Vipps MobilePay', undefined, sampleTargets);
    expect(result?.id).toBe('acc-1');
  });

  it('should return null when no match', () => {
    const result = matchTargetAccount('Unknown Corp', 'unknown.com', sampleTargets);
    expect(result).toBeNull();
  });

  it('should prefer domain match over name match', () => {
    const targets: TargetAccount[] = [
      { id: 'a', name: 'Vipps', domain: 'vipps.no', industry: null, segment: null, tier: 'A' },
      { id: 'b', name: 'Vipps AS', domain: 'different.no', industry: null, segment: null, tier: 'B' },
    ];
    const result = matchTargetAccount('Vipps AS', 'vipps.no', targets);
    expect(result?.id).toBe('a');
  });
});

describe('buildSystemPrompt', () => {
  it('should include target account names', () => {
    const prompt = buildSystemPrompt(sampleTargets);
    expect(prompt).toContain('Vipps (vipps.no)');
    expect(prompt).toContain('Tier A');
    expect(prompt).toContain('Fintech');
  });

  it('should handle empty target list', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('No target accounts configured');
  });
});

describe('buildUserPrompt', () => {
  it('should include article details', () => {
    const prompt = buildUserPrompt(leadScannerBasic.articles);
    expect(prompt).toContain('Ny CPO i Vipps');
    expect(prompt).toContain('Shifter.no');
    expect(prompt).toContain('https://example.com/vipps-cpo');
    expect(prompt).toContain('Analyze these 3 articles');
  });
});
