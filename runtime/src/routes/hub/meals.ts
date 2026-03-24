import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../../lib/supabase.js';
import { loadDbContextCached, getOrCreateCurrentWeekPlan } from '../husmor/db.js';
import { executeActions } from '../husmor/actions.js';
import { requireAuth } from './auth.js';
import { RateMealSchema } from './schemas.js';
import { callClaude } from '../../lib/claude.js';
import { getEnv } from '../../lib/env.js';
import { invalidateCache } from '../husmor/cache.js';
import type { DbContext } from '../husmor/db.js';

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

  // Generate a new weekly meal plan with alternatives via Claude
  fastify.post('/hub/api/meals/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const env = getEnv();
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return reply.status(500).send({ error: 'Missing ANTHROPIC_API_KEY' });
    }

    const supabase = getSupabase();
    const ctx = await loadDbContextCached(supabase);
    const systemPrompt = buildSlimMealPrompt(ctx);

    const body = request.body as { skipDays?: number[]; prefilledMeals?: Array<{ dayOfWeek: string; meal: string }>; kitchenContext?: string; weekOffset?: number } | null;
    const skipDays = body?.skipDays ?? [];
    const weekOffset = body?.weekOffset ?? 0;
    const prefilled = (body?.prefilledMeals ?? []).map(p => ({ dayOfWeek: parseInt(p.dayOfWeek), meal: p.meal }));
    const prefilledDays = new Set(prefilled.map(p => p.dayOfWeek));
    const dayNames = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
    const daysToGenerate = [1, 2, 3, 4, 5, 6, 7].filter(d => !skipDays.includes(d) && !prefilledDays.has(d));
    const activeDayNames = daysToGenerate.map(d => `${dayNames[d]} (dayOfWeek=${d})`).join(', ');
    const skipNote = skipDays.length > 0
      ? `\nFamilien er BORTE disse dagene og trenger IKKE middag: ${skipDays.map(d => dayNames[d]).join(', ')}.`
      : '';
    const prefilledNote = prefilled.length > 0
      ? `\nFamilien har allerede bestemt disse dagene: ${prefilled.map(p => `${dayNames[p.dayOfWeek]}: ${p.meal}`).join(', ')}. IKKE generer alternativer for disse — de er låst. Ta hensyn til dem for variasjon (ikke foreslå lignende retter de andre dagene).`
      : '';

    const kitchenNote = body?.kitchenContext
      ? `\n\nFamilien har snakket med deg og fortalt følgende om hva de har tilgjengelig og ønsker: ${body.kitchenContext}`
      : '';

    const targetWeek = ctx.plan.weekNumber + weekOffset;
    const userMessage = `Lag ukemeny for uke ${targetWeek} med alternativer.

Generer middag for disse dagene: ${activeDayNames}.${skipNote}${prefilledNote}${kitchenNote}

For HVER aktive dag, gi 2 middagsforslag.
Ta hensyn til sesongvarer, familiepreferanser, barnas smaksprofiler og ernæringsbalanse.
Varier mellom fisk, kjøtt, vegetar og belgvekster i tråd med kostrådene.

NAVNGIVING — veldig viktig:
- Gi hver rett et SKIKKELIG RETTNAVN som er gjenkjennelig og minneverdig for barn.
- Bruk kjente rettnavn fra verdens matkultur: "Chicken Kiev", "Svenske kjøttboller", "Maskinistens fiskegrateng", "Pasta Carbonara", "Teriyaki-laks", "Moussaka", "Fish & Chips", "Shakshuka", "Pad Thai".
- IKKE bruk generiske beskrivelser som "Fiskegrateng med purre og gulrot" eller "Pasta med cottage cheese" — gi retten et ordentlig navn.
- Beskrivelsen (description) er til foreldrene og forklarer kort hva retten inneholder.
- Målet: barna skal lære hva en "Chicken Kiev" eller "Maskinistens fiskegrateng" er.

KATEGORI — inkluder alltid:
- "category" på hver option: "fisk", "kjøtt", "fjærkre", "vegetar", "vegan", eller "belgvekst"

VIKTIG:
- IKKE referer til "rester fra gårsdagen" eller anta hva som ble servert andre dager. Hver dag er uavhengig med mindre det er eksplisitt markert som en restedag.
- Ikke bruk add_meals. Svar BARE med denne JSON-strukturen:
{
  "reply": "Kort kommentar om ukeplanen",
  "days": [
    {
      "dayOfWeek": 1,
      "options": [
        { "name": "Chicken Kiev", "description": "Panert kyllingbryst fylt med hvitløkssmør, servert med ris og salat", "category": "fjærkre" },
        { "name": "Teriyaki-laks", "description": "Ovnsbakt laks med teriyakiglasur, edamame og jasminris", "category": "fisk" }
      ]
    }
  ]
}

Sørg for at alternativene er varierte — ikke bare varianter av samme rett.
Det første alternativet for hver dag er hovedforslaget.`;

    try {
      const response = await callClaude(apiKey, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('');

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return reply.status(500).send({ error: 'Ugyldig respons fra Claude' });
      }

      const result = JSON.parse(jsonMatch[0]);
      return { ok: true, reply: result.reply, days: result.days };
    } catch (err) {
      fastify.log.error(err, 'Meal plan generation failed');
      return reply.status(500).send({ error: 'Kunne ikke generere ukemeny' });
    }
  });

  // Confirm/save a generated meal plan
  fastify.post('/hub/api/meals/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const body = request.body as { meals?: Array<{ dayOfWeek: number; name: string; description?: string; mealType?: string; yieldsLeftovers?: boolean }>; weekOffset?: number };
    if (!body.meals || !Array.isArray(body.meals) || body.meals.length === 0) {
      return reply.status(400).send({ error: 'meals array required' });
    }

    const supabase = getSupabase();
    const weekOffset = body.weekOffset ?? 0;
    const planId = await getOrCreateCurrentWeekPlan(supabase, weekOffset);

    const rows = body.meals.map(m => ({
      plan_id: planId,
      day_of_week: m.dayOfWeek,
      name: m.name,
      description: m.description ?? null,
      meal_type: m.mealType ?? 'dinner',
      yields_leftovers: m.yieldsLeftovers ?? false,
      suggested_by: 'husmor',
    }));
    await supabase.from('planned_meals').insert(rows);
    fastify.log.info({ planId, count: rows.length }, 'Confirmed meals');
    invalidateCache('husmor:');
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

/** Lightweight system prompt for meal generation — ~2-3k chars instead of ~80k */
function buildSlimMealPrompt(ctx: DbContext): string {
  const sections: string[] = [];

  sections.push(`Du er Husmor, en matplanlegger for en norsk familie. Du svarer BARE med JSON — ingen annen tekst.`);

  const dateStr = new Date().toLocaleDateString('nb-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  sections.push(`I dag er ${dateStr}. Uke ${ctx.plan.weekNumber}, ${ctx.plan.year}.`);

  // Family preferences
  if (ctx.preferences.length > 0) {
    const prefs = ctx.preferences.map(p => `- ${p.key}: ${JSON.stringify(p.value)}`).join('\n');
    sections.push(`## Familiepreferanser\n${prefs}`);
  }

  // Recent meals for variety
  if (ctx.plan.meals.length > 0) {
    const recent = ctx.plan.meals.map(m => `- ${m.dayName}: ${m.name}`).join('\n');
    sections.push(`## Allerede planlagt denne uken\n${recent}\nUnngå å foreslå lignende retter.`);
  }

  // Seasonal produce
  if (ctx.seasonalProduce.length > 0) {
    sections.push(`## I sesong nå\n${ctx.seasonalProduce.join(', ')}`);
  }

  // Items that need to be used
  if (ctx.inventoryNotes.length > 0) {
    const notes = ctx.inventoryNotes.map(n => {
      const qty = n.quantity ? ` (${n.quantity})` : '';
      return `- ${n.itemName}${qty}`;
    }).join('\n');
    sections.push(`## Må brukes opp\n${notes}`);
  }

  // Core dietary guidelines (condensed)
  sections.push(`## Kostråd (norske)
- Fisk 2-3x/uke (fet fisk minst 1x)
- Begrens rødt kjøtt til 2-3x/uke
- Minst 1 vegetar/belgvekst-dag per uke
- Varier proteinkilder gjennom uken`);

  return sections.join('\n\n');
}
