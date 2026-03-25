import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../../lib/supabase.js';
import { getOrCreateCurrentWeekPlan } from '../husmor/db.js';
import { requireAuth } from './auth.js';
import { AddShoppingItemsSchema } from './schemas.js';

async function getOrCreateShoppingList(supabase: ReturnType<typeof getSupabase>): Promise<string> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);

  // Try to find existing list for this plan
  const { data: existing } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  // Create new list
  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({ plan_id: planId, household_id: 'default', status: 'active' })
    .select('id')
    .single();

  if (error || !data) throw new Error('Failed to create shopping list');
  return data.id;
}

export async function hubShoppingRoutes(fastify: FastifyInstance): Promise<void> {
  // Get shopping list
  fastify.get('/hub/api/shopping', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const supabase = getSupabase();
    const listId = await getOrCreateShoppingList(supabase);

    const { data, error } = await supabase
      .from('shopping_items')
      .select('id, name, amount, unit, category, checked')
      .eq('list_id', listId)
      .order('category')
      .order('name');

    if (error) return reply.status(500).send({ error: error.message });
    return { listId, items: data ?? [] };
  });

  // Add items
  fastify.post('/hub/api/shopping/items', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const parsed = AddShoppingItemsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });

    const supabase = getSupabase();
    const listId = await getOrCreateShoppingList(supabase);

    const rows = parsed.data.items.map((item) => ({
      list_id: listId,
      name: item.name,
      amount: item.amount ?? null,
      unit: item.unit ?? null,
      category: item.category ?? null,
    }));

    const { error } = await supabase.from('shopping_items').insert(rows);
    if (error) return reply.status(500).send({ error: error.message });

    return { ok: true, count: rows.length };
  });

  // Toggle checked
  fastify.patch('/hub/api/shopping/items/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const { id } = request.params as { id: string };
    const body = request.body as { checked?: boolean };
    const supabase = getSupabase();

    if (body.checked !== undefined) {
      const { error } = await supabase
        .from('shopping_items')
        .update({ checked: body.checked })
        .eq('id', id);
      if (error) return reply.status(500).send({ error: error.message });
    }

    return { ok: true };
  });

  // Delete all checked items
  fastify.delete('/hub/api/shopping/checked', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const supabase = getSupabase();
    const listId = await getOrCreateShoppingList(supabase);

    const { error } = await supabase
      .from('shopping_items')
      .delete()
      .eq('list_id', listId)
      .eq('checked', true);

    if (error) return reply.status(500).send({ error: error.message });
    return { ok: true };
  });

  // Delete item
  fastify.delete('/hub/api/shopping/items/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const { id } = request.params as { id: string };
    const supabase = getSupabase();

    const { error } = await supabase.from('shopping_items').delete().eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    return { ok: true };
  });
}
