-- Household learnings: shared table for conversation extraction, meal patterns, and proposed learnings
create table if not exists household_learnings (
  id uuid primary key default gen_random_uuid(),
  household_id text not null default 'default',
  thread_ts text,
  category text not null,
  insight text not null,
  confidence numeric not null default 0.8 check (confidence between 0.0 and 1.0),
  confirmed boolean,
  source text not null default 'extraction',
  source_summary text,
  expires_at timestamptz,
  superseded_by uuid references household_learnings(id) on delete set null,
  slack_message_ts text,
  created_at timestamptz default now()
);

-- expires_at filtering done at query time (now() is not immutable)
create index idx_learnings_active on household_learnings(household_id)
  where superseded_by is null and confirmed is distinct from false;

alter table household_learnings enable row level security;
