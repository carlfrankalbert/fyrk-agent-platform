-- Enable Row Level Security on public tables
-- The runtime uses the service_role key which bypasses RLS,
-- so no explicit policies are needed for the backend.

alter table public.agent_runs enable row level security;
alter table public.artifacts enable row level security;
