-- 0007_member_positions.sql — Phase 5: live position + safety
-- Run after 0001–0006. Idempotent. Forward-only (never edit applied files).

-- ── member_positions: ONE row per user (upsert) ────────────────────────────────
create table if not exists public.member_positions (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  accuracy    double precision,
  is_moving   boolean not null default true,
  updated_at  timestamptz not null default now(),
  constraint member_positions_not_null_island check (not (latitude = 0 and longitude = 0))
);
create index if not exists member_positions_updated_at_idx on public.member_positions (updated_at);

-- ── Mandatory CLAUDE.md table policy, then narrow ──────────────────────────────
grant select, insert, update, delete on public.member_positions to anon, authenticated;
alter table public.member_positions enable row level security;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Own row, or anyone you share an outing with (reuses the Phase 3 helper as-is).
drop policy if exists member_positions_select on public.member_positions;
create policy member_positions_select on public.member_positions
  for select using (
    auth.uid() = user_id
    or public.shares_group_with(auth.uid(), user_id)
  );

drop policy if exists member_positions_insert on public.member_positions;
create policy member_positions_insert on public.member_positions
  for insert with check (auth.uid() = user_id);

-- Single-owner row (unlike friendships/group_members there is no two-party
-- record to protect a column from) — a plain owner-only UPDATE policy is
-- sufficient, no column-restriction trigger needed (Phase 3 lesson doesn't
-- apply here).
drop policy if exists member_positions_update on public.member_positions;
create policy member_positions_update on public.member_positions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists member_positions_delete on public.member_positions;
create policy member_positions_delete on public.member_positions
  for delete using (auth.uid() = user_id);

-- ── Realtime: RLS applies to the change stream too ─────────────────────────────
-- Use a DO block for idempotency (IF NOT EXISTS is not valid in ALTER PUBLICATION grammar).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_positions'
  ) then
    alter publication supabase_realtime add table public.member_positions;
  end if;
end $$;
