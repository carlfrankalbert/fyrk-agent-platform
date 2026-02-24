import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LinkedInPostOutput } from '../src/agents/linkedin-post/schemas.js';
import linkedInPostBasic from './fixtures/linkedin_post_basic.json';

// Mock env to provide ANTHROPIC_API_KEY
vi.mock('../src/lib/env.js', () => ({
  getEnv: () => ({
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_KEY: 'fake-key',
    ANTHROPIC_API_KEY: 'test-api-key',
    PORT: 8787,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
  }),
}));

// Mock Claude API — must be before importing the agent
vi.mock('../src/lib/claude.js', () => ({
  callClaude: vi.fn(),
  extractText: vi.fn(),
}));

import { linkedInPostAgent } from '../src/agents/linkedin-post/index.js';
import {
  mockCallClaude,
  createTestContext,
  makeMockClaudeResponse,
  makeFencedClaudeResponse,
  makeBadJsonClaudeResponse,
} from './helpers/claude-agent.js';

const sampleDrafts: LinkedInPostOutput = {
  drafts: [
    {
      title: 'AI-beslutningskvalitet vs AI-effektivitet',
      postText: 'De fleste selskaper investerer i AI for å gjøre ting raskere.\n\nMen spørsmålet er ikke om du gjør ting raskere — det er om du gjør bedre beslutninger.\n\nTre artikler denne uken peker mot samme mønster: AI-verktøy adopteres bredt, men beslutningskvaliteten forbedres ikke.\n\nHer er en enkel test:\n> Hvis AI-investeringen din primært reduserer tid, automatiserer du arbeid.\n> Hvis den endrer hvilke beslutninger som tas, automatiserer du dømmekraft.\n\nDe fleste er i kategori 1. Og det er ikke nok.\n\n—\nKilder:\nhttps://example.com/ai-agents-automation\nhttps://example.com/norske-bedrifter-ki\nhttps://example.com/okr-european-startups\n\n#AI #Beslutningskvalitet #OKR #Automatisering #Strategi',
      sourceArticles: [
        {
          title: 'How AI Agents Are Transforming Business Automation',
          url: 'https://example.com/ai-agents-automation',
          source: 'MIT Technology Review',
        },
        {
          title: 'Norske bedrifter satser stort på KI-verktøy',
          url: 'https://example.com/norske-bedrifter-ki',
          source: 'Digi.no',
        },
        {
          title: 'The Rise of OKR Software in European Startups',
          url: 'https://example.com/okr-european-startups',
          source: 'TechCrunch',
        },
      ],
      hashtags: ['#AI', '#Beslutningskvalitet', '#OKR', '#Automatisering', '#Strategi'],
      topic: 'Beslutningskvalitet',
      characterCount: 950,
    },
  ],
  totalArticlesAnalyzed: 3,
  generatedAt: '2026-02-23T10:00:00Z',
  hasDrafts: true,
};

describe('linkedin-post agent', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  describe('input validation', () => {
    it('should reject input with no articles', async () => {
      const input = { ...linkedInPostBasic, articles: [] };
      await expect(linkedInPostAgent.execute(input, ctx)).rejects.toThrow();
    });

    it('should accept input with only articles', async () => {
      makeMockClaudeResponse(sampleDrafts);
      const input = { articles: linkedInPostBasic.articles };
      const result = await linkedInPostAgent.execute(input, ctx);
      expect(result.output.hasDrafts).toBe(true);
    });
  });

  describe('draft generation', () => {
    beforeEach(() => {
      makeMockClaudeResponse(sampleDrafts);
    });

    it('should return hasDrafts true when drafts exist', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.hasDrafts).toBe(true);
    });

    it('should return one synthesized draft', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.drafts).toHaveLength(1);
    });

    it('should include source articles in draft', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      const draft = result.output.drafts[0];
      expect(draft.sourceArticles.length).toBeGreaterThan(0);
      for (const source of draft.sourceArticles) {
        expect(source.title).toBeTruthy();
        expect(source.url).toBeTruthy();
        expect(source.source).toBeTruthy();
      }
    });

    it('should include hashtags in draft', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.drafts[0].hashtags.length).toBeGreaterThan(0);
    });

    it('should include character count in draft', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.drafts[0].characterCount).toBeGreaterThan(0);
    });

    it('should return totalArticlesAnalyzed', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.totalArticlesAnalyzed).toBe(3);
    });

    it('should return generatedAt timestamp', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.generatedAt).toBeTruthy();
    });

    it('should produce a markdown artifact', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('linkedin-post-drafts');
    });

    it('should include metadata in artifact', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.artifacts[0].meta).toEqual({
        totalArticles: 3,
        draftsGenerated: 1,
        generatedAt: '2026-02-23T10:00:00Z',
      });
    });

    it('should include draft text in artifact content', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      const content = result.artifacts[0].content;
      expect(content).toContain('AI-beslutningskvalitet vs AI-effektivitet');
    });
  });

  describe('prompt construction', () => {
    beforeEach(() => {
      makeMockClaudeResponse(sampleDrafts);
    });

    it('should call Claude with opus model', async () => {
      await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(mockCallClaude).toHaveBeenCalledTimes(1);
      const call = mockCallClaude.mock.calls[0];
      expect(call[0]).toBe('test-api-key');
      expect(call[1].model).toBe('claude-opus-4-6');
    });

    it('should include decision frame instructions in system prompt', async () => {
      await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('Beslutningsramme');
      expect(call[1].system).toContain('DECISION FRAME MODE');
    });

    it('should include articles in user prompt', async () => {
      await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      const userMsg = call[1].messages[0].content;
      expect(userMsg).toContain('AI Agents Are Transforming');
      expect(userMsg).toContain('Norske bedrifter satser');
      expect(userMsg).toContain('OKR Software in European');
    });
  });

  describe('when Claude returns no drafts', () => {
    const noDrafts: LinkedInPostOutput = {
      drafts: [],
      totalArticlesAnalyzed: 3,
      generatedAt: '2026-02-23T10:00:00Z',
      hasDrafts: false,
    };

    beforeEach(() => {
      makeMockClaudeResponse(noDrafts);
    });

    it('should return hasDrafts false', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.hasDrafts).toBe(false);
    });

    it('should return empty drafts array', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.drafts).toHaveLength(0);
    });

    it('should produce no artifacts', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.artifacts).toHaveLength(0);
    });
  });

  describe('Claude response with markdown fences', () => {
    it('should handle response wrapped in code fences', async () => {
      makeFencedClaudeResponse(sampleDrafts);

      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.hasDrafts).toBe(true);
      expect(result.output.drafts).toHaveLength(1);
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

      await expect(linkedInPostAgent.execute(linkedInPostBasic, ctx)).rejects.toThrow(
        'ANTHROPIC_API_KEY is required',
      );

      vi.mocked(envModule.getEnv).mockRestore();
    });

    it('should throw on invalid Claude JSON response', async () => {
      makeBadJsonClaudeResponse();

      await expect(linkedInPostAgent.execute(linkedInPostBasic, ctx)).rejects.toThrow();
    });
  });
});
