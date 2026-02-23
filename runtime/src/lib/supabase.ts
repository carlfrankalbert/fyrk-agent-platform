import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from './env.js';

export function getSupabase(): SupabaseClient {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
