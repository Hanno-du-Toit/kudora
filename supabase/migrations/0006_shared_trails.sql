-- 0006_shared_trails.sql — Phase 4: per-path trail sharing
-- Run after 0001–0005. Idempotent. Forward-only (never edit applied files).

-- ── shared_trails: one IMMUTABLE row per (owner, outing, local hunt) ──────────
create table if not exists public.shared_trails (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  group_id       uuid not null references public.hunt_groups(id) on delete cascade,
  local_hunt_id  text not null,
  started_at     timestamptz not null,
  ended_at       timestamptz not null,
  distance_km    double precision not null default 0,
  duration_ms    bigint not null default 0,
  avg_speed_kmh  double precision not null default 0,
  map_type       text not null default 'topo' check (map_type in ('topo', 'satellite')),
  trail_points   jsonb not null,
  created_at     timestamptz not null default now(),
  constraint shared_trail_unique unique (owner_id, group_id, local_hunt_id),
  constraint shared_trail_times check (ended_at >= started_at),
  constraint shared_trail_points_shape check (
    jsonb_typeof(trail_points) = 'array'
    and jsonb_array_length(trail_points) between 2 and 2000
  )
);
create index if not exists shared_trails_group_idx on public.shared_trails (group_id);
create index if not exists shared_trails_owner_idx on public.shared_trails (owner_id);

-- ── shared_waypoints: table + RLS only (capture UI deferred, foundation spec) ─
create table if not exists public.shared_waypoints (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,
  group_id           uuid not null references public.hunt_groups(id) on delete cascade,
  local_waypoint_id  text not null,
  name               text not null check (char_length(name) between 1 and 40),
  type               text not null default 'general'
                     check (type in ('blind', 'water', 'camp', 'sighting', 'general')),
  latitude           double precision not null check (latitude between -90 and 90),
  longitude          double precision not null check (longitude between -180 and 180),
  created_at_client  timestamptz,
  created_at         timestamptz not null default now(),
  constraint shared_waypoint_unique unique (owner_id, group_id, local_waypoint_id),
  constraint shared_waypoint_not_null_island check (not (latitude = 0 and longitude = 0))
);
create index if not exists shared_waypoints_group_idx on public.shared_waypoints (group_id);

-- ── Mandatory CLAUDE.md table policy, then narrow ──────────────────────────────
-- Rows are IMMUTABLE (re-share = delete + insert), so there is deliberately NO
-- UPDATE policy below: with RLS enabled, no policy = default-deny for every role,
-- which is grant-independent — the Phase 3 lesson (Supabase default privileges keep
-- a table-wide UPDATE grant alive) cannot bite because no UPDATE is ever authorized
-- at the policy layer. The revoke is defense-in-depth only.
grant select, insert, delete on public.shared_trails to anon, authenticated;
revoke update on public.shared_trails from anon, authenticated;
alter table public.shared_trails enable row level security;

grant select, insert, delete on public.shared_waypoints to anon, authenticated;
revoke update on public.shared_waypoints from anon, authenticated;
alter table public.shared_waypoints enable row level security;

-- ── RLS: shared_trails ─────────────────────────────────────────────────────────
drop policy if exists shared_trails_select on public.shared_trails;
create policy shared_trails_select on public.shared_trails
  for select using (
    auth.uid() = owner_id
    or public.is_group_member(group_id, auth.uid())
  );

drop policy if exists shared_trails_insert on public.shared_trails;
create policy shared_trails_insert on public.shared_trails
  for insert with check (
    auth.uid() = owner_id
    and public.is_group_member(group_id, auth.uid())
  );

drop policy if exists shared_trails_delete on public.shared_trails;
create policy shared_trails_delete on public.shared_trails
  for delete using (auth.uid() = owner_id);

-- ── RLS: shared_waypoints (same shape) ─────────────────────────────────────────
drop policy if exists shared_waypoints_select on public.shared_waypoints;
create policy shared_waypoints_select on public.shared_waypoints
  for select using (
    auth.uid() = owner_id
    or public.is_group_member(group_id, auth.uid())
  );

drop policy if exists shared_waypoints_insert on public.shared_waypoints;
create policy shared_waypoints_insert on public.shared_waypoints
  for insert with check (
    auth.uid() = owner_id
    and public.is_group_member(group_id, auth.uid())
  );

drop policy if exists shared_waypoints_delete on public.shared_waypoints;
create policy shared_waypoints_delete on public.shared_waypoints
  for delete using (auth.uid() = owner_id);

-- ── Privacy: leaving / being removed takes your shared data with you ───────────
-- (Owner never has a member row; owner exit = group delete → group_id cascade.)
create or replace function public.cleanup_member_shares()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.shared_trails
   where group_id = old.group_id and owner_id = old.user_id;
  delete from public.shared_waypoints
   where group_id = old.group_id and owner_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists group_members_cleanup_shares on public.group_members;
create trigger group_members_cleanup_shares
  after delete on public.group_members
  for each row execute function public.cleanup_member_shares();
