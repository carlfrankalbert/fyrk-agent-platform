import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_NAMES } from '../lib/constants.js';
import type { HusmorAction } from './husmor-schemas.js';

export interface WeekPlanContext {
  planId: string | null;
  weekNumber: number;
  year: number;
  status: string;
  meals: Array<{ dayOfWeek: number; dayName: string; name: string; description: string | null; mealType: string }>;
}

export interface DbContext {
  plan: WeekPlanContext;
  preferences: Array<{ key: string; value: unknown }>;
  pantryStaples: string[];
  inventoryNotes: Array<{ itemName: string; status: string; quantity: string | null }>;
  seasonalProduce: string[];
}

export function getCurrentWeekNumber(): { week: number; year: number } {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return { week, year: now.getFullYear() };
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

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

export async function executeActions(
  supabase: SupabaseClient,
  actions: HusmorAction[],
  logger: Logger,
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
