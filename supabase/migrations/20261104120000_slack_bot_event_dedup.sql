-- Event dedup for the FYRK Slack bot (POST /slack/fyrk-bot-events), shared across Fly.io machines.
-- The runtime claims each Slack event_id with INSERT ... ON CONFLICT DO NOTHING; a conflict means another
-- machine (or an earlier delivery) already handled it. Old rows are pruned by the runtime.
create table if not exists public.slack_bot_event_dedup (
  event_id text primary key,
  claimed_at timestamptz not null default now()
);

create index if not exists idx_slack_bot_event_dedup_claimed_at on public.slack_bot_event_dedup (claimed_at);

-- Internal table: service_role only, same as 20261007100000_lock_down_internal_tables.sql.
-- RLS on + no permissive policy + revoked grants = no anon/authenticated access. service_role bypasses RLS.
alter table public.slack_bot_event_dedup enable row level security;
revoke all on table public.slack_bot_event_dedup from anon, authenticated;
grant select, insert, update, delete on table public.slack_bot_event_dedup to service_role;
