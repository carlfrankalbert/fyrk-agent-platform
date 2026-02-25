-- Event dedup table for Husmor Slack events (shared across Fly.io machines)
create table if not exists husmor_event_dedup (
  event_ts text primary key,
  claimed_at timestamptz not null default now()
);

-- Auto-cleanup index: rows older than 5 minutes
create index idx_husmor_dedup_claimed on husmor_event_dedup(claimed_at);
