import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NullDbClient } from '../src/db/client.js';
import type { AgentContext } from '../src/agents/base.js';
import type { DocsSyncOutput } from '../src/agents/docs-sync/schemas.js';
import docsSyncBasic from './fixtures/docs_sync_basic.json';

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

import { docsSyncAgent } from '../src/agents/docs-sync/index.js';
import { callClaude, extractText } from '../src/lib/claude.js';

const mockCallClaude = vi.mocked(callClaude);
const mockExtractText = vi.mocked(extractText);

function makeMockResponse(output: DocsSyncOutput) {
  const text = JSON.stringify(output);
  const response = {
    id: 'msg_test',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  mockCallClaude.mockResolvedValue(response);
  mockExtractText.mockReturnValue(text);
}

describe('docs-sync agent', () => {
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
    it('should reject input with no changed files', async () => {
      const input = { ...docsSyncBasic, changedFiles: [] };
      await expect(docsSyncAgent.execute(input, ctx)).rejects.toThrow();
    });

    it('should reject input with no content pages', async () => {
      const input = { ...docsSyncBasic, contentPages: [] };
      await expect(docsSyncAgent.execute(input, ctx)).rejects.toThrow();
    });
  });

  describe('when Claude finds updates', () => {
    const mockOutput: DocsSyncOutput = {
      hasUpdates: true,
      summary: 'Verktøysiden bør oppdateres med info om OKR-fremdriftssporing.',
      suggestedUpdates: [
        {
          path: 'src/pages/verktoy.astro',
          originalContent: docsSyncBasic.contentPages[0].content,
          updatedContent: docsSyncBasic.contentPages[0].content.replace(
            'OKR-dashboard med oversikt over mal og resultater',
            'OKR-dashboard med oversikt over mal, resultater og fremdriftssporing',
          ),
          reason: 'Ny OKR-fremdriftsfunksjonalitet bør reflekteres på verktøysiden.',
        },
      ],
      prTitle: 'docs: oppdater verktøyside med OKR-fremdrift',
      prBody: '## Endringer\n\n- Oppdatert verktøysiden med info om OKR-fremdriftssporing',
    };

    beforeEach(() => {
      makeMockResponse(mockOutput);
    });

    it('should return hasUpdates true', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.output.hasUpdates).toBe(true);
    });

    it('should return suggested updates', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.output.suggestedUpdates).toHaveLength(1);
      expect(result.output.suggestedUpdates[0].path).toBe('src/pages/verktoy.astro');
    });

    it('should return PR title and body', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.output.prTitle).toBeTruthy();
      expect(result.output.prBody).toBeTruthy();
    });

    it('should produce an artifact', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('docs-sync-report');
    });

    it('should include metadata in artifact', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.artifacts[0].meta).toEqual({
        repo: 'carlfrankalbert/nettside_fyrk',
        beforeSha: 'abc1234',
        afterSha: 'def5678',
        pagesAnalyzed: 2,
        updatesFound: 1,
      });
    });

    it('should call Claude with correct model', async () => {
      await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(mockCallClaude).toHaveBeenCalledTimes(1);
      const call = mockCallClaude.mock.calls[0];
      expect(call[0]).toBe('test-api-key');
      expect(call[1].model).toBe('claude-haiku-4-5-20251001');
    });

    it('should include system prompt in Norwegian', async () => {
      await docsSyncAgent.execute(docsSyncBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('norsk');
    });
  });

  describe('when Claude finds no updates', () => {
    const mockOutput: DocsSyncOutput = {
      hasUpdates: false,
      summary: 'Ingen innholdssider trenger oppdatering.',
      suggestedUpdates: [],
      prTitle: '',
      prBody: '',
    };

    beforeEach(() => {
      makeMockResponse(mockOutput);
    });

    it('should return hasUpdates false', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.output.hasUpdates).toBe(false);
    });

    it('should return empty suggested updates', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.output.suggestedUpdates).toHaveLength(0);
    });

    it('should produce no artifacts', async () => {
      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.artifacts).toHaveLength(0);
    });
  });

  describe('filtering identical updates', () => {
    it('should filter out updates where content did not change', async () => {
      const fakeOutput: DocsSyncOutput = {
        hasUpdates: true,
        summary: 'Claude returned an update but content is identical',
        suggestedUpdates: [
          {
            path: 'src/pages/om-oss.astro',
            originalContent: docsSyncBasic.contentPages[1].content,
            updatedContent: docsSyncBasic.contentPages[1].content,
            reason: 'No real change',
          },
        ],
        prTitle: 'docs: no-op',
        prBody: 'Nothing changed',
      };
      makeMockResponse(fakeOutput);

      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.output.hasUpdates).toBe(false);
      expect(result.output.suggestedUpdates).toHaveLength(0);
    });
  });

  describe('Claude response with markdown fences', () => {
    it('should handle response wrapped in code fences', async () => {
      const output: DocsSyncOutput = {
        hasUpdates: false,
        summary: 'Ingen oppdateringer nødvendig.',
        suggestedUpdates: [],
        prTitle: '',
        prBody: '',
      };
      const fenced = '```json\n' + JSON.stringify(output) + '\n```';
      const response = {
        id: 'msg_test',
        content: [{ type: 'text', text: fenced }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };
      mockCallClaude.mockResolvedValue(response);
      mockExtractText.mockReturnValue(fenced);

      const result = await docsSyncAgent.execute(docsSyncBasic, ctx);
      expect(result.output.hasUpdates).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw when ANTHROPIC_API_KEY is missing', async () => {
      // Temporarily override the mock
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

      await expect(docsSyncAgent.execute(docsSyncBasic, ctx)).rejects.toThrow(
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
        usage: { input_tokens: 100, output_tokens: 50 },
      };
      mockCallClaude.mockResolvedValue(response);
      mockExtractText.mockReturnValue('not valid json');

      await expect(docsSyncAgent.execute(docsSyncBasic, ctx)).rejects.toThrow();
    });
  });
});
