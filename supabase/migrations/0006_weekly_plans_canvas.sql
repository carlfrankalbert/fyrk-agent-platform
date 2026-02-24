-- Add canvas_id to weekly_plans for Slack Canvas integration
alter table weekly_plans add column if not exists canvas_id text;
