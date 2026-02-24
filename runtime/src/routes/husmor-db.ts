import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_NAMES } from '../lib/constants.js';

// --- Types ---

export interface WeekPlanContext {
  planId: string | null;
  weekNumber: number;
  year: number;
  status: string;
  meals: Array<{ dayOfWeek: number; dayName: string; name: string; description: string | null; mealType: string }>;
}

export interface FoodTradition {
  name: string;
  country: string;
  typicalDishes: string[];
  suggestStrength: string;
  description: string | null;
}

export interface NutritionEntry {
  category: string;
  topic: string;
  content: string;
  appliesTo: string | null;
}

export interface RecentMeal {
  weekNumber: number;
  year: number;
  dayOfWeek: number;
  dayName: string;
  name: string;
  feedbackEmoji: string | null;
  rating: number | null;
}

export interface DbContext {
  plan: WeekPlanContext;
  preferences: Array<{ key: string; value: unknown }>;
  pantryStaples: string[];
  inventoryNotes: Array<{ itemName: string; status: string; quantity: string | null }>;
  seasonalProduce: string[];
  foodTraditions: FoodTradition[];
  nutritionKnowledge: NutritionEntry[];
  recentMeals: RecentMeal[];
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

  const [planResult, prefsResult, pantryResult, inventoryResult, seasonalResult, traditionsResult, nutritionResult] = await Promise.all([
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
    supabase
      .from('food_traditions')
      .select('name, country, typical_dishes, suggest_strength, description')
      .contains('months', [currentMonth]),
    supabase
      .from('nutrition_knowledge')
      .select('category, topic, content, applies_to'),
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

  const recentMeals = await loadRecentMeals(supabase, week, year);

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
    foodTraditions: (traditionsResult.data ?? []).map((t) => ({
      name: t.name,
      country: t.country,
      typicalDishes: t.typical_dishes ?? [],
      suggestStrength: t.suggest_strength,
      description: t.description,
    })),
    nutritionKnowledge: (nutritionResult.data ?? []).map((n) => ({
      category: n.category,
      topic: n.topic,
      content: n.content,
      appliesTo: n.applies_to,
    })),
    recentMeals,
  };
}

async function loadRecentMeals(supabase: SupabaseClient, currentWeek: number, currentYear: number): Promise<RecentMeal[]> {
  const { data: recentPlans } = await supabase
    .from('weekly_plans')
    .select('id, week_number, year')
    .eq('household_id', 'default')
    .gte('year', currentYear - 1)
    .order('year', { ascending: false })
    .order('week_number', { ascending: false })
    .limit(4);

  const pastPlans = (recentPlans ?? []).filter(
    (p) => !(p.week_number === currentWeek && p.year === currentYear),
  ).slice(0, 3);

  if (pastPlans.length === 0) return [];

  const pastPlanIds = pastPlans.map((p) => p.id);
  const { data: recentMealRows } = await supabase
    .from('planned_meals')
    .select('plan_id, day_of_week, name, feedback_emoji, rating')
    .in('plan_id', pastPlanIds)
    .order('day_of_week', { ascending: true });

  const planLookup = new Map(pastPlans.map((p) => [p.id, p]));
  return (recentMealRows ?? []).map((m) => {
    const plan = planLookup.get(m.plan_id);
    return {
      weekNumber: plan?.week_number ?? 0,
      year: plan?.year ?? 0,
      dayOfWeek: m.day_of_week,
      dayName: DAY_NAMES[m.day_of_week] ?? `Dag ${m.day_of_week}`,
      name: m.name,
      feedbackEmoji: m.feedback_emoji,
      rating: m.rating,
    };
  });
}

// --- Plan upsert ---

export async function getOrCreateCurrentWeekPlan(supabase: SupabaseClient): Promise<string> {
  const { week, year } = getCurrentWeekNumber();

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
