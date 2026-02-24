-- Add portions to lookup_food return for unit conversion (e.g. "stk" → grams)
-- Must DROP first because changing return type is not allowed by CREATE OR REPLACE
DROP FUNCTION IF EXISTS lookup_food(text, int);
CREATE FUNCTION lookup_food(query_text text, result_limit int DEFAULT 5)
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
  portions jsonb,
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
    fn.portions,
    similarity(fn.food_name, query_text) AS similarity
  FROM food_nutrients fn
  WHERE similarity(fn.food_name, query_text) > 0.2
  ORDER BY similarity DESC
  LIMIT result_limit;
$$;
