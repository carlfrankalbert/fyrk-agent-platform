-- Batch food lookup: resolve multiple food names in a single query
-- Replaces N+1 lookupFood() calls with one RPC call
CREATE OR REPLACE FUNCTION lookup_foods_batch(
  query_texts text[],
  result_limit int DEFAULT 1
)
RETURNS TABLE (
  query_index int,
  id text,
  food_name text,
  calories_kcal numeric,
  protein_g numeric,
  fat_g numeric,
  carbs_g numeric,
  fiber_g numeric,
  similarity real
) LANGUAGE sql STABLE AS $$
  SELECT
    q.idx::int AS query_index,
    f.id,
    f.food_name,
    f.calories_kcal,
    f.protein_g,
    f.fat_g,
    f.carbs_g,
    f.fiber_g,
    similarity(f.food_name, q.txt) AS similarity
  FROM unnest(query_texts) WITH ORDINALITY AS q(txt, idx)
  CROSS JOIN LATERAL (
    SELECT fn.*
    FROM food_nutrients fn
    WHERE similarity(fn.food_name, q.txt) >= 0.3
    ORDER BY similarity(fn.food_name, q.txt) DESC
    LIMIT result_limit
  ) f
$$;
