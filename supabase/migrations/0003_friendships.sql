-- 0003_friendships.sql — Phase 2: friend graph
-- Run after 0001_profiles.sql and 0002_signup_hardening.sql. Idempotent.

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint friendship_not_self check (requester_id <> addressee_id)
);

-- One row per unordered pair: blocks A→B and B→A both existing.
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

-- ── Mandatory CLAUDE.md table policy ─────────────────────────────────────────
grant select, insert, update, delete on public.friendships to anon, authenticated;
alter table public.friendships enable row level security;

-- ── RLS ───────────────────────────────────────────────────────────────────────
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select using (auth.uid() in (requester_id, addressee_id));

drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert with check (auth.uid() = requester_id and status = 'pending');

-- Accept only: addressee flips pending → accepted, cannot set any other status.
drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update using (auth.uid() = addressee_id) with check (status = 'accepted');

-- Either party: cancel request / decline / unfriend.
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete using (auth.uid() in (requester_id, addressee_id));

-- ── updated_at trigger (reuses set_updated_at from 0001) ──────────────────────
drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- ── Friendship helper (accepted only) ─────────────────────────────────────────
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a))
  );
$$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ── Broaden profiles SELECT: self OR accepted friend ──────────────────────────
-- (Phase 3 adds the shares_group_with branch.)
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    auth.uid() = id
    or public.are_friends(auth.uid(), id)
  );

-- ── Friends-screen data source ────────────────────────────────────────────────
-- SECURITY DEFINER so a still-PENDING requester's profile fields are returned
-- (profiles RLS would otherwise hide a non-friend). Filtered to the caller.
create or replace function public.list_my_friendships()
returns table (
  id                  uuid,
  other_id            uuid,
  other_username      text,
  other_display_name  text,
  status              text,
  is_incoming         boolean,
  created_at          timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    f.id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
    p.username,
    p.display_name,
    f.status,
    (f.addressee_id = auth.uid() and f.status = 'pending'),
    f.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by f.created_at desc;
$$;

grant execute on function public.list_my_friendships() to authenticated;
