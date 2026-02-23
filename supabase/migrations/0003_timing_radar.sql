-- FYRK Timing Radar - Phase 1 Schema
-- Target accounts, leads with 5-dimension scoring, calibration, and scoring adjustments

-- Companies FYRK wants to work with
create table if not exists target_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique,
  industry text,
  segment text,           -- e.g. 'enterprise', 'scaleup', 'startup'
  tier text default 'B',  -- A, B, C priority
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Observed triggers (new CPO hire, etc.) with 5-dimension scoring
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references target_accounts(id) on delete set null,

  -- Who & what
  person_name text not null,
  person_role text not null,
  person_linkedin text,
  company_name text not null,
  company_domain text,
  trigger_type text not null,        -- e.g. 'new_hire', 'promotion', 'reorg'
  trigger_description text,
  source_url text,

  -- 5-dimension scoring
  score_fit integer not null default 0 check (score_fit between 0 and 30),
  score_trigger integer not null default 0 check (score_trigger between 0 and 25),
  score_timing integer not null default 0 check (score_timing between 0 and 20),
  score_authority integer not null default 0 check (score_authority between 0 and 15),
  score_intent integer not null default 0 check (score_intent between 0 and 10),
  score_total integer generated always as (
    score_fit + score_trigger + score_timing + score_authority + score_intent
  ) stored,

  -- Outreach context
  why_now text,
  recommended_action text,
  angle text,

  -- Status & workflow
  status text not null default 'new',  -- new, planned, contacted, warm, cold_good_account, not_relevant
  contacted_at timestamptz,
  slack_message_ts text,
  slack_channel text,

  -- Deduplication
  dedupe_key text unique,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Learning log for what works / doesn't work
create table if not exists calibration_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  action text not null,        -- e.g. 'marked_not_relevant', 'marked_warm', 'contacted'
  feedback text,               -- free-text notes
  previous_status text,
  new_status text,
  created_at timestamptz default now()
);

-- Weight adjustments based on calibration
create table if not exists scoring_adjustments (
  id uuid primary key default gen_random_uuid(),
  dimension text not null,     -- score_fit, score_trigger, etc.
  adjustment_type text not null, -- e.g. 'weight_change', 'threshold_change'
  old_value numeric,
  new_value numeric,
  reason text,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_leads_status on leads(status);
create index if not exists idx_leads_score_total on leads(score_total);
create index if not exists idx_leads_dedupe_key on leads(dedupe_key);
create index if not exists idx_leads_account_id on leads(account_id);
create index if not exists idx_leads_company_domain on leads(company_domain);
create index if not exists idx_leads_slack_message_ts on leads(slack_message_ts);
create index if not exists idx_target_accounts_domain on target_accounts(domain);
create index if not exists idx_calibration_log_lead_id on calibration_log(lead_id);

-- Enable RLS (service_role key bypasses)
alter table target_accounts enable row level security;
alter table leads enable row level security;
alter table calibration_log enable row level security;
alter table scoring_adjustments enable row level security;

-- Comments
comment on table target_accounts is 'Companies FYRK wants to work with';
comment on table leads is 'Observed triggers (new CPO hire, etc.) with 5-dimension scoring';
comment on table calibration_log is 'Learning log for lead feedback and calibration';
comment on table scoring_adjustments is 'Weight adjustments based on calibration feedback';
comment on column leads.score_total is 'Auto-computed sum of all 5 scoring dimensions (max 100)';
comment on column leads.dedupe_key is 'Unique key to prevent duplicate leads (e.g. person+company+trigger)';
