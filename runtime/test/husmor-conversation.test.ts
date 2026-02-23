import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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
}));

// Mock Supabase
const mockFrom = vi.fn();
const mockSupabaseClient = { from: mockFrom };

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

import { callClaude, extractText } from '../src/lib/claude.js';
import { replyInThread, updateMessage, getThreadHistory } from '../src/lib/slack.js';
import {
  handleHusmorMessage,
  loadDbContext,
  buildSystemPrompt,
  parseClaudeResponse,
  executeActions,
  getOrCreateCurrentWeekPlan,
  cleanMessageOrder,
  type HusmorMessageParams,
} from '../src/routes/husmor-conversation.js';
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
function chainMock(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'contains', 'maybeSingle', 'single', 'order'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  // Make terminal methods resolve the result
  const insertChain = { ...chain };
  chain['insert'] = vi.fn().mockReturnValue(insertChain);
  chain['order'] = vi.fn().mockResolvedValue(result);
  return chain;
}

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
      const ctx = {
        plan: {
          planId: 'p1', weekNumber: 9, year: 2026, status: 'draft',
          meals: [{ dayOfWeek: 1, dayName: 'Mandag', name: 'Laks', description: 'Med brokkoli', mealType: 'dinner' }],
        },
        preferences: [], pantryStaples: [], inventoryNotes: [], seasonalProduce: [],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Mandag: Laks');
      expect(prompt).toContain('Med brokkoli');
    });

    it('should show "no plan" when meals are empty', () => {
      const ctx = {
        plan: { planId: null, weekNumber: 9, year: 2026, status: 'none', meals: [] },
        preferences: [], pantryStaples: [], inventoryNotes: [], seasonalProduce: [],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Ingen plan enna');
    });

    it('should include preferences', () => {
      const ctx = {
        plan: { planId: null, weekNumber: 9, year: 2026, status: 'none', meals: [] },
        preferences: [{ key: 'allergies', value: ['melk'] }],
        pantryStaples: [], inventoryNotes: [], seasonalProduce: [],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('allergies');
      expect(prompt).toContain('melk');
    });

    it('should include seasonal produce', () => {
      const ctx = {
        plan: { planId: null, weekNumber: 9, year: 2026, status: 'none', meals: [] },
        preferences: [], pantryStaples: [], inventoryNotes: [],
        seasonalProduce: ['Gulrot', 'Kal'],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Gulrot');
      expect(prompt).toContain('Kal');
    });

    it('should include inventory notes', () => {
      const ctx = {
        plan: { planId: null, weekNumber: 9, year: 2026, status: 'none', meals: [] },
        preferences: [], pantryStaples: [],
        inventoryNotes: [{ itemName: 'Spinat', status: 'use_soon', quantity: '200g' }],
        seasonalProduce: [],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Spinat');
      expect(prompt).toContain('200g');
    });

    it('should include available action types', () => {
      const ctx = {
        plan: { planId: null, weekNumber: 9, year: 2026, status: 'none', meals: [] },
        preferences: [], pantryStaples: [], inventoryNotes: [], seasonalProduce: [],
      };
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('add_meals');
      expect(prompt).toContain('update_meal');
      expect(prompt).toContain('remove_meal');
      expect(prompt).toContain('set_preference');
      expect(prompt).toContain('add_inventory_note');
      expect(prompt).toContain('update_plan_status');
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
          // Return upsertChain for getOrCreate, but need to handle both upsert and update
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

    it('should not throw when individual action fails', async () => {
      mockFrom.mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const actions: HusmorAction[] = [
        { type: 'add_inventory_note', itemName: 'Spinat' },
      ];
      // Should not throw
      await executeActions(mockSupabaseClient as any, actions, mockLogger);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleHusmorMessage', () => {
    it('should call Claude and update thinking message with reply', async () => {
      // Setup Supabase mocks for context loading
      mockFrom.mockImplementation(() => {
        return chainMock({ data: null, error: null });
      });

      makeClaudeResponse('Hei! Ingen plan for denne uken enna.');

      await handleHusmorMessage(makeParams());

      expect(mockCallClaude).toHaveBeenCalledTimes(1);
      expect(mockCallClaude.mock.calls[0][0]).toBe('test-api-key');
      expect(mockCallClaude.mock.calls[0][1].model).toBe('claude-sonnet-4-5-20250929');
      // First call: thinking indicator
      expect(mockReplyInThread).toHaveBeenCalledWith(
        'xoxb-test-token',
        'C-husmor',
        '1700000000.000001',
        'Husmor tenker...',
      );
      // Then: update the thinking message with the real reply
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
          // Must support both context loading (select chain) and action execution (insert)
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
        'Beklager, noe gikk galt. Prov igjen om litt!',
      );
    });

    it('should not throw when error reply also fails', async () => {
      mockFrom.mockImplementation(() => {
        return chainMock({ data: null, error: null });
      });

      mockCallClaude.mockRejectedValue(new Error('Claude down'));
      mockReplyInThread.mockResolvedValueOnce({ ok: true, ts: '1234.5678' }); // thinking msg ok
      mockUpdateMessage.mockRejectedValue(new Error('Slack update down'));
      mockReplyInThread.mockRejectedValue(new Error('Slack down'));

      // Should not throw
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
      // Should send multi-turn messages to Claude
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
      // Bot messages should be wrapped in JSON format
      const parsed = JSON.parse(assistantMsg!.content);
      expect(parsed.reply).toBe('Hei! Hva kan jeg hjelpe med?');
      expect(parsed.actions).toEqual([]);
    });

    it('should skip error messages from thread history', async () => {
      mockFrom.mockImplementation(() => chainMock({ data: null, error: null }));
      mockGetThreadHistory.mockResolvedValue([
        { user: 'U12345', text: 'hei', ts: '1700000000.000001' },
        { bot_id: 'B1', text: 'Beklager, noe gikk galt. Prov igjen om litt!', ts: '1700000000.000002' },
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
        { bot_id: 'B1', text: 'Husmor tenker...', ts: '1700000000.000002' },
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
  });
});
