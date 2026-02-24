-- Enable trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE food_nutrients (
  id text PRIMARY KEY,                    -- foodId from API (e.g. "04.301")
  food_name text NOT NULL,
  food_group_id text,
  latin_name text,
  search_keywords text[] DEFAULT '{}',

  -- Key nutrients (denormalized for efficient queries)
  calories_kcal numeric,
  energy_kj numeric,
  protein_g numeric,
  fat_g numeric,
  carbs_g numeric,
  fiber_g numeric,

  -- Micronutrients tracked by Husmor's dietary guidelines
  iron_mg numeric,                        -- Fe
  calcium_mg numeric,                     -- Ca
  vitamin_d_ug numeric,                   -- Vit D
  omega3_g numeric,                       -- Omega-3
  vitamin_a_rae numeric,                  -- Vit A
  vitamin_c_mg numeric,                   -- Vit C
  vitamin_b12_ug numeric,                 -- Vit B12
  folate_ug numeric,                      -- Folat
  sodium_mg numeric,                      -- Na
  selenium_ug numeric,                    -- Se
  zinc_mg numeric,                        -- Zn

  -- Full data
  portions jsonb DEFAULT '[]',            -- standard portions with gram equivalents
  edible_part_pct numeric,
  all_constituents jsonb DEFAULT '[]',    -- full 56-nutrient array from API

  -- Metadata
  imported_at timestamptz DEFAULT now()
);

-- Trigram index for fuzzy name matching
CREATE INDEX idx_food_nutrients_name_trgm
  ON food_nutrients USING gin (food_name gin_trgm_ops);

-- Standard index on food group for category lookups
CREATE INDEX idx_food_nutrients_group
  ON food_nutrients(food_group_id);

-- Enable RLS (consistent with rest of project)
ALTER TABLE food_nutrients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "food_nutrients_read" ON food_nutrients FOR SELECT USING (true);

-- Fuzzy lookup function for use via supabase.rpc('lookup_food', ...)
CREATE OR REPLACE FUNCTION lookup_food(query_text text, result_limit int DEFAULT 5)
RETURNS TABLE (
  id text,
  "foodName" text,
  "caloriesKcal" numeric,
  "proteinG" numeric,
  "fatG" numeric,
  "carbsG" numeric,
  "fiberG" numeric,
  "ironMg" numeric,
  "calciumMg" numeric,
  "vitaminDUg" numeric,
  "omega3G" numeric,
  "vitaminARae" numeric,
  "vitaminCMg" numeric,
  "vitaminB12Ug" numeric,
  "folateUg" numeric,
  "sodiumMg" numeric,
  "seleniumUg" numeric,
  "zincMg" numeric,
  similarity real
)
LANGUAGE sql STABLE
AS $$
  SELECT
    fn.id,
    fn.food_name AS "foodName",
    fn.calories_kcal AS "caloriesKcal",
    fn.protein_g AS "proteinG",
    fn.fat_g AS "fatG",
    fn.carbs_g AS "carbsG",
    fn.fiber_g AS "fiberG",
    fn.iron_mg AS "ironMg",
    fn.calcium_mg AS "calciumMg",
    fn.vitamin_d_ug AS "vitaminDUg",
    fn.omega3_g AS "omega3G",
    fn.vitamin_a_rae AS "vitaminARae",
    fn.vitamin_c_mg AS "vitaminCMg",
    fn.vitamin_b12_ug AS "vitaminB12Ug",
    fn.folate_ug AS "folateUg",
    fn.sodium_mg AS "sodiumMg",
    fn.selenium_ug AS "seleniumUg",
    fn.zinc_mg AS "zincMg",
    similarity(fn.food_name, query_text) AS similarity
  FROM food_nutrients fn
  WHERE similarity(fn.food_name, query_text) > 0.2
  ORDER BY similarity DESC
  LIMIT result_limit;
$$;
