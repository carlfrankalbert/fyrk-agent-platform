import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateCurrentWeekPlan } from './db.js';
import type { HusmorAction } from './schemas.js';
import { invalidateCache } from './cache.js';
import { enrichRecipeNutrition } from '../../lib/nutrition-enrichment.js';
import { getSession, searchProducts, addToCart, bestMatch, extractPackCount } from '../../lib/oda.js';
import type { Logger } from '../../lib/types.js';

export async function executeActions(
  supabase: SupabaseClient,
  actions: HusmorAction[],
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

  // Invalidate cached aggregations if any data-modifying actions were executed
  const CACHE_INVALIDATING_ACTIONS = new Set(['add_meals', 'update_meal', 'remove_meal', 'rate_meal', 'save_recipe', 'clear_shopping_list']);
  if (actions.some(a => CACHE_INVALIDATING_ACTIONS.has(a.type))) {
    invalidateCache('husmor:');
  }
}

async function executeOneAction(
  supabase: SupabaseClient,
  action: HusmorAction,
  logger: Logger,
): Promise<void> {
  switch (action.type) {
    case 'add_meals':
      return handleAddMeals(supabase, action, logger);
    case 'update_meal':
      return handleUpdateMeal(supabase, action, logger);
    case 'remove_meal':
      return handleRemoveMeal(supabase, action, logger);
    case 'set_preference':
      return handleSetPreference(supabase, action, logger);
    case 'add_inventory_note':
      return handleAddInventoryNote(supabase, action, logger);
    case 'rate_meal':
      return handleRateMeal(supabase, action, logger);
    case 'generate_shopping_list':
      return handleGenerateShoppingList(supabase, action, logger);
    case 'update_plan_status':
      return handleUpdatePlanStatus(supabase, action, logger);
    case 'propose_learning':
      return handleProposeLearning(supabase, action, logger);
    case 'save_recipe':
      return handleSaveRecipe(supabase, action, logger);
    case 'update_inventory_status':
      return handleUpdateInventoryStatus(supabase, action, logger);
    case 'set_week_context':
      return handleSetWeekContext(supabase, action, logger);
    case 'log_child_reaction':
      return handleLogChildReaction(supabase, action, logger);
    case 'sync_oda_cart':
      return handleSyncOdaCart(action, logger);
    case 'add_shopping_items':
      return handleAddShoppingItems(supabase, action, logger);
    case 'remove_shopping_items':
      return handleRemoveShoppingItems(supabase, action, logger);
    case 'check_off_items':
      return handleCheckOffItems(supabase, action, logger);
    case 'clear_shopping_list':
      return handleClearShoppingList(supabase, action, logger);
  }
}

async function handleAddMeals(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'add_meals' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  const rows = action.meals.map((m) => ({
    plan_id: planId,
    day_of_week: m.dayOfWeek,
    name: m.name,
    description: m.description ?? null,
    meal_type: m.mealType ?? 'dinner',
    yields_leftovers: m.yieldsLeftovers ?? false,
    suggested_by: 'husmor',
  }));
  await supabase.from('planned_meals').insert(rows);
  logger.info({ planId, count: rows.length }, 'Added meals to plan');
}

async function handleUpdateMeal(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'update_meal' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);

  // Check if this was a Husmor suggestion being modified
  const { data: existing } = await supabase
    .from('planned_meals')
    .select('name, suggested_by')
    .eq('plan_id', planId)
    .eq('day_of_week', action.dayOfWeek)
    .maybeSingle();

  if (existing?.suggested_by === 'husmor' && existing.name !== action.name) {
    // Track the modification
    await supabase.from('suggestion_modifications').insert({
      household_id: 'default',
      plan_id: planId,
      day_of_week: action.dayOfWeek,
      original_meal: existing.name,
      replacement_meal: action.name,
    });
  }

  const updateData: Record<string, unknown> = {
    name: action.name,
    updated_at: new Date().toISOString(),
  };
  if (action.description !== undefined) updateData.description = action.description;
  if (action.yieldsLeftovers !== undefined) updateData.yields_leftovers = action.yieldsLeftovers;
  if (existing?.suggested_by === 'husmor' && existing.name !== action.name) {
    updateData.original_suggestion = existing.name;
  }
  await supabase
    .from('planned_meals')
    .update(updateData)
    .eq('plan_id', planId)
    .eq('day_of_week', action.dayOfWeek);
  logger.info({ planId, day: action.dayOfWeek }, 'Updated meal');
}

async function handleRemoveMeal(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'remove_meal' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);

  // Check if this was a Husmor suggestion being removed
  const { data: existing } = await supabase
    .from('planned_meals')
    .select('name, suggested_by')
    .eq('plan_id', planId)
    .eq('day_of_week', action.dayOfWeek)
    .maybeSingle();

  if (existing?.suggested_by === 'husmor') {
    await supabase.from('suggestion_modifications').insert({
      household_id: 'default',
      plan_id: planId,
      day_of_week: action.dayOfWeek,
      original_meal: existing.name,
      replacement_meal: null,
    });
  }

  await supabase
    .from('planned_meals')
    .delete()
    .eq('plan_id', planId)
    .eq('day_of_week', action.dayOfWeek);
  logger.info({ planId, day: action.dayOfWeek }, 'Removed meal');
}

async function handleSetPreference(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'set_preference' }>,
  logger: Logger,
): Promise<void> {
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
}

async function handleAddInventoryNote(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'add_inventory_note' }>,
  logger: Logger,
): Promise<void> {
  await supabase
    .from('inventory_notes')
    .insert({
      household_id: 'default',
      item_name: action.itemName,
      status: action.status ?? 'available',
      quantity: action.quantity ?? null,
    });
  logger.info({ item: action.itemName }, 'Added inventory note');
}

async function handleRateMeal(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'rate_meal' }>,
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

async function handleGenerateShoppingList(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'generate_shopping_list' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);

  const { data: listData } = await supabase
    .from('shopping_lists')
    .insert({ plan_id: planId, household_id: 'default', status: 'active' })
    .select('id')
    .single();

  if (!listData?.id) return;

  const items = action.items.map((item) => ({
    list_id: listData.id,
    name: item.name,
    amount: item.amount ? parseFloat(item.amount) : null,
    unit: item.unit ?? null,
    category: item.category ?? null,
  }));
  await supabase.from('shopping_items').insert(items);
  logger.info({ planId, listId: listData.id, count: items.length }, 'Created shopping list');
}

async function handleUpdatePlanStatus(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'update_plan_status' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  await supabase
    .from('weekly_plans')
    .update({ status: action.status, updated_at: new Date().toISOString() })
    .eq('id', planId);
  logger.info({ planId, status: action.status }, 'Updated plan status');
}

async function handleProposeLearning(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'propose_learning' }>,
  logger: Logger,
): Promise<void> {
  const { data: learning } = await supabase
    .from('household_learnings')
    .insert({
      household_id: 'default',
      category: action.category,
      insight: action.insight,
      confidence: action.confidence ?? 0.7,
      source: 'proposed',
      confirmed: null,
    })
    .select('id')
    .single();

  if (!learning) {
    logger.warn('Failed to insert proposed learning');
    return;
  }

  logger.info({ learningId: learning.id, category: action.category }, 'Proposed learning');
}

async function handleSaveRecipe(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'save_recipe' }>,
  logger: Logger,
): Promise<void> {
  const { data: recipe } = await supabase
    .from('recipes')
    .insert({
      household_id: 'default',
      name: action.name,
      description: action.description ?? null,
      prep_time_min: action.prepTimeMin ?? null,
      cook_time_min: action.cookTimeMin ?? null,
      servings: action.servings ?? null,
    })
    .select('id')
    .single();

  if (!recipe?.id) {
    logger.warn('Failed to insert recipe');
    return;
  }

  if (action.ingredients && action.ingredients.length > 0) {
    const rows = action.ingredients.map((ing, i) => ({
      recipe_id: recipe.id,
      name: ing.name,
      amount: ing.amount ?? null,
      unit: ing.unit ?? null,
      sort_order: i + 1,
    }));
    await supabase.from('recipe_ingredients').insert(rows);
  }

  if (action.steps && action.steps.length > 0) {
    const rows = action.steps.map((step, i) => ({
      recipe_id: recipe.id,
      step_number: i + 1,
      instruction: step.instruction,
      duration_min: step.durationMin ?? null,
    }));
    await supabase.from('recipe_steps').insert(rows);
  }

  // Enrich with nutrition data from Matvaretabellen (non-fatal)
  if (action.ingredients && action.ingredients.length > 0 && action.servings) {
    try {
      const ingredients = action.ingredients.map((ing) => ({
        name: ing.name,
        amount: ing.amount ? parseFloat(ing.amount) || null : null,
        unit: ing.unit ?? null,
      }));
      const nutrition = await enrichRecipeNutrition(
        supabase,
        ingredients,
        action.servings,
      );
      if (nutrition) {
        await supabase
          .from('recipes')
          .update({ nutrition_per_serving: nutrition })
          .eq('id', recipe.id);
        logger.info({ recipeId: recipe.id, coverage: nutrition.coverage }, 'Enriched recipe nutrition');
      }
    } catch (err) {
      logger.warn({ err }, 'Nutrition enrichment failed (non-fatal)');
    }
  }

  if (action.linkToDayOfWeek) {
    const planId = await getOrCreateCurrentWeekPlan(supabase);
    await supabase
      .from('planned_meals')
      .update({ recipe_id: recipe.id })
      .eq('plan_id', planId)
      .eq('day_of_week', action.linkToDayOfWeek);
  }

  logger.info({ recipeId: recipe.id, name: action.name }, 'Saved recipe');
}

async function handleUpdateInventoryStatus(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'update_inventory_status' }>,
  logger: Logger,
): Promise<void> {
  await supabase
    .from('inventory_notes')
    .update({ status: action.newStatus, updated_at: new Date().toISOString() })
    .eq('household_id', 'default')
    .eq('item_name', action.itemName);
  logger.info({ item: action.itemName, newStatus: action.newStatus }, 'Updated inventory status');
}

async function handleSetWeekContext(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'set_week_context' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  const context: Record<string, unknown> = {};
  if (action.travelWeek !== undefined) context.travelWeek = action.travelWeek;
  if (action.guests !== undefined) context.guests = action.guests;
  if (action.guestCount !== undefined) context.guestCount = action.guestCount;
  if (action.holiday !== undefined) context.holiday = action.holiday;
  if (action.notes !== undefined) context.notes = action.notes;
  await supabase
    .from('weekly_plans')
    .update({ context, updated_at: new Date().toISOString() })
    .eq('id', planId);
  logger.info({ planId, context }, 'Set week context');
}

async function handleLogChildReaction(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'log_child_reaction' }>,
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

async function getActiveShoppingList(
  supabase: SupabaseClient,
  planId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('plan_id', planId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function handleAddShoppingItems(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'add_shopping_items' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  let listId = await getActiveShoppingList(supabase, planId);

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

async function handleRemoveShoppingItems(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'remove_shopping_items' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  const listId = await getActiveShoppingList(supabase, planId);
  if (!listId) {
    logger.warn('No active shopping list to remove items from');
    return;
  }

  await Promise.all(
    action.items.map((itemName) =>
      supabase
        .from('shopping_items')
        .delete()
        .eq('list_id', listId)
        .ilike('name', itemName),
    ),
  );
  logger.info({ planId, listId, count: action.items.length }, 'Removed items from shopping list');
}

async function handleCheckOffItems(
  supabase: SupabaseClient,
  action: Extract<HusmorAction, { type: 'check_off_items' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  const listId = await getActiveShoppingList(supabase, planId);
  if (!listId) {
    logger.warn('No active shopping list to check off items from');
    return;
  }

  await Promise.all(
    action.items.map((itemName) =>
      supabase
        .from('shopping_items')
        .update({ checked: true })
        .eq('list_id', listId)
        .ilike('name', itemName),
    ),
  );
  logger.info({ planId, listId, count: action.items.length }, 'Checked off items from shopping list');
}

async function handleClearShoppingList(
  supabase: SupabaseClient,
  _action: Extract<HusmorAction, { type: 'clear_shopping_list' }>,
  logger: Logger,
): Promise<void> {
  const planId = await getOrCreateCurrentWeekPlan(supabase);
  await supabase
    .from('shopping_lists')
    .update({ status: 'completed' })
    .eq('plan_id', planId)
    .eq('status', 'active');
  logger.info({ planId }, 'Cleared shopping list');
}

async function handleSyncOdaCart(
  action: Extract<HusmorAction, { type: 'sync_oda_cart' }>,
  logger: Logger,
): Promise<void> {
  const session = await getSession();

  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const item of action.items) {
    try {
      const results = await searchProducts(session, item.name);
      logger.debug({ query: item.name, resultCount: results.length, firstResult: results[0]?.name }, 'Oda search results');
      const available = bestMatch(results.filter((p) => p.available), item.name);
      if (available) {
        const packCount = extractPackCount(available.name);
        const adjustedQty = Math.max(1, Math.ceil((item.quantity ?? 1) / packCount));
        logger.info({ query: item.name, productId: available.id, productName: available.name, quantity: adjustedQty, packCount }, 'Oda: adding to cart');
        const cartRes = await addToCart(available.id, adjustedQty);
        matched.push(available.name);
        logger.info({ productId: available.id, httpStatus: cartRes.status, responseBody: cartRes.bodySnippet }, 'Oda: addToCart response');
      } else {
        unmatched.push(item.name);
        logger.warn({ query: item.name }, 'No available Oda product found');
      }
    } catch (err) {
      unmatched.push(item.name);
      logger.error({ query: item.name, err }, 'Oda search/add failed');
    }
  }

  logger.info({ matched: matched.length, unmatched: unmatched.length }, 'Oda cart sync complete');
}
