create table if not exists agent_state (
  agent_id text not null,
  key text not null,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (agent_id, key)
);

alter table agent_state enable row level security;

create policy "Service role full access"
  on agent_state
  for all
  using (true)
  with check (true);
