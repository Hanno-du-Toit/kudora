-- 0004_hunt_groups.sql — Phase 3: hunt groups
-- Run after 0001_profiles.sql, 0002_signup_hardening.sql, 0003_friendships.sql. Idempotent.

-- ── Tables ─────────────────────────────────────────────────────────────────────
create table if not exists public.hunt_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint hunt_group_dates check (end_date >= start_date)
);
create index if not exists hunt_groups_owner_idx on public.hunt_groups (owner_id);

create table if not exists public.group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.hunt_groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'invited' check (status in ('invited', 'joined')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint group_member_unique unique (group_id, user_id)
);
create index if not exists group_members_group_idx on public.group_members (group_id);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- ── Mandatory CLAUDE.md table policy ─────────────────────────────────────────
grant select, insert, update, delete on public.hunt_groups to anon, authenticated;
alter table public.hunt_groups enable row level security;

-- group_members: UPDATE restricted to the status column only (accept invite).
-- A full-column grant + accept-only WITH CHECK would let a member rewrite
-- group_id/user_id on their own row (Phase 2 friendships lesson). Column-level
-- UPDATE makes those columns physically unwritable. (Re-running: the revoke
-- undoes the earlier table-wide update grant.)
grant select, insert, delete on public.group_members to anon, authenticated;
revoke update on public.group_members from anon, authenticated;
grant update (status) on public.group_members to authenticated;
alter table public.group_members enable row level security;

-- ── Helpers (SECURITY DEFINER STABLE; recursion-safe like are_friends) ────────
create or replace function public.is_group_owner(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.hunt_groups g where g.id = gid and g.owner_id = uid
  );
$$;
grant execute on function public.is_group_owner(uuid, uuid) to authenticated;

create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.hunt_groups g where g.id = gid and g.owner_id = uid
  ) or exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = uid and m.status = 'joined'
  );
$$;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

-- a and b are both owner/joined in a common group (used by profiles SELECT and
-- by Phase 5 member-position visibility).
create or replace function public.shares_group_with(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.hunt_groups g
    where (g.owner_id = a or exists (
             select 1 from public.group_members m
             where m.group_id = g.id and m.user_id = a and m.status = 'joined'))
      and (g.owner_id = b or exists (
             select 1 from public.group_members m
             where m.group_id = g.id and m.user_id = b and m.status = 'joined'))
  );
$$;
grant execute on function public.shares_group_with(uuid, uuid) to authenticated;

-- ── RLS: hunt_groups ──────────────────────────────────────────────────────────
drop policy if exists hunt_groups_select on public.hunt_groups;
create policy hunt_groups_select on public.hunt_groups
  for select using (public.is_group_member(id, auth.uid()));

drop policy if exists hunt_groups_insert on public.hunt_groups;
create policy hunt_groups_insert on public.hunt_groups
  for insert with check (auth.uid() = owner_id);

-- Owner edits name / dates; WITH CHECK pins owner_id so it cannot be transferred.
drop policy if exists hunt_groups_update on public.hunt_groups;
create policy hunt_groups_update on public.hunt_groups
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists hunt_groups_delete on public.hunt_groups;
create policy hunt_groups_delete on public.hunt_groups
  for delete using (auth.uid() = owner_id);

-- ── RLS: group_members ────────────────────────────────────────────────────────
-- Members see the whole roster; an invitee always sees their own invite row.
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select using (
    public.is_group_member(group_id, auth.uid())
    or auth.uid() = user_id
  );

-- Only the group OWNER invites, only accepted FRIENDS, only as 'invited'.
drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members
  for insert with check (
    auth.uid() = invited_by
    and public.is_group_owner(group_id, auth.uid())
    and status = 'invited'
    and public.are_friends(auth.uid(), user_id)
  );

-- Invitee accepts their own invite: invited → joined (accept-only).
drop policy if exists group_members_update on public.group_members;
create policy group_members_update on public.group_members
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status = 'joined');

-- Leave / decline (self) OR remove (owner).
drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members
  for delete using (
    auth.uid() = user_id
    or public.is_group_owner(group_id, auth.uid())
  );

-- ── updated_at triggers (reuse set_updated_at from 0001) ──────────────────────
drop trigger if exists hunt_groups_set_updated_at on public.hunt_groups;
create trigger hunt_groups_set_updated_at
  before update on public.hunt_groups
  for each row execute function public.set_updated_at();

drop trigger if exists group_members_set_updated_at on public.group_members;
create trigger group_members_set_updated_at
  before update on public.group_members
  for each row execute function public.set_updated_at();

-- ── Final profiles SELECT: self OR accepted friend OR shares a group ──────────
-- (Completes the spec's profiles policy; Phase 2 left a TODO for the group branch.)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    auth.uid() = id
    or public.are_friends(auth.uid(), id)
    or public.shares_group_with(auth.uid(), id)
  );

-- ── RPC: my groups (owner/joined/invited), incl. pending invites ──────────────
-- SECURITY DEFINER so an INVITED (not-yet-joined) user sees the group name/dates
-- (hunt_groups RLS would otherwise hide it until they join). Filtered to caller.
create or replace function public.list_my_groups()
returns table (
  group_id            uuid,
  name                text,
  start_date          date,
  end_date            date,
  owner_id            uuid,
  owner_username      text,
  owner_display_name  text,
  my_status           text,
  member_count        integer,
  created_at          timestamptz
)
language sql security definer stable set search_path = public as $$
  select
    g.id, g.name, g.start_date, g.end_date,
    g.owner_id, op.username, op.display_name,
    case when g.owner_id = auth.uid() then 'owner' else m.status end as my_status,
    (select count(*) from public.group_members gm
       where gm.group_id = g.id and gm.status = 'joined')::int + 1 as member_count,
    g.created_at
  from public.hunt_groups g
  join public.profiles op on op.id = g.owner_id
  left join public.group_members m
    on m.group_id = g.id and m.user_id = auth.uid()
  where g.owner_id = auth.uid() or m.user_id = auth.uid()
  order by g.start_date desc, g.created_at desc;
$$;
grant execute on function public.list_my_groups() to authenticated;

-- ── RPC: full roster for one group (owner + members, incl. still-invited) ─────
-- SECURITY DEFINER so invitees/joined members see everyone's profile fields even
-- when they aren't pairwise friends. Authorized to members + the caller's own invite.
create or replace function public.list_group_members(gid uuid)
returns table (user_id uuid, username text, display_name text, status text, is_me boolean)
language sql security definer stable set search_path = public as $$
  select roster.user_id, roster.username, roster.display_name, roster.status, roster.is_me
  from (
    -- owner (implicit member, no group_members row)
    select g.owner_id as user_id, op.username, op.display_name,
           'owner'::text as status, (g.owner_id = auth.uid()) as is_me
    from public.hunt_groups g
    join public.profiles op on op.id = g.owner_id
    where g.id = gid
    union all
    select m.user_id, mp.username, mp.display_name, m.status, (m.user_id = auth.uid())
    from public.group_members m
    join public.profiles mp on mp.id = m.user_id
    where m.group_id = gid
  ) roster
  where public.is_group_member(gid, auth.uid())
     or exists (select 1 from public.group_members me
                where me.group_id = gid and me.user_id = auth.uid())
  order by case roster.status when 'owner' then 0 when 'joined' then 1 else 2 end,
           roster.username;
$$;
grant execute on function public.list_group_members(uuid) to authenticated;
