-- FYRK Mat Agent — Phase 1 Schema
-- Family meal planning: knowledge base, recipes, weekly plans, shopping lists

-- Dietary guidelines reference (Helsedirektoratet, etc.)
create table if not exists nutrition_knowledge (
  id uuid primary key default gen_random_uuid(),
  category text not null,          -- e.g. 'barn', 'generelt', 'kosttilskudd'
  topic text not null,
  content text not null,
  applies_to text,                 -- e.g. 'children_1_3', 'adults', 'all'
  source text,                     -- e.g. 'Helsedirektoratet 2024'
  created_at timestamptz default now()
);

-- Nordic seasonal produce calendar
create table if not exists seasonal_produce (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null,          -- e.g. 'vegetable', 'berry', 'fruit', 'fish', 'mushroom', 'game'
  months_available integer[] not null default '{}',
  months_peak integer[] not null default '{}',
  nutrition_highlight text,
  child_friendly_note text,
  created_at timestamptz default now()
);

-- Norwegian/Swedish food traditions
create table if not exists food_traditions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text not null default 'NO',  -- NO, SE, NO/SE
  months integer[] not null default '{}',
  typical_dishes text[] not null default '{}',
  suggest_strength text not null default 'hint'
    check (suggest_strength in ('hint', 'suggest', 'strong')),
  description text,
  created_at timestamptz default now()
);

-- Family preferences (allergies, dislikes, household config)
create table if not exists family_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'default',
  key text not null,               -- e.g. 'allergies', 'dislikes', 'adults', 'children'
  value jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (household_id, key)
);

-- Items always in stock (exclude from shopping lists)
create table if not exists pantry_staples (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'default',
  name text not null,
  category text,                   -- e.g. 'krydder', 'basis', 'hermetikk'
  created_at timestamptz default now(),
  unique (household_id, name)
);

-- Recipe catalog
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  tags text[] not null default '{}',         -- e.g. 'vegetar', 'fisk', 'barnevennlig', 'batch'
  prep_time_min integer,
  cook_time_min integer,
  servings integer default 4,
  nutrition_per_serving jsonb,               -- { calories, protein_g, fiber_g, ... }
  best_months integer[] not null default '{}',
  source_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Per-recipe ingredients
create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  name text not null,
  amount numeric,
  unit text,                       -- e.g. 'g', 'dl', 'stk', 'ss', 'ts'
  ingredient_group text,           -- e.g. 'main', 'sauce', 'garnish'
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- Per-recipe steps
create table if not exists recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  step_number integer not null,
  instruction text not null,
  duration_min integer,
  created_at timestamptz default now()
);

-- Weekly meal plans
create table if not exists weekly_plans (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'default',
  week_number integer not null check (week_number between 1 and 53),
  year integer not null,
  status text not null default 'draft'
    check (status in ('draft', 'proposed', 'approved', 'active', 'completed')),
  slack_message_ts text,
  slack_channel text,
  run_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Meals within weekly plans
create table if not exists planned_meals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references weekly_plans(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 1 and 7),  -- 1=Monday
  meal_type text not null default 'dinner',   -- dinner, lunch, breakfast
  name text not null,
  description text,
  estimated_prep_min integer,
  tags text[] not null default '{}',
  recipe_id uuid references recipes(id) on delete set null,
  feedback_emoji text,
  rating integer check (rating is null or rating between 1 and 5),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Shopping lists linked to plans
create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references weekly_plans(id) on delete set null,
  household_id text not null default 'default',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Items within shopping lists
create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists(id) on delete cascade,
  name text not null,
  amount numeric,
  unit text,
  category text,                   -- e.g. 'grønnsaker', 'meieri', 'kjøtt', 'tørrvarer'
  checked boolean not null default false,
  created_at timestamptz default now()
);

-- Purchase records (Phase 2 — receipt photo, Oda, manual)
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'default',
  source text not null default 'manual',  -- manual, receipt_photo, oda
  store_name text,
  total_amount numeric,
  currency text default 'NOK',
  purchased_at timestamptz default now(),
  receipt_image_url text,
  created_at timestamptz default now()
);

-- Items within purchases
create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  price numeric,
  category text,
  created_at timestamptz default now()
);

-- "What needs using up" notes (Phase 2)
create table if not exists inventory_notes (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'default',
  item_name text not null,
  status text not null default 'available'
    check (status in ('available', 'use_soon', 'used', 'expired')),
  quantity text,
  noted_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_seasonal_produce_months on seasonal_produce using gin (months_available);
create index if not exists idx_seasonal_produce_peak on seasonal_produce using gin (months_peak);
create index if not exists idx_food_traditions_months on food_traditions using gin (months);
create index if not exists idx_recipes_tags on recipes using gin (tags);
create index if not exists idx_recipes_best_months on recipes using gin (best_months);
create index if not exists idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);
create index if not exists idx_recipe_steps_recipe on recipe_steps(recipe_id);
create index if not exists idx_weekly_plans_household on weekly_plans(household_id);
create index if not exists idx_weekly_plans_week on weekly_plans(year, week_number);
create index if not exists idx_weekly_plans_status on weekly_plans(status);
create index if not exists idx_weekly_plans_slack_ts on weekly_plans(slack_message_ts);
create index if not exists idx_planned_meals_plan on planned_meals(plan_id);
create index if not exists idx_shopping_lists_plan on shopping_lists(plan_id);
create index if not exists idx_shopping_items_list on shopping_items(list_id);
create index if not exists idx_purchases_household on purchases(household_id);
create index if not exists idx_purchase_items_purchase on purchase_items(purchase_id);
create index if not exists idx_inventory_notes_household on inventory_notes(household_id);
create index if not exists idx_family_preferences_household on family_preferences(household_id);
create index if not exists idx_pantry_staples_household on pantry_staples(household_id);

-- Enable RLS (service_role key bypasses)
alter table nutrition_knowledge enable row level security;
alter table seasonal_produce enable row level security;
alter table food_traditions enable row level security;
alter table family_preferences enable row level security;
alter table pantry_staples enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_steps enable row level security;
alter table weekly_plans enable row level security;
alter table planned_meals enable row level security;
alter table shopping_lists enable row level security;
alter table shopping_items enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table inventory_notes enable row level security;

-- Comments
comment on table nutrition_knowledge is 'Dietary guidelines reference (Helsedirektoratet, child nutrition, etc.)';
comment on table seasonal_produce is 'Nordic seasonal produce calendar with months_available and months_peak';
comment on table food_traditions is 'Norwegian/Swedish food traditions with suggest_strength';
comment on table family_preferences is 'Per-household preferences (allergies, dislikes, config)';
comment on table pantry_staples is 'Items always in stock — excluded from shopping lists';
comment on table recipes is 'Recipe catalog with tags, nutrition, and seasonal info';
comment on table recipe_ingredients is 'Per-recipe ingredient list';
comment on table recipe_steps is 'Per-recipe cooking steps';
comment on table weekly_plans is 'Weekly meal plans with Slack integration and status workflow';
comment on table planned_meals is 'Individual meals within a weekly plan';
comment on table shopping_lists is 'Shopping lists linked to weekly plans';
comment on table shopping_items is 'Items within a shopping list';
comment on table purchases is 'Purchase records — Phase 2 (receipt photo, Oda, manual)';
comment on table purchase_items is 'Items within a purchase record — Phase 2';
comment on table inventory_notes is 'What needs using up notes — Phase 2';
