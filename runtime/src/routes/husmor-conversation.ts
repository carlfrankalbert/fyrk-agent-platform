import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.js';
import { callClaude, extractText } from '../lib/claude.js';
import { replyInThread } from '../lib/slack.js';
import {
  HusmorClaudeResponseSchema,
  type HusmorAction,
  type HusmorClaudeResponse,
} from './husmor-schemas.js';

export interface HusmorMessageParams {
  text: string;
  channel: string;
  threadTs: string;
  userId: string;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

const DAY_NAMES: Record<number, string> = {
  1: 'Mandag', 2: 'Tirsdag', 3: 'Onsdag', 4: 'Torsdag',
  5: 'Fredag', 6: 'Lordag', 7: 'Sondag',
};

function getSupabase(): SupabaseClient {
  const env = getEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}

function getCurrentWeekNumber(): { week: number; year: number } {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return { week, year: now.getFullYear() };
}

// --- DB context loading ---

interface WeekPlanContext {
  planId: string | null;
  weekNumber: number;
  year: number;
  status: string;
  meals: Array<{ dayOfWeek: number; dayName: string; name: string; description: string | null; mealType: string }>;
}

interface DbContext {
  plan: WeekPlanContext;
  preferences: Array<{ key: string; value: unknown }>;
  pantryStaples: string[];
  inventoryNotes: Array<{ itemName: string; status: string; quantity: string | null }>;
  seasonalProduce: string[];
}

export async function loadDbContext(supabase: SupabaseClient): Promise<DbContext> {
  const { week, year } = getCurrentWeekNumber();
  const currentMonth = new Date().getMonth() + 1;

  const [planResult, prefsResult, pantryResult, inventoryResult, seasonalResult] = await Promise.all([
    supabase
      .from('weekly_plans')
      .select('id, status, week_number, year')
      .eq('household_id', 'default')
      .eq('week_number', week)
      .eq('year', year)
      .maybeSingle(),
    supabase
      .from('family_preferences')
      .select('key, value')
      .eq('household_id', 'default'),
    supabase
      .from('pantry_staples')
      .select('name')
      .eq('household_id', 'default'),
    supabase
      .from('inventory_notes')
      .select('item_name, status, quantity')
      .eq('household_id', 'default')
      .in('status', ['available', 'use_soon']),
    supabase
      .from('seasonal_produce')
      .select('name')
      .contains('months_available', [currentMonth]),
  ]);

  let meals: WeekPlanContext['meals'] = [];
  if (planResult.data?.id) {
    const { data: mealRows } = await supabase
      .from('planned_meals')
      .select('day_of_week, name, description, meal_type')
      .eq('plan_id', planResult.data.id)
      .order('day_of_week', { ascending: true });

    meals = (mealRows ?? []).map((m) => ({
      dayOfWeek: m.day_of_week,
      dayName: DAY_NAMES[m.day_of_week] ?? `Dag ${m.day_of_week}`,
      name: m.name,
      description: m.description,
      mealType: m.meal_type,
    }));
  }

  return {
    plan: {
      planId: planResult.data?.id ?? null,
      weekNumber: week,
      year,
      status: planResult.data?.status ?? 'none',
      meals,
    },
    preferences: (prefsResult.data ?? []).map((p) => ({ key: p.key, value: p.value })),
    pantryStaples: (pantryResult.data ?? []).map((p) => p.name),
    inventoryNotes: (inventoryResult.data ?? []).map((n) => ({
      itemName: n.item_name,
      status: n.status,
      quantity: n.quantity,
    })),
    seasonalProduce: (seasonalResult.data ?? []).map((s) => s.name),
  };
}

// --- Prompt building ---

export function buildSystemPrompt(ctx: DbContext): string {
  const sections: string[] = [];

  sections.push(`Du er Husmor — en varm, kunnskapsrik og praktisk familiens matassistent i Slack.
Du hjelper familien med ukeplanlegging, matinnkjop, preferanser og ernaering.
Skriv alltid pa norsk. Vær vennlig, kortfattet og handlingsorientert.

Dagens dato: ${new Date().toISOString().slice(0, 10)}
Uke ${ctx.plan.weekNumber}, ${ctx.plan.year}`);

  // Current plan
  if (ctx.plan.meals.length > 0) {
    sections.push('\n## Gjeldende ukeplan');
    for (const m of ctx.plan.meals) {
      const desc = m.description ? ` — ${m.description}` : '';
      sections.push(`- ${m.dayName}: ${m.name}${desc}`);
    }
    sections.push(`Status: ${ctx.plan.status}`);
  } else {
    sections.push('\n## Gjeldende ukeplan\nIngen plan enna for denne uken.');
  }

  // Preferences
  if (ctx.preferences.length > 0) {
    sections.push('\n## Familiepreferanser');
    for (const p of ctx.preferences) {
      sections.push(`- ${p.key}: ${JSON.stringify(p.value)}`);
    }
  }

  // Pantry staples
  if (ctx.pantryStaples.length > 0) {
    sections.push(`\n## Alltid pa lager\n${ctx.pantryStaples.join(', ')}`);
  }

  // Inventory notes
  if (ctx.inventoryNotes.length > 0) {
    sections.push('\n## Ma brukes opp');
    for (const n of ctx.inventoryNotes) {
      const qty = n.quantity ? ` (${n.quantity})` : '';
      sections.push(`- ${n.itemName}${qty} — ${n.status}`);
    }
  }

  // Seasonal
  if (ctx.seasonalProduce.length > 0) {
    sections.push(`\n## I sesong na\n${ctx.seasonalProduce.join(', ')}`);
  }

  sections.push(`\n## Tilgjengelige handlinger
Du kan utfore handlinger ved a inkludere dem i "actions"-arrayen i JSON-svaret ditt.

Handlingstyper:
- add_meals: Legg til maltider. meals: [{ dayOfWeek (1=mandag), name, description?, mealType? }]
- update_meal: Oppdater et maltid. dayOfWeek, name, description?
- remove_meal: Fjern et maltid. dayOfWeek
- set_preference: Sett en preferanse. key, value
- add_inventory_note: Legg til beholdningsnotat. itemName, status? (available|use_soon), quantity?
- update_plan_status: Oppdater planstatus. status (draft|proposed|approved|active|completed)

## Responsformat
Svar ALLTID med gyldig JSON:
{
  "reply": "Din melding til brukeren (norsk, vennlig, kortfattet)",
  "actions": []
}

"actions" kan være tom array eller utelatt hvis ingen handlinger trengs.
Returner KUN valid JSON, ingen annen tekst.`);

  return sections.join('\n');
}

// --- Response parsing ---

export function parseClaudeResponse(text: string): HusmorClaudeResponse {
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(jsonStr);
  return HusmorClaudeResponseSchema.parse(parsed);
}

// --- Action execution ---

export async function getOrCreateCurrentWeekPlan(supabase: SupabaseClient): Promise<string> {
  const { week, year } = getCurrentWeekNumber();

  // Upsert: insert if not exists, return existing if it does
  const { data, error } = await supabase
    .from('weekly_plans')
    .upsert(
      { household_id: 'default', week_number: week, year, status: 'draft' },
      { onConflict: 'household_id,week_number,year', ignoreDuplicates: true },
    )
    .select('id')
    .single();

  if (error || !data) {
    // Fallback: query existing
    const { data: existing } = await supabase
      .from('weekly_plans')
      .select('id')
      .eq('household_id', 'default')
      .eq('week_number', week)
      .eq('year', year)
      .single();
    if (!existing) throw new Error('Failed to get or create weekly plan');
    return existing.id;
  }

  return data.id;
}

export async function executeActions(
  supabase: SupabaseClient,
  actions: HusmorAction[],
  logger: HusmorMessageParams['logger'],
): Promise<void> {
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'add_meals': {
          const planId = await getOrCreateCurrentWeekPlan(supabase);
          const rows = action.meals.map((m) => ({
            plan_id: planId,
            day_of_week: m.dayOfWeek,
            name: m.name,
            description: m.description ?? null,
            meal_type: m.mealType ?? 'dinner',
          }));
          await supabase.from('planned_meals').insert(rows);
          logger.info({ planId, count: rows.length }, 'Added meals to plan');
          break;
        }
        case 'update_meal': {
          const planId = await getOrCreateCurrentWeekPlan(supabase);
          const updateData: Record<string, unknown> = {
            name: action.name,
            updated_at: new Date().toISOString(),
          };
          if (action.description !== undefined) updateData.description = action.description;
          await supabase
            .from('planned_meals')
            .update(updateData)
            .eq('plan_id', planId)
            .eq('day_of_week', action.dayOfWeek);
          logger.info({ planId, day: action.dayOfWeek }, 'Updated meal');
          break;
        }
        case 'remove_meal': {
          const planId = await getOrCreateCurrentWeekPlan(supabase);
          await supabase
            .from('planned_meals')
            .delete()
            .eq('plan_id', planId)
            .eq('day_of_week', action.dayOfWeek);
          logger.info({ planId, day: action.dayOfWeek }, 'Removed meal');
          break;
        }
        case 'set_preference': {
          await supabase
            .from('family_preferences')
            .upsert(
              {
                household_id: 'default',
                key: action.key,
                value: action.value,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'household_id,key' },
            );
          logger.info({ key: action.key }, 'Set preference');
          break;
        }
        case 'add_inventory_note': {
          await supabase
            .from('inventory_notes')
            .insert({
              household_id: 'default',
              item_name: action.itemName,
              status: action.status ?? 'available',
              quantity: action.quantity ?? null,
            });
          logger.info({ item: action.itemName }, 'Added inventory note');
          break;
        }
        case 'update_plan_status': {
          const planId = await getOrCreateCurrentWeekPlan(supabase);
          await supabase
            .from('weekly_plans')
            .update({ status: action.status, updated_at: new Date().toISOString() })
            .eq('id', planId);
          logger.info({ planId, status: action.status }, 'Updated plan status');
          break;
        }
      }
    } catch (err) {
      logger.error({ action: action.type, err }, 'Failed to execute action');
    }
  }
}

// --- Main handler ---

export async function handleHusmorMessage(params: HusmorMessageParams): Promise<void> {
  const { text, channel, threadTs, userId, logger } = params;
  const env = getEnv();

  const botToken = env.SLACK_HUSMOR_BOT_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!botToken || !apiKey) {
    logger.error('Missing SLACK_HUSMOR_BOT_TOKEN or ANTHROPIC_API_KEY');
    return;
  }

  const supabase = getSupabase();

  try {
    // 1. Load DB context
    const dbContext = await loadDbContext(supabase);

    // 2. Build prompt
    const systemPrompt = buildSystemPrompt(dbContext);

    // 3. Call Claude
    const response = await callClaude(apiKey, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const rawText = extractText(response);

    // 4. Parse response
    const parsed = parseClaudeResponse(rawText);

    // 5. Reply in thread
    await replyInThread(botToken, channel, threadTs, parsed.reply);

    // 6. Execute actions
    if (parsed.actions && parsed.actions.length > 0) {
      await executeActions(supabase, parsed.actions, logger);
    }

    logger.info({ userId, actionsCount: parsed.actions?.length ?? 0 }, 'Husmor message handled');
  } catch (err) {
    logger.error({ err, userId }, 'Failed to handle Husmor message');
    try {
      if (botToken) {
        await replyInThread(
          botToken,
          channel,
          threadTs,
          'Beklager, noe gikk galt. Prov igjen om litt!',
        );
      }
    } catch (replyErr) {
      logger.error({ replyErr }, 'Failed to send error reply');
    }
  }
}
