import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaude, extractText } from '../lib/claude.js';
import { postMessage } from '../lib/slack.js';
import { loadDbContext } from './husmor-db.js';
import { buildProactiveSystemPrompt } from './husmor-prompt.js';

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

const PROACTIVE_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 1024;

export type ProactiveType = 'inventory_reminder' | 'midweek_checkin' | 'weekend_prep' | 'weekly_learning_summary';

export async function handleProactiveMessage(
  type: ProactiveType,
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  switch (type) {
    case 'inventory_reminder':
      return handleInventoryReminder(supabase, botToken, channel, apiKey, logger);
    case 'midweek_checkin':
      return handleMidweekCheckin(supabase, botToken, channel, apiKey, logger);
    case 'weekend_prep':
      return handleWeekendPrep(supabase, botToken, channel, apiKey, logger);
    case 'weekly_learning_summary':
      return handleWeeklyLearningSummary(supabase, botToken, channel, apiKey, logger);
  }
}

async function handleInventoryReminder(
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  const dbContext = await loadDbContext(supabase);

  if (dbContext.inventoryNotes.filter(n => n.status === 'use_soon').length === 0) {
    logger.info('No use_soon items, skipping inventory reminder');
    return { sent: false, type: 'inventory_reminder' };
  }

  const systemPrompt = buildProactiveSystemPrompt(dbContext);
  const itemList = dbContext.inventoryNotes
    .filter(n => n.status === 'use_soon')
    .map((i) => `- ${i.itemName}${i.quantity ? ` (${i.quantity})` : ''}`)
    .join('\n');

  const response = await callClaude(apiKey, {
    model: PROACTIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt + '\n\nSkriv en kort, vennlig paaminnelse om varer som ma brukes opp snart. Foresla 1-2 middager som bruker opp varene og passer familiens preferanser. Hold det kort — maks 3-4 setninger.',
    messages: [{ role: 'user', content: `Disse varene ma brukes opp snart:\n${itemList}` }],
  });

  const text = extractText(response);
  await postMessage(botToken, channel, [], text);
  logger.info({ itemCount: dbContext.inventoryNotes.length }, 'Sent inventory reminder');
  return { sent: true, type: 'inventory_reminder' };
}

async function handleMidweekCheckin(
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  const dbContext = await loadDbContext(supabase);

  if (dbContext.plan.meals.length === 0) {
    logger.info('No plan for current week, skipping midweek checkin');
    return { sent: false, type: 'midweek_checkin' };
  }

  const systemPrompt = buildProactiveSystemPrompt(dbContext);
  const mealSummary = dbContext.plan.meals.map((m) => {
    const desc = m.description ? ` — ${m.description}` : '';
    return `- ${m.dayName}: ${m.name}${desc}`;
  }).join('\n');

  const response = await callClaude(apiKey, {
    model: PROACTIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt + '\n\nDet er midt i uken. Skriv en kort, vennlig sjekk — spor om middagene hittil har fungert, og tilby a justere resten av uken. Bruk det du vet om familien. Hold det kort og uformelt.',
    messages: [{ role: 'user', content: `Ukens middagsplan:\n${mealSummary}` }],
  });

  const text = extractText(response);
  await postMessage(botToken, channel, [], text);
  logger.info({ planId: dbContext.plan.planId }, 'Sent midweek checkin');
  return { sent: true, type: 'midweek_checkin' };
}

async function handleWeekendPrep(
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  const dbContext = await loadDbContext(supabase);

  const weekendMeals = dbContext.plan.meals.filter(m => m.dayOfWeek === 6 || m.dayOfWeek === 7);

  if (weekendMeals.length === 0) {
    logger.info('No weekend meals planned, skipping weekend prep');
    return { sent: false, type: 'weekend_prep' };
  }

  const systemPrompt = buildProactiveSystemPrompt(dbContext);
  const mealSummary = weekendMeals.map((m) => {
    const desc = m.description ? ` — ${m.description}` : '';
    return `- ${m.dayName}: ${m.name}${desc}`;
  }).join('\n');

  // Check for active shopping list
  let shoppingInfo = '';
  if (dbContext.plan.planId) {
    const { data: shoppingList } = await supabase
      .from('shopping_lists')
      .select('id')
      .eq('plan_id', dbContext.plan.planId)
      .eq('status', 'active')
      .maybeSingle();

    if (shoppingList?.id) {
      const { data: items } = await supabase
        .from('shopping_items')
        .select('name, amount, unit')
        .eq('list_id', shoppingList.id)
        .eq('checked', false);

      if (items && items.length > 0) {
        const itemList = items.map((i) => {
          const qty = i.amount ? ` ${i.amount}${i.unit ? ` ${i.unit}` : ''}` : '';
          return `- ${i.name}${qty}`;
        }).join('\n');
        shoppingInfo = `\n\nUhandlede varer:\n${itemList}`;
      }
    }
  }

  const response = await callClaude(apiKey, {
    model: PROACTIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt + '\n\nDet er fredag. Skriv en kort, motiverende paaminnelse om helgens middager og hva som trengs. Bruk det du vet om familien. Hold det kort og hyggelig.',
    messages: [{ role: 'user', content: `Helgens middager:\n${mealSummary}${shoppingInfo}` }],
  });

  const text = extractText(response);
  await postMessage(botToken, channel, [], text);
  logger.info({ planId: dbContext.plan.planId, mealCount: weekendMeals.length }, 'Sent weekend prep');
  return { sent: true, type: 'weekend_prep' };
}

async function handleWeeklyLearningSummary(
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  // Fetch learnings from the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: recentLearnings } = await supabase
    .from('household_learnings')
    .select('category, insight, confidence, confirmed, source')
    .eq('household_id', 'default')
    .is('superseded_by', null)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false });

  if (!recentLearnings || recentLearnings.length === 0) {
    logger.info('No new learnings this week, skipping summary');
    return { sent: false, type: 'weekly_learning_summary' };
  }

  const dbContext = await loadDbContext(supabase);
  const systemPrompt = buildProactiveSystemPrompt(dbContext);

  const learningsList = recentLearnings.map((l) => {
    const status = l.confirmed === true ? ' (bekreftet)' : l.confirmed === false ? ' (avvist)' : '';
    return `- [${l.category}] ${l.insight}${status} (kilde: ${l.source})`;
  }).join('\n');

  const response = await callClaude(apiKey, {
    model: PROACTIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt + `\n\nDet er sondag kveld. Skriv en varm, kort ukentlig oppsummering av hva du har laert om familien denne uken. Start med "Denne uken laerte jeg..." og oppsummer de viktigste lerdommene. Avslutt med en kort tanke om hvordan du vil bruke dette neste uke. Hold det personlig og varmt — maks 5-6 setninger.`,
    messages: [{ role: 'user', content: `Nye lerdommer denne uken:\n${learningsList}` }],
  });

  const text = extractText(response);
  await postMessage(botToken, channel, [], text);
  logger.info({ learningCount: recentLearnings.length }, 'Sent weekly learning summary');
  return { sent: true, type: 'weekly_learning_summary' };
}
