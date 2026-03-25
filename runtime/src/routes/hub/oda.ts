import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.js';
import { getSupabase } from '../../lib/supabase.js';
import { getOrCreateCurrentWeekPlan } from '../husmor/db.js';
import {
  searchProducts,
  bestMatch,
  addToCart,
  removeFromCart,
  getCart,
  getSession,
  extractPackCount,
} from '../../lib/oda.js';

interface SyncRequest {
  itemIds?: string[]; // specific items, or omit for all unchecked
}

export async function hubOdaRoutes(fastify: FastifyInstance): Promise<void> {
  // Sync shopping items to Oda cart
  fastify.post('/hub/api/oda/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const body = request.body as SyncRequest | null;
    const supabase = getSupabase();
    const planId = await getOrCreateCurrentWeekPlan(supabase);

    // Get shopping list
    const { data: list } = await supabase
      .from('shopping_lists')
      .select('id')
      .eq('plan_id', planId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!list) return reply.status(404).send({ error: 'Ingen handleliste funnet' });

    // Get items to sync
    let query = supabase
      .from('shopping_items')
      .select('id, name, amount, unit')
      .eq('list_id', list.id);

    if (body?.itemIds && body.itemIds.length > 0) {
      query = query.in('id', body.itemIds);
    } else {
      query = query.eq('checked', false);
    }

    const { data: items, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    if (!items || items.length === 0) return reply.status(400).send({ error: 'Ingen varer å synkronisere' });

    const session = await getSession();
    const results: Array<{
      itemId: string;
      name: string;
      status: 'added' | 'not_found' | 'error';
      odaProduct?: { id: number; name: string; price: string };
      error?: string;
    }> = [];

    for (const item of items) {
      try {
        const searchQuery = item.amount && item.unit
          ? `${item.name} ${item.amount}${item.unit}`
          : item.name;

        const products = await searchProducts(session, searchQuery);
        const match = bestMatch(products, searchQuery);

        if (!match) {
          results.push({ itemId: item.id, name: item.name, status: 'not_found' });
          continue;
        }

        // Adjust quantity for multi-packs
        const packCount = extractPackCount(match.name);
        const quantity = item.amount && packCount > 1
          ? Math.ceil(item.amount / packCount)
          : 1;

        await addToCart(match.id, quantity);
        results.push({
          itemId: item.id,
          name: item.name,
          status: 'added',
          odaProduct: { id: match.id, name: match.name, price: match.price },
        });
      } catch (err) {
        results.push({
          itemId: item.id,
          name: item.name,
          status: 'error',
          error: err instanceof Error ? err.message : 'Ukjent feil',
        });
      }
    }

    const added = results.filter(r => r.status === 'added').length;
    const notFound = results.filter(r => r.status === 'not_found').length;

    return {
      ok: true,
      summary: { total: items.length, added, notFound, errors: results.length - added - notFound },
      results,
    };
  });

  // Get Oda cart
  fastify.get('/hub/api/oda/cart', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const cart = await getCart();
      return cart;
    } catch (err) {
      fastify.log.error(err, 'Failed to fetch Oda cart');
      return reply.status(500).send({ error: 'Kunne ikke hente Oda-handlekurv' });
    }
  });

  // Remove item from Oda cart
  fastify.delete('/hub/api/oda/cart/:productId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const { productId } = request.params as { productId: string };
    const id = parseInt(productId, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Ugyldig produkt-ID' });

    try {
      await removeFromCart(id);
      return { ok: true };
    } catch (err) {
      fastify.log.error(err, 'Failed to remove from Oda cart');
      return reply.status(500).send({ error: 'Kunne ikke fjerne vare fra Oda' });
    }
  });
}
