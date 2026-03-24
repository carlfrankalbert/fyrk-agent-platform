import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../../lib/supabase.js';
import { loadDbContextCached, getOrCreateCurrentWeekPlan } from '../husmor/db.js';
import { executeActions } from '../husmor/actions.js';
import { requireAuth } from './auth.js';
import { RateMealSchema } from './schemas.js';
import { callClaude } from '../../lib/claude.js';
import { getEnv } from '../../lib/env.js';
import { invalidateCache, getOrCompute } from '../husmor/cache.js';
import type { DbContext } from '../husmor/db.js';
import { fetchAllCalendars, type CalendarEvent } from './calendar.js';

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
    const [ctx, calendar] = await Promise.all([
      loadDbContextCached(supabase),
      getOrCompute('hub:calendar', fetchAllCalendars, 5 * 60 * 1000),
    ]);

    const body = request.body as { skipDays?: number[]; prefilledMeals?: Array<{ dayOfWeek: string; meal: string }>; kitchenContext?: string; weekOffset?: number } | null;
    const skipDays = body?.skipDays ?? [];
    const weekOffset = body?.weekOffset ?? 0;
    const prefilled = (body?.prefilledMeals ?? []).map(p => ({ dayOfWeek: parseInt(p.dayOfWeek), meal: p.meal }));
    const prefilledDays = new Set(prefilled.map(p => p.dayOfWeek));
    const dayNames = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
    const daysToGenerate = [1, 2, 3, 4, 5, 6, 7].filter(d => !skipDays.includes(d) && !prefilledDays.has(d));

    // Compute actual dates for the target week
    const targetWeek = ctx.plan.weekNumber + weekOffset;
    const targetYear = ctx.plan.year;
    const weekDates = getWeekDates(targetYear, targetWeek);

    // Build per-day date + calendar context
    const calendarByDay = groupCalendarByDay(calendar.events, weekDates);
    const activeDayNames = daysToGenerate.map(d => {
      const date = weekDates[d];
      const dateStr = date ? formatNorwegianDate(date) : '';
      return `${dayNames[d]} ${dateStr} (dayOfWeek=${d})`;
    }).join(', ');

    const skipNote = skipDays.length > 0
      ? `\nFamilien er BORTE disse dagene og trenger IKKE middag: ${skipDays.map(d => dayNames[d]).join(', ')}.`
      : '';
    const prefilledNote = prefilled.length > 0
      ? `\nFamilien har allerede bestemt disse dagene: ${prefilled.map(p => `${dayNames[p.dayOfWeek]}: ${p.meal}`).join(', ')}. IKKE generer alternativer for disse — de er låst. Ta hensyn til dem for variasjon (ikke foreslå lignende retter de andre dagene).`
      : '';

    const kitchenNote = body?.kitchenContext
      ? `\n\nFamilien har snakket med deg og fortalt følgende om hva de har tilgjengelig og ønsker: ${body.kitchenContext}`
      : '';

    // Build calendar context section for Claude
    const calendarSection = buildCalendarSection(calendarByDay, dayNames, weekDates, daysToGenerate);

    const systemPrompt = buildSlimMealPrompt(ctx);
    const userMessage = `Lag ukemeny for uke ${targetWeek} med alternativer.

Generer middag for disse dagene: ${activeDayNames}.${skipNote}${prefilledNote}${kitchenNote}
${calendarSection}
For HVER aktive dag, gi 2 middagsforslag.
Ta hensyn til sesongvarer, familiepreferanser, barnas smaksprofiler og ernæringsbalanse.
Varier mellom fisk, kjøtt, vegetar og belgvekster i tråd med kostrådene.

TILPASS TIL HVOR TRAVEL DAGEN ER:
- "travel" dager (mange avtaler, henting, trening) → raske retter under 30 min
- "normal" dager → vanlige retter
- "rolig" dager (ingen avtaler) → kan være mer ambisiøse retter

NAVNGIVING — veldig viktig:
- Gi hver rett et SKIKKELIG RETTNAVN som er gjenkjennelig og minneverdig for barn.
- Bruk kjente rettnavn fra verdens matkultur: "Chicken Kiev", "Svenske kjøttboller", "Pasta Carbonara", "Teriyaki-laks", "Fish & Chips", "Shakshuka", "Pad Thai".
- IKKE bruk generiske beskrivelser som "Fiskegrateng med purre og gulrot" — gi retten et ordentlig navn.
- Beskrivelsen (description) er til foreldrene og forklarer kort hva retten inneholder.

KATEGORI — inkluder alltid:
- "category" på hver option: "fisk", "kjøtt", "fjærkre", "vegetar", "vegan", eller "belgvekst"

VIKTIG:
- IKKE referer til "rester fra gårsdagen" eller anta hva som ble servert andre dager.
- Svar BARE med denne JSON-strukturen:
{
  "reply": "Kort kommentar om ukeplanen",
  "days": [
    {
      "dayOfWeek": 1,
      "contextLine": "Henting 17:00",
      "busyness": "travel",
      "options": [
        {
          "name": "Chicken Kiev",
          "description": "Panert kyllingbryst fylt med hvitløkssmør, servert med ris og salat",
          "category": "fjærkre",
          "reasoning": "Rask rett som passer en travel dag",
          "planB": "Brødmat med pålegg"
        },
        {
          "name": "Teriyaki-laks",
          "description": "Ovnsbakt laks med teriyakiglasur, edamame og jasminris",
          "category": "fisk",
          "reasoning": "Sunn og rask — ferdig på 25 min"
        }
      ]
    }
  ]
}

- "contextLine": Kort oppsummering av dagen (maks 4 ord). F.eks. "Travelt", "Henting 17:00", "Rolig dag", "Trening ettermiddag".
- "busyness": "rolig", "normal" eller "travel" — basert på kalenderaktivitet.
- "reasoning": Én setning (maks 15 ord) om hvorfor denne retten passer denne dagen.
- "planB": KUN for travel-dager — et enkelt alternativ hvis planen ryker (f.eks. "Frossenpizza + salat", "Brødmat").

Sørg for at alternativene er varierte — ikke bare varianter av samme rett.
Det første alternativet for hver dag er hovedforslaget.`;

    try {
      const response = await callClaude(apiKey, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
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

      // Inject server-computed dates (don't trust Claude for date math)
      for (const day of result.days ?? []) {
        const date = weekDates[day.dayOfWeek];
        if (date) {
          day.date = date.toISOString().slice(0, 10);
        }
      }

      return { ok: true, reply: result.reply, days: result.days };
    } catch (err) {
      fastify.log.error(err, 'Meal plan generation failed');
      return reply.status(500).send({ error: 'Kunne ikke generere ukemeny' });
    }
  });

  // Confirm/save a generated meal plan
  fastify.post('/hub/api/meals/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAuth(request, reply))) return;

    const body = request.body as { meals?: Array<{ dayOfWeek: number; name: string; description?: string; mealType?: string; yieldsLeftovers?: boolean; suggestedBy?: string }>; weekOffset?: number };
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
      suggested_by: m.suggestedBy ?? 'husmor',
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

/** Get Monday date for a given ISO week number */
function getWeekDates(year: number, week: number): Record<number, Date> {
  // ISO week date: Jan 4 is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // 1=Mon..7=Sun
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);

  const dates: Record<number, Date> = {};
  for (let d = 1; d <= 7; d++) {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + d - 1);
    dates[d] = date;
  }
  return dates;
}

function formatNorwegianDate(date: Date): string {
  return date.toLocaleDateString('nb-NO', {
    timeZone: 'Europe/Oslo',
    day: 'numeric',
    month: 'long',
  });
}

/** Group calendar events by day-of-week for the target week */
function groupCalendarByDay(
  events: CalendarEvent[],
  weekDates: Record<number, Date>,
): Record<number, CalendarEvent[]> {
  const result: Record<number, CalendarEvent[]> = {};
  for (let d = 1; d <= 7; d++) result[d] = [];

  for (const event of events) {
    const eventDate = new Date(event.startTime);
    for (let d = 1; d <= 7; d++) {
      const wd = weekDates[d];
      if (
        wd &&
        eventDate.getUTCFullYear() === wd.getUTCFullYear() &&
        eventDate.getUTCMonth() === wd.getUTCMonth() &&
        eventDate.getUTCDate() === wd.getUTCDate()
      ) {
        result[d].push(event);
        break;
      }
    }
  }
  return result;
}

/** Build a calendar context section for Claude */
function buildCalendarSection(
  calendarByDay: Record<number, CalendarEvent[]>,
  dayNames: string[],
  weekDates: Record<number, Date>,
  activeDays: number[],
): string {
  const lines: string[] = [];
  for (const d of activeDays) {
    const events = calendarByDay[d] ?? [];
    const date = weekDates[d];
    const dateStr = date ? formatNorwegianDate(date) : '';
    if (events.length === 0) {
      lines.push(`- ${dayNames[d]} ${dateStr}: Ingen avtaler`);
    } else {
      const eventSummaries = events.map(e => {
        if (e.allDay) return e.title;
        const time = new Date(e.startTime).toLocaleTimeString('nb-NO', {
          timeZone: 'Europe/Oslo',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `${e.title} ${time}`;
      });
      lines.push(`- ${dayNames[d]} ${dateStr}: ${eventSummaries.join(', ')}`);
    }
  }

  if (lines.length === 0) return '';
  return `\n## Familiens kalender denne uken\n${lines.join('\n')}\nBruk dette til å vurdere hvor travel hver dag er og tilpasse forslagene.`;
}
