-- Add unique constraint for safe upsert on weekly_plans
alter table weekly_plans
  add constraint weekly_plans_household_week_year_key
  unique (household_id, week_number, year);
