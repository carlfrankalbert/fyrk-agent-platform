import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock env
vi.mock('../src/lib/env.js', () => ({
  getEnv: () => ({
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_KEY: 'fake-key',
    ANTHROPIC_API_KEY: 'test-api-key',
    SLACK_HUSMOR_BOT_TOKEN: 'xoxb-test-token',
    SLACK_HUSMOR_SIGNING_SECRET: 'test-signing-secret',
    SLACK_CHANNEL_HUSMOR: 'C-husmor',
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
  replyInThread: vi.fn().mockResolvedValue({ ok: true, ts: '1234.5678' }),
  updateMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1234.5678' }),
  getThreadHistory: vi.fn().mockResolvedValue([]),
  verifySignature: vi.fn().mockReturnValue(true),
  createCanvas: vi.fn().mockResolvedValue({ ok: true, canvas_id: 'canvas-1' }),
  editCanvas: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock husmor-learnings (loadLearnings and computeMealPatterns are tested separately)
vi.mock('../src/routes/husmor-learnings.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    loadLearnings: vi.fn().mockResolvedValue([]),
    computeMealPatterns: vi.fn().mockResolvedValue([]),
    extractLearnings: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock Supabase
const mockFrom = vi.fn();
const mockSupabaseClient = { from: mockFrom };

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

import { callClaude, extractText } from '../src/lib/claude.js';
import { replyInThread, updateMessage, getThreadHistory } from '../src/lib/slack.js';
import { handleHusmorMessage, THINKING_MSG, ERROR_MSG, type HusmorMessageParams } from '../src/routes/husmor-conversation.js';
import { buildSystemPrompt, parseClaudeResponse, cleanMessageOrder } from '../src/routes/husmor-prompt.js';
import { executeActions, } from '../src/routes/husmor-actions.js';
import { buildCanvasMarkdown } from '../src/routes/husmor-canvas.js';
import type { DbContext } from '../src/routes/husmor-db.js';
import { buildLearningsSection, buildPatternsSection, type Learning, type MealPattern } from '../src/routes/husmor-learnings.js';
import {
  HusmorSlackMessageEvent,
  HusmorSlackEventEnvelope,
  HusmorActionSchema,
  type HusmorAction,
} from '../src/routes/husmor-schemas.js';

const mockCallClaude = vi.mocked(callClaude);
const mockExtractText = vi.mocked(extractText);
const mockReplyInThread = vi.mocked(replyInThread);
const mockUpdateMessage = vi.mocked(updateMessage);
const mockGetThreadHistory = vi.mocked(getThreadHistory);

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// --- Test helpers ---

function makeDbContext(overrides?: Partial<DbContext>): DbContext {
  return {
    plan: { planId: null, weekNumber: 9, year: 2026, status: 'none', meals: [] },
    preferences: [],
    pantryStaples: [],
    inventoryNotes: [],
    seasonalProduce: [],
    foodTraditions: [],
    nutritionKnowledge: [],
    recentMeals: [],
    learnings: [],
    mealPatterns: [],
    savedRecipes: [],
    ...overrides,
  };
}

function makeParams(overrides?: Partial<HusmorMessageParams>): HusmorMessageParams {
  return {
    text: 'Hei, hva er planen denne uken?',
    channel: 'C-husmor',
    threadTs: '1700000000.000001',
    userId: 'U12345',
    isThreadReply: false,
    logger: mockLogger,
    ...overrides,
  };
}

function makeClaudeResponse(reply: string, actions?: HusmorAction[]) {
  const json = JSON.stringify({ reply, actions: actions ?? [] });
  const response = {
    id: 'msg_test',
    content: [{ type: 'text', text: json }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    usage: { input_tokens: 200, output_tokens: 100 },
  };
  mockCallClaude.mockResolvedValue(response);
  mockExtractText.mockReturnValue(json);
}

// Chain helper for Supabase mock
// The chain is a thenable that resolves to result when awaited directly,
// but also supports chaining via .eq(), .order(), .limit(), etc.
function chainMock(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'contains', 'maybeSingle', 'single', 'order', 'gte', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  // Make the chain itself thenable so `await supabase.from(...).select(...).order(...)` resolves
  chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    return Promise.resolve(result).then(resolve, reject);
  };
  // Make terminal methods resolve the result
  const insertChain = { ...chain };
  chain['insert'] = vi.fn().mockReturnValue(insertChain);
  return chain;
}

// --- Tests ---

describe('husmor-conversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseClaudeResponse', () => {
    it('should parse valid JSON response', () => {
      const result = parseClaudeResponse('{"reply":"Hei!","actions":[]}');
      expect(result.reply).toBe('Hei!');
      expect(result.actions).toEqual([]);
    });

    it('should parse response with actions', () => {
      const json = JSON.stringify({
        reply: 'Lagt til laks pa mandag!',
        actions: [{ type: 'add_meals', meals: [{ dayOfWeek: 1, name: 'Laks' }] }],
      });
      const result = parseClaudeResponse(json);
      expect(result.reply).toBe('Lagt til laks pa mandag!');
      expect(result.actions).toHaveLength(1);
      expect(result.actions![0].type).toBe('add_meals');
    });

    it('should strip markdown fences', () => {
      const json = '```json\n{"reply":"Hei!","actions":[]}\n```';
      const result = parseClaudeResponse(json);
      expect(result.reply).toBe('Hei!');
    });

    it('should salvage plain text as reply when not valid JSON', () => {
      const result = parseClaudeResponse('For mye sukker er skadelig.');
      expect(result.reply).toBe('For mye sukker er skadelig.');
      expect(result.actions).toEqual([]);
    });

    it('should salvage text when reply field is missing from JSON', () => {
      const result = parseClaudeResponse('{"actions":[]}');
      expect(result.reply).toBe('{"actions":[]}');
      expect(result.actions).toEqual([]);
    });

    it('should accept response without actions field', () => {
      const result = parseClaudeResponse('{"reply":"Hei!"}');
      expect(result.reply).toBe('Hei!');
      expect(result.actions).toBeUndefined();
    });
  });

  describe('buildSystemPrompt', () => {
    it('should include current meals in prompt', () => {
      const ctx = makeDbContext({
        plan: {
          planId: 'p1', weekNumber: 9, year: 2026, status: 'draft',
          meals: [{ dayOfWeek: 1, dayName: 'Mandag', name: 'Laks', description: 'Med brokkoli', mealType: 'dinner' }],
        },
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Mandag: Laks');
      expect(prompt).toContain('Med brokkoli');
    });

    it('should show "no plan" when meals are empty', () => {
      const prompt = buildSystemPrompt(makeDbContext());
      expect(prompt).toContain('Ingen plan enna');
    });

    it('should include preferences', () => {
      const ctx = makeDbContext({ preferences: [{ key: 'allergies', value: ['melk'] }] });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('allergies');
      expect(prompt).toContain('melk');
    });

    it('should include seasonal produce', () => {
      const ctx = makeDbContext({ seasonalProduce: ['Gulrot', 'Kal'] });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Gulrot');
      expect(prompt).toContain('Kal');
    });

    it('should include inventory notes', () => {
      const ctx = makeDbContext({
        inventoryNotes: [{ itemName: 'Spinat', status: 'use_soon', quantity: '200g' }],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Spinat');
      expect(prompt).toContain('200g');
    });

    it('should include available action types', () => {
      const prompt = buildSystemPrompt(makeDbContext());
      expect(prompt).toContain('add_meals');
      expect(prompt).toContain('update_meal');
      expect(prompt).toContain('remove_meal');
      expect(prompt).toContain('set_preference');
      expect(prompt).toContain('add_inventory_note');
      expect(prompt).toContain('update_plan_status');
    });

    it('should include food traditions when present', () => {
      const ctx = makeDbContext({
        foodTraditions: [{ name: 'Fettisdagen', country: 'SE', typicalDishes: ['Semlor'], suggestStrength: 'strong', description: 'Svensk tradisjon' }],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Mattradisjoner denne maneden');
      expect(prompt).toContain('Fettisdagen');
      expect(prompt).toContain('Semlor');
      expect(prompt).toContain('sterk anbefaling');
    });

    it('should include nutrition knowledge when present', () => {
      const ctx = makeDbContext({
        nutritionKnowledge: [{ category: 'barn', topic: 'Jern', content: 'Barn trenger ekstra jern', appliesTo: 'children_1_3' }],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Utfyllende kostholdsrad');
      expect(prompt).toContain('barn');
      expect(prompt).toContain('Jern');
      expect(prompt).toContain('children_1_3');
    });

    it('should include recent meals grouped by week', () => {
      const ctx = makeDbContext({
        recentMeals: [
          { weekNumber: 8, year: 2026, dayOfWeek: 1, dayName: 'Mandag', name: 'Laks', feedbackEmoji: null, rating: 4 },
          { weekNumber: 8, year: 2026, dayOfWeek: 3, dayName: 'Onsdag', name: 'Taco', feedbackEmoji: '👍', rating: null },
        ],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Nylige middager');
      expect(prompt).toContain('Uke 8, 2026');
      expect(prompt).toContain('Mandag: Laks');
      expect(prompt).toContain('(4/5)');
      expect(prompt).toContain('Taco');
    });

    it('should include nutrition balance section', () => {
      const prompt = buildSystemPrompt(makeDbContext());
      expect(prompt).toContain('Naeringsbalanse');
      expect(prompt).toContain('Fiskedager');
      expect(prompt).toContain('Vegetardager');
    });

    it('should include recipe instruction', () => {
      const prompt = buildSystemPrompt(makeDbContext());
      expect(prompt).toContain('Oppskrifter');
      expect(prompt).toContain('steg-for-steg');
    });
  });

  describe('buildCanvasMarkdown', () => {
    it('should build markdown with meals and shopping list', () => {
      const meals = [
        { dayOfWeek: 1, dayName: 'Mandag', name: 'Laks', description: 'Med brokkoli' },
        { dayOfWeek: 3, dayName: 'Onsdag', name: 'Taco', description: null },
      ];
      const items = [
        { name: 'Laks', amount: '400', unit: 'g', category: 'Fisk' },
        { name: 'Brokkoli', amount: '1', unit: 'stk', category: 'Gronnsaker' },
      ];
      const md = buildCanvasMarkdown(9, 2026, meals, items);
      expect(md).toContain('# Ukeplan uke 9, 2026');
      expect(md).toContain('**Mandag:** Laks');
      expect(md).toContain('Med brokkoli');
      expect(md).toContain('**Onsdag:** Taco');
      expect(md).toContain('### Fisk');
      expect(md).toContain('- [ ] Laks 400 g');
      expect(md).toContain('### Gronnsaker');
    });

    it('should handle empty meals', () => {
      const md = buildCanvasMarkdown(9, 2026, []);
      expect(md).toContain('Ingen middager planlagt');
    });
  });

  describe('executeActions', () => {
    it('should execute add_meals action', async () => {
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const upsertChain = chainMock({ data: { id: 'plan-1' }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'weekly_plans') return upsertChain;
        if (table === 'planned_meals') return { insert: insertFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [
        { type: 'add_meals', meals: [{ dayOfWeek: 1, name: 'Laks' }] },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(insertFn).toHaveBeenCalledWith([
        expect.objectContaining({ day_of_week: 1, name: 'Laks', meal_type: 'dinner' }),
      ]);
    });

    it('should execute remove_meal action', async () => {
      const deleteFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      });
      const upsertChain = chainMock({ data: { id: 'plan-1' }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'weekly_plans') return upsertChain;
        if (table === 'planned_meals') return { delete: deleteFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [{ type: 'remove_meal', dayOfWeek: 3 }];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(deleteFn).toHaveBeenCalled();
    });

    it('should execute set_preference action', async () => {
      const upsertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'family_preferences') return { upsert: upsertFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [
        { type: 'set_preference', key: 'allergies', value: ['melk', 'egg'] },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'allergies', value: ['melk', 'egg'] }),
        expect.any(Object),
      );
    });

    it('should execute add_inventory_note action', async () => {
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'inventory_notes') return { insert: insertFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [
        { type: 'add_inventory_note', itemName: 'Spinat', status: 'use_soon', quantity: '200g' },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({ item_name: 'Spinat', status: 'use_soon', quantity: '200g' }),
      );
    });

    it('should execute update_plan_status action', async () => {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const upsertChain = chainMock({ data: { id: 'plan-1' }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'weekly_plans') {
          return {
            ...upsertChain,
            update: updateFn,
          };
        }
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [{ type: 'update_plan_status', status: 'approved' }];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
      );
    });

    it('should execute rate_meal action', async () => {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      });
      const upsertChain = chainMock({ data: { id: 'plan-1' }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'weekly_plans') return upsertChain;
        if (table === 'planned_meals') return { update: updateFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [
        { type: 'rate_meal', dayOfWeek: 1, rating: 4, feedbackEmoji: '👍' },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({ feedback_emoji: '👍', rating: 4 }),
      );
    });

    it('should execute generate_shopping_list action', async () => {
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const listInsertChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'list-1' }, error: null }),
          }),
        }),
      };
      const upsertChain = chainMock({ data: { id: 'plan-1' }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'weekly_plans') return upsertChain;
        if (table === 'shopping_lists') return listInsertChain;
        if (table === 'shopping_items') return { insert: insertFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [
        { type: 'generate_shopping_list', items: [{ name: 'Laks', amount: '400', unit: 'g', category: 'fisk' }] },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(listInsertChain.insert).toHaveBeenCalled();
      expect(insertFn).toHaveBeenCalledWith([
        expect.objectContaining({ list_id: 'list-1', name: 'Laks', amount: 400, unit: 'g', category: 'fisk' }),
      ]);
    });

    it('should not throw when individual action fails', async () => {
      mockFrom.mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const actions: HusmorAction[] = [
        { type: 'add_inventory_note', itemName: 'Spinat' },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleHusmorMessage', () => {
    it('should call Claude and update thinking message with reply', async () => {
      mockFrom.mockImplementation(() => {
        return chainMock({ data: null, error: null });
      });

      makeClaudeResponse('Hei! Ingen plan for denne uken enna.');

      await handleHusmorMessage(makeParams());

      expect(mockCallClaude).toHaveBeenCalledTimes(1);
      expect(mockCallClaude.mock.calls[0][0]).toBe('test-api-key');
      expect(mockCallClaude.mock.calls[0][1].model).toBe('claude-sonnet-4-5-20250929');
      expect(mockReplyInThread).toHaveBeenCalledWith(
        'xoxb-test-token',
        'C-husmor',
        '1700000000.000001',
        THINKING_MSG,
      );
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'xoxb-test-token',
        'C-husmor',
        '1234.5678',
        'Hei! Ingen plan for denne uken enna.',
      );
    });

    it('should include user message in Claude prompt', async () => {
      mockFrom.mockImplementation(() => {
        return chainMock({ data: null, error: null });
      });

      makeClaudeResponse('Ok!');

      await handleHusmorMessage(makeParams({ text: 'Vi har laks i kjoleskapet' }));

      const userMsg = mockCallClaude.mock.calls[0][1].messages[0].content;
      expect(userMsg).toBe('Vi har laks i kjoleskapet');
    });

    it('should execute actions from Claude response', async () => {
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'inventory_notes') {
          const chain = chainMock({ data: [], error: null });
          chain['insert'] = insertFn;
          return chain;
        }
        return chainMock({ data: null, error: null });
      });

      makeClaudeResponse('Notert!', [
        { type: 'add_inventory_note', itemName: 'Laks', status: 'available' },
      ]);

      await handleHusmorMessage(makeParams({ text: 'Vi har laks i kjoleskapet' }));

      expect(insertFn).toHaveBeenCalled();
    });

    it('should update thinking message with error when Claude call fails', async () => {
      mockFrom.mockImplementation(() => {
        return chainMock({ data: null, error: null });
      });

      mockCallClaude.mockRejectedValue(new Error('Claude API error'));

      await handleHusmorMessage(makeParams());

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'xoxb-test-token',
        'C-husmor',
        '1234.5678',
        ERROR_MSG,
      );
    });

    it('should not throw when error reply also fails', async () => {
      mockFrom.mockImplementation(() => {
        return chainMock({ data: null, error: null });
      });

      mockCallClaude.mockRejectedValue(new Error('Claude down'));
      mockReplyInThread.mockResolvedValueOnce({ ok: true, ts: '1234.5678' });
      mockUpdateMessage.mockRejectedValue(new Error('Slack update down'));
      mockReplyInThread.mockRejectedValue(new Error('Slack down'));

      await handleHusmorMessage(makeParams());
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('thread history / conversation memory', () => {
    it('should fetch thread history for thread replies', async () => {
      mockFrom.mockImplementation(() => chainMock({ data: null, error: null }));
      mockGetThreadHistory.mockResolvedValue([
        { user: 'U12345', text: 'hei, hva er det til middag?', ts: '1700000000.000001' },
        { bot_id: 'B1', text: 'I dag er det laks!', ts: '1700000000.000002' },
        { user: 'U12345', text: 'kan vi bytte til taco?', ts: '1700000000.000003' },
      ]);
      makeClaudeResponse('Selvfolgelig!');

      await handleHusmorMessage(makeParams({ isThreadReply: true, text: 'kan vi bytte til taco?' }));

      expect(mockGetThreadHistory).toHaveBeenCalledWith('xoxb-test-token', 'C-husmor', '1700000000.000001');
      const messages = mockCallClaude.mock.calls[0][1].messages;
      expect(messages.length).toBeGreaterThan(1);
    });

    it('should not fetch thread history for top-level messages', async () => {
      mockFrom.mockImplementation(() => chainMock({ data: null, error: null }));
      makeClaudeResponse('Hei!');

      await handleHusmorMessage(makeParams({ isThreadReply: false }));

      expect(mockGetThreadHistory).not.toHaveBeenCalled();
    });

    it('should wrap bot messages in JSON format for Claude', async () => {
      mockFrom.mockImplementation(() => chainMock({ data: null, error: null }));
      mockGetThreadHistory.mockResolvedValue([
        { user: 'U12345', text: 'hei', ts: '1700000000.000001' },
        { bot_id: 'B1', text: 'Hei! Hva kan jeg hjelpe med?', ts: '1700000000.000002' },
        { user: 'U12345', text: 'taco i dag?', ts: '1700000000.000003' },
      ]);
      makeClaudeResponse('Ok!');

      await handleHusmorMessage(makeParams({ isThreadReply: true, text: 'taco i dag?' }));

      const messages = mockCallClaude.mock.calls[0][1].messages;
      const assistantMsg = messages.find((m: { role: string }) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      const parsed = JSON.parse(assistantMsg!.content);
      expect(parsed.reply).toBe('Hei! Hva kan jeg hjelpe med?');
      expect(parsed.actions).toEqual([]);
    });

    it('should skip error messages from thread history', async () => {
      mockFrom.mockImplementation(() => chainMock({ data: null, error: null }));
      mockGetThreadHistory.mockResolvedValue([
        { user: 'U12345', text: 'hei', ts: '1700000000.000001' },
        { bot_id: 'B1', text: ERROR_MSG, ts: '1700000000.000002' },
        { user: 'U12345', text: 'prov igjen', ts: '1700000000.000003' },
      ]);
      makeClaudeResponse('Ok!');

      await handleHusmorMessage(makeParams({ isThreadReply: true, text: 'prov igjen' }));

      const messages = mockCallClaude.mock.calls[0][1].messages;
      const allContent = messages.map((m: { content: string }) => m.content).join(' ');
      expect(allContent).not.toContain('Beklager, noe gikk galt');
    });

    it('should skip "Husmor tenker..." messages from history', async () => {
      mockFrom.mockImplementation(() => chainMock({ data: null, error: null }));
      mockGetThreadHistory.mockResolvedValue([
        { user: 'U12345', text: 'hei', ts: '1700000000.000001' },
        { bot_id: 'B1', text: THINKING_MSG, ts: '1700000000.000002' },
        { bot_id: 'B1', text: 'Hei! Hva kan jeg hjelpe med?', ts: '1700000000.000002' },
        { user: 'U12345', text: 'taco i dag?', ts: '1700000000.000003' },
      ]);
      makeClaudeResponse('Ok!');

      await handleHusmorMessage(makeParams({ isThreadReply: true, text: 'taco i dag?' }));

      const messages = mockCallClaude.mock.calls[0][1].messages;
      const allContent = messages.map((m: { content: string }) => m.content).join(' ');
      expect(allContent).not.toContain('Husmor tenker...');
    });
  });

  describe('cleanMessageOrder', () => {
    it('should merge consecutive same-role messages', () => {
      const result = cleanMessageOrder([
        { role: 'user', content: 'hei' },
        { role: 'user', content: 'hva skjer' },
        { role: 'assistant', content: 'hei!' },
        { role: 'user', content: 'ok' },
      ]);
      expect(result).toHaveLength(3);
      expect(result[0].content).toContain('hei');
      expect(result[0].content).toContain('hva skjer');
    });

    it('should ensure first message is user', () => {
      const result = cleanMessageOrder([
        { role: 'assistant', content: 'hei' },
        { role: 'user', content: 'hei tilbake' },
      ]);
      expect(result[0].role).toBe('user');
    });

    it('should ensure last message is user', () => {
      const result = cleanMessageOrder([
        { role: 'user', content: 'hei' },
        { role: 'assistant', content: 'hei!' },
      ]);
      expect(result[result.length - 1].role).toBe('user');
    });
  });

  describe('route filtering (via schema/logic)', () => {
    it('should parse valid message event', () => {
      const result = HusmorSlackMessageEvent.safeParse({
        type: 'message',
        user: 'U12345',
        text: 'Hei Husmor!',
        ts: '1700000000.000001',
        channel: 'C-husmor',
      });
      expect(result.success).toBe(true);
    });

    it('should parse message with bot_id (for filtering)', () => {
      const result = HusmorSlackMessageEvent.safeParse({
        type: 'message',
        text: 'bot message',
        ts: '1700000000.000002',
        channel: 'C-husmor',
        bot_id: 'B12345',
      });
      expect(result.success).toBe(true);
      expect(result.data!.bot_id).toBe('B12345');
    });

    it('should parse message with subtype (for filtering)', () => {
      const result = HusmorSlackMessageEvent.safeParse({
        type: 'message',
        text: 'edited',
        ts: '1700000000.000003',
        channel: 'C-husmor',
        subtype: 'message_changed',
      });
      expect(result.success).toBe(true);
      expect(result.data!.subtype).toBe('message_changed');
    });

    it('should parse thread reply (for filtering)', () => {
      const result = HusmorSlackMessageEvent.safeParse({
        type: 'message',
        user: 'U12345',
        text: 'reply in thread',
        ts: '1700000000.000004',
        channel: 'C-husmor',
        thread_ts: '1700000000.000001',
      });
      expect(result.success).toBe(true);
      expect(result.data!.thread_ts).not.toBe(result.data!.ts);
    });

    it('should parse envelope for event_callback', () => {
      const result = HusmorSlackEventEnvelope.safeParse({
        type: 'event_callback',
        token: 'tok',
        event: { type: 'message', text: 'hei', ts: '123', channel: 'C1' },
      });
      expect(result.success).toBe(true);
      expect(result.data!.type).toBe('event_callback');
    });
  });

  describe('action schema validation', () => {
    it('should validate add_meals action', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'add_meals',
        meals: [{ dayOfWeek: 1, name: 'Laks', description: 'Med brokkoli' }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid dayOfWeek', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'add_meals',
        meals: [{ dayOfWeek: 8, name: 'Laks' }],
      });
      expect(result.success).toBe(false);
    });

    it('should validate update_plan_status action', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'update_plan_status',
        status: 'approved',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid plan status', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'update_plan_status',
        status: 'invalid_status',
      });
      expect(result.success).toBe(false);
    });

    it('should validate rate_meal action', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'rate_meal',
        dayOfWeek: 1,
        rating: 4,
        feedbackEmoji: '👍',
      });
      expect(result.success).toBe(true);
    });

    it('should reject rate_meal with invalid rating', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'rate_meal',
        dayOfWeek: 1,
        rating: 6,
      });
      expect(result.success).toBe(false);
    });

    it('should validate generate_shopping_list action', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'generate_shopping_list',
        items: [{ name: 'Laks', amount: '400', unit: 'g', category: 'fisk' }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject generate_shopping_list with empty items', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'generate_shopping_list',
        items: [],
      });
      expect(result.success).toBe(false);
    });

    it('should validate propose_learning action', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'propose_learning',
        category: 'preference',
        insight: 'Familien foretrekker taco pa fredager',
        confidence: 0.9,
      });
      expect(result.success).toBe(true);
    });

    it('should validate propose_learning without confidence', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'propose_learning',
        category: 'routine',
        insight: 'Raske middager pa tirsdager',
      });
      expect(result.success).toBe(true);
    });

    it('should reject propose_learning with invalid category', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'propose_learning',
        category: 'invalid_category',
        insight: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should reject propose_learning with confidence out of range', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'propose_learning',
        category: 'preference',
        insight: 'test',
        confidence: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('buildLearningsSection', () => {
    it('should return null for empty learnings', () => {
      expect(buildLearningsSection([])).toBeNull();
    });

    it('should group learnings by category', () => {
      const learnings: Learning[] = [
        { id: '1', category: 'preference', insight: 'Familien liker laks', confidence: 0.9, confirmed: true, source: 'extraction' },
        { id: '2', category: 'preference', insight: 'Barna liker ikke sopp', confidence: 0.8, confirmed: null, source: 'extraction' },
        { id: '3', category: 'routine', insight: 'Taco pa fredager', confidence: 0.95, confirmed: true, source: 'proposed' },
      ];
      const result = buildLearningsSection(learnings)!;
      expect(result).toContain('Matpreferanser');
      expect(result).toContain('Rutiner');
      expect(result).toContain('Familien liker laks');
      expect(result).toContain('(bekreftet)');
      expect(result).toContain('Taco pa fredager');
    });

    it('should include learnings in system prompt when present', () => {
      const ctx = makeDbContext({
        learnings: [
          { id: '1', category: 'preference', insight: 'Liker fisk', confidence: 0.9, confirmed: true, source: 'extraction' },
        ],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Lerdommer fra tidligere samtaler');
      expect(prompt).toContain('Liker fisk');
    });

    it('should not include learnings section when empty', () => {
      const ctx = makeDbContext({ learnings: [] });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).not.toContain('Lerdommer fra tidligere samtaler');
    });
  });

  describe('buildPatternsSection', () => {
    it('should return null for empty patterns', () => {
      expect(buildPatternsSection([])).toBeNull();
    });

    it('should group patterns by type', () => {
      const patterns: MealPattern[] = [
        { type: 'favorite', description: 'Laks scorer 4.5/5 i snitt (servert 5 ganger)' },
        { type: 'weekday', description: 'Fredag: Taco (5 av 8 uker)' },
        { type: 'balance', description: 'Fisk: 2.1 ganger/uke' },
      ];
      const result = buildPatternsSection(patterns)!;
      expect(result).toContain('Favoritter');
      expect(result).toContain('Ukedagsmonstre');
      expect(result).toContain('Balanse siste uker');
      expect(result).toContain('Laks scorer 4.5/5');
      expect(result).toContain('Fredag: Taco');
      expect(result).toContain('Fisk: 2.1 ganger/uke');
    });

    it('should include avoid section when present', () => {
      const patterns: MealPattern[] = [
        { type: 'avoid', description: 'Grot scorer 1.5/5 i snitt — vurder a droppe' },
      ];
      const result = buildPatternsSection(patterns)!;
      expect(result).toContain('Unnga');
      expect(result).toContain('Grot scorer 1.5/5');
    });

    it('should include patterns in system prompt when present', () => {
      const ctx = makeDbContext({
        mealPatterns: [
          { type: 'favorite', description: 'Taco scorer 4.8/5 i snitt (servert 8 ganger)' },
        ],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Maltidsmonstre');
      expect(prompt).toContain('Taco scorer 4.8/5');
    });
  });

  describe('propose_learning action', () => {
    it('should execute propose_learning action and insert learning', async () => {
      const insertFn = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'learning-1' }, error: null }),
        }),
      });
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'household_learnings') return { insert: insertFn, update: updateFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [
        { type: 'propose_learning', category: 'preference', insight: 'Familien liker taco', confidence: 0.9 },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger, 'xoxb-test-token', { channel: 'C-husmor', threadTs: '1700000000.000001' });

      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'preference',
          insight: 'Familien liker taco',
          confidence: 0.9,
          source: 'proposed',
        }),
      );
    });

    it('should post confirmation message in Slack thread', async () => {
      const insertFn = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'learning-1' }, error: null }),
        }),
      });
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'household_learnings') return { insert: insertFn, update: updateFn };
        return chainMock({ data: null, error: null });
      });

      const mockReply = vi.mocked(replyInThread);
      mockReply.mockResolvedValue({ ok: true, ts: '9999.1234' });

      const actions: HusmorAction[] = [
        { type: 'propose_learning', category: 'routine', insight: 'Raske middager pa tirsdager' },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger, 'xoxb-test-token', { channel: 'C-husmor', threadTs: '1700000000.000001' });

      // Should have called replyInThread (once for the learning proposal, plus potentially for thinking)
      const proposalCalls = mockReply.mock.calls.filter(
        (c) => typeof c[3] === 'string' && c[3].includes('Husker du dette?'),
      );
      expect(proposalCalls).toHaveLength(1);
      expect(proposalCalls[0][3]).toContain('Raske middager pa tirsdager');
    });

    it('should include propose_learning in system prompt actions doc', () => {
      const prompt = buildSystemPrompt(makeDbContext());
      expect(prompt).toContain('propose_learning');
      expect(prompt).toContain('Foresla en observasjon for bekreftelse');
    });
  });

  describe('feedbackText on rate_meal', () => {
    it('should validate rate_meal with feedbackText', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'rate_meal',
        dayOfWeek: 1,
        rating: 4,
        feedbackText: 'Barna spiste alt, kjempegod!',
      });
      expect(result.success).toBe(true);
    });

    it('should reject feedbackText over 300 chars', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'rate_meal',
        dayOfWeek: 1,
        feedbackText: 'x'.repeat(301),
      });
      expect(result.success).toBe(false);
    });

    it('should include feedbackText in system prompt for recent meals', () => {
      const ctx = makeDbContext({
        recentMeals: [
          { weekNumber: 8, year: 2026, dayOfWeek: 1, dayName: 'Mandag', name: 'Laks', feedbackEmoji: null, rating: 4, feedbackText: 'Barna elsket det' },
        ],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('"Barna elsket det"');
    });

    it('should include feedbackText instruction in ACTIONS_DOC', () => {
      const prompt = buildSystemPrompt(makeDbContext());
      expect(prompt).toContain('feedbackText');
      expect(prompt).toContain('kort fritekst');
    });

    it('should execute rate_meal with feedbackText', async () => {
      const updateFn = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      });
      const upsertChain = chainMock({ data: { id: 'plan-1' }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'weekly_plans') return upsertChain;
        if (table === 'planned_meals') return { update: updateFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [
        { type: 'rate_meal', dayOfWeek: 1, rating: 5, feedbackText: 'Perfekt middag' },
      ];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({ rating: 5, feedback_text: 'Perfekt middag' }),
      );
    });
  });

  describe('save_recipe action', () => {
    it('should validate save_recipe action', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'save_recipe',
        name: 'Laksegryte',
        prepTimeMin: 10,
        cookTimeMin: 25,
        servings: 4,
        ingredients: [{ name: 'Laks', amount: '400', unit: 'g' }],
        steps: [{ instruction: 'Stek laksen', durationMin: 5 }],
      });
      expect(result.success).toBe(true);
    });

    it('should validate save_recipe with only name', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'save_recipe',
        name: 'Taco',
      });
      expect(result.success).toBe(true);
    });

    it('should reject save_recipe without name', () => {
      const result = HusmorActionSchema.safeParse({
        type: 'save_recipe',
      });
      expect(result.success).toBe(false);
    });

    it('should include save_recipe in system prompt actions doc', () => {
      const prompt = buildSystemPrompt(makeDbContext());
      expect(prompt).toContain('save_recipe');
      expect(prompt).toContain('Lagre en oppskrift');
    });

    it('should execute save_recipe action', async () => {
      const recipeInsertFn = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'recipe-1' }, error: null }),
        }),
      });
      const ingredientInsertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const stepInsertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'recipes') return { insert: recipeInsertFn };
        if (table === 'recipe_ingredients') return { insert: ingredientInsertFn };
        if (table === 'recipe_steps') return { insert: stepInsertFn };
        return chainMock({ data: null, error: null });
      });

      const actions: HusmorAction[] = [{
        type: 'save_recipe',
        name: 'Laksegryte',
        prepTimeMin: 10,
        cookTimeMin: 25,
        ingredients: [{ name: 'Laks', amount: '400', unit: 'g' }],
        steps: [{ instruction: 'Stek laksen', durationMin: 5 }],
      }];
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(recipeInsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Laksegryte', prep_time_min: 10 }),
      );
      expect(ingredientInsertFn).toHaveBeenCalledWith([
        expect.objectContaining({ recipe_id: 'recipe-1', name: 'Laks', sort_order: 1 }),
      ]);
      expect(stepInsertFn).toHaveBeenCalledWith([
        expect.objectContaining({ recipe_id: 'recipe-1', step_number: 1, instruction: 'Stek laksen' }),
      ]);
    });

    it('should include saved recipes in system prompt', () => {
      const ctx = makeDbContext({
        savedRecipes: [
          { id: 'r1', name: 'Laksegryte', prepTimeMin: 10, cookTimeMin: 25, avgRating: 4.5, lastUsedWeek: 7, lastUsedYear: 2026 },
        ],
      });
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Lagrede oppskrifter');
      expect(prompt).toContain('Laksegryte');
      expect(prompt).toContain('4.5/5');
    });
  });
});
