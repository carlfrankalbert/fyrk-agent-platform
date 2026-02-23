import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.js';
import { callClaude, extractText } from '../lib/claude.js';
import { replyInThread, updateMessage, getThreadHistory } from '../lib/slack.js';
import type { ClaudeMessage } from '../lib/claude.js';
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
  isThreadReply: boolean;
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

  const now = new Date();
  const dateStr = now.toLocaleDateString('nb-NO', {
    timeZone: 'Europe/Oslo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  sections.push(`Du er Husmor. En tydelig, varm og bestemt skikkelse som kunne jobbet pa Sigtuna allmanna laroverk. Du har hoy standard for orden, helse og dannelse.

Du er strukturert, praktisk, ravarebevisst, lite imponert av slurv, og opptatt av rytme, tradisjon og kvalitet. Du tar valg. Du anbefaler tydelig. Du kan vaere streng nar det trengs.

Du snakker norsk, men kan bruke enkelte svenske ord nar det gir karakter. Det skal foles naturlig, ikke teatralsk.

## Kjerneprinsipper
- Helse og trivsel forst: Mat skal gi stabil energi, god magefolelse og ro i kroppen.
- Sesong og baerekraft: Bruk norske sesongravarer. Prioriter fisk, gronnsaker, belgvekster og grove korn. Moderate mengder kjott.
- Tradisjon og rytme: Ukerytme. Helgemat. Sma ritualer. Barna skal vokse opp med smak og minner.
- Null slosing: Planlegg for rester. Bruk opp det vi har for vi kjoper nytt.
- Realisme: Middager skal vaere gjennomforbare. Du optimaliserer for logistikk og hverdag. 20-45 min pa hverdager, inntil 60 min i helgen.
- Smak og kvalitet: Enkle ting gjort ordentlig. Riktig stekeskorpe. God saus nar det trengs.

## Tone
Varm, bestemt, kort og tydelig. Lite dill. Fokus pa orden og kvalitet. Ikke mas. Nar brukeren er vag, velger du en tydelig retning.

## Sprak
Skriv alltid pa norsk. Hold svarene korte og handlingsorienterte — dette er Slack, ikke en blogg.

I dag er det ${dateStr}.
Uke ${ctx.plan.weekNumber}, ${ctx.plan.year}.

## Kostrad — Helsedirektoratet (Norge) og Livsmedelsverket (Sverige)
Du folger disse offisielle kostradene. De er ikke valgfrie — de er grunnmuren i alt du anbefaler.

### Gronnsaker, frukt og baer
- Minst 5 porsjoner daglig, helst 8. En porsjon = 100g.
- Halvparten gronnsaker, halvparten frukt/baer. Varier farger.
- Inkluder ved hvert maltid, ogsa mellommaltider.
- Sverige: minst 500g daglig, gjerne mer.

### Fullkorn
- Minst 90g fullkorn daglig, fordelt pa minst 2 maltider.
- Velg grovt brod (minst 75% fullkorn), knekkerod, havregryn, fullkornspasta.

### Fisk og sjomat
- 300-450g per uke (2-3 middager). Minst 200g skal vaere fet fisk (laks, orret, makrell, sild).
- En middagsporsjon = 150-200g.

### Belgvekster
- Minst 1 gang per uke som hovedrett eller tilbehor. Sverige: gjerne daglig.
- Bonner, linser, erter, hummus, tofu.

### Kjott
- Rodt kjott (storfe, svin, lam): maks 350g per uke. Begrens bearbeidet kjott (polse, bacon, salami).
- Velg hvitt kjott (kylling, kalkun) framfor rodt.
- Bade Norge og Sverige senket grensen til 350g/uke.

### Meieriprodukter
- 3 porsjoner daglig (ca 5dl totalt). Velg magre varianter.
- 2 porsjoner bor vaere melk/yoghurt (for jod).

### Fett og noetter
- Bruk planteolje (raps, oliven) i stedet for smor.
- 20-30g usaltede notter daglig.

### Sukker, snacks og drikke
- Begrens godteri, chips, kaker, brus, energidrikk.
- Drikk vann. Kaffe 1-4 kopper filtrert for voksne.
- Barn under 3: unnga kunstige sotningsmilder.

### Tallerkenen
- Halve tallerkenen: gronnsaker/frukt/baer.
- En fjerdedel: karbohydrater (fullkorn, poteter).
- En fjerdedel: protein (fisk, belgvekster, egg, meieri, magert kjott).

### Maltidsrytme
- Regelmessige maltider gir stabil energi.
- Barn trenger hyppigere maltider.

Kilder: Helsedirektoratet (oppdatert aug 2024), Livsmedelsverket (nye kostrad 2025).`);

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

// --- Message ordering ---

/** Ensure messages alternate user/assistant and start with user (Claude API requirement) */
export function cleanMessageOrder(messages: ClaudeMessage[]): ClaudeMessage[] {
  if (messages.length === 0) return [];

  const result: ClaudeMessage[] = [];
  for (const msg of messages) {
    const prev = result[result.length - 1];
    // Merge consecutive same-role messages
    if (prev && prev.role === msg.role) {
      prev.content += '\n' + msg.content;
    } else {
      result.push({ ...msg });
    }
  }

  // Must start with user
  while (result.length > 0 && result[0].role !== 'user') {
    result.shift();
  }

  // Must end with user
  while (result.length > 0 && result[result.length - 1].role !== 'user') {
    result.pop();
  }

  return result.length > 0 ? result : [{ role: 'user', content: '' }];
}

// --- Main handler ---

export async function handleHusmorMessage(params: HusmorMessageParams): Promise<void> {
  const { text, channel, threadTs, userId, isThreadReply, logger } = params;
  const env = getEnv();

  const botToken = env.SLACK_HUSMOR_BOT_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!botToken || !apiKey) {
    logger.error('Missing SLACK_HUSMOR_BOT_TOKEN or ANTHROPIC_API_KEY');
    return;
  }

  const supabase = getSupabase();

  // Post a "thinking" indicator immediately
  let thinkingTs: string | undefined;
  try {
    const thinking = await replyInThread(botToken, channel, threadTs, 'Husmor tenker...');
    thinkingTs = thinking.ts;
  } catch (err) {
    logger.warn({ err }, 'Failed to post thinking indicator');
  }

  try {
    // 1. Load DB context + thread history in parallel
    const [dbContext, threadMessages] = await Promise.all([
      loadDbContext(supabase),
      isThreadReply
        ? getThreadHistory(botToken, channel, threadTs).catch(() => [])
        : Promise.resolve([]),
    ]);

    // 2. Build prompt
    const systemPrompt = buildSystemPrompt(dbContext);

    // 3. Build conversation messages from thread history
    const messages: ClaudeMessage[] = [];
    if (threadMessages.length > 0) {
      // Skip the thinking message (last bot message) and the current user message (last)
      for (const msg of threadMessages) {
        if (!msg.text) continue;
        // Skip "Husmor tenker..." placeholders
        if (msg.text === 'Husmor tenker...') continue;
        if (msg.bot_id) {
          // Bot message → try to extract just the reply text (strip JSON if present)
          messages.push({ role: 'assistant', content: msg.text });
        } else if (msg.user) {
          messages.push({ role: 'user', content: msg.text });
        }
      }
    }

    // If no history or last message isn't the current one, add it
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg || lastUserMsg.content !== text) {
      messages.push({ role: 'user', content: text });
    }

    // Ensure messages alternate and start with user
    const cleanedMessages = cleanMessageOrder(messages);

    // 4. Call Claude
    const response = await callClaude(apiKey, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: cleanedMessages,
    });

    const rawText = extractText(response);

    // 4. Parse response
    const parsed = parseClaudeResponse(rawText);

    // 5. Update thinking message with real reply, or post new if update fails
    if (thinkingTs) {
      try {
        await updateMessage(botToken, channel, thinkingTs, parsed.reply);
      } catch {
        await replyInThread(botToken, channel, threadTs, parsed.reply);
      }
    } else {
      await replyInThread(botToken, channel, threadTs, parsed.reply);
    }

    // 6. Execute actions
    if (parsed.actions && parsed.actions.length > 0) {
      await executeActions(supabase, parsed.actions, logger);
    }

    logger.info({ userId, actionsCount: parsed.actions?.length ?? 0 }, 'Husmor message handled');
  } catch (err) {
    logger.error({ err, userId }, 'Failed to handle Husmor message');
    try {
      const errorMsg = 'Beklager, noe gikk galt. Prov igjen om litt!';
      if (thinkingTs) {
        try {
          await updateMessage(botToken, channel, thinkingTs, errorMsg);
        } catch {
          await replyInThread(botToken, channel, threadTs, errorMsg);
        }
      } else {
        await replyInThread(botToken, channel, threadTs, errorMsg);
      }
    } catch (replyErr) {
      logger.error({ replyErr }, 'Failed to send error reply');
    }
  }
}
