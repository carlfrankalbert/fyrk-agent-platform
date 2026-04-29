import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CvTailorOutput } from '../src/agents/cv-tailor/schemas.js';
import cvTailorBasic from './fixtures/cv_tailor_basic.json';

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

// Mock Claude API
vi.mock('../src/lib/claude.js', () => ({
  callClaude: vi.fn(),
  extractText: vi.fn(),
}));

import { cvTailorAgent } from '../src/agents/cv-tailor/index.js';
import { buildSystemPrompt, buildUserPrompt } from '../src/agents/cv-tailor/prompt.js';
import {
  mockCallClaude,
  mockExtractText,
  createTestContext,
  makeBadJsonClaudeResponse,
} from './helpers/claude-agent.js';

const sampleOutput: CvTailorOutput = {
  cv: {
    name: 'Carl Johnson',
    title: 'Senior produktleder | Betaling og regulerte digitale produkter',
    contact: '+47 929 11 929 | carl@fyrk.no | linkedin.com/in/carlfrankalbert | Oslo, Norge',
    profile:
      'Senior produktleder med 15+ års erfaring fra bank og betaling. Har ledet produktutviklingen for betalingsløsninger som håndterer milliarder i ukentlige transaksjoner.',
    coreCompetencies: [
      'Produktledelse og produkteierskap',
      'Bank, betaling og regulerte produkter',
      'Prioritering og roadmap',
      'Tverrfaglig teamledelse',
    ],
    experience: [
      {
        company: 'SpareBank 1 Utvikling',
        role: 'Produktleder — BM Mobilbank, Betaling og Transaksjoner',
        period: 'Jan 2025 – nov 2025',
        description:
          'Produktleder for tre tverrfaglige team innen mobilbank bedrift, betalingsløsninger og transaksjoner.',
        highlights: [
          'Eide produktretning og roadmap for 15 personer fordelt på 3 team',
          'Drev migrering av betalingsplattform med milliarder i ukentlige transaksjoner',
        ],
        relevanceScore: 95,
      },
      {
        company: 'SpareBank 1 Utvikling',
        role: 'Produktleder og teamleder — BM Mobilbank',
        period: 'Jan 2024 – des 2024',
        description: 'Helhetlig ansvar for mobilbanken bedrift.',
        highlights: [
          'Lanserte biometrisk signering for betaling — første bank i Norge',
          'Kundebruk opp 40% på halvannet år',
        ],
        relevanceScore: 90,
      },
    ],
    previousExperienceSummary: null,
    education: ['Master, Entrepreneurial Management — Jönköping International Business School (2006–2007)'],
    certifications: ['Certified Scrum Product Owner (CSPO) — Scrum Alliance (2021)'],
    talks: [],
    languages: ['Svensk (morsmål)', 'Norsk (profesjonelt)', 'Engelsk (profesjonelt)'],
  },
  matchAnalysis: {
    overallFit: 'strong',
    fitScore: 88,
    matchedSkills: ['Produktledelse', 'Betalingsløsninger', 'Smidig', 'Roadmap'],
    matchedExperience: ['SB1 Betaling og Transaksjoner', 'SB1 BM Mobilbank'],
    strengthNarrative:
      'Carl har direkte erfaring som produktleder for betalingsløsninger i regulert bankmiljø, med ansvar for team, roadmap og leveranse.',
  },
  gaps: {
    missingSkills: ['PSD2-spesifikk erfaring'],
    missingExperience: [],
    questions: [
      'Har du jobbet direkte med PSD2-regulering, for eksempel SCA (Strong Customer Authentication) eller Open Banking-APIer?',
    ],
    suggestions: [
      'Biometrisk signering for betaling er nært knyttet til SCA under PSD2 — dette kan rammes inn som relevant PSD2-erfaring.',
    ],
  },
  generatedAt: '2026-03-16T10:00:00Z',
  roleHint: 'produktleder',
};

function makeCvEditorialPayload(output: CvTailorOutput) {
  return {
    profile: output.cv.profile,
    coreCompetencies: output.cv.coreCompetencies,
    previousExperienceSummary: output.cv.previousExperienceSummary ?? null,
    experience: output.cv.experience.map((entry) => ({
      description: entry.description,
      highlights: entry.highlights,
    })),
  };
}

function makeMockClaudeResponse(output: CvTailorOutput): void {
  const generationText = JSON.stringify(output);
  const editorialText = JSON.stringify(makeCvEditorialPayload(output));

  mockCallClaude
    .mockResolvedValueOnce(makeClaudeResponse(generationText))
    .mockResolvedValueOnce(makeClaudeResponse(editorialText));

  mockExtractText.mockImplementation((response: any) => response.content[0].text);
}

function makeFencedClaudeResponse(output: CvTailorOutput): void {
  const generationText = '```json\n' + JSON.stringify(output) + '\n```';
  const editorialText = JSON.stringify(makeCvEditorialPayload(output));

  mockCallClaude
    .mockResolvedValueOnce(makeClaudeResponse(generationText))
    .mockResolvedValueOnce(makeClaudeResponse(editorialText));

  mockExtractText.mockImplementation((response: any) => response.content[0].text);
}

function makeClaudeResponse(text: string) {
  return {
    id: 'msg_test',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe('cv-tailor agent', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createTestContext();
  });

  describe('input validation', () => {
    it('should reject input with empty jobPosting', async () => {
      const input = { jobPosting: '' };
      await expect(cvTailorAgent.execute(input as any, ctx)).rejects.toThrow();
    });

    it('should accept input with only jobPosting', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute({ jobPosting: 'Vi søker en produktleder...' }, ctx);
      expect(result.output.cv.name).toBe('Carl Johnson');
    });
  });

  describe('CV generation', () => {
    it('should return structured CV output', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      expect(result.output.cv.name).toBe('Carl Johnson');
      expect(result.output.cv.experience.length).toBeGreaterThan(0);
      expect(result.output.cv.coreCompetencies.length).toBeGreaterThan(0);
    });

    it('should include relevanceScore for each experience entry', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      for (const exp of result.output.cv.experience) {
        expect(exp.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(exp.relevanceScore).toBeLessThanOrEqual(100);
      }
    });

    it('should pass roleHint through to output', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      expect(result.output.roleHint).toBe('produktleder');
    });

    it('should add previous experience summary when only newer roles are detailed', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      expect(result.output.cv.previousExperienceSummary).toContain('Nets/BBS');
    });
  });

  describe('match analysis', () => {
    it('should return fitScore in valid range', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      expect(result.output.matchAnalysis.fitScore).toBeGreaterThanOrEqual(0);
      expect(result.output.matchAnalysis.fitScore).toBeLessThanOrEqual(100);
    });

    it('should populate matchedSkills', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      expect(result.output.matchAnalysis.matchedSkills.length).toBeGreaterThan(0);
    });
  });

  describe('gap analysis', () => {
    it('should return gap questions', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      expect(result.output.gaps.questions.length).toBeGreaterThan(0);
    });

    it('should return suggestions for addressing gaps', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      expect(result.output.gaps.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('prompt construction', () => {
    it('should include experience database in system prompt', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('Erfaringsbase');
      expect(prompt).toContain('Carl Johnson');
      expect(prompt).toContain('SpareBank 1');
    });

    it('should include job posting in user prompt', () => {
      const prompt = buildUserPrompt('Vi søker en produktleder', 'produktleder');
      expect(prompt).toContain('Vi søker en produktleder');
      expect(prompt).toContain('produktleder');
    });

    it('should include additionalContext when provided', () => {
      const prompt = buildUserPrompt('Stilling', null, 'Ja, jeg har PSD2-erfaring via SCA-prosjekt');
      expect(prompt).toContain('PSD2-erfaring');
    });

    it('should default to Norwegian', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('norsk (bokmål)');
    });

    it('should switch to English when specified', () => {
      const prompt = buildSystemPrompt('en');
      expect(prompt).toContain('English');
    });
  });

  describe('artifact generation', () => {
    it('should produce a markdown artifact', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('cv-tailor-output');
    });

    it('should include CV content in artifact', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      const content = result.artifacts[0].content;

      expect(content).toContain('Carl Johnson');
      expect(content).toContain('Kjernekompetanse');
      expect(content).not.toContain('Treffanalyse');
    });

    it('should keep gap analysis out of the markdown artifact', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      const content = result.artifacts[0].content;

      expect(content).not.toContain('Gap-analyse');
      expect(content).not.toContain('Spørsmål til Carl');
      expect(result.output.gaps.questions).toHaveLength(1);
    });

    it('should include meta with fitScore and roleHint', async () => {
      makeMockClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      const meta = result.artifacts[0].meta!;

      expect(meta.fitScore).toBe(88);
      expect(meta.roleHint).toBe('produktleder');
      expect(meta.gapQuestions).toBe(1);
      expect(meta.validationIssueCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('validation layer', () => {
    it('should reorder experiences to reverse chronology', async () => {
      const outOfOrder: CvTailorOutput = {
        ...sampleOutput,
        cv: {
          ...sampleOutput.cv,
          experience: [...sampleOutput.cv.experience].reverse(),
        },
      };
      makeMockClaudeResponse(outOfOrder);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      expect(result.output.cv.experience[0].period).toBe('Jan 2025 – nov 2025');
      expect(result.output.cv.experience[1].period).toBe('Jan 2024 – des 2024');
    });

    it('should replace unsupported target-role title with candidate positioning', async () => {
      const mirroredTitle: CvTailorOutput = {
        ...sampleOutput,
        cv: {
          ...sampleOutput.cv,
          title: 'Delivery Lead | Bank og betaling',
        },
      };
      makeMockClaudeResponse(mirroredTitle);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      expect(result.output.cv.title).toBe('Produkt- og leveranseleder | Bank og regulerte teknologimiljøer');
    });

    it('should clean abbreviations and overclaims in final output', async () => {
      const aggressive: CvTailorOutput = {
        ...sampleOutput,
        cv: {
          ...sampleOutput.cv,
          experience: [
            {
              ...sampleOutput.cv.experience[0],
              role: 'Produktleder — BM Mobilbank',
              highlights: ['Eide roadmap', 'Stoppet parallelt arbeid'],
            },
            ...sampleOutput.cv.experience.slice(1),
          ],
        },
      };
      makeMockClaudeResponse(aggressive);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      expect(result.output.cv.experience[0].role).toContain('Mobilbank Bedrift');
      expect(result.output.cv.experience[0].highlights[0]).toContain('Hadde ansvar for');
      expect(result.output.cv.experience[0].highlights[1]).toContain('Reduserte parallelt arbeid');
    });

    it('should remove non-professional language levels', async () => {
      const withBasicLanguage: CvTailorOutput = {
        ...sampleOutput,
        cv: {
          ...sampleOutput.cv,
          languages: [...sampleOutput.cv.languages, 'Tysk (grunnleggende)'],
        },
      };
      makeMockClaudeResponse(withBasicLanguage);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);

      expect(result.output.cv.languages).not.toContain('Tysk (grunnleggende)');
    });
  });

  describe('JSON fence handling', () => {
    it('should handle fenced JSON from Claude', async () => {
      makeFencedClaudeResponse(sampleOutput);
      const result = await cvTailorAgent.execute(cvTailorBasic, ctx);
      expect(result.output.cv.name).toBe('Carl Johnson');
    });
  });

  describe('error handling', () => {
    it('should throw on invalid JSON from Claude', async () => {
      makeBadJsonClaudeResponse();
      await expect(cvTailorAgent.execute(cvTailorBasic, ctx)).rejects.toThrow();
    });
  });
});
