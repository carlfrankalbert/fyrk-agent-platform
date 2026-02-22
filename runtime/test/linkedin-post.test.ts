import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NullDbClient } from '../src/db/client.js';
import type { AgentContext } from '../src/agents/base.js';
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
import { callClaude, extractText } from '../src/lib/claude.js';

const mockCallClaude = vi.mocked(callClaude);
const mockExtractText = vi.mocked(extractText);

function makeMockResponse(output: LinkedInPostOutput) {
  const text = JSON.stringify(output);
  const response = {
    id: 'msg_test',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    usage: { input_tokens: 200, output_tokens: 150 },
  };
  mockCallClaude.mockResolvedValue(response);
  mockExtractText.mockReturnValue(text);
}

const sampleDrafts: LinkedInPostOutput = {
  drafts: [
    {
      title: 'AI-agenter og automatisering',
      postText: 'Visste du at AI-agenter kan redusere manuelle arbeidsoppgaver med 60%?\n\nNy forskning viser at...\n\nhttps://example.com/ai-agents-automation',
      sourceArticle: {
        title: 'How AI Agents Are Transforming Business Automation',
        url: 'https://example.com/ai-agents-automation',
        source: 'MIT Technology Review',
      },
      hashtags: ['#AI', '#automatisering', '#FYRK', '#agenter'],
      topic: 'AI',
      characterCount: 950,
    },
    {
      title: 'Norske bedrifter og KI',
      postText: '45% av norske mellomstore bedrifter planlegger KI-verktøy innen 2027.\n\nDette er en trend vi følger tett i FYRK...\n\nhttps://example.com/norske-bedrifter-ki',
      sourceArticle: {
        title: 'Norske bedrifter satser stort på KI-verktøy',
        url: 'https://example.com/norske-bedrifter-ki',
        source: 'Digi.no',
      },
      hashtags: ['#KI', '#Norge', '#beslutningsverktøy', '#FYRK'],
      topic: 'beslutningsverktøy',
      characterCount: 1100,
    },
  ],
  totalArticlesAnalyzed: 3,
  generatedAt: '2026-02-23T10:00:00Z',
  hasDrafts: true,
};

describe('linkedin-post agent', () => {
  let ctx: AgentContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = {
      db: new NullDbClient(),
      dryRun: true,
      publish: false,
      runId: 'test-run-id',
    };
  });

  describe('input validation', () => {
    it('should reject input with no articles', async () => {
      const input = { ...linkedInPostBasic, articles: [] };
      await expect(linkedInPostAgent.execute(input, ctx)).rejects.toThrow();
    });

    it('should accept input with default topics', async () => {
      makeMockResponse(sampleDrafts);
      const input = { articles: linkedInPostBasic.articles };
      const result = await linkedInPostAgent.execute(input, ctx);
      expect(result.output.hasDrafts).toBe(true);
    });

    it('should accept input with default maxPosts', async () => {
      makeMockResponse(sampleDrafts);
      const { maxPosts, ...input } = linkedInPostBasic;
      const result = await linkedInPostAgent.execute(input, ctx);
      expect(result.output).toBeDefined();
    });
  });

  describe('draft generation', () => {
    beforeEach(() => {
      makeMockResponse(sampleDrafts);
    });

    it('should return hasDrafts true when drafts exist', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.hasDrafts).toBe(true);
    });

    it('should return the correct number of drafts', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.drafts).toHaveLength(2);
    });

    it('should include source article in each draft', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      for (const draft of result.output.drafts) {
        expect(draft.sourceArticle.title).toBeTruthy();
        expect(draft.sourceArticle.url).toBeTruthy();
        expect(draft.sourceArticle.source).toBeTruthy();
      }
    });

    it('should include hashtags in each draft', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      for (const draft of result.output.drafts) {
        expect(draft.hashtags.length).toBeGreaterThan(0);
      }
    });

    it('should include character count in each draft', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      for (const draft of result.output.drafts) {
        expect(draft.characterCount).toBeGreaterThan(0);
      }
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
        draftsGenerated: 2,
        language: 'no',
        tone: 'thought-leader',
        generatedAt: '2026-02-23T10:00:00Z',
      });
    });

    it('should include draft text in artifact content', async () => {
      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      const content = result.artifacts[0].content;
      expect(content).toContain('AI-agenter og automatisering');
      expect(content).toContain('Norske bedrifter og KI');
    });
  });

  describe('prompt construction', () => {
    beforeEach(() => {
      makeMockResponse(sampleDrafts);
    });

    it('should call Claude with correct model', async () => {
      await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(mockCallClaude).toHaveBeenCalledTimes(1);
      const call = mockCallClaude.mock.calls[0];
      expect(call[0]).toBe('test-api-key');
      expect(call[1].model).toBe('claude-haiku-4-5-20251001');
    });

    it('should include topics in system prompt', async () => {
      await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('AI');
      expect(call[1].system).toContain('automatisering');
      expect(call[1].system).toContain('beslutningsverktøy');
    });

    it('should include tone instruction in system prompt', async () => {
      await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('tankeleder');
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
      makeMockResponse(noDrafts);
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
      const fenced = '```json\n' + JSON.stringify(sampleDrafts) + '\n```';
      const response = {
        id: 'msg_test',
        content: [{ type: 'text', text: fenced }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 150 },
      };
      mockCallClaude.mockResolvedValue(response);
      mockExtractText.mockReturnValue(fenced);

      const result = await linkedInPostAgent.execute(linkedInPostBasic, ctx);
      expect(result.output.hasDrafts).toBe(true);
      expect(result.output.drafts).toHaveLength(2);
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
      const response = {
        id: 'msg_test',
        content: [{ type: 'text', text: 'not valid json' }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 150 },
      };
      mockCallClaude.mockResolvedValue(response);
      mockExtractText.mockReturnValue('not valid json');

      await expect(linkedInPostAgent.execute(linkedInPostBasic, ctx)).rejects.toThrow();
    });
  });
});
