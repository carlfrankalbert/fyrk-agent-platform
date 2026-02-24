#!/usr/bin/env npx tsx
/**
 * Import food nutrients from Matvaretabellen.no API into Supabase.
 *
 * Usage:
 *   npx tsx scripts/import-food-nutrients.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in .env at project root.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env from project root
// ---------------------------------------------------------------------------
function loadEnv(): void {
  const envPath = resolve(__dirname, '..', '.env');
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    return; // no .env file — rely on process.env
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Matvaretabellen API types
// ---------------------------------------------------------------------------
interface ApiFood {
  foodId: string;
  foodName: string;
  foodGroupId: string;
  latinName?: string;
  searchKeywords?: string[];
  calories?: { quantity: number; unit: string };
  energy?: { quantity: number; unit: string };
  ediblePart?: { percent: number };
  portions?: Array<{ portionName: string; portionUnit?: string; quantity: number; unit: string }>;
  constituents: Array<{
    nutrientId: string;
    quantity?: number;
    unit?: string;
    sourceId?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Nutrient ID → column mapping
// ---------------------------------------------------------------------------
const NUTRIENT_MAP: Record<string, string> = {
  'Protein': 'protein_g',
  'Fett': 'fat_g',
  'Karbo': 'carbs_g',
  'Fiber': 'fiber_g',
  'Fe': 'iron_mg',
  'Ca': 'calcium_mg',
  'Vit D': 'vitamin_d_ug',
  'Omega-3': 'omega3_g',
  'Vit A': 'vitamin_a_rae',
  'Vit C': 'vitamin_c_mg',
  'Vit B12': 'vitamin_b12_ug',
  'Folat': 'folate_ug',
  'Na': 'sodium_mg',
  'Se': 'selenium_ug',
  'Zn': 'zinc_mg',
};

// ---------------------------------------------------------------------------
// Map a single API food to our DB row
// ---------------------------------------------------------------------------
function mapFood(food: ApiFood): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: food.foodId,
    food_name: food.foodName,
    food_group_id: food.foodGroupId,
    latin_name: food.latinName ?? null,
    search_keywords: food.searchKeywords ?? [],
    calories_kcal: food.calories?.quantity ?? null,
    energy_kj: food.energy?.quantity ?? null,
    portions: food.portions ?? [],
    edible_part_pct: food.ediblePart?.percent ?? null,
    all_constituents: food.constituents,
    imported_at: new Date().toISOString(),
  };

  // Initialize all nutrient columns to null
  for (const col of Object.values(NUTRIENT_MAP)) {
    row[col] = null;
  }

  // Map constituents to denormalized columns
  for (const c of food.constituents) {
    const col = NUTRIENT_MAP[c.nutrientId];
    if (col && c.quantity != null) {
      row[col] = c.quantity;
    }
  }

  return row;
}

// ---------------------------------------------------------------------------
// Upsert a batch via Supabase REST API (PostgREST)
// ---------------------------------------------------------------------------
async function upsertBatch(rows: Record<string, unknown>[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/food_nutrients`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upsert failed (${res.status}): ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('Fetching matvaretabellen.no API...');
  const res = await fetch('https://www.matvaretabellen.no/api/nb/foods.json');
  if (!res.ok) {
    throw new Error(`API fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { foods: ApiFood[] };
  const foods = data.foods;
  console.log(`Fetched ${foods.length} foods`);

  const rows = foods.map(mapFood);
  const BATCH_SIZE = 500;
  let imported = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await upsertBatch(batch);
      imported += batch.length;
      console.log(`  Upserted ${imported}/${rows.length}`);
    } catch (err) {
      errors++;
      console.error(`  Batch ${i}-${i + batch.length} failed:`, err);
    }
  }

  console.log(`\nDone. Imported: ${imported}, Errors: ${errors}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
