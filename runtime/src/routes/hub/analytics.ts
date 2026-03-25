import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getSupabase } from '../../lib/supabase.js';
import { requireAuth } from './auth.js';

const EventSchema = z.object({
  feature: z.string().min(1).max(100),
  action: z.string().min(1).max(50),
  metadata: z.record(z.unknown()).optional(),
});

const BatchEventsSchema = z.object({
  events: z.array(EventSchema).min(1).max(200),
});

export async function hubAnalyticsRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /hub/api/analytics/events — batch insert usage events
  fastify.post(
    '/hub/api/analytics/events',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = BatchEventsSchema.parse(request.body);
      const supabase = getSupabase();

      const rows = body.events.map((e) => ({
        household_id: 'default',
        feature: e.feature,
        action: e.action,
        metadata: e.metadata ?? {},
      }));

      const { error } = await supabase.from('hub_usage_events').insert(rows);
      if (error) {
        fastify.log.warn({ err: error }, 'Failed to insert usage events');
        return reply.status(500).send({ error: 'Failed to store events' });
      }

      return { ok: true, count: rows.length };
    },
  );

  // GET /hub/api/analytics/summary — aggregated usage data
  fastify.get(
    '/hub/api/analytics/summary',
    { preHandler: requireAuth },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const supabase = getSupabase();

      // Feature totals (last 30 days)
      const { data: summary, error } = await supabase
        .from('hub_usage_summary')
        .select('*');

      if (error) {
        fastify.log.warn({ err: error }, 'Failed to fetch usage summary');
        return reply.status(500).send({ error: 'Failed to fetch summary' });
      }

      // Aggregate into per-feature stats
      const features: Record<
        string,
        { total: number; lastUsed: string; byDay: Record<string, number>; actions: Record<string, number> }
      > = {};

      for (const row of summary ?? []) {
        const key = row.feature;
        if (!features[key]) {
          features[key] = { total: 0, lastUsed: '', byDay: {}, actions: {} };
        }
        const f = features[key];
        f.total += row.count;
        if (!f.lastUsed || row.last_used > f.lastUsed) {
          f.lastUsed = row.last_used;
        }
        f.byDay[row.day] = (f.byDay[row.day] ?? 0) + row.count;
        f.actions[row.action] = (f.actions[row.action] ?? 0) + row.count;
      }

      // Sort by total desc
      const sorted = Object.entries(features)
        .map(([feature, stats]) => ({ feature, ...stats }))
        .sort((a, b) => b.total - a.total);

      return { features: sorted };
    },
  );
}
