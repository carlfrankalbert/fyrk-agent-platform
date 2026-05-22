import type { z } from 'zod';
import { callClaudeJson } from '../../lib/claude-json.js';
import { callOpenAiJson } from '../../lib/openai-json.js';
import { getEnv } from '../../lib/env.js';

export type Tier = 'quality' | 'fast';
export type Provider = 'claude' | 'openai';

export interface ModelSpec {
  provider: Provider;
  model: string;
  maxTokens: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface TierConfig {
  label: string;
  brief: ModelSpec;
  groundwork: ModelSpec;
  positioning: ModelSpec;
  language: ModelSpec;
  skeptic: ModelSpec;
  factGuard: ModelSpec;
  chiefEditor: ModelSpec;
}

const CLAUDE_SONNET = 'claude-sonnet-4-5-20250929';

/**
 * Default OpenAI model identifiers. These can be overridden per tier via env vars
 * (OPENAI_EDITORIAL_QUALITY_MODEL, OPENAI_EDITORIAL_FAST_MODEL) if your account
 * has access to newer snapshots like gpt-5.5 / gpt-5.4-mini.
 */
const OPENAI_QUALITY_DEFAULT = 'gpt-5';
const OPENAI_FAST_DEFAULT = 'gpt-5-mini';

export function buildTiers(): Record<Tier, TierConfig> {
  const env = getEnv();
  const qualityModel = env.OPENAI_EDITORIAL_QUALITY_MODEL ?? OPENAI_QUALITY_DEFAULT;
  const fastModel = env.OPENAI_EDITORIAL_FAST_MODEL ?? OPENAI_FAST_DEFAULT;

  return {
    quality: {
      label: 'Høy kvalitet',
      brief: { provider: 'openai', model: qualityModel, maxTokens: 4000, reasoningEffort: 'low' },
      groundwork: { provider: 'openai', model: qualityModel, maxTokens: 6000, reasoningEffort: 'low' },
      positioning: { provider: 'openai', model: qualityModel, maxTokens: 8000, reasoningEffort: 'medium' },
      language: { provider: 'claude', model: CLAUDE_SONNET, maxTokens: 4096 },
      skeptic: { provider: 'openai', model: qualityModel, maxTokens: 8000, reasoningEffort: 'medium' },
      factGuard: { provider: 'openai', model: fastModel, maxTokens: 8000, reasoningEffort: 'low' },
      chiefEditor: { provider: 'openai', model: qualityModel, maxTokens: 8000, reasoningEffort: 'medium' },
    },
    fast: {
      label: 'Rask og rimelig',
      brief: { provider: 'openai', model: fastModel, maxTokens: 3000, reasoningEffort: 'minimal' },
      groundwork: { provider: 'openai', model: fastModel, maxTokens: 4000, reasoningEffort: 'low' },
      positioning: { provider: 'openai', model: fastModel, maxTokens: 4000, reasoningEffort: 'low' },
      language: { provider: 'claude', model: CLAUDE_SONNET, maxTokens: 4096 },
      skeptic: { provider: 'openai', model: fastModel, maxTokens: 4000, reasoningEffort: 'low' },
      factGuard: { provider: 'openai', model: fastModel, maxTokens: 4000, reasoningEffort: 'low' },
      chiefEditor: { provider: 'openai', model: qualityModel, maxTokens: 8000, reasoningEffort: 'medium' },
    },
  };
}

/**
 * Single dispatch point: a role gets a ModelSpec and we route to the right provider.
 * Args supplied for both providers; JSON-schema fields are only used by OpenAI.
 */
export async function callRole<T>(
  spec: ModelSpec,
  schema: z.ZodSchema<T>,
  args: {
    system: string;
    user: string;
    schemaName: string;
    schemaDescription: string;
    schemaJson: Record<string, unknown>;
  },
): Promise<T> {
  if (spec.provider === 'openai') {
    const { parsed } = await callOpenAiJson(schema, {
      model: spec.model,
      system: args.system,
      input: args.user,
      schemaName: args.schemaName,
      schemaDescription: args.schemaDescription,
      schemaJson: args.schemaJson,
      maxTokens: spec.maxTokens,
      reasoningEffort: spec.reasoningEffort,
    });
    return parsed;
  }

  const { parsed } = await callClaudeJson(schema, {
    model: spec.model,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
    maxTokens: spec.maxTokens,
  });
  return parsed;
}
