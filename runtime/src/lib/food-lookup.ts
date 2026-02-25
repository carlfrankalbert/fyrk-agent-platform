import type { SupabaseClient } from '@supabase/supabase-js';

export interface FoodPortion {
  portionName: string;
  portionUnit: string;
  quantity: number;
  gramsPrQuantity: number;
}

export interface FoodMatch {
  id: string;
  foodName: string;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  fiberG: number | null;
  ironMg: number | null;
  calciumMg: number | null;
  vitaminDUg: number | null;
  omega3G: number | null;
  vitaminARae: number | null;
  vitaminCMg: number | null;
  vitaminB12Ug: number | null;
  folateUg: number | null;
  sodiumMg: number | null;
  seleniumUg: number | null;
  zincMg: number | null;
  portions: FoodPortion[] | null;
  similarity: number;
}

/**
 * Fuzzy-match Norwegian food names via pg_trgm similarity.
 * Returns top matches sorted by similarity descending.
 */
export async function lookupFood(
  supabase: SupabaseClient,
  query: string,
  limit = 5,
): Promise<FoodMatch[]> {
  const { data, error } = await supabase.rpc('lookup_food', {
    query_text: query,
    result_limit: limit,
  });

  if (error) throw new Error(`Food lookup failed: ${error.message}`);
  return (data ?? []) as FoodMatch[];
}

/** Lightweight match for batch food lookup (nutrition estimates from meal names). */
export interface BatchFoodMatch {
  queryIndex: number;
  id: string;
  foodName: string;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  fiberG: number | null;
  similarity: number;
}

/**
 * Batch fuzzy-match multiple food names in a single SQL call.
 * Returns a Map keyed by query index (0-based).
 */
export async function lookupFoodsBatch(
  supabase: SupabaseClient,
  queries: string[],
  limit = 1,
): Promise<Map<number, BatchFoodMatch>> {
  if (queries.length === 0) return new Map();

  const { data, error } = await supabase.rpc('lookup_foods_batch', {
    query_texts: queries,
    result_limit: limit,
  });

  if (error) throw new Error(`Batch food lookup failed: ${error.message}`);

  const result = new Map<number, BatchFoodMatch>();
  for (const row of data ?? []) {
    // query_index is 1-based from SQL ordinality, convert to 0-based
    const idx = (row.query_index as number) - 1;
    if (!result.has(idx)) {
      result.set(idx, {
        queryIndex: idx,
        id: row.id as string,
        foodName: row.food_name as string,
        caloriesKcal: row.calories_kcal as number | null,
        proteinG: row.protein_g as number | null,
        fatG: row.fat_g as number | null,
        carbsG: row.carbs_g as number | null,
        fiberG: row.fiber_g as number | null,
        similarity: row.similarity as number,
      });
    }
  }
  return result;
}
