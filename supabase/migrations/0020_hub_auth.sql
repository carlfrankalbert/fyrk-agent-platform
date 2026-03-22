-- Hub webapp auth: magic link via 6-digit code

create table if not exists hub_allowed_emails (
  email text primary key,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists hub_sessions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Login codes (short-lived, 10 min)
create table if not exists hub_login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_hub_sessions_token on hub_sessions(token);
create index idx_hub_sessions_expires on hub_sessions(expires_at);
create index idx_hub_login_codes_email on hub_login_codes(email, code);

-- RLS (service role full access)
alter table hub_allowed_emails enable row level security;
alter table hub_sessions enable row level security;
alter table hub_login_codes enable row level security;

create policy "Service role access" on hub_allowed_emails for all using (true) with check (true);
create policy "Service role access" on hub_sessions for all using (true) with check (true);
create policy "Service role access" on hub_login_codes for all using (true) with check (true);
