import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateCurrentWeekPlan } from './husmor-db.js';
import { syncCanvas } from './husmor-canvas.js';
import { replyInThread } from '../lib/slack.js';
import type { HusmorAction } from './husmor-schemas.js';
import { invalidateCache } from './husmor-cache.js';
import { enrichRecipeNutrition } from '../lib/nutrition-enrichment.js';

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

export async function executeActions(
  supabase: SupabaseClient,
  actions: HusmorAction[],
  logger: Logger,
  slackToken?: string,
  actionCtx?: { channel?: string; threadTs?: string },
): Promise<void> {
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'add_meals':
          await handleAddMeals(supabase, action, logger);
          break;
        case 'update_meal':
          await handleUpdateMeal(supabase, action, logger);
          break;
        case 'remove_meal':
          await handleRemoveMeal(supabase, action, logger);
          break;
        case 'set_preference':
          await handleSetPreference(supabase, action, logger);
          break;
        case 'add_inventory_note':
          await handleAddInventoryNote(supabase, action, logger);
          break;
        case 'rate_meal':
          await handleRateMeal(supabase, action, logger);
          break;
        case 'generate_shopping_list':
          await handleGenerateShoppingList(supabase, action, logger, slackToken);
          break;
        case 'update_plan_status':
          await handleUpdatePlanStatus(supabase, action, logger);
          break;
        case 'propose_learning':
          await handleProposeLearning(supabase, action, logger, slackToken, actionCtx?.channel, actionCtx?.threadTs);
          break;
        case 'save_recipe':
          await handleSaveRecipe(supabase, action, logger);
          break;
        case 'update_inventory_status':
          await handleUpdateInventoryStatus(supabase, action, logger);
          break;
        case 'set_week_context':
          await handleSetWeekContext(supabase, action, logger);
          break;
        case 'log_child_reaction':
          await handleLogChildReaction(supabase, action, logger);
          break;
      }
    } catch (err) {
      logger.error({ action: action.type, err }, 'Failed to execute action');
    }
  }

  // Invalidate cached aggregations if any data-modifying actions were executed
  const CACHE_INVALIDATING_ACTIONS = new Set(['add_meals', 'update_meal', 'remove_meal', 'rate_meal', 'save_recipe']);
  if (actions.some(a => CACHE_INVALIDATING_ACTIONS.has(a.type))) {
    invalidateCache('husmor:');
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
  slackToken?: string,
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

  if (slackToken) {
    try {
      await syncCanvas(supabase, slackToken, planId, action.items, logger);
    } catch (canvasErr) {
      logger.warn({ canvasErr }, 'Canvas update failed (non-fatal)');
    }
  }
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
  slackToken?: string,
  channel?: string,
  threadTs?: string,
): Promise<void> {
  // Insert learning with source='proposed', confirmed=null
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

  // Post confirmation message in thread
  if (slackToken && channel && threadTs) {
    const confirmMsg = `Husker du dette?\n> ${action.insight}\nReager med :white_check_mark: for a bekrefte eller :x: for a avvise.`;
    try {
      const result = await replyInThread(slackToken, channel, threadTs, confirmMsg);
      if (result.ts) {
        await supabase
          .from('household_learnings')
          .update({ slack_message_ts: result.ts })
          .eq('id', learning.id);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to post learning confirmation message');
    }
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
