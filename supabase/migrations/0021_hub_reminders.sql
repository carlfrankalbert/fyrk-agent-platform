-- Hub reminders: recurring or one-off reminders shown on the dashboard
create table if not exists hub_reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text not null default '📌',
  -- Recurrence: 'daily', 'weekdays', 'weekends', or comma-separated day numbers '1,3,5' (1=Mon)
  recurrence text not null default 'daily',
  active boolean not null default true,
  created_by text references hub_allowed_emails(email),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hub_reminders enable row level security;
create policy "Service role full access on hub_reminders"
  on hub_reminders for all using (true) with check (true);

-- Seed some default reminders
insert into hub_reminders (title, emoji, recurrence) values
  ('Gympose', '🎒', 'weekdays'),
  ('Søppel ut', '🗑️', '3'),
  ('Nøkler', '🔑', 'daily');
