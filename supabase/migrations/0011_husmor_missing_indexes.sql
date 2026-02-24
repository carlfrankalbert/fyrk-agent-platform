-- Add missing indexes for Husmor query performance

CREATE INDEX IF NOT EXISTS idx_planned_meals_recipe
  ON planned_meals(recipe_id) WHERE recipe_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_child_meal_reactions_household
  ON child_meal_reactions(household_id);
