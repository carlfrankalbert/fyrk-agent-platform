import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Brief,
  EditorialRoomInput,
  FactGuardPass,
  FinalPass,
  Groundwork,
  LanguagePass,
  PositioningPass,
  SkepticPass,
} from '../src/agents/editorial-room/schemas.js';

// Mock env so editorial-room sees an OpenAI key (most roles run on GPT).
const baseEnv = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_SERVICE_KEY: 'fake-key',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  OPENAI_API_KEY: 'test-openai-key',
  PORT: 8787,
  HOST: '0.0.0.0',
  LOG_LEVEL: 'info',
};

vi.mock('../src/lib/env.js', () => ({
  getEnv: vi.fn(() => baseEnv),
}));

// Mock only callRole — keep the real buildTiers so meta.modelsUsed reflects real config.
vi.mock('../src/agents/editorial-room/models.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/agents/editorial-room/models.js')>();
  return { ...actual, callRole: vi.fn() };
});

import { getEnv } from '../src/lib/env.js';
import { callRole } from '../src/agents/editorial-room/models.js';
import { editorialRoomAgent } from '../src/agents/editorial-room/index.js';
import {
  EditorialRoomInputSchema,
  EditorialRoomOutputSchema,
  resolveDefaults,
} from '../src/agents/editorial-room/schemas.js';
import {
  buildBriefSystemPrompt,
  buildBriefUserPrompt,
  buildChiefEditorUserPrompt,
  buildGroundworkSystemPrompt,
} from '../src/agents/editorial-room/prompt.js';
import { createTestContext } from './helpers/claude-agent.js';

const mockCallRole = vi.mocked(callRole);
const mockGetEnv = vi.mocked(getEnv);

// ─── Sample editorial-room responses (one per redaksjonsrolle) ────────────────

const brief: Brief = {
  goal: 'Vise hvordan tydelig prioritering skaper fremdrift',
  audience: 'Produktledere i større organisasjoner',
  positioning: 'Carl som operativ produktleder som får ting i mål',
  toneTargets: ['rolig', 'konkret', 'erfaren'],
  risks: ['generiskhet', 'oppdiktet konkretisering'],
};

const groundwork: Groundwork = {
  fromInput: ['Carl skrev at prioritering ofte mangler i produktteam'],
  fromCarlContext: ['Erfaring som produktleder i SpareBank 1'],
  reasonableInferences: ['Tydelig prioritering reduserer parallelt arbeid'],
  placeholders: ['Ett konkret eksempel fra bank eller betaling'],
};

const positioning: PositioningPass = {
  takeaway: 'Prioritering er en lederhandling, ikke en liste',
  honestAngle: 'Carl har sett fremdrift stoppe når prioritering er uklar',
  strengths: ['Bygger på reell erfaring'],
  weaknesses: ['Mangler ett konkret eksempel'],
  reframings: ['Prioritering som retning', 'Prioritering som nei'],
};

const languagePass: LanguagePass = {
  polishedDraft: 'Polert utkast om prioritering og fremdrift.',
  cuts: ['Fjernet en lang bisetning'],
  alternativeOpenings: ['Åpning A', 'Åpning B', 'Åpning C'],
  alternativeClosings: ['Avslutning A', 'Avslutning B', 'Avslutning C'],
};

const skeptic: SkepticPass = {
  verdict: 'revise',
  genericPhrases: ['skape verdi'],
  overclaims: [],
  unclearPoints: ['Hva betyr fremdrift konkret'],
  needsConcretization: ['Trenger ett eksempel fra Carls erfaring'],
  threeSecondTest: 'En travel leder nikker, men vil ha et eksempel',
};

const factGuard: FactGuardPass = {
  classifiedClaims: [
    {
      claim: 'Prioritering mangler ofte',
      classification: 'supported_input',
      action: 'keep',
      softerPhrasing: null,
    },
    {
      claim: '30% raskere leveranse',
      classification: 'should_remove',
      action: 'remove',
      softerPhrasing: null,
    },
  ],
  cleanedDraft: 'Renset utkast om prioritering.',
  removedClaims: ['30% raskere leveranse: ingen dekning'],
  softenedClaims: ['Universell påstand mykgjort til erfaringsbasert'],
};

const final: FinalPass = {
  recommendedPost: 'Endelig anbefalt post om prioritering og fremdrift.',
  changeNotes: [
    'Strammet opp åpningen og kuttet en gjentakelse',
    'Tonet ned et oppblåst tall uten dekning',
    'Gjorde avslutningen mer presis',
  ],
};

/** Wire callRole to resolve the seven redaksjonssteg in order. */
function mockEditorialRun(overrides?: { final?: FinalPass }): void {
  mockCallRole
    .mockResolvedValueOnce(brief)
    .mockResolvedValueOnce(groundwork)
    .mockResolvedValueOnce(positioning)
    .mockResolvedValueOnce(languagePass)
    .mockResolvedValueOnce(skeptic)
    .mockResolvedValueOnce(factGuard)
    .mockResolvedValueOnce(overrides?.final ?? final);
}

const basicInput: EditorialRoomInput = {
  draft: 'Jeg tenker mye på prioritering i produktteam.',
};

describe('editorial-room agent', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  describe('input schema', () => {
    it('rejects an empty draft', () => {
      expect(EditorialRoomInputSchema.safeParse({ draft: '' }).success).toBe(false);
    });

    it('accepts a draft with no other fields', () => {
      expect(EditorialRoomInputSchema.safeParse({ draft: 'En idé' }).success).toBe(true);
    });

    it('rejects an unknown mode', () => {
      expect(
        EditorialRoomInputSchema.safeParse({ draft: 'En idé', mode: 'publish' }).success,
      ).toBe(false);
    });

    it('rejects an unknown tier', () => {
      expect(
        EditorialRoomInputSchema.safeParse({ draft: 'En idé', tier: 'turbo' }).success,
      ).toBe(false);
    });
  });

  describe('resolveDefaults', () => {
    it('applies defaults for omitted optional fields', () => {
      const resolved = resolveDefaults({ draft: 'En idé' });
      expect(resolved).toMatchObject({
        mode: 'improve',
        format: 'post',
        language: 'no',
        tier: 'quality',
      });
    });

    it('keeps explicit values over defaults', () => {
      const resolved = resolveDefaults({
        draft: 'En idé',
        mode: 'explore',
        format: 'comment',
        language: 'en',
        tier: 'fast',
      });
      expect(resolved).toMatchObject({
        mode: 'explore',
        format: 'comment',
        language: 'en',
        tier: 'fast',
      });
    });
  });

  describe('execute', () => {
    it('requires an OpenAI API key', async () => {
      mockGetEnv.mockReturnValueOnce({ ...baseEnv, OPENAI_API_KEY: undefined });
      await expect(editorialRoomAgent.execute(basicInput, ctx)).rejects.toThrow(/OPENAI_API_KEY/);
    });

    it('runs all seven editorial roles in order', async () => {
      mockEditorialRun();
      await editorialRoomAgent.execute(basicInput, ctx);
      expect(mockCallRole).toHaveBeenCalledTimes(7);
    });

    it('returns each role pass on the output', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);

      expect(result.output.brief).toEqual(brief);
      expect(result.output.groundwork).toEqual(groundwork);
      expect(result.output.positioning).toEqual(positioning);
      expect(result.output.language).toEqual(languagePass);
      expect(result.output.skeptic).toEqual(skeptic);
      expect(result.output.factGuard).toEqual(factGuard);
      expect(result.output.final).toEqual(final);
    });

    it('produces output that satisfies the output schema', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      expect(EditorialRoomOutputSchema.safeParse(result.output).success).toBe(true);
    });

    it('defaults mode to improve and echoes it on the output', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      expect(result.output.mode).toBe('improve');
    });

    it('passes an explicit mode through to the output', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(
        { draft: 'En idé', mode: 'finalize' },
        ctx,
      );
      expect(result.output.mode).toBe('finalize');
    });

    it('stamps generatedAt with an ISO timestamp', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      expect(result.output.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(result.output.generatedAt).toString()).not.toBe('Invalid Date');
    });
  });

  describe('artifact', () => {
    it('produces a single editorial-room-output artifact', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('editorial-room-output');
    });

    it('includes the recommended post and change notes in the markdown', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      const content = result.artifacts[0].content;

      expect(content).toContain('# Redaksjonsrommet');
      expect(content).toContain('## Anbefalt versjon');
      expect(content).toContain(final.recommendedPost);
      expect(content).toContain('## Endringer');
      expect(content).toContain(final.changeNotes[0]);
    });

    it('omits the change section when there are no change notes', async () => {
      mockEditorialRun({ final: { ...final, changeNotes: [] } });
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      const content = result.artifacts[0].content;

      expect(content).not.toContain('## Endringer');
      // The recommended version is always present.
      expect(content).toContain('## Anbefalt versjon');
      expect(content).toContain(final.recommendedPost);
    });

    it('caps change notes at five', async () => {
      const sixNotes = ['en', 'to', 'tre', 'fire', 'fem', 'seks'];
      mockEditorialRun({ final: { ...final, changeNotes: sixNotes } });
      const result = await editorialRoomAgent.execute(basicInput, ctx);

      expect(result.output.final.changeNotes).toHaveLength(5);
      expect(result.output.final.changeNotes).not.toContain('seks');
      expect(result.artifacts[0].content).not.toContain('- seks');
    });

    it('records mode, tier and verdict in artifact meta', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      const meta = result.artifacts[0].meta!;

      expect(meta.mode).toBe('improve');
      expect(meta.tier).toBe('quality');
      expect(meta.tierLabel).toBe('Høy kvalitet');
      expect(meta.verdict).toBe('revise');
    });

    it('counts classified, removed and softened claims in meta', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      const meta = result.artifacts[0].meta!;

      expect(meta.claimsClassified).toBe(2);
      expect(meta.claimsRemoved).toBe(1);
      expect(meta.claimsSoftened).toBe(1);
    });

    it('records the model used per role in meta', async () => {
      mockEditorialRun();
      const result = await editorialRoomAgent.execute(basicInput, ctx);
      const modelsUsed = result.artifacts[0].meta!.modelsUsed as Record<string, string>;

      // Quality tier: GPT for brief, Claude Sonnet for the language editor.
      expect(modelsUsed.brief).toBe('gpt-5');
      expect(modelsUsed.language).toContain('claude');
    });
  });

  describe('error handling', () => {
    it('rejects when a role call fails', async () => {
      mockCallRole.mockRejectedValueOnce(new Error('OpenAI 500'));
      await expect(editorialRoomAgent.execute(basicInput, ctx)).rejects.toThrow('OpenAI 500');
    });
  });
});

describe('editorial-room prompts', () => {
  it('includes Carl voice context and the truth rule in role system prompts', () => {
    const prompt = buildBriefSystemPrompt('no');
    expect(prompt).toContain('Carl Johnson');
    expect(prompt).toContain('Sannhetsregel');
    expect(prompt).toContain('norsk bokmål');
  });

  it('switches the language instruction to English', () => {
    expect(buildBriefSystemPrompt('en')).toContain('engelsk');
    expect(buildGroundworkSystemPrompt('en')).toContain('engelsk');
  });

  it('embeds the draft and mode guidance in the brief user prompt', () => {
    const prompt = buildBriefUserPrompt({
      draft: 'Et konkret utkast om prioritering',
      mode: 'explore',
      format: 'post',
    });
    expect(prompt).toContain('Et konkret utkast om prioritering');
    expect(prompt).toContain('utforsk idé');
    expect(prompt).toContain('LinkedIn-post');
  });

  it('includes audience and intent hints when supplied', () => {
    const prompt = buildBriefUserPrompt({
      draft: 'Utkast',
      mode: 'improve',
      format: 'comment',
      audience: 'CPO-er i Norden',
      intent: 'Bygge troverdighet',
    });
    expect(prompt).toContain('CPO-er i Norden');
    expect(prompt).toContain('Bygge troverdighet');
    expect(prompt).toContain('LinkedIn-kommentar');
  });

  it('includes revision notes and the previous post for the chief editor', () => {
    const prompt = buildChiefEditorUserPrompt({
      originalDraft: 'Opprinnelig utkast',
      brief,
      groundwork,
      positioning,
      language: languagePass,
      skeptic,
      factGuard,
      revisionNotes: 'Gjør åpningen strammere',
      previousFinalPost: 'Forrige genererte versjon',
    });
    expect(prompt).toContain('Gjør åpningen strammere');
    expect(prompt).toContain('Forrige genererte versjon');
  });

  it('omits revision sections when no notes are supplied', () => {
    const prompt = buildChiefEditorUserPrompt({
      originalDraft: 'Opprinnelig utkast',
      brief,
      groundwork,
      positioning,
      language: languagePass,
      skeptic,
      factGuard,
    });
    expect(prompt).not.toContain('revisjonsnotater');
    expect(prompt).not.toContain('Forrige genererte versjon');
  });
});
