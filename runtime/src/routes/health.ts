import type { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.js';

function getSupabaseClient() {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async () => {
    try {
      const client = getSupabaseClient();
      const { error } = await client
        .from('agent_runs')
        .select('id', { count: 'exact', head: true });

      if (error) {
        return { ok: false, db: 'error' };
      }
      return { ok: true, db: 'connected' };
    } catch {
      return { ok: false, db: 'error' };
    }
  });

  fastify.get<{ Querystring: { hours?: string } }>('/health/failures', async (request) => {
    const hours = Math.min(Math.max(parseInt(request.query.hours ?? '24', 10) || 24, 1), 168);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('agent_runs')
        .select('id, agent_name, agent_version, status, error, created_at')
        .neq('status', 'completed')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        return { ok: false, error: error.message };
      }

      return {
        ok: true,
        hours,
        count: data.length,
        failures: data,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  await Promise.resolve();
}
