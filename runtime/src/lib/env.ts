import { z } from 'zod';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  SLACK_BOT_TOKEN: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  SLACK_CHANNEL_LEADS: z.string().optional(),
  SLACK_STOCK_BOT_TOKEN: z.string().min(1).optional(),
  SLACK_CHANNEL_STOCK: z.string().optional(),
  SLACK_HUSMOR_BOT_TOKEN: z.string().min(1).optional(),
  SLACK_HUSMOR_SIGNING_SECRET: z.string().min(1).optional(),
  SLACK_CHANNEL_HUSMOR: z.string().optional(),
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
