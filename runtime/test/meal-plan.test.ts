import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NullDbClient } from '../src/db/client.js';
import type { AgentContext } from '../src/agents/base.js';
import type { MealPlanOutput } from '../src/agents/meal-plan/schemas.js';
import mealPlanBasic from './fixtures/meal_plan_basic.json';

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

import { mealPlanAgent } from '../src/agents/meal-plan/index.js';
import { callClaude, extractText } from '../src/lib/claude.js';

const mockCallClaude = vi.mocked(callClaude);
const mockExtractText = vi.mocked(extractText);

function makeMockResponse(output: MealPlanOutput) {
  const text = JSON.stringify(output);
  const response = {
    id: 'msg_test',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    usage: { input_tokens: 500, output_tokens: 800 },
  };
  mockCallClaude.mockResolvedValue(response);
  mockExtractText.mockReturnValue(text);
}

const sampleMeals: MealPlanOutput = {
  weekNumber: 9,
  year: 2026,
  meals: [
    {
      dayOfWeek: 1,
      dayName: 'Mandag',
      name: 'Ovnsbakt torsk med rotgronnsaker',
      description: 'Saftig torsk med gulrot, pastinakk og poteter i ovn.',
      estimatedPrepMin: 35,
      tags: ['fisk', 'barnevennlig', 'sesong'],
      keyNutrients: ['omega-3', 'D-vitamin', 'protein'],
      seasonalIngredients: ['torsk', 'gulrot', 'poteter'],
      childTip: 'Server fisken i biter med en mild dipsaus.',
      ingredients: [
        { name: 'Torsk', amount: '600g' },
        { name: 'Gulrot', amount: '4 stk' },
        { name: 'Poteter', amount: '6 stk' },
      ],
    },
    {
      dayOfWeek: 2,
      dayName: 'Tirsdag',
      name: 'Linsesuppe med brod',
      description: 'Varmende rode linser med gulrot og krydder. Vegetardag!',
      estimatedPrepMin: 25,
      tags: ['vegetar', 'belgfrukt', 'batch'],
      keyNutrients: ['fiber', 'jern', 'protein'],
      seasonalIngredients: ['gulrot', 'purre'],
      childTip: 'Mos suppen glatt for de minste.',
      batchNote: 'Lag dobbel porsjon — fryser utmerket!',
      ingredients: [
        { name: 'Rode linser', amount: '3 dl' },
        { name: 'Gulrot', amount: '2 stk' },
        { name: 'Purre', amount: '1 stk' },
      ],
    },
    {
      dayOfWeek: 3,
      dayName: 'Onsdag',
      name: 'Kylling i karry med ris',
      description: 'Mild karrigryte med kylling, brokkoli og paprika.',
      estimatedPrepMin: 30,
      tags: ['kylling', 'barnevennlig', 'asiatisk'],
      keyNutrients: ['protein', 'C-vitamin'],
      seasonalIngredients: [],
      childTip: 'Bruk mild karri og server brokkoli pa siden.',
      ingredients: [
        { name: 'Kyllingfilet', amount: '500g' },
        { name: 'Brokkoli', amount: '1 hode' },
        { name: 'Paprika', amount: '2 stk' },
      ],
    },
    {
      dayOfWeek: 4,
      dayName: 'Torsdag',
      name: 'Laksepasta med spinat',
      description: 'Kremet pasta med laks og spinat i en lett floetesaus.',
      estimatedPrepMin: 25,
      tags: ['fisk', 'pasta', 'rask'],
      keyNutrients: ['omega-3', 'jern', 'kalsium'],
      seasonalIngredients: ['laks'],
      ingredients: [
        { name: 'Laks', amount: '400g' },
        { name: 'Pasta', amount: '400g' },
        { name: 'Spinat', amount: '200g' },
      ],
    },
    {
      dayOfWeek: 5,
      dayName: 'Fredag',
      name: 'Fisketaco med kalslaw',
      description: 'Fredagstaco med panert torsk og frisk kalslaw.',
      estimatedPrepMin: 30,
      tags: ['fisk', 'taco', 'barnevennlig'],
      keyNutrients: ['protein', 'C-vitamin', 'fiber'],
      seasonalIngredients: ['torsk', 'kal'],
      childTip: 'Tortilla med mild fisk — de fleste barn elsker dette!',
      ingredients: [
        { name: 'Torsk', amount: '500g' },
        { name: 'Tortilla', amount: '8 stk' },
        { name: 'Kal', amount: '200g' },
      ],
    },
    {
      dayOfWeek: 6,
      dayName: 'Lordag',
      name: 'Biff med ovnsbakte poteter',
      description: 'Helgestek med ovnsbakte poteter og bearnaise.',
      estimatedPrepMin: 45,
      tags: ['kjott', 'helg'],
      keyNutrients: ['jern', 'B12', 'protein'],
      seasonalIngredients: ['poteter'],
      ingredients: [
        { name: 'Biff', amount: '600g' },
        { name: 'Poteter', amount: '8 stk' },
        { name: 'Bearnaise', amount: '1 pk' },
      ],
    },
    {
      dayOfWeek: 7,
      dayName: 'Sondag',
      name: 'Kalsuppe med byggyn',
      description: 'Tradisjonell norsk suppe med kal, gulrot og byggyn.',
      estimatedPrepMin: 40,
      tags: ['vegetar', 'tradisjonell', 'sesong'],
      keyNutrients: ['fiber', 'C-vitamin', 'jern'],
      seasonalIngredients: ['kal', 'gulrot', 'purre'],
      childTip: 'Kutt gronnsakene i sma biter og server med brod.',
      ingredients: [
        { name: 'Kal', amount: '300g' },
        { name: 'Gulrot', amount: '3 stk' },
        { name: 'Byggyn', amount: '2 dl' },
      ],
    },
  ],
  weekSummary: 'En variert uke med tre fiskemiddager, to vegetardager, og god balanse mellom proteinkildene. Brokkoli og kyllingfilet fra kjoleskapet er brukt opp tidlig i uken.',
  nutritionNotes: 'Uken gir god dekning av omega-3 (3 fiskemiddager), jern fra linser og biff, og rikelig fiber fra belgfrukter og gronnsaker. Kalsium dekkes gjennom meieriprodukter i floetesaus og tilbehor.',
  seasonalHighlight: 'Torsk er i hoysesongen (skrei) og brukes i to middager. Gulrot, kal og purre er norske lagervarer som gir vitaminer gjennom vinteren.',
  traditionNote: 'Fredagstaco er med, men i en sunnere variant med panert torsk i stedet for kjottdeig.',
  shoppingHighlights: ['Torsk (1.1kg)', 'Laks (400g)', 'Kyllingfilet (500g)', 'Biff (600g)', 'Rode linser', 'Spinat', 'Paprika', 'Tortilla'],
  hasMeals: true,
};

describe('meal-plan agent', () => {
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
    it('should reject input missing weekNumber', async () => {
      const { weekNumber, ...input } = mealPlanBasic;
      await expect(mealPlanAgent.execute(input as never, ctx)).rejects.toThrow();
    });

    it('should accept minimal input (weekNumber + year only)', async () => {
      makeMockResponse(sampleMeals);
      const input = { weekNumber: 9, year: 2026 };
      const result = await mealPlanAgent.execute(input, ctx);
      expect(result.output.hasMeals).toBe(true);
    });

    it('should accept full context input', async () => {
      makeMockResponse(sampleMeals);
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output).toBeDefined();
    });
  });

  describe('meal plan generation', () => {
    beforeEach(() => {
      makeMockResponse(sampleMeals);
    });

    it('should return hasMeals true when meals exist', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.hasMeals).toBe(true);
    });

    it('should return correct number of meals', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.meals).toHaveLength(7);
    });

    it('should return meals with correct structure', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      for (const meal of result.output.meals) {
        expect(meal.dayOfWeek).toBeGreaterThanOrEqual(1);
        expect(meal.dayOfWeek).toBeLessThanOrEqual(7);
        expect(meal.dayName).toBeTruthy();
        expect(meal.name).toBeTruthy();
        expect(meal.description).toBeTruthy();
        expect(meal.estimatedPrepMin).toBeGreaterThan(0);
        expect(Array.isArray(meal.tags)).toBe(true);
        expect(Array.isArray(meal.ingredients)).toBe(true);
      }
    });

    it('should return Norwegian day names', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      const dayNames = result.output.meals.map((m) => m.dayName);
      expect(dayNames).toContain('Mandag');
      expect(dayNames).toContain('Fredag');
      expect(dayNames).toContain('Sondag');
    });

    it('should include weekSummary', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.weekSummary).toBeTruthy();
      expect(result.output.weekSummary.length).toBeGreaterThan(20);
    });

    it('should include nutritionNotes', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.nutritionNotes).toBeTruthy();
    });

    it('should include shoppingHighlights', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.shoppingHighlights.length).toBeGreaterThan(0);
    });

    it('should include seasonalHighlight when produce provided', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.seasonalHighlight).toBeTruthy();
    });

    it('should include traditionNote when traditions provided', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.traditionNote).toBeTruthy();
    });

    it('should produce a markdown artifact', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].kind).toBe('weekly-meal-plan');
    });

    it('should include metadata in artifact', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.artifacts[0].meta).toEqual({
        weekNumber: 9,
        year: 2026,
        mealCount: 7,
        householdId: 'default',
      });
    });

    it('should include day names in artifact content', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      const content = result.artifacts[0].content;
      expect(content).toContain('Mandag');
      expect(content).toContain('Fredag');
      expect(content).toContain('Uke 9');
    });
  });

  describe('prompt construction', () => {
    beforeEach(() => {
      makeMockResponse(sampleMeals);
    });

    it('should call Claude with correct model', async () => {
      await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(mockCallClaude).toHaveBeenCalledTimes(1);
      const call = mockCallClaude.mock.calls[0];
      expect(call[0]).toBe('test-api-key');
      expect(call[1].model).toBe('claude-haiku-4-5-20251001');
    });

    it('should include seasonal produce in system prompt', async () => {
      await mealPlanAgent.execute(mealPlanBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('Gulrot');
      expect(call[1].system).toContain('Torsk');
      expect(call[1].system).toContain('Laks');
    });

    it('should include traditions in system prompt', async () => {
      await mealPlanAgent.execute(mealPlanBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('Tacofredag');
    });

    it('should include family allergies in system prompt', async () => {
      await mealPlanAgent.execute(mealPlanBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).toContain('notter');
    });

    it('should include recent meals in user prompt', async () => {
      await mealPlanAgent.execute(mealPlanBasic, ctx);
      const call = mockCallClaude.mock.calls[0];
      const userMsg = call[1].messages[0].content;
      expect(userMsg).toContain('Laksewok');
      expect(userMsg).toContain('Pasta bolognese');
      expect(userMsg).toContain('Taco');
    });
  });

  describe('when Claude returns no meals', () => {
    const noMeals: MealPlanOutput = {
      weekNumber: 9,
      year: 2026,
      meals: [],
      weekSummary: '',
      nutritionNotes: '',
      shoppingHighlights: [],
      hasMeals: false,
    };

    beforeEach(() => {
      makeMockResponse(noMeals);
    });

    it('should return hasMeals false', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.hasMeals).toBe(false);
    });

    it('should produce no artifacts', async () => {
      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.artifacts).toHaveLength(0);
    });
  });

  describe('Claude response with markdown fences', () => {
    it('should handle response wrapped in code fences', async () => {
      const fenced = '```json\n' + JSON.stringify(sampleMeals) + '\n```';
      const response = {
        id: 'msg_test',
        content: [{ type: 'text', text: fenced }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 800 },
      };
      mockCallClaude.mockResolvedValue(response);
      mockExtractText.mockReturnValue(fenced);

      const result = await mealPlanAgent.execute(mealPlanBasic, ctx);
      expect(result.output.hasMeals).toBe(true);
      expect(result.output.meals).toHaveLength(7);
    });
  });

  describe('handles missing optional context gracefully', () => {
    it('should work without seasonal produce or traditions', async () => {
      makeMockResponse(sampleMeals);
      const input = { weekNumber: 9, year: 2026 };
      const result = await mealPlanAgent.execute(input, ctx);
      expect(result.output.hasMeals).toBe(true);

      // System prompt should not contain seasonal section
      const call = mockCallClaude.mock.calls[0];
      expect(call[1].system).not.toContain('Sesongvarer akkurat na');
      expect(call[1].system).not.toContain('Mattradisjoner denne perioden');
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

      await expect(mealPlanAgent.execute(mealPlanBasic, ctx)).rejects.toThrow(
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
        usage: { input_tokens: 500, output_tokens: 100 },
      };
      mockCallClaude.mockResolvedValue(response);
      mockExtractText.mockReturnValue('not valid json');

      await expect(mealPlanAgent.execute(mealPlanBasic, ctx)).rejects.toThrow();
    });

    it('should throw on schema validation failure', async () => {
      const invalidOutput = { weekNumber: 9, year: 2026, meals: 'not an array' };
      const text = JSON.stringify(invalidOutput);
      const response = {
        id: 'msg_test',
        content: [{ type: 'text', text }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 100 },
      };
      mockCallClaude.mockResolvedValue(response);
      mockExtractText.mockReturnValue(text);

      await expect(mealPlanAgent.execute(mealPlanBasic, ctx)).rejects.toThrow();
    });
  });
});
