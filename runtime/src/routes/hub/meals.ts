import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../../lib/supabase.js';
import { loadDbContextCached } from '../husmor/db.js';
import { executeActions } from '../husmor/actions.js';
import { requireAuth } from './auth.js';
import { RateMealSchema } from './schemas.js';

export async function hubMealsRoutes(fastify: FastifyInstance): Promise<void> {
  // Get current week's meal plan
  fastify.get('/hub/api/meals/week', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const supabase = getSupabase();
    const ctx = await loadDbContextCached(supabase);

    return {
      plan: ctx.plan,
      weeklyNutrition: ctx.weeklyNutrition,
    };
  });

  // Rate a meal
  fastify.post('/hub/api/meals/rate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const parsed = RateMealSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const supabase = getSupabase();
    await executeActions(supabase, [{ type: 'rate_meal', ...parsed.data }], fastify.log);

    return { ok: true };
  });

  // Get saved recipes
  fastify.get('/hub/api/recipes', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('recipes')
      .select('id, name, description, tags, prep_time_min, cook_time_min, servings, nutrition_per_serving')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) return reply.status(500).send({ error: error.message });
    return { recipes: data ?? [] };
  });

  // Get single recipe with ingredients and steps
  fastify.get('/hub/api/recipes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const { id } = request.params as { id: string };
    const supabase = getSupabase();

    const [recipeResult, ingredientsResult, stepsResult] = await Promise.all([
      supabase.from('recipes').select('*').eq('id', id).single(),
      supabase.from('recipe_ingredients').select('*').eq('recipe_id', id).order('sort_order'),
      supabase.from('recipe_steps').select('*').eq('recipe_id', id).order('step_number'),
    ]);

    if (recipeResult.error) return reply.status(404).send({ error: 'Oppskrift ikke funnet' });

    return {
      recipe: recipeResult.data,
      ingredients: ingredientsResult.data ?? [],
      steps: stepsResult.data ?? [],
    };
  });
}
