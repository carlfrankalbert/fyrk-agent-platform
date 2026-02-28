-- Web chat conversations for Husmor
create table husmor_web_conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table husmor_web_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references husmor_web_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_web_messages_conversation
  on husmor_web_messages(conversation_id, created_at);

-- RLS: service role has full access
alter table husmor_web_conversations enable row level security;
alter table husmor_web_messages enable row level security;

create policy "Service role full access on husmor_web_conversations"
  on husmor_web_conversations for all
  using (true) with check (true);

create policy "Service role full access on husmor_web_messages"
  on husmor_web_messages for all
  using (true) with check (true);
