-- Generic persistent character memory (engine only — no character data belongs in migrations).
-- Service-only: character canon and private memories must never be readable by anon/authenticated clients.
create table public.character_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text not null,
  public_profile jsonb not null default '{}',
  private_canon jsonb not null default '{}',
  visual_canon jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Memories are append-mostly: a changed preference/opinion/fact closes the old row (valid_to, status=superseded)
-- and inserts a new current row, so history is preserved. Dates are in-world dates (day precision).
create table public.character_memories (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.character_profiles(id) on delete cascade,
  memory_type text not null check (memory_type in ('preference', 'opinion', 'fact', 'episode')),
  memory_key text not null check (memory_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  value jsonb not null,
  status text not null default 'active' check (status in ('active', 'superseded')),
  locked boolean not null default false,
  confidence numeric(3,2) not null default 1 check (confidence between 0 and 1),
  valid_from date,
  valid_to date,
  occurred_at date,
  superseded_by uuid references public.character_memories(id),
  source text not null check (source in ('bootstrap', 'operator', 'content')),
  source_run_id uuid,
  tags text[] not null default '{}',
  audience_visibility text not null default 'private' check (audience_visibility in ('private', 'public')),
  revealed_at date,
  revealed_source_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((memory_type = 'episode') = (occurred_at is not null)),
  check (memory_type = 'episode' or valid_from is not null),
  check (valid_to is null or valid_to >= valid_from),
  check (audience_visibility = 'public' or revealed_at is null)
);
-- Exactly one current value per non-episode key; episodes are unique per key and day.
create unique index character_memories_one_current on public.character_memories(character_id, memory_key)
  where status = 'active' and memory_type <> 'episode';
create unique index character_memories_episode_once on public.character_memories(character_id, memory_key, occurred_at)
  where memory_type = 'episode';
create index character_memories_lookup on public.character_memories(character_id, memory_type, memory_key);

alter table public.character_profiles enable row level security;
alter table public.character_memories enable row level security;
revoke all on public.character_profiles, public.character_memories from anon, authenticated;
grant all on public.character_profiles, public.character_memories to service_role;

-- Atomically close the current value for a key and insert its replacement.
create function public.character_memory_supersede(p_previous_id uuid, p_memory jsonb, p_allow_locked boolean default false)
returns public.character_memories
language plpgsql security invoker set search_path = '' as $$
declare
  prev public.character_memories;
  created public.character_memories;
  v_from date := (p_memory->>'valid_from')::date;
begin
  select * into prev from public.character_memories where id = p_previous_id for update;
  if not found then raise exception 'Memory to supersede not found'; end if;
  if prev.status <> 'active' then raise exception 'Memory is no longer current'; end if;
  if prev.locked and not p_allow_locked then raise exception 'Memory is locked canon'; end if;
  if prev.memory_type = 'episode' then raise exception 'Episodes cannot be superseded'; end if;
  if (p_memory->>'character_id')::uuid <> prev.character_id or p_memory->>'memory_key' <> prev.memory_key then
    raise exception 'Supersede must target the same character and key';
  end if;
  if v_from is null or v_from < prev.valid_from then raise exception 'New value must start on or after the current value'; end if;

  update public.character_memories set status = 'superseded', valid_to = v_from, updated_at = now() where id = prev.id;
  insert into public.character_memories(character_id, memory_type, memory_key, value, locked, confidence,
    valid_from, source, source_run_id, tags, audience_visibility)
  values (prev.character_id, p_memory->>'memory_type', prev.memory_key, p_memory->'value',
    coalesce((p_memory->>'locked')::boolean, false), coalesce((p_memory->>'confidence')::numeric, 1),
    v_from, p_memory->>'source', (p_memory->>'source_run_id')::uuid,
    coalesce(array(select jsonb_array_elements_text(p_memory->'tags')), '{}'),
    coalesce(p_memory->>'audience_visibility', 'private'))
  returning * into created;
  update public.character_memories set superseded_by = created.id where id = prev.id;
  return created;
end $$;

revoke all on function public.character_memory_supersede(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.character_memory_supersede(uuid, jsonb, boolean) to service_role;
