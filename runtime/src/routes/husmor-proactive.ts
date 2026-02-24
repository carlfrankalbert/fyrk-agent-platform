import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaude, extractText } from '../lib/claude.js';
import { postMessage } from '../lib/slack.js';
import { getCurrentWeekNumber } from './husmor-db.js';
import { DAY_NAMES } from '../lib/constants.js';

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

const PROACTIVE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 512;

export type ProactiveType = 'inventory_reminder' | 'midweek_checkin' | 'weekend_prep';

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
  }
}

async function handleInventoryReminder(
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  const { data: items } = await supabase
    .from('inventory_notes')
    .select('item_name, quantity')
    .eq('household_id', 'default')
    .eq('status', 'use_soon');

  if (!items || items.length === 0) {
    logger.info('No use_soon items, skipping inventory reminder');
    return { sent: false, type: 'inventory_reminder' };
  }

  const itemList = items.map((i) => `- ${i.item_name}${i.quantity ? ` (${i.quantity})` : ''}`).join('\n');

  const response = await callClaude(apiKey, {
    model: PROACTIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: `Du er Husmor, en varm og bestemt matplanlegger. Skriv en kort, vennlig paaminnelse pa norsk om varer som ma brukes opp snart. Foresla 1-2 middager som bruker opp varene. Hold det kort — maks 3-4 setninger. Skriv ren tekst, ikke JSON.`,
    messages: [{ role: 'user', content: `Disse varene ma brukes opp snart:\n${itemList}` }],
  });

  const text = extractText(response);
  await postMessage(botToken, channel, [], text);
  logger.info({ itemCount: items.length }, 'Sent inventory reminder');
  return { sent: true, type: 'inventory_reminder' };
}

async function handleMidweekCheckin(
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  const { week, year } = getCurrentWeekNumber();

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('household_id', 'default')
    .eq('week_number', week)
    .eq('year', year)
    .maybeSingle();

  if (!plan?.id) {
    logger.info('No plan for current week, skipping midweek checkin');
    return { sent: false, type: 'midweek_checkin' };
  }

  const { data: meals } = await supabase
    .from('planned_meals')
    .select('day_of_week, name, feedback_emoji, rating, feedback_text')
    .eq('plan_id', plan.id)
    .order('day_of_week', { ascending: true });

  if (!meals || meals.length === 0) {
    return { sent: false, type: 'midweek_checkin' };
  }

  const mealSummary = meals.map((m) => {
    const day = DAY_NAMES[m.day_of_week] ?? `Dag ${m.day_of_week}`;
    const feedback = m.feedback_emoji ? ` ${m.feedback_emoji}` : '';
    const rating = m.rating ? ` (${m.rating}/5)` : '';
    const text = m.feedback_text ? ` — "${m.feedback_text}"` : '';
    return `- ${day}: ${m.name}${feedback}${rating}${text}`;
  }).join('\n');

  const response = await callClaude(apiKey, {
    model: PROACTIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: `Du er Husmor, en varm og bestemt matplanlegger. Det er midt i uken. Skriv en kort, vennlig sjekk pa norsk — spor om middagene hittil har fungert, og tilby a justere resten av uken. Hold det kort og uformelt. Skriv ren tekst, ikke JSON.`,
    messages: [{ role: 'user', content: `Ukens middagsplan:\n${mealSummary}` }],
  });

  const text = extractText(response);
  await postMessage(botToken, channel, [], text);
  logger.info({ planId: plan.id }, 'Sent midweek checkin');
  return { sent: true, type: 'midweek_checkin' };
}

async function handleWeekendPrep(
  supabase: SupabaseClient,
  botToken: string,
  channel: string,
  apiKey: string,
  logger: Logger,
): Promise<{ sent: boolean; type: ProactiveType }> {
  const { week, year } = getCurrentWeekNumber();

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('id')
    .eq('household_id', 'default')
    .eq('week_number', week)
    .eq('year', year)
    .maybeSingle();

  if (!plan?.id) {
    logger.info('No plan for current week, skipping weekend prep');
    return { sent: false, type: 'weekend_prep' };
  }

  const { data: weekendMeals } = await supabase
    .from('planned_meals')
    .select('day_of_week, name, description')
    .eq('plan_id', plan.id)
    .in('day_of_week', [6, 7])
    .order('day_of_week', { ascending: true });

  if (!weekendMeals || weekendMeals.length === 0) {
    logger.info('No weekend meals planned, skipping weekend prep');
    return { sent: false, type: 'weekend_prep' };
  }

  const mealSummary = weekendMeals.map((m) => {
    const day = DAY_NAMES[m.day_of_week] ?? `Dag ${m.day_of_week}`;
    const desc = m.description ? ` — ${m.description}` : '';
    return `- ${day}: ${m.name}${desc}`;
  }).join('\n');

  // Check for active shopping list
  const { data: shoppingList } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('plan_id', plan.id)
    .eq('status', 'active')
    .maybeSingle();

  let shoppingInfo = '';
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

  const response = await callClaude(apiKey, {
    model: PROACTIVE_MODEL,
    max_tokens: MAX_TOKENS,
    system: `Du er Husmor, en varm og bestemt matplanlegger. Det er fredag. Skriv en kort, motiverende paaminnelse pa norsk om helgens middager og hva som trengs. Hold det kort og hyggelig. Skriv ren tekst, ikke JSON.`,
    messages: [{ role: 'user', content: `Helgens middager:\n${mealSummary}${shoppingInfo}` }],
  });

  const text = extractText(response);
  await postMessage(botToken, channel, [], text);
  logger.info({ planId: plan.id, mealCount: weekendMeals.length }, 'Sent weekend prep');
  return { sent: true, type: 'weekend_prep' };
}
