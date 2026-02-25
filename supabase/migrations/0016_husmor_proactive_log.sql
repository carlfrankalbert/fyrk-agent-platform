-- Log table for proactive Husmor messages (rate-limiting)
create table if not exists husmor_proactive_log (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  sent_at timestamptz not null default now()
);

create index idx_proactive_log_type_sent on husmor_proactive_log(type, sent_at desc);
