import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../../lib/supabase.js';
import { requireAuth } from './auth.js';

export async function hubChildrenRoutes(fastify: FastifyInstance): Promise<void> {
  // Get child profiles aggregated from meal reactions
  fastify.get('/hub/api/children/profiles', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('child_meal_reactions')
      .select('child_name, meal_name, reaction')
      .eq('household_id', 'default')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return reply.status(500).send({ error: error.message });

    // Aggregate by child
    const childMap = new Map<string, { likes: Set<string>; dislikes: Set<string> }>();

    for (const row of data ?? []) {
      if (!childMap.has(row.child_name)) {
        childMap.set(row.child_name, { likes: new Set(), dislikes: new Set() });
      }
      const child = childMap.get(row.child_name)!;

      if (row.reaction === 'loved' || row.reaction === 'liked') {
        child.likes.add(row.meal_name);
        child.dislikes.delete(row.meal_name); // latest wins
      } else if (row.reaction === 'disliked' || row.reaction === 'refused') {
        child.dislikes.add(row.meal_name);
        child.likes.delete(row.meal_name);
      }
    }

    const children = Array.from(childMap.entries()).map(([name, prefs]) => ({
      name,
      likes: Array.from(prefs.likes).slice(0, 10),
      dislikes: Array.from(prefs.dislikes).slice(0, 10),
    }));

    return { children };
  });
}
