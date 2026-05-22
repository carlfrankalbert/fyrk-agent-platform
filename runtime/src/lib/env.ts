import { z } from 'zod';

/** Optional string that treats empty string as undefined */
const optStr = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());
const optEmail = z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional());

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: optStr,
  OPENAI_API_KEY: optStr,
  OPENAI_CV_REVIEW_MODEL: optStr,
  OPENAI_EDITORIAL_QUALITY_MODEL: optStr,
  OPENAI_EDITORIAL_FAST_MODEL: optStr,
  CV_SECOND_OPINION_PROVIDER: z.enum(['openai']).optional(),
  HUB_ACCESS_CODE: optStr,
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
