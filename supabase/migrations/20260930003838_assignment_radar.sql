-- Service-only radar storage. Every merge is transactional and protected by a renewable run lease.
create table public.assignment_radar_assignments (
  id uuid primary key, assignment jsonb not null, score jsonb not null,
  first_seen_at timestamptz not null, last_seen_at timestamptz not null
);
create table public.assignment_radar_observations (
  assignment_id uuid not null references public.assignment_radar_assignments(id) on delete cascade,
  source text not null, external_id text not null, url text not null,
  title text not null, customer text, location text, deadline text, start_date text, extent text,
  description text not null, first_seen_at timestamptz not null, last_seen_at timestamptz not null,
  primary key (source, external_id)
);
create index assignment_radar_observation_assignment on public.assignment_radar_observations(assignment_id);
create index assignment_radar_observation_url on public.assignment_radar_observations(url);
create table public.assignment_radar_deliveries (
  assignment_id uuid primary key references public.assignment_radar_assignments(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','uncertain')),
  slack_channel text, slack_ts text, error text, updated_at timestamptz not null default now()
);
create table public.assignment_radar_lease (
  singleton boolean primary key default true check (singleton), token uuid, expires_at timestamptz
);
insert into public.assignment_radar_lease(singleton) values (true);

alter table public.assignment_radar_assignments enable row level security;
alter table public.assignment_radar_observations enable row level security;
alter table public.assignment_radar_deliveries enable row level security;
alter table public.assignment_radar_lease enable row level security;
revoke all on public.assignment_radar_assignments, public.assignment_radar_observations,
  public.assignment_radar_deliveries, public.assignment_radar_lease from anon, authenticated;
grant all on public.assignment_radar_assignments, public.assignment_radar_observations,
  public.assignment_radar_deliveries, public.assignment_radar_lease to service_role;

create function public.assignment_radar_acquire(p_token uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.assignment_radar_lease set token = p_token, expires_at = now() + interval '15 minutes'
  where singleton and (token is null or expires_at < now());
  return found;
end $$;
create function public.assignment_radar_release(p_token uuid) returns void
language sql security invoker set search_path = '' as $$
  update public.assignment_radar_lease set token = null, expires_at = null where singleton and token = p_token;
$$;
create function public.assignment_radar_save(p_token uuid, p_record jsonb, p_new boolean, p_notify boolean) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  a jsonb := p_record->'assignment'; o jsonb; v_id uuid := (p_record->>'id')::uuid;
begin
  update public.assignment_radar_lease set expires_at = now() + interval '15 minutes'
    where singleton and token = p_token and expires_at > now();
  if not found then raise exception 'Radar lease lost'; end if;
  insert into public.assignment_radar_assignments(id, assignment, score, first_seen_at, last_seen_at)
    values (v_id, a, p_record->'score', (a->>'first_seen_at')::timestamptz, (a->>'last_seen_at')::timestamptz)
    on conflict (id) do update set assignment = excluded.assignment, score = excluded.score,
      last_seen_at = excluded.last_seen_at;
  for o in select value from jsonb_array_elements(p_record->'observations') loop
    insert into public.assignment_radar_observations(assignment_id, source, external_id, url, title,
      customer, location, deadline, start_date, extent, description, first_seen_at, last_seen_at)
    values (v_id, o->>'source', o->>'external_id', o->>'url', o->>'title', o->>'customer', o->>'location',
      o->>'deadline', o->>'start_date', o->>'extent', o->>'description',
      (o->>'first_seen_at')::timestamptz, (o->>'last_seen_at')::timestamptz)
    on conflict (source, external_id) do update set url = excluded.url, title = excluded.title,
      customer = excluded.customer, location = excluded.location, deadline = excluded.deadline,
      start_date = excluded.start_date, extent = excluded.extent, description = excluded.description,
      last_seen_at = excluded.last_seen_at
    where public.assignment_radar_observations.assignment_id = excluded.assignment_id;
    if not found then raise exception 'Observation belongs to another assignment'; end if;
  end loop;
  if p_new and p_notify then
    insert into public.assignment_radar_deliveries(assignment_id) values (v_id) on conflict do nothing;
  end if;
end $$;
create function public.assignment_radar_claim(p_token uuid, p_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.assignment_radar_lease set expires_at = now() + interval '15 minutes'
    where singleton and token = p_token and expires_at > now();
  if not found then raise exception 'Radar lease lost'; end if;
  update public.assignment_radar_deliveries set status = 'sending', updated_at = now()
    where assignment_id = p_id and status = 'pending';
  return found;
end $$;
revoke all on function public.assignment_radar_acquire(uuid), public.assignment_radar_release(uuid),
  public.assignment_radar_save(uuid,jsonb,boolean,boolean), public.assignment_radar_claim(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.assignment_radar_acquire(uuid), public.assignment_radar_release(uuid),
  public.assignment_radar_save(uuid,jsonb,boolean,boolean), public.assignment_radar_claim(uuid,uuid) to service_role;
