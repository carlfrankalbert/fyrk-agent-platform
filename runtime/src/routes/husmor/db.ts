import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_NAMES } from '../../lib/constants.js';
import { loadLearnings, computeMealPatterns, computeSuggestionMetrics, computeRejectionPatterns, loadReactionSummary, detectKnowledgeGaps } from './learnings/index.js';
import type { Learning, MealPattern, SuggestionMetrics, RejectionPattern, ReactionSummary, KnowledgeGap } from './learnings/index.js';
import { getCached, setCached } from './cache.js';
import { lookupFood } from '../../lib/food-lookup.js';
import type { NutritionPerServing } from '../../lib/nutrition-enrichment.js';

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
  meals: Array<{ dayOfWeek: number; dayName: string; name: string; description: string | null; mealType: string; yieldsLeftovers: boolean; nutrition?: MealNutrition }>;
}

export interface ChildReactionSummary {
  childName: string;
  mealName: string;
  reaction: string;
  count: number;
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

export interface MealNutrition {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  source: 'recipe' | 'estimate';
}

export interface WeeklyNutrition {
  totals: {
    caloriesKcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    fiberG: number;
    ironMg: number;
    omega3G: number;
    vitaminDUg: number;
    calciumMg: number;
  };
  mealsWithData: number;
  totalMeals: number;
}

export interface RecentMeal {
  weekNumber: number;
  year: number;
  dayOfWeek: number;
  dayName: string;
  name: string;
  feedbackEmoji: string | null;
  rating: number | null;
  feedbackText: string | null;
}

export interface SavedRecipe {
  id: string;
  name: string;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  avgRating: number | null;
  lastUsedWeek: number | null;
  lastUsedYear: number | null;
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
  learnings: Learning[];
  mealPatterns: MealPattern[];
  savedRecipes: SavedRecipe[];
  childReactions: ChildReactionSummary[];
  suggestionMetrics: SuggestionMetrics | null;
  rejectionPatterns: RejectionPattern[];
  reactionSummary: ReactionSummary | null;
  knowledgeGaps: KnowledgeGap[];
  weeklyNutrition: WeeklyNutrition | null;
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

  // Cache keys for expensive aggregations
  const CACHE_KEY_PATTERNS = 'husmor:mealPatterns';
  const CACHE_KEY_SUGGESTIONS = 'husmor:suggestionMetrics';
  const CACHE_KEY_REJECTIONS = 'husmor:rejectionPatterns';
  const CACHE_KEY_REACTIONS = 'husmor:reactionSummary';

  const cachedMealPatterns = async () => {
    const cached = getCached<MealPattern[]>(CACHE_KEY_PATTERNS);
    if (cached) return cached;
    const result = await computeMealPatterns(supabase);
    setCached(CACHE_KEY_PATTERNS, result);
    return result;
  };
  const cachedSuggestionMetrics = async () => {
    const cached = getCached<SuggestionMetrics | null>(CACHE_KEY_SUGGESTIONS);
    if (cached !== undefined) return cached;
    const result = await computeSuggestionMetrics(supabase);
    setCached(CACHE_KEY_SUGGESTIONS, result);
    return result;
  };
  const cachedRejectionPatterns = async () => {
    const cached = getCached<RejectionPattern[]>(CACHE_KEY_REJECTIONS);
    if (cached) return cached;
    const result = await computeRejectionPatterns(supabase);
    setCached(CACHE_KEY_REJECTIONS, result);
    return result;
  };
  const cachedReactionSummary = async () => {
    const cached = getCached<ReactionSummary | null>(CACHE_KEY_REACTIONS);
    if (cached !== undefined) return cached;
    const result = await loadReactionSummary(supabase);
    setCached(CACHE_KEY_REACTIONS, result);
    return result;
  };

  const [planResult, prefsResult, pantryResult, inventoryResult, seasonalResult, traditionsResult, nutritionResult, learningsResult, mealPatternsResult, savedRecipesResult, childReactionsResult, suggestionMetricsResult, rejectionPatternsResult, reactionSummaryResult] = await Promise.all([
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
      .from('pantry_staples')
      .select('name')
      .eq('household_id', 'default')
      .limit(50),
    supabase
      .from('inventory_notes')
      .select('item_name, status, quantity')
      .eq('household_id', 'default')
      .in('status', ['available', 'use_soon'])
      .limit(30),
    supabase
      .from('seasonal_produce')
      .select('name')
      .contains('months_available', [currentMonth])
      .limit(30),
    supabase
      .from('food_traditions')
      .select('name, country, typical_dishes, suggest_strength, description')
      .contains('months', [currentMonth])
      .limit(20),
    supabase
      .from('nutrition_knowledge')
      .select('category, topic, content, applies_to')
      .limit(50),
    loadLearnings(supabase),
    cachedMealPatterns(),
    loadSavedRecipes(supabase),
    loadChildReactions(supabase),
    cachedSuggestionMetrics(),
    cachedRejectionPatterns(),
    cachedReactionSummary(),
  ]);

  let meals: WeekPlanContext['meals'] = [];
  const recipeLookup = new Map<string, NutritionPerServing>();
  if (planResult.data?.id) {
    const { data: mealRows } = await supabase
      .from('planned_meals')
      .select('day_of_week, name, description, meal_type, yields_leftovers, recipe_id')
      .eq('plan_id', planResult.data.id)
      .order('day_of_week', { ascending: true });

    // Fetch nutrition for meals with linked recipes
    const recipeIds = (mealRows ?? [])
      .map((m) => m.recipe_id)
      .filter((id): id is string => id != null);
    if (recipeIds.length > 0) {
      const { data: recipes } = await supabase
        .from('recipes')
        .select('id, nutrition_per_serving')
        .in('id', recipeIds);
      for (const r of recipes ?? []) {
        if (r.nutrition_per_serving) {
          recipeLookup.set(r.id, r.nutrition_per_serving as NutritionPerServing);
        }
      }
    }

    meals = await Promise.all(
      (mealRows ?? []).map(async (m) => {
        let nutrition: MealNutrition | undefined;

        // Try recipe-based nutrition first
        if (m.recipe_id && recipeLookup.has(m.recipe_id)) {
          const n = recipeLookup.get(m.recipe_id)!;
          nutrition = {
            caloriesKcal: n.caloriesKcal,
            proteinG: n.proteinG,
            fatG: n.fatG,
            carbsG: n.carbsG,
            fiberG: n.fiberG,
            source: 'recipe',
          };
        } else {
          // Fuzzy estimate from meal name
          try {
            const matches = await lookupFood(supabase, m.name, 1);
            if (matches.length > 0 && matches[0].similarity >= 0.3) {
              const f = matches[0];
              nutrition = {
                caloriesKcal: f.caloriesKcal ?? 0,
                proteinG: f.proteinG ?? 0,
                fatG: f.fatG ?? 0,
                carbsG: f.carbsG ?? 0,
                fiberG: f.fiberG ?? 0,
                source: 'estimate',
              };
            }
          } catch {
            // Non-fatal: skip nutrition for this meal
          }
        }

        return {
          dayOfWeek: m.day_of_week,
          dayName: DAY_NAMES[m.day_of_week] ?? `Dag ${m.day_of_week}`,
          name: m.name,
          description: m.description,
          mealType: m.meal_type,
          yieldsLeftovers: m.yields_leftovers ?? false,
          nutrition,
        };
      }),
    );
  }

  const recentMeals = await loadRecentMeals(supabase, week, year);
  const prefs = (prefsResult.data ?? []).map((p) => ({ key: p.key, value: p.value }));
  const knowledgeGaps = detectKnowledgeGaps(learningsResult, prefs);

  // Compute weekly nutrition totals from meals with data
  const mealsWithNutrition = meals.filter((m) => m.nutrition);
  let weeklyNutrition: WeeklyNutrition | null = null;
  if (mealsWithNutrition.length > 0) {
    const totals = {
      caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0,
      ironMg: 0, omega3G: 0, vitaminDUg: 0, calciumMg: 0,
    };
    for (const m of mealsWithNutrition) {
      const n = m.nutrition!;
      totals.caloriesKcal += n.caloriesKcal;
      totals.proteinG += n.proteinG;
      totals.fatG += n.fatG;
      totals.carbsG += n.carbsG;
      totals.fiberG += n.fiberG;
    }
    // Add micronutrients from recipe-based nutrition (full data in recipeLookup)
    for (const fullNutrition of recipeLookup.values()) {
      totals.ironMg += fullNutrition.ironMg;
      totals.omega3G += fullNutrition.omega3G;
      totals.vitaminDUg += fullNutrition.vitaminDUg;
      totals.calciumMg += fullNutrition.calciumMg;
    }
    weeklyNutrition = {
      totals,
      mealsWithData: mealsWithNutrition.length,
      totalMeals: meals.length,
    };
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
    preferences: prefs,
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
    learnings: learningsResult,
    mealPatterns: mealPatternsResult,
    savedRecipes: savedRecipesResult,
    childReactions: childReactionsResult,
    suggestionMetrics: suggestionMetricsResult,
    rejectionPatterns: rejectionPatternsResult,
    reactionSummary: reactionSummaryResult,
    knowledgeGaps,
    weeklyNutrition,
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
    .select('plan_id, day_of_week, name, feedback_emoji, rating, feedback_text')
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
      feedbackText: m.feedback_text ?? null,
    };
  });
}

// --- Child meal reactions ---

async function loadChildReactions(supabase: SupabaseClient): Promise<ChildReactionSummary[]> {
  const { data } = await supabase
    .from('child_meal_reactions')
    .select('child_name, meal_name, reaction')
    .eq('household_id', 'default')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!data || data.length === 0) return [];

  // Aggregate: per child+meal, count reactions
  const summaryMap = new Map<string, { childName: string; mealName: string; reaction: string; count: number }>();
  for (const r of data) {
    const key = `${r.child_name}::${r.meal_name}::${r.reaction}`;
    const existing = summaryMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      summaryMap.set(key, { childName: r.child_name, mealName: r.meal_name, reaction: r.reaction, count: 1 });
    }
  }

  return [...summaryMap.values()];
}

// --- Saved recipes ---

async function loadSavedRecipes(supabase: SupabaseClient): Promise<SavedRecipe[]> {
  const { data: recipes } = await supabase
    .from('recipes')
    .select('id, name, prep_time_min, cook_time_min')
    .eq('household_id', 'default')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!recipes || recipes.length === 0) return [];

  const recipeIds = recipes.map((r: { id: string }) => r.id);

  const { data: linkedMeals } = await supabase
    .from('planned_meals')
    .select('recipe_id, rating, plan_id')
    .in('recipe_id', recipeIds);

  // Fetch plan metadata for week/year
  const planIds = [...new Set((linkedMeals ?? []).map((m: { plan_id: string }) => m.plan_id))];
  const planLookup = new Map<string, { week_number: number; year: number }>();
  if (planIds.length > 0) {
    const { data: plans } = await supabase
      .from('weekly_plans')
      .select('id, week_number, year')
      .in('id', planIds);
    for (const p of plans ?? []) {
      planLookup.set(p.id, { week_number: p.week_number, year: p.year });
    }
  }

  return recipes.map((r: { id: string; name: string; prep_time_min: number | null; cook_time_min: number | null }) => {
    const meals = (linkedMeals ?? []).filter((m: { recipe_id: string }) => m.recipe_id === r.id);
    const ratings = meals
      .map((m: { rating: number | null }) => m.rating)
      .filter((v: number | null): v is number => v != null);
    const avgRating = ratings.length > 0 ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null;

    let lastUsedWeek: number | null = null;
    let lastUsedYear: number | null = null;
    for (const m of meals) {
      const plan = planLookup.get((m as { plan_id: string }).plan_id);
      if (plan) {
        if (lastUsedYear === null || plan.year > lastUsedYear || (plan.year === lastUsedYear && plan.week_number > (lastUsedWeek ?? 0))) {
          lastUsedWeek = plan.week_number;
          lastUsedYear = plan.year;
        }
      }
    }

    return {
      id: r.id,
      name: r.name,
      prepTimeMin: r.prep_time_min,
      cookTimeMin: r.cook_time_min,
      avgRating,
      lastUsedWeek,
      lastUsedYear,
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
