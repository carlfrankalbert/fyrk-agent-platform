-- Feature 2: Rester-logikk
alter table planned_meals add column if not exists yields_leftovers boolean default false;

-- Feature 5: Kontekstuell tilpasning
alter table weekly_plans add column if not exists context jsonb;

-- Feature 6: Barns smaksutvikling
create table if not exists child_meal_reactions (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'default',
  child_name text not null,
  meal_name text not null,
  reaction text not null check (reaction in ('loved', 'liked', 'neutral', 'disliked', 'refused')),
  notes text,
  created_at timestamptz not null default now()
);

alter table child_meal_reactions enable row level security;
