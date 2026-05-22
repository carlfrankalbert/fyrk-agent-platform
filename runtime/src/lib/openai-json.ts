import type { z } from 'zod';
import { getEnv } from './env.js';
import { stripJsonFences } from './json.js';
import { callOpenAi, extractOpenAiRefusal, extractOpenAiText } from './openai.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini-2024-07-18';
export const DEFAULT_OPENAI_MAX_TOKENS = 4096;

interface CallOpenAiJsonOptions {
  system: string;
  input: string;
  schemaName: string;
  schemaDescription: string;
  schemaJson: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export async function callOpenAiJson<T>(
  schema: z.ZodSchema<T>,
  options: CallOpenAiJsonOptions,
): Promise<{ parsed: T; raw: string }> {
  const env = getEnv();
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const response = await callOpenAi(apiKey, {
    model: options.model ?? env.OPENAI_CV_REVIEW_MODEL ?? DEFAULT_OPENAI_MODEL,
    input: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.input },
    ],
    max_output_tokens: options.maxTokens ?? DEFAULT_OPENAI_MAX_TOKENS,
    text: {
      format: {
        type: 'json_schema',
        name: options.schemaName,
        description: options.schemaDescription,
        schema: options.schemaJson,
        strict: true,
      },
    },
    ...(options.reasoningEffort && { reasoning: { effort: options.reasoningEffort } }),
  });

  const refusal = extractOpenAiRefusal(response);
  if (refusal) {
    throw new Error(`OpenAI refused the request: ${refusal}`);
  }

  const raw = extractOpenAiText(response);
  const jsonStr = stripJsonFences(raw);
  const parsed = schema.parse(JSON.parse(jsonStr));

  return { parsed, raw };
}
