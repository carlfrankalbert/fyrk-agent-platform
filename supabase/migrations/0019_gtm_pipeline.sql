-- GTM Pipeline: add context/size columns to leads + create pipeline log table

ALTER TABLE leads ADD COLUMN IF NOT EXISTS gtm_context text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_size int;

CREATE TABLE IF NOT EXISTS gtm_pipeline_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_number   int NOT NULL,
  year          int NOT NULL,
  active_calls  int NOT NULL DEFAULT 0,
  offers_sent   int NOT NULL DEFAULT 0,
  paid_days     numeric(6,1),
  folq_inbound  int,
  icp_comments  int,
  pivot_triggers jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_number, year)
);

ALTER TABLE gtm_pipeline_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON gtm_pipeline_log
  FOR ALL USING (auth.role() = 'service_role');
