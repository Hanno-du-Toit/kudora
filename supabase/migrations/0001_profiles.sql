-- 0001_profiles.sql — Phase 1: accounts + profiles

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text not null,
  display_name    text not null,
  safety_range_m  integer not null default 5000,
  warning_range_m integer not null default 300,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,20}$')
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- ── Mandatory CLAUDE.md table policy ─────────────────────────────────────────
grant select, insert, update, delete on public.profiles to anon, authenticated;
alter table public.profiles enable row level security;

-- ── RLS: self-only in Phase 1 (Phases 2/3 broaden SELECT to friends/group) ───
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ── Exact-match lookup RPC (bypasses RLS so it cannot be used to enumerate) ───
create or replace function public.find_user_by_username(handle text)
returns table (id uuid, username text, display_name text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where p.username = lower(handle)
  limit 1;
$$;

grant execute on function public.find_user_by_username(text) to anon, authenticated;

-- ── Auto-create the profile row on signup (atomic with auth.users insert) ─────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    coalesce(new.raw_user_meta_data->>'display_name',
             new.raw_user_meta_data->>'username')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Keep updated_at fresh ─────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
