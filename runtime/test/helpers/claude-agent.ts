import { vi } from 'vitest';
import { NullDbClient } from '../../src/db/client.js';
import type { AgentContext } from '../../src/agents/base.js';
import { callClaude, extractText } from '../../src/lib/claude.js';

export const mockCallClaude = vi.mocked(callClaude);
export const mockExtractText = vi.mocked(extractText);

export function createTestContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    db: new NullDbClient(),
    dryRun: true,
    publish: false,
    runId: 'test-run-id',
    ...overrides,
  };
}

/** Set up mocks so callClaude returns JSON-stringified output. */
export function makeMockClaudeResponse<T>(output: T): void {
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

/** Set up mocks so callClaude returns JSON wrapped in markdown fences. */
export function makeFencedClaudeResponse<T>(output: T): void {
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
}

/** Set up mocks so callClaude returns invalid JSON (for error-handling tests). */
export function makeBadJsonClaudeResponse(): void {
  const response = {
    id: 'msg_test',
    content: [{ type: 'text', text: 'not valid json' }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  mockCallClaude.mockResolvedValue(response);
  mockExtractText.mockReturnValue('not valid json');
}
