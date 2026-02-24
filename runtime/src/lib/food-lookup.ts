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
