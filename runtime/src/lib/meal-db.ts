import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_NAMES } from './constants.js';
import { getOrCompute } from './cache.js';

// --- Types ---

export interface WeekContext {
  travelWeek?: boolean;
  guests?: boolean;
  guestCount?: number;
  holiday?: string;
  notes?: string;
}

export interface WeekPlanContext {
  planId: string | null;
  weekNumber: number;
  year: number;
  status: string;
  context: WeekContext | null;
  meals: Array<{ dayOfWeek: number; dayName: string; name: string; description: string | null; mealType: string; yieldsLeftovers: boolean }>;
}

export interface DbContext {
  plan: WeekPlanContext;
  preferences: Array<{ key: string; value: unknown }>;
  inventoryNotes: Array<{ itemName: string; status: string; quantity: string | null }>;
  seasonalProduce: string[];
}

// --- Week calculation ---

export function getCurrentWeekNumber(): { week: number; year: number } {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return { week, year: now.getFullYear() };
}

// --- Context loading ---

export async function loadDbContext(supabase: SupabaseClient): Promise<DbContext> {
  const { week, year } = getCurrentWeekNumber();
  const currentMonth = new Date().getMonth() + 1;

  const [planResult, prefsResult, inventoryResult, seasonalResult] = await Promise.all([
    supabase
      .from('weekly_plans')
      .select('id, status, week_number, year, context')
      .eq('household_id', 'default')
      .eq('week_number', week)
      .eq('year', year)
      .maybeSingle(),
    supabase
      .from('family_preferences')
      .select('key, value')
      .eq('household_id', 'default')
      .limit(50),
    supabase
      .from('inventory_notes')
      .select('item_name, status, quantity')
      .eq('household_id', 'default')
      .in('status', ['available', 'use_soon'])
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(30),
    supabase
      .from('seasonal_produce')
      .select('name')
      .contains('months_available', [currentMonth])
      .limit(30),
  ]);

  let meals: WeekPlanContext['meals'] = [];
  if (planResult.data?.id) {
    const { data: mealRows } = await supabase
      .from('planned_meals')
      .select('day_of_week, name, description, meal_type, yields_leftovers')
      .eq('plan_id', planResult.data.id)
      .order('day_of_week', { ascending: true });

    meals = (mealRows ?? []).map((m) => ({
      dayOfWeek: m.day_of_week,
      dayName: DAY_NAMES[m.day_of_week] ?? `Dag ${m.day_of_week}`,
      name: m.name,
      description: m.description,
      mealType: m.meal_type,
      yieldsLeftovers: m.yields_leftovers ?? false,
    }));
  }

  return {
    plan: {
      planId: planResult.data?.id ?? null,
      weekNumber: week,
      year,
      status: planResult.data?.status ?? 'none',
      context: (planResult.data?.context as WeekContext) ?? null,
      meals,
    },
    preferences: (prefsResult.data ?? []).map((p) => ({ key: p.key, value: p.value })),
    inventoryNotes: (inventoryResult.data ?? []).map((n) => ({
      itemName: n.item_name,
      status: n.status,
      quantity: n.quantity,
    })),
    seasonalProduce: (seasonalResult.data ?? []).map((s) => s.name),
  };
}

// --- Cached full DbContext ---

const CACHE_KEY_DB_CONTEXT = 'husmor:dbContext';
const DB_CONTEXT_TTL_MS = 2 * 60 * 1000; // 2 minutes

export async function loadDbContextCached(supabase: SupabaseClient): Promise<DbContext> {
  return getOrCompute(CACHE_KEY_DB_CONTEXT, () => loadDbContext(supabase), DB_CONTEXT_TTL_MS);
}

// --- Plan upsert ---

export async function getOrCreateCurrentWeekPlan(supabase: SupabaseClient, weekOffset = 0): Promise<string> {
  const { week: currentWeek, year: currentYear } = getCurrentWeekNumber();
  let week = currentWeek + weekOffset;
  let year = currentYear;
  if (week > 52) { week -= 52; year += 1; }

  const { data, error } = await supabase
    .from('weekly_plans')
    .upsert(
      { household_id: 'default', week_number: week, year, status: 'draft' },
      { onConflict: 'household_id,week_number,year', ignoreDuplicates: true },
    )
    .select('id')
    .single();

  if (error || !data) {
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
