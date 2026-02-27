import type { z } from 'zod';
import { callClaude, extractText, type ClaudeMessage } from './claude.js';
import { getEnv } from './env.js';
import { stripJsonFences } from './json.js';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_MAX_TOKENS = 4096;

interface CallClaudeJsonOptions {
  system: string;
  messages: ClaudeMessage[];
  model?: string;
  maxTokens?: number;
  cacheControl?: { type: 'ephemeral' };
}

/**
 * Call Claude, extract text, strip JSON fences, parse JSON, and validate with a Zod schema.
 * Handles the full pipeline: env → API key check → callClaude → extractText → strip fences → JSON.parse → schema.parse.
 */
export async function callClaudeJson<T>(
  schema: z.ZodSchema<T>,
  options: CallClaudeJsonOptions,
): Promise<{ parsed: T; raw: string }> {
  const env = getEnv();
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }

  const response = await callClaude(apiKey, {
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: options.system,
    messages: options.messages,
    ...(options.cacheControl && { cache_control: options.cacheControl }),
  });

  const raw = extractText(response);
  const jsonStr = stripJsonFences(raw);
  const parsed = schema.parse(JSON.parse(jsonStr));

  return { parsed, raw };
}
