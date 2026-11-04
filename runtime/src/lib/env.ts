import { z } from 'zod';

/** Optional string that treats empty string as undefined */
const optStr = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());
const optEmail = z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional());

/** Optional JSON object env var. Invalid JSON is passed through as a string so Zod reports it instead of throwing. */
function optJson<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<z.ZodOptional<T>> {
  return z.preprocess((v) => {
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v) as unknown; } catch { return v; }
  }, schema.optional());
}

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: optStr,
  OPENAI_API_KEY: optStr,
  OPENAI_CV_REVIEW_MODEL: optStr,
  OPENAI_EDITORIAL_QUALITY_MODEL: optStr,
  OPENAI_EDITORIAL_FAST_MODEL: optStr,
  CV_SECOND_OPINION_PROVIDER: z.enum(['openai']).optional(),
  ASSIGNMENT_RADAR_THRESHOLD: z.coerce.number().int().min(0).max(100).default(70),
  ASSIGNMENT_RADAR_SLACK_BOT_TOKEN: optStr,
  ASSIGNMENT_RADAR_SLACK_CHANNEL: optStr,
  /** FYRK Slack bot (POST /slack/fyrk-bot-events). Both must be set for the bot to answer. */
  SLACK_FYRK_BOT_TOKEN: optStr,
  SLACK_FYRK_SIGNING_SECRET: optStr,
  /** Bot module used when no channel override matches (see slack-bot/modules/registry.ts). */
  SLACK_BOT_DEFAULT_MODULE: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).default('handbook')),
  /** Per-channel module overrides as JSON, e.g. {"C0123ABC":"handbook"}. */
  SLACK_BOT_CHANNEL_MODULES: optJson(z.record(z.string().min(1), z.string().min(1))),
  HUB_ACCESS_CODE: optStr,
  /** Shared secret for internal operator actions (x-operator-token header). Unset = operator agents refuse. */
  AGENT_OPERATOR_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(24).optional()),
  ODA_EMAIL: optEmail,
  ODA_PASSWORD: optStr,
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

export function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${missing}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    throw new Error('validateEnv() must be called before getEnv()');
  }
  return cachedEnv;
}
