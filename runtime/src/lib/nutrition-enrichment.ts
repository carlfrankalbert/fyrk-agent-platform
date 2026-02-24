import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupFood, type FoodMatch, type FoodPortion } from './food-lookup.js';

export interface NutritionPerServing {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  ironMg: number;
  calciumMg: number;
  vitaminDUg: number;
  omega3G: number;
  vitaminCMg: number;
  vitaminB12Ug: number;
  folateUg: number;
  coverage: number; // 0.0–1.0, fraction of ingredients matched
}

export interface Ingredient {
  name: string;
  amount?: number | null;
  unit?: string | null; // g, kg, dl, stk, ss, ts, etc.
}

const MIN_SIMILARITY = 0.3;

/**
 * Convert an ingredient amount + unit to grams.
 * All Matvaretabellen values are per 100g, so we need grams to scale.
 */
function toGrams(
  amount: number | null | undefined,
  unit: string | null | undefined,
  portions: FoodPortion[] | null,
): number {
  if (!amount) return 100; // no amount → assume 100g

  const u = (unit ?? '').toLowerCase().trim();

  switch (u) {
    case 'g':
      return amount;
    case 'kg':
      return amount * 1000;
    case 'dl':
      return amount * 100; // rough approximation
    case 'l':
      return amount * 1000;
    case 'ss':
    case 'spiseskje':
      return amount * 15;
    case 'ts':
    case 'teskje':
      return amount * 5;
    case 'stk': {
      // Try to use portion data from Matvaretabellen
      if (portions && portions.length > 0) {
        const stk = portions.find(
          (p) => p.portionUnit === 'stk' || p.portionUnit === 'stykk',
        );
        if (stk && stk.gramsPrQuantity > 0) {
          return amount * stk.gramsPrQuantity;
        }
        // Fallback: use first portion entry
        if (portions[0].gramsPrQuantity > 0) {
          return amount * portions[0].gramsPrQuantity;
        }
      }
      return amount * 100; // fallback: 100g per stk
    }
    default:
      return 100; // unknown unit → 100g fallback
  }
}

function val(v: number | null): number {
  return v ?? 0;
}

/**
 * Enrich a recipe with nutrition data from Matvaretabellen.
 * Returns per-serving nutrition, or null if no ingredients matched.
 */
export async function enrichRecipeNutrition(
  supabase: SupabaseClient,
  ingredients: Ingredient[],
  servings: number,
): Promise<NutritionPerServing | null> {
  if (ingredients.length === 0 || servings <= 0) return null;

  const totals = {
    caloriesKcal: 0,
    proteinG: 0,
    fatG: 0,
    carbsG: 0,
    fiberG: 0,
    ironMg: 0,
    calciumMg: 0,
    vitaminDUg: 0,
    omega3G: 0,
    vitaminCMg: 0,
    vitaminB12Ug: 0,
    folateUg: 0,
  };

  let matched = 0;

  for (const ing of ingredients) {
    let matches: FoodMatch[];
    try {
      matches = await lookupFood(supabase, ing.name, 1);
    } catch {
      continue;
    }

    if (matches.length === 0 || matches[0].similarity < MIN_SIMILARITY) {
      continue;
    }

    const food = matches[0];
    const grams = toGrams(ing.amount, ing.unit, food.portions);
    const scale = grams / 100; // nutrients are per 100g

    totals.caloriesKcal += val(food.caloriesKcal) * scale;
    totals.proteinG += val(food.proteinG) * scale;
    totals.fatG += val(food.fatG) * scale;
    totals.carbsG += val(food.carbsG) * scale;
    totals.fiberG += val(food.fiberG) * scale;
    totals.ironMg += val(food.ironMg) * scale;
    totals.calciumMg += val(food.calciumMg) * scale;
    totals.vitaminDUg += val(food.vitaminDUg) * scale;
    totals.omega3G += val(food.omega3G) * scale;
    totals.vitaminCMg += val(food.vitaminCMg) * scale;
    totals.vitaminB12Ug += val(food.vitaminB12Ug) * scale;
    totals.folateUg += val(food.folateUg) * scale;

    matched++;
  }

  if (matched === 0) return null;

  return {
    caloriesKcal: round1(totals.caloriesKcal / servings),
    proteinG: round1(totals.proteinG / servings),
    fatG: round1(totals.fatG / servings),
    carbsG: round1(totals.carbsG / servings),
    fiberG: round1(totals.fiberG / servings),
    ironMg: round1(totals.ironMg / servings),
    calciumMg: round1(totals.calciumMg / servings),
    vitaminDUg: round1(totals.vitaminDUg / servings),
    omega3G: round1(totals.omega3G / servings),
    vitaminCMg: round1(totals.vitaminCMg / servings),
    vitaminB12Ug: round1(totals.vitaminB12Ug / servings),
    folateUg: round1(totals.folateUg / servings),
    coverage: round1(matched / ingredients.length),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
