-- Feature #1: Suggestion provenance on planned_meals
ALTER TABLE planned_meals ADD COLUMN IF NOT EXISTS suggested_by text DEFAULT 'user'
  CHECK (suggested_by IN ('husmor', 'user'));
ALTER TABLE planned_meals ADD COLUMN IF NOT EXISTS original_suggestion text;

-- Feature #6: Modification tracking
CREATE TABLE suggestion_modifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id text NOT NULL DEFAULT 'default',
  plan_id uuid REFERENCES weekly_plans(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  original_meal text NOT NULL,
  replacement_meal text,  -- NULL = removal
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_suggestion_modifications_household
  ON suggestion_modifications(household_id, created_at DESC);

ALTER TABLE suggestion_modifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_suggestion_modifications"
  ON suggestion_modifications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Feature #8: Reaction mining
CREATE TABLE message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id text NOT NULL DEFAULT 'default',
  message_ts text NOT NULL,
  channel text NOT NULL,
  reaction text NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_reactions_household
  ON message_reactions(household_id, created_at DESC);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_message_reactions"
  ON message_reactions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
