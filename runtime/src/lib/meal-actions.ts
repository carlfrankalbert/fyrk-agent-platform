import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateCurrentWeekPlan } from './meal-db.js';
import type { MealAction } from './meal-schemas.js';
import { invalidateCache } from './cache.js';
import type { Logger } from './types.js';

export async function executeActions(
  supabase: SupabaseClient,
  actions: MealAction[],
  logger: Logger,
): Promise<void> {
  const results = await Promise.allSettled(
    actions.map(action => executeOneAction(supabase, action, logger)),
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      logger.error({ action: actions[i].type, err: (results[i] as PromiseRejectedResult).reason }, 'Failed to execute action');
    }
  }

  if (actions.some(a => a.type === 'rate_meal')) {
    invalidateCache('husmor:');
  }
}

async function executeOneAction(
  supabase: SupabaseClient,
  action: MealAction,
  logger: Logger,
): Promise<void> {
  switch (action.type) {
    case 'rate_meal':
      return handleRateMeal(supabase, action, logger);
    case 'log_child_reaction':
      return handleLogChildReaction(supabase, action, logger);
    case 'add_shopping_items':
      return handleAddShoppingItems(supabase, action, logger);
  }
}

async function handleRateMeal(
  supabase: SupabaseClient,
  action: Extract<MealAction, { type: 'rate_meal' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (action.feedbackEmoji !== undefined) updateData.feedback_emoji = action.feedbackEmoji;
  if (action.rating !== undefined) updateData.rating = action.rating;
  if (action.feedbackText !== undefined) updateData.feedback_text = action.feedbackText;
  await supabase
    .from('planned_meals')
    .update(updateData)
    .eq('plan_id', planId)
    .eq('day_of_week', action.dayOfWeek);
  logger.info({ planId, day: action.dayOfWeek }, 'Rated meal');
}

async function handleLogChildReaction(
  supabase: SupabaseClient,
  action: Extract<MealAction, { type: 'log_child_reaction' }>,
  logger: Logger,
): Promise<void> {
  await supabase
    .from('child_meal_reactions')
    .insert({
      household_id: 'default',
      child_name: action.childName,
      meal_name: action.mealName,
      reaction: action.reaction,
      notes: action.notes ?? null,
    });
  logger.info({ child: action.childName, meal: action.mealName, reaction: action.reaction }, 'Logged child reaction');
}

async function handleAddShoppingItems(
  supabase: SupabaseClient,
  action: Extract<MealAction, { type: 'add_shopping_items' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);

  // Get or create active shopping list
  const { data: existing } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('plan_id', planId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let listId = existing?.id;
  if (!listId) {
    const { data: listData } = await supabase
      .from('shopping_lists')
      .insert({ plan_id: planId, household_id: 'default', status: 'active' })
      .select('id')
      .single();
    if (!listData?.id) return;
    listId = listData.id;
  }

  const items = action.items.map((item) => ({
    list_id: listId,
    name: item.name,
    amount: item.amount ? parseFloat(item.amount) : null,
    unit: item.unit ?? null,
    category: item.category ?? null,
  }));
  await supabase.from('shopping_items').insert(items);
  logger.info({ planId, listId, count: items.length }, 'Added items to shopping list');
}
