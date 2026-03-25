-- Usage tracking for Husmor Hub — lightweight event log
create table if not exists hub_usage_events (
  id bigint generated always as identity primary key,
  household_id text not null default 'default',
  feature text not null,         -- e.g. 'meal_rating', 'voice', 'shopping_toggle'
  action text not null,          -- e.g. 'tap', 'view', 'submit'
  metadata jsonb default '{}',   -- optional extra context
  created_at timestamptz not null default now()
);

-- Index for querying by feature and time range
create index idx_hub_usage_feature_time on hub_usage_events (feature, created_at desc);

-- Partition-friendly: allow efficient cleanup of old data
create index idx_hub_usage_created on hub_usage_events (created_at);

-- Summary view: per-feature daily counts for the last 30 days
create or replace view hub_usage_summary as
select
  feature,
  action,
  date_trunc('day', created_at)::date as day,
  count(*) as count,
  max(created_at) as last_used
from hub_usage_events
where created_at > now() - interval '30 days'
group by feature, action, date_trunc('day', created_at)::date
order by day desc, count desc;

-- RLS
alter table hub_usage_events enable row level security;
create policy "service_key_only" on hub_usage_events
  for all using (true) with check (true);
