# Phase 3 — Hunt Groups Implementation Plan

> **Status: ✅ COMPLETE (2026-07-02).** All 5 tasks built and device-verified on two
> accounts (create / invite / accept / decline / roster / end-date edit / leave /
> remove / delete). Completion review done: phase Security Review PASS; final
> whole-phase code review "Ready to merge: Yes". Status-only trigger forge test run
> in the Supabase SQL editor — all rows PASS (both triggers block group_id/user_id/
> pair rewrites; legit status flips allowed). Close-out: `0005` migration revokes
> `find_user_by_username` from anon (Phase 1 oracle) and adds boolean-only
> `username_available` so the pre-auth signup check keeps working; "outing" copy
> sweep; known decision recorded in CLAUDE.md (pending invite survives un-friending
> — accepted at family scale).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create a multi-day hunt group, invite **accepted friends only**, accept/decline invites, see the member roster, and leave/remove/delete — a confirmed group-membership graph that Phase 4 (path sharing) and Phase 5 (live position) build on ("only members see each other's trails/positions").

**Architecture:** Two new tables — `hunt_groups` (owner-owned, with a `start_date`/`end_date` range) and `group_members` (one row per invitee, `invited → joined`). The owner is the **implicit** member (no self-row); `group_members` rows are only the people the owner invited. RLS scopes every row to group members, and three `SECURITY DEFINER STABLE` helpers (`is_group_owner`, `is_group_member`, `shares_group_with`) back the policies and the now-final `profiles` SELECT (self **or** accepted friend **or** shares a group) without policy self-recursion. Two `SECURITY DEFINER` RPCs drive the UI: `list_my_groups()` (groups I own/joined/am-invited-to, including pending invites whose group row RLS would otherwise hide) and `list_group_members(gid)` (the full roster incl. still-invited people). Mutations go straight to the tables under RLS. Group is reached as a new **bottom-tab** with its own native-stack (`GroupMain → GroupDetail`), mirroring the Phase 2 `ProfileStack`.

**Tech Stack:** Expo SDK 54, React Native 0.81, `@supabase/supabase-js` v2, `@react-navigation/native` v7 + `@react-navigation/native-stack` v7 (**already installed in Phase 2** — no new dependency), `@react-native-community/datetimepicker` (**new — bundled in Expo Go, added in Task 4 via `npx expo install`**), `react-native-safe-area-context`, `@expo/vector-icons` (all already installed), AsyncStorage (Supabase session, already configured).

## Decision (date entry) — RESOLVED: native calendar picker

The owner picks `start_date` and `end_date` with **`@react-native-community/datetimepicker`** (chosen 2026-06-29). It is bundled in the Expo Go runtime, so it works on device with no custom dev client, and `npx expo install` pins an SDK-54-compatible version. The create form (Task 4) uses two `display="compact"` iOS pickers (Start / Ends, with the end picker's `minimumDate` pinned to the chosen start); the hunt detail (Task 5) uses one compact picker for the owner to change the end date. Dates are converted to the Postgres `date` type as `'YYYY-MM-DD'` via `toISODate` (and back via `parseISODate`).

## Global Constraints

- **Offline-first is not violated here:** groups are inherently online (you need signal to create/invite/accept), exactly like Friends. No existing local GPS/hunt flow is touched. Every group action shows a loading state and a friendly "no signal" error; nothing blocks the app.
- **Public repo:** no secrets, emails, or personal data committed. Only `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` via `process.env` (already in place).
- **Every new table:** `GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO anon, authenticated;` then `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` (CLAUDE.md mandatory policy). Where a column-level UPDATE is tighter (see `group_members`), we narrow `UPDATE` after granting — this is stricter than the floor, not looser.
- **RLS predicates that reference other tables run through `SECURITY DEFINER STABLE` helpers** (`is_group_owner`, `is_group_member`, `shares_group_with`) so policies never self-reference (Supabase recursion gotcha). Helpers only *check* membership, never bypass it for writes.
- **`group_members` UPDATE is restricted to `status` only** — the Phase 2 friendships lesson: a member must not be able to rewrite `group_id`/`user_id` on their own row. Enforced by a `BEFORE UPDATE` trigger (`group_members_status_only`) that rejects any non-`status` column change — this is the **authoritative** guard, because a plain `revoke update ... from anon, authenticated` does NOT reliably strip the table-wide UPDATE that Supabase default privileges auto-grant on new public tables (different grantor → silent no-op). The `revoke` + `grant update (status)` are kept as defense-in-depth.
- **Group invariants (from spec):** `hunt_groups`: `end_date >= start_date` (CHECK), owner-only INSERT/UPDATE/DELETE, member-only SELECT. `group_members`: `status ∈ {invited, joined}`; **unique (group_id, user_id)**; INSERT = group **owner** only AND `are_friends(owner, user_id)` AND `status = 'invited'`; UPDATE = the invitee only, accept-only (`WITH CHECK status='joined'`); DELETE = the member themselves (leave/decline) OR the owner (remove); SELECT = group member OR your own invite row.
- **No enumeration:** invites are sent to a `user_id` chosen from your **own accepted-friends list** (reuses `listFriendships()` from Phase 2). The user base is never scraped; `profiles` is never globally selectable.
- **Migration numbering:** next file is `0004_hunt_groups.sql` (`0001`–`0003` already exist and have been run).
- **Branch / push:** work continues on `main-CleanVersion`; commit + push to `origin/main-CleanVersion` after every task (CLAUDE.md push policy).
- **Verification model (same as Phases 1–2):** no automated test harness exists in this repo and none is added here. Verification is **Supabase SQL editor** for schema/RLS (two test users) + **Expo Go on two devices/accounts** for the app flow. Pure functions (date helpers, error mapper, validator) get a one-off `node` check. **Do not add jest/testing-library.**
- **Colours / UI:** primary action green `#5FCE5F` (`GREEN`); danger red `#E24B4A` (`RED_STOP`); surfaces/text via `useTheme()` (`T.*`). Min tap target 44×44. (Constants in `src/constants/themes.js`.)
- **Sensitive feature:** group membership + access control + final `profiles` broadening, so the **Security Review skill** runs at the end (see Completion). The spec flags phases 1/4/5 for Security Review; Phase 3 is added because it introduces the membership access-control surface every later phase trusts.

---

## File Structure

- `supabase/migrations/0004_hunt_groups.sql` — **create**: `hunt_groups` + `group_members` tables + RLS, `is_group_owner` / `is_group_member` / `shares_group_with` helpers, `list_my_groups` + `list_group_members` RPCs, final broadened `profiles` SELECT, `updated_at` triggers (reuse `set_updated_at` from 0001).
- `src/utils/dates.js` — **create**: pure `toISODate`, `parseISODate`, `addDays`, `formatDateShort` (node-testable, no RN imports).
- `src/services/groups.js` — **create**: `listMyGroups`, `listGroupMembers`, `createGroup`, `updateGroupEndDate`, `deleteGroup`, `inviteFriend`, `acceptInvite`, `leaveGroup`, `removeMember`.
- `src/utils/groupErrors.js` — **create**: pure `friendlyGroupError(error)` mapper (mirrors `friendErrors.js`).
- `src/utils/validators.js` — **modify**: add pure `validateGroupName(raw)` alongside `validateUsername`.
- `src/screens/GroupScreen.js` — **create**: create-hunt form + invitations + your-hunts list (placeholder in Task 3, built out in Task 4).
- `src/screens/GroupDetailScreen.js` — **create**: roster, invite-friend picker (owner), extend end date (owner), leave (member) / remove (owner) / delete (owner) (placeholder in Task 3, built out in Task 5).
- `App.js` — **modify**: add a `GroupStack` (native-stack: `GroupMain → GroupDetail`) and a **Group** bottom tab between Sessions and Profile; auth gate and other tabs untouched.

> Navigation note: tabs become **Map / Sessions / Group / Profile** (the spec's target). The Friends sub-screen stays under Profile.

---

## Task 1: Database migration — hunt_groups, group_members, helpers, RPCs, final profiles SELECT

**Files:**
- Create: `supabase/migrations/0004_hunt_groups.sql`

**Interfaces:**
- Produces: tables `public.hunt_groups(id, name, owner_id, start_date, end_date, created_at, updated_at)` and `public.group_members(id, group_id, user_id, status, invited_by, created_at, updated_at)`; helpers `is_group_owner(gid uuid, uid uuid) → bool`, `is_group_member(gid uuid, uid uuid) → bool`, `shares_group_with(a uuid, b uuid) → bool`; RPC `list_my_groups() → setof (group_id, name, start_date, end_date, owner_id, owner_username, owner_display_name, my_status, member_count, created_at)`; RPC `list_group_members(gid uuid) → setof (user_id, username, display_name, status, is_me)`; final `profiles` SELECT (self/friend/group).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0004_hunt_groups.sql`:

```sql
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

-- group_members: only the `status` column may be UPDATEd (an invitee flips
-- invited→joined); group_id/user_id must stay immutable or a member could rewrite
-- their row onto another group/user and forge membership (Phase 2 friendships
-- lesson). IMPORTANT: a plain `revoke update ... from anon, authenticated` does NOT
-- reliably strip the TABLE-WIDE update grant that Supabase default privileges
-- auto-apply to every new public table — that grant's grantor differs from this
-- role, so the revoke is a silent no-op and the column grant ends up shadowed. The
-- BEFORE UPDATE trigger further down (group_members_status_only) is therefore the
-- AUTHORITATIVE guard; the revoke + column grant are kept only as defense-in-depth.
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

-- ── AUTHORITATIVE column guard: only `status` may change on group_members ─────
-- Grant-independent enforcement of status-only UPDATE (see the grants note above):
-- rejects any rewrite of the identity/immutable columns even if a table-wide UPDATE
-- grant survives Supabase's default privileges. The legitimate accept
-- (status: invited→joined) is unaffected.
create or replace function public.enforce_group_member_status_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id
     or new.group_id is distinct from old.group_id
     or new.user_id is distinct from old.user_id
     or new.invited_by is distinct from old.invited_by
     or new.created_at is distinct from old.created_at then
    raise exception 'group_members: only status may be updated (group_id/user_id are immutable)';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_status_only on public.group_members;
create trigger group_members_status_only
  before update on public.group_members
  for each row execute function public.enforce_group_member_status_only();

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
-- SECURITY DEFINER so joined members see everyone's profile fields even when they
-- aren't pairwise friends. Authorized to MEMBERS ONLY (owner + joined): an invited
-- user reads the hunt name/dates/inviter via list_my_groups to decide, but cannot
-- enumerate the roster (incl. other pending invitees) until they accept.
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
  order by case roster.status when 'owner' then 0 when 'joined' then 1 else 2 end,
           roster.username;
$$;
grant execute on function public.list_group_members(uuid) to authenticated;
```

- [ ] **Step 2: Run the migration**

In the Supabase dashboard → **SQL Editor**, paste the full contents of `0004_hunt_groups.sql` and run it. Expected: "Success. No rows returned."

- [ ] **Step 3: Verify schema + RLS objects exist (SQL editor)**

Run:

```sql
select tablename, rowsecurity from pg_tables where tablename in ('hunt_groups', 'group_members');
select tablename, polname, cmd from pg_policies
  where tablename in ('hunt_groups', 'group_members', 'profiles') order by tablename, polname;
select proname from pg_proc
  where proname in ('is_group_owner', 'is_group_member', 'shares_group_with', 'list_my_groups', 'list_group_members');
-- Confirm group_members UPDATE is column-restricted to status:
select privilege_type, column_name from information_schema.column_privileges
  where table_name = 'group_members' and privilege_type = 'UPDATE';
```

Expected: both tables `rowsecurity = true`; 4 `hunt_groups_*` policies + 4 `group_members_*` policies + 1 `profiles_select`; all five functions present; the column-privilege query lists `UPDATE` for **`status` only** (not `group_id`/`user_id`).

- [ ] **Step 4: Verify RLS behaviour with two users (SQL editor)**

Use two real `auth.users` ids that are **already accepted friends** (from Phase 2 testing). Replace `:owner` / `:friend` with their uuids, and `:stranger` with a third uuid that is NOT a friend of `:owner`.

```sql
-- As OWNER: create a group
set local role authenticated;
set local request.jwt.claim.sub = ':owner';
insert into public.hunt_groups (name, owner_id, start_date, end_date)
  values ('Test hunt', ':owner', current_date, current_date + 2)
  returning id;  -- note the returned id as :gid

-- As OWNER: invite the friend (allowed)
insert into public.group_members (group_id, user_id, invited_by, status)
  values (':gid', ':friend', ':owner', 'invited');

-- As OWNER: inviting a NON-friend must fail (are_friends false → RLS violation)
insert into public.group_members (group_id, user_id, invited_by, status)
  values (':gid', ':stranger', ':owner', 'invited');   -- expect: RLS violation (42501)

-- As FRIEND: list shows the group with my_status = 'invited' and the owner's name
set local request.jwt.claim.sub = ':friend';
select name, my_status, owner_username from public.list_my_groups();   -- expect 1 row, invited

-- As FRIEND: cannot yet read the group row directly (not joined)
select count(*) from public.hunt_groups where id = ':gid';            -- expect 0

-- As FRIEND: accept (invited → joined)
update public.group_members set status = 'joined'
  where group_id = ':gid' and user_id = ':friend';

-- As FRIEND: now the group row is visible (is_group_member true)
select count(*) from public.hunt_groups where id = ':gid';            -- expect 1

-- As FRIEND: cannot invite anyone (not the owner → RLS violation)
insert into public.group_members (group_id, user_id, invited_by, status)
  values (':gid', ':stranger', ':friend', 'invited');                 -- expect: RLS violation

-- As STRANGER: sees nothing of this group
set local request.jwt.claim.sub = ':stranger';
select count(*) from public.hunt_groups where id = ':gid';            -- expect 0
select count(*) from public.list_my_groups()
  where group_id = ':gid';                                            -- expect 0

-- As OWNER + FRIEND now share a group → can read each other's profile
set local request.jwt.claim.sub = ':friend';
select count(*) from public.profiles where id = ':owner';            -- expect 1
```

Expected results are noted inline. Clean up afterward (as owner): `delete from public.hunt_groups where id = ':gid';` (cascades members).

- [ ] **Step 5: Commit + push**

```bash
git add supabase/migrations/0004_hunt_groups.sql
git commit -m "feat: hunt_groups + group_members tables, RLS, helpers and list RPCs (phase 3)"
git push origin main-CleanVersion
```

---

## Task 2: Date helpers, groups service, error mapper, group-name validator

**Files:**
- Create: `src/utils/dates.js`
- Create: `src/services/groups.js`
- Create: `src/utils/groupErrors.js`
- Modify: `src/utils/validators.js`

**Interfaces:**
- Consumes: `supabase` from `src/services/supabase.js`; RPCs `list_my_groups()` / `list_group_members(gid)` (Task 1); tables `hunt_groups`, `group_members`.
- Produces:
  - `toISODate(d: Date) → 'YYYY-MM-DD'`, `parseISODate(iso: string) → Date`, `addDays(d: Date, n: number) → Date`, `formatDateShort(d: Date) → string`.
  - `validateGroupName(raw) → { ok: true, value } | { ok: false, error }`.
  - `listMyGroups() → Promise<Array<{ group_id, name, start_date, end_date, owner_id, owner_username, owner_display_name, my_status, member_count, created_at }>>`
  - `listGroupMembers(groupId) → Promise<Array<{ user_id, username, display_name, status, is_me }>>`
  - `createGroup({ name, startDate, endDate }) → Promise<{ id, name, start_date, end_date, owner_id }>`
  - `updateGroupEndDate(groupId, endDate) → Promise<void>`; `deleteGroup(groupId) → Promise<void>`
  - `inviteFriend(groupId, userId) → Promise<void>` (throws `.code === 'ALREADY_MEMBER'` on duplicate)
  - `acceptInvite(groupId) → Promise<void>`; `leaveGroup(groupId) → Promise<void>`; `removeMember(groupId, userId) → Promise<void>`
  - `friendlyGroupError(error) → string`
  - service errors carry `.code` of `'NOT_SIGNED_IN'` or `'ALREADY_MEMBER'` for the cases the UI maps.

- [ ] **Step 1: Write `src/utils/dates.js`**

```javascript
// Pure date helpers — no RN imports so they're trivially node-testable.
// All operate in LOCAL time and map to/from the Postgres `date` type ('YYYY-MM-DD').

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso) {
  const [y, m, d] = (iso ?? '').split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d, n) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

export function formatDateShort(d) {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
```

- [ ] **Step 2: Quick-check the date helpers with node**

Run:

```bash
node --input-type=module -e "import {toISODate,parseISODate,addDays} from './src/utils/dates.js'; const s=new Date(2026,5,29); console.log(toISODate(s)==='2026-06-29', toISODate(addDays(s,2))==='2026-07-01', toISODate(parseISODate('2026-07-01'))==='2026-07-01', toISODate(addDays(parseISODate('2026-12-31'),1))==='2027-01-01');"
```

Expected: `true true true true`.

- [ ] **Step 3: Add `validateGroupName` to `src/utils/validators.js`**

Append (after `validateUsername`):

```javascript
export function validateGroupName(raw) {
  const name = (raw ?? '').trim();
  if (name.length === 0) return { ok: false, error: 'Name the hunt' };
  if (name.length > 40) return { ok: false, error: 'At most 40 characters' };
  return { ok: true, value: name };
}
```

- [ ] **Step 4: Write `src/utils/groupErrors.js`**

```javascript
// Pure mapper from a thrown groups-service error to user-facing copy.
// No RN/Supabase imports so it's trivially node-checkable. Mirrors friendErrors.js.
export function friendlyGroupError(error) {
  switch (error?.code) {
    case 'NOT_SIGNED_IN':  return 'You are signed out — log in again';
    case 'ALREADY_MEMBER': return 'Already invited or a member';
    default: break;
  }
  // Postgres RLS violation (e.g. inviting a non-friend, acting without permission).
  if (error?.code === '42501') return 'You do not have permission for that';
  const m = (error?.message || '').toLowerCase();
  if (m.includes('network') || m.includes('fetch'))
    return 'No signal — try again when you have a connection';
  return error?.message || 'Something went wrong';
}
```

- [ ] **Step 5: Quick-check the mapper with node**

Run:

```bash
node --input-type=module -e "import {friendlyGroupError} from './src/utils/groupErrors.js'; console.log(friendlyGroupError({code:'ALREADY_MEMBER'})==='Already invited or a member', friendlyGroupError({code:'42501'})==='You do not have permission for that', friendlyGroupError({message:'Network request failed'}).startsWith('No signal'), friendlyGroupError({})==='Something went wrong');"
```

Expected: `true true true true`.

- [ ] **Step 6: Write `src/services/groups.js`**

```javascript
import { supabase } from './supabase';

function tagged(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw tagged('NOT_SIGNED_IN', 'Not signed in');
  return data.user;
}

// Groups I own / joined / am invited to (incl. pending invites). Powers GroupScreen.
export async function listMyGroups() {
  const { data, error } = await supabase.rpc('list_my_groups');
  if (error) throw error;
  return data ?? [];
}

// Full roster (owner + members) for one group. Caller must be a member/invitee.
export async function listGroupMembers(groupId) {
  const { data, error } = await supabase.rpc('list_group_members', { gid: groupId });
  if (error) throw error;
  return data ?? [];
}

// Owner-only create. Dates are 'YYYY-MM-DD' strings.
export async function createGroup({ name, startDate, endDate }) {
  const user = await requireUser();
  const { data, error } = await supabase
    .from('hunt_groups')
    .insert({ name, owner_id: user.id, start_date: startDate, end_date: endDate })
    .select('id, name, start_date, end_date, owner_id')
    .single();
  if (error) throw error;
  return data;
}

// Owner-only: move the end date (DB CHECK forbids before start_date). 'YYYY-MM-DD'.
export async function updateGroupEndDate(groupId, endDate) {
  const { error } = await supabase
    .from('hunt_groups')
    .update({ end_date: endDate })
    .eq('id', groupId);
  if (error) throw error;
}

// Owner-only delete (cascades members).
export async function deleteGroup(groupId) {
  const { error } = await supabase.from('hunt_groups').delete().eq('id', groupId);
  if (error) throw error;
}

// Owner invites a friend (RLS enforces owner + friends-only + 'invited').
export async function inviteFriend(groupId, userId) {
  const user = await requireUser();
  const { error } = await supabase.from('group_members').insert({
    group_id: groupId, user_id: userId, invited_by: user.id, status: 'invited',
  });
  if (error) {
    if (error.code === '23505') throw tagged('ALREADY_MEMBER', 'Already invited or a member');
    throw error;
  }
}

// Invitee accepts: invited → joined (RLS: own row, accept-only).
export async function acceptInvite(groupId) {
  const user = await requireUser();
  const { error } = await supabase
    .from('group_members')
    .update({ status: 'joined' })
    .eq('group_id', groupId)
    .eq('user_id', user.id);
  if (error) throw error;
}

// Leave / decline (self). RLS: own row.
export async function leaveGroup(groupId) {
  const user = await requireUser();
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', user.id);
  if (error) throw error;
}

// Owner removes a member.
export async function removeMember(groupId, userId) {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}
```

- [ ] **Step 7: Verify the service imports cleanly (no syntax errors)**

Run:

```bash
node --check src/services/groups.js
```

Expected: no output, exit 0. (Matches the Phase 1/2 service check — `--check` parses but does not execute the ESM import.)

- [ ] **Step 8: Commit + push**

```bash
git add src/utils/dates.js src/utils/groupErrors.js src/utils/validators.js src/services/groups.js
git commit -m "feat: groups service, date helpers, group error mapper and name validator (phase 3)"
git push origin main-CleanVersion
```

---

## Task 3: Navigation scaffold — Group tab + GroupStack + screen placeholders

**Files:**
- Modify: `App.js`
- Create: `src/screens/GroupScreen.js` (placeholder this task; built out in Task 4)
- Create: `src/screens/GroupDetailScreen.js` (placeholder this task; built out in Task 5)

**Interfaces:**
- Consumes: nothing new from earlier tasks (wiring only).
- Produces: a reachable **Group** tab whose stack is `GroupMain` (`GroupScreen`) → `GroupDetail` (`GroupDetailScreen`); `GroupScreen` receives `navigation`; `GroupDetailScreen` receives `route.params = { groupId, name, ownerId, myStatus }`.

- [ ] **Step 1: Create the placeholder `src/screens/GroupScreen.js`**

Replaced wholesale in Task 4 — it exists now only so the route registers.

```javascript
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../store/ThemeContext';

export default function GroupScreen() {
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.root, { backgroundColor: T.bg, paddingTop: insets.top + 24 }]}>
      <Text style={{ color: T.textDim }}>Hunts</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Create the placeholder `src/screens/GroupDetailScreen.js`**

Replaced wholesale in Task 5.

```javascript
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../store/ThemeContext';

export default function GroupDetailScreen({ route }) {
  const { T } = useTheme();
  return (
    <View style={[st.root, { backgroundColor: T.bg }]}>
      <Text style={{ color: T.textDim }}>{route?.params?.name ?? 'Hunt'}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 3: Add the GroupStack and Group tab in `App.js`**

Add the imports near the other screen imports:

```javascript
import GroupScreen from './src/screens/GroupScreen';
import GroupDetailScreen from './src/screens/GroupDetailScreen';
```

Add the stack navigator next to `const ProfileStack = ...`:

```javascript
const GroupStack = createNativeStackNavigator();
```

Add `GroupStackScreen` above `ThemedTabs` (mirrors `ProfileStackScreen`; the detail header shows the group name and a "Hunts" back label):

```javascript
function GroupStackScreen() {
  const { T } = useTheme();
  return (
    <GroupStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: T.headerBg },
        headerTintColor: T.headerText,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: T.bg },
      }}
    >
      <GroupStack.Screen
        name="GroupMain"
        component={GroupScreen}
        options={{ headerShown: false, title: 'Hunts' }}
      />
      <GroupStack.Screen
        name="GroupDetail"
        component={GroupDetailScreen}
        options={({ navigation, route }) => ({
          title: route.params?.name ?? 'Hunt',
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingRight: 12 }}
            >
              <Ionicons name="chevron-back" size={26} color={T.headerText} />
              <Text style={{ color: T.headerText, fontSize: 17 }}>Hunts</Text>
            </TouchableOpacity>
          ),
        })}
      />
    </GroupStack.Navigator>
  );
}
```

Add the **Group** tab between Sessions and Profile, and register its icon. In the `tabBarIcon` `icons` map, add `Group`:

```javascript
            const icons = { Map: 'map', Sessions: 'trail-sign', Group: 'people', Profile: 'person' };
```

Then insert the tab between the Sessions and Profile `<Tab.Screen>`:

```javascript
        <Tab.Screen name="Group" component={GroupStackScreen} options={{ headerShown: false }} />
```

(The final tab order is Map / Sessions / Group / Profile.)

- [ ] **Step 4: Verify navigation on device**

Run `npx expo start`, open in Expo Go, log in. Confirm: a new **Group** tab appears (people icon) between Sessions and Profile; tapping it shows the placeholder "Hunts" screen; the Map / Sessions / Profile tabs and the Profile → Friends sub-screen all still work; theme + TOPO/SAT toggles still work.

- [ ] **Step 5: Commit + push**

```bash
git add App.js src/screens/GroupScreen.js src/screens/GroupDetailScreen.js
git commit -m "feat: Group tab, GroupStack navigator and screen placeholders (phase 3)"
git push origin main-CleanVersion
```

---

## Task 4: GroupScreen build-out — create hunt, invitations, your-hunts list

**Files:**
- Modify (replace): `src/screens/GroupScreen.js`

**Interfaces:**
- Consumes: `listMyGroups`, `createGroup`, `acceptInvite`, `leaveGroup` from `src/services/groups.js`; `friendlyGroupError` from `src/utils/groupErrors.js`; `validateGroupName` from `src/utils/validators.js`; `toISODate`, `addDays`, `parseISODate`, `formatDateShort` from `src/utils/dates.js`; `useTheme`, `GREEN`, `RED_STOP`.
- Produces: navigates to `GroupDetail` with `{ groupId, name, ownerId, myStatus }`.

- [ ] **Step 1: Install the native date picker (Expo-pinned)**

Run:

```bash
npx expo install @react-native-community/datetimepicker
```

Expected: adds `@react-native-community/datetimepicker` to `package.json` at an SDK-54-compatible version. It is bundled in the Expo Go runtime, so no custom dev client is needed to test on device.

- [ ] **Step 2: Replace `src/screens/GroupScreen.js` with the full screen**

```javascript
import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, SectionList, Alert, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { validateGroupName } from '../utils/validators';
import { friendlyGroupError } from '../utils/groupErrors';
import { toISODate, addDays, parseISODate, formatDateShort } from '../utils/dates';
import { listMyGroups, createGroup, acceptInvite, leaveGroup } from '../services/groups';
import DateTimePicker from '@react-native-community/datetimepicker';

// Split the flat RPC rows into invitations vs. my active hunts.
function toSections(rows) {
  const invites = rows.filter((r) => r.my_status === 'invited');
  const mine = rows.filter((r) => r.my_status === 'owner' || r.my_status === 'joined');
  const sections = [];
  if (invites.length) sections.push({ key: 'invites', title: 'Invitations', data: invites });
  sections.push({ key: 'mine', title: 'Your hunts', data: mine });
  return sections;
}

function dateRangeLabel(startISO, endISO) {
  return `${formatDateShort(parseISODate(startISO))} – ${formatDateShort(parseISODate(endISO))}`;
}

export default function GroupScreen({ navigation }) {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  // create-hunt form
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(() => addDays(new Date(), 1));
  const [creating, setCreating] = useState(false);

  // iOS-first compact pickers update via onChange. Keep end >= start.
  const onStartChange = (_e, d) => {
    if (!d) return;
    setStartDate(d);
    if (d > endDate) setEndDate(d);
  };
  const onEndChange = (_e, d) => { if (d) setEndDate(d); };

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await listMyGroups();
      setRows(data);
    } catch (e) {
      setError(friendlyGroupError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onCreate = async () => {
    setError(null);
    const v = validateGroupName(name);
    if (!v.ok) return setError(v.error);
    setCreating(true);
    try {
      await createGroup({
        name: v.value,
        startDate: toISODate(startDate),
        endDate: toISODate(endDate),
      });
      setName('');
      setStartDate(new Date());
      setEndDate(addDays(new Date(), 1));
      await load();
    } catch (e) {
      setError(friendlyGroupError(e));
    } finally {
      setCreating(false);
    }
  };

  const onAccept = async (groupId) => {
    if (actionBusy) return;
    setActionBusy(true);
    try { await acceptInvite(groupId); await load(); }
    catch (e) { Alert.alert('Could not accept', friendlyGroupError(e)); }
    finally { setActionBusy(false); }
  };

  const onDecline = (item) => {
    Alert.alert('Decline invite', `Decline the invite to "${item.name}"?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive',
        onPress: async () => {
          if (actionBusy) return;
          setActionBusy(true);
          try { await leaveGroup(item.group_id); await load(); }
          catch (e) { Alert.alert('Could not decline', friendlyGroupError(e)); }
          finally { setActionBusy(false); }
        },
      },
    ]);
  };

  const inputStyle = [
    st.input,
    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderColor: T.cardBorder, color: T.text },
  ];

  const Header = (
    <View style={st.createBox}>
      <Text style={[st.createTitle, { color: T.text }]}>New hunt</Text>
      <TextInput
        style={inputStyle} placeholder="Hunt name (e.g. Noord plaas)" placeholderTextColor={T.textDim}
        value={name} onChangeText={setName} autoCorrect={false} maxLength={40}
      />
      <View style={st.formRow}>
        <Text style={[st.formLabel, { color: T.textDim }]}>Starts</Text>
        <DateTimePicker
          value={startDate} mode="date" display="compact"
          themeVariant={isDark ? 'dark' : 'light'} accentColor={GREEN}
          onChange={onStartChange}
        />
      </View>
      <View style={st.formRow}>
        <Text style={[st.formLabel, { color: T.textDim }]}>Ends</Text>
        <DateTimePicker
          value={endDate} mode="date" display="compact" minimumDate={startDate}
          themeVariant={isDark ? 'dark' : 'light'} accentColor={GREEN}
          onChange={onEndChange}
        />
      </View>
      <Text style={[st.rangePreview, { color: T.textDim }]}>
        {dateRangeLabel(toISODate(startDate), toISODate(endDate))}
      </Text>
      <TouchableOpacity
        style={[st.createBtn, { backgroundColor: GREEN, opacity: creating ? 0.6 : 1 }]}
        onPress={onCreate} disabled={creating} activeOpacity={0.85}
      >
        {creating
          ? <ActivityIndicator color="#06210a" />
          : <Text style={st.createBtnText}>Create hunt</Text>}
      </TouchableOpacity>
      {error && <Text style={[st.error, { color: RED_STOP }]}>{error}</Text>}
    </View>
  );

  const renderItem = ({ item }) => {
    const isInvite = item.my_status === 'invited';
    return (
      <TouchableOpacity
        style={[st.row, { borderColor: T.cardBorder }]}
        activeOpacity={isInvite ? 1 : 0.7}
        disabled={isInvite}
        onPress={() => navigation.navigate('GroupDetail', {
          groupId: item.group_id, name: item.name, ownerId: item.owner_id, myStatus: item.my_status,
          startDate: item.start_date, endDate: item.end_date,
        })}
      >
        <View style={{ flex: 1 }}>
          <Text style={[st.name, { color: T.text }]}>{item.name}</Text>
          <Text style={[st.meta, { color: T.textDim }]}>
            {dateRangeLabel(item.start_date, item.end_date)} · {item.member_count} hunter{item.member_count === 1 ? '' : 's'}
            {item.my_status === 'owner' ? ' · owner' : ''}
          </Text>
          {isInvite && (
            <Text style={[st.meta, { color: T.textDim }]}>from @{item.owner_username}</Text>
          )}
        </View>
        {isInvite ? (
          <View style={st.inviteActions}>
            <TouchableOpacity style={[st.accept, { backgroundColor: GREEN, opacity: actionBusy ? 0.5 : 1 }]}
              onPress={() => onAccept(item.group_id)} disabled={actionBusy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={st.acceptText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.iconBtn, { opacity: actionBusy ? 0.5 : 1 }]}
              onPress={() => onDecline(item)} disabled={actionBusy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={RED_STOP} />
            </TouchableOpacity>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={T.textDim} />
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: T.bg }]}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  return (
    <View style={[st.root, { backgroundColor: T.bg, paddingTop: insets.top + 12 }]}>
      <SectionList
        sections={toSections(rows)}
        keyExtractor={(item) => item.group_id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        renderSectionHeader={({ section }) => (
          <Text style={[st.section, { color: T.textDim }]}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.key === 'mine' && section.data.length === 0
            ? <Text style={[st.empty, { color: T.textDim }]}>No hunts yet — create one above.</Text>
            : null
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={GREEN} />
        }
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  createBox: { paddingTop: 4, paddingBottom: 8 },
  createTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  input: { height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, fontSize: 16 },
  formRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12 },
  formLabel: { fontSize: 14, fontWeight: '600' },
  rangePreview: { fontSize: 13, marginTop: 10 },
  createBtn: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  createBtnText: { color: '#06210a', fontSize: 15, fontWeight: '800' },
  error: { fontSize: 13, marginTop: 8 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 6 },
  empty: { fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13, marginTop: 2 },
  inviteActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accept: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#06210a', fontSize: 14, fontWeight: '800' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 3: Verify on device (one account is enough for create)**

Run `npx expo start`. On the **Group** tab: type a hunt name, tap the **Starts** / **Ends** compact pickers and change the dates (confirm the end picker won't go before the start and the date-range preview updates), tap **Create hunt** → it appears under **Your hunts** with the range, "1 hunter", "owner". Tapping the row pushes the (placeholder) detail with the hunt name in the header and a "Hunts" back button. Empty-name create shows "Name the hunt".

- [ ] **Step 4: Commit + push**

```bash
git add src/screens/GroupScreen.js package.json package-lock.json
git commit -m "feat: build out Group screen - create hunt with date pickers, invitations, your hunts (phase 3)"
git push origin main-CleanVersion
```

---

## Task 5: GroupDetailScreen build-out — roster, invite friends, extend, leave/remove/delete

**Files:**
- Modify (replace): `src/screens/GroupDetailScreen.js`

**Interfaces:**
- Consumes: `listGroupMembers`, `inviteFriend`, `updateGroupEndDate`, `deleteGroup`, `leaveGroup`, `removeMember` from `src/services/groups.js`; `listFriendships` from `src/services/friends.js`; `friendlyGroupError` from `src/utils/groupErrors.js`; `parseISODate`, `toISODate`, `formatDateShort` from `src/utils/dates.js`; `DateTimePicker` from `@react-native-community/datetimepicker`; `useTheme`, `GREEN`, `RED_STOP`. Receives `route.params = { groupId, name, ownerId, myStatus, startDate, endDate }` (set by `GroupScreen`); uses `navigation.goBack()` after delete/leave.

- [ ] **Step 1: Replace `src/screens/GroupDetailScreen.js` with the full screen**

```javascript
import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, Alert, Modal, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { friendlyGroupError } from '../utils/groupErrors';
import { parseISODate, toISODate, formatDateShort } from '../utils/dates';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  listGroupMembers, inviteFriend, updateGroupEndDate, deleteGroup, leaveGroup, removeMember,
} from '../services/groups';
import { listFriendships } from '../services/friends';

const STATUS_LABEL = { owner: 'Owner', joined: 'Joined', invited: 'Invited' };

export default function GroupDetailScreen({ route, navigation }) {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { groupId, myStatus, startDate, endDate: initialEnd } = route.params;
  const isOwner = myStatus === 'owner';

  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [endDate, setEndDate] = useState(() => parseISODate(initialEnd));

  // invite picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await listGroupMembers(groupId);
      setRoster(data);
    } catch (e) {
      Alert.alert('Could not load hunt', friendlyGroupError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const all = await listFriendships();
      const memberIds = new Set(roster.map((r) => r.user_id));
      // accepted friends who aren't already owner/invited/joined here
      setFriends(all.filter((f) => f.status === 'accepted' && !memberIds.has(f.other_id)));
    } catch (e) {
      Alert.alert('Could not load friends', friendlyGroupError(e));
    } finally {
      setPickerLoading(false);
    }
  };

  const onInvite = async (userId) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await inviteFriend(groupId, userId);
      setPickerOpen(false);
      await load();
    } catch (e) {
      Alert.alert('Could not invite', friendlyGroupError(e));
    } finally {
      setActionBusy(false);
    }
  };

  // Owner changes the end date (DB CHECK also forbids before start_date).
  const onChangeEnd = async (_e, d) => {
    if (!d || actionBusy) return;
    const previous = endDate;
    setEndDate(d);                                 // optimistic
    setActionBusy(true);
    try { await updateGroupEndDate(groupId, toISODate(d)); }
    catch (e) { setEndDate(previous); Alert.alert('Could not change dates', friendlyGroupError(e)); }
    finally { setActionBusy(false); }
  };

  const onRemove = (member) => {
    Alert.alert('Remove hunter', `Remove @${member.username} from this hunt?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          if (actionBusy) return;
          setActionBusy(true);
          try { await removeMember(groupId, member.user_id); await load(); }
          catch (e) { Alert.alert('Could not remove', friendlyGroupError(e)); }
          finally { setActionBusy(false); }
        },
      },
    ]);
  };

  const onLeave = () => {
    Alert.alert('Leave hunt', 'Leave this hunt? You can be re-invited later.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: async () => {
          setActionBusy(true);
          try { await leaveGroup(groupId); navigation.goBack(); }
          catch (e) { setActionBusy(false); Alert.alert('Could not leave', friendlyGroupError(e)); }
        },
      },
    ]);
  };

  const onDelete = () => {
    Alert.alert('Delete hunt', 'Delete this hunt for everyone? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setActionBusy(true);
          try { await deleteGroup(groupId); navigation.goBack(); }
          catch (e) { setActionBusy(false); Alert.alert('Could not delete', friendlyGroupError(e)); }
        },
      },
    ]);
  };

  const renderMember = ({ item }) => (
    <View style={[st.row, { borderColor: T.cardBorder }]}>
      <View style={{ flex: 1 }}>
        <Text style={[st.name, { color: T.text }]}>
          {item.display_name}{item.is_me ? ' (you)' : ''}
        </Text>
        <Text style={[st.handle, { color: T.textDim }]}>@{item.username}</Text>
      </View>
      <Text style={[st.badge, { color: item.status === 'invited' ? T.textDim : GREEN }]}>
        {STATUS_LABEL[item.status]}
      </Text>
      {isOwner && item.status !== 'owner' && (
        <TouchableOpacity onPress={() => onRemove(item)} style={[st.iconBtn, { opacity: actionBusy ? 0.5 : 1 }]}
          disabled={actionBusy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="person-remove-outline" size={20} color={RED_STOP} />
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: T.bg }]}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  return (
    <View style={[st.root, { backgroundColor: T.bg }]}>
      <FlatList
        data={roster}
        keyExtractor={(item) => item.user_id}
        renderItem={renderMember}
        ListHeaderComponent={
          <View style={st.headerWrap}>
            <View style={st.dateRow}>
              <Text style={[st.dateLabel, { color: T.text }]}>
                {formatDateShort(parseISODate(startDate))} – {formatDateShort(endDate)}
              </Text>
              {isOwner && (
                <DateTimePicker
                  value={endDate} mode="date" display="compact"
                  minimumDate={parseISODate(startDate)}
                  themeVariant={isDark ? 'dark' : 'light'} accentColor={GREEN}
                  onChange={onChangeEnd}
                />
              )}
            </View>
            <Text style={[st.section, { color: T.textDim }]}>Hunters</Text>
          </View>
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={GREEN} />
        }
        ListFooterComponent={
          <View style={st.footer}>
            {isOwner && (
              <TouchableOpacity style={[st.actionBtn, { backgroundColor: GREEN, opacity: actionBusy ? 0.6 : 1 }]}
                onPress={openPicker} disabled={actionBusy} activeOpacity={0.85}>
                <Ionicons name="person-add-outline" size={18} color="#06210a" />
                <Text style={st.actionText}>Invite a friend</Text>
              </TouchableOpacity>
            )}
            {isOwner ? (
              <TouchableOpacity style={[st.dangerBtn, { borderColor: T.cardBorder }]}
                onPress={onDelete} disabled={actionBusy} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={18} color={RED_STOP} />
                <Text style={[st.dangerText, { color: RED_STOP }]}>Delete hunt</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[st.dangerBtn, { borderColor: T.cardBorder }]}
                onPress={onLeave} disabled={actionBusy} activeOpacity={0.8}>
                <Ionicons name="exit-outline" size={18} color={RED_STOP} />
                <Text style={[st.dangerText, { color: RED_STOP }]}>Leave hunt</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <Modal visible={pickerOpen} animationType="slide" transparent
        onRequestClose={() => setPickerOpen(false)}>
        <View style={st.modalBackdrop}>
          <View style={[st.modalCard, { backgroundColor: T.bg, paddingBottom: insets.bottom + 16 }]}>
            <View style={st.modalHead}>
              <Text style={[st.modalTitle, { color: T.text }]}>Invite a friend</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={T.textDim} />
              </TouchableOpacity>
            </View>
            {pickerLoading ? (
              <ActivityIndicator color={GREEN} style={{ marginVertical: 24 }} />
            ) : friends.length === 0 ? (
              <Text style={[st.empty, { color: T.textDim }]}>
                No friends left to invite. Add friends from the Profile tab.
              </Text>
            ) : (
              <FlatList
                data={friends}
                keyExtractor={(f) => f.other_id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={[st.row, { borderColor: T.cardBorder }]}
                    onPress={() => onInvite(item.other_id)} disabled={actionBusy} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.name, { color: T.text }]}>{item.other_display_name}</Text>
                      <Text style={[st.handle, { color: T.textDim }]}>@{item.other_username}</Text>
                    </View>
                    <Ionicons name="add-circle" size={24} color={GREEN} />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerWrap: { paddingTop: 12 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, marginBottom: 8 },
  dateLabel: { fontSize: 16, fontWeight: '700' },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '700' },
  handle: { fontSize: 13, marginTop: 1 },
  badge: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { marginTop: 24, gap: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 12 },
  actionText: { color: '#06210a', fontSize: 15, fontWeight: '800' },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  dangerText: { fontSize: 15, fontWeight: '700' },
  empty: { fontSize: 13, paddingVertical: 24, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { maxHeight: '70%', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 16 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
});
```

- [ ] **Step 2: Verify the full flow on two devices/accounts**

Run `npx expo start`. With **account A** (device 1, already friends with B) and **account B** (device 2):

1. A → Group → create a hunt → open it. Header shows the date range; A sees only themselves as **Owner**.
2. A → **Invite a friend** → the picker lists B (an accepted friend) → tap B → B appears as **Invited** in the roster.
3. B → Group tab (pull to refresh): the hunt is under **Invitations** with A's handle → tap **Accept** → it moves to **Your hunts**; open it → B sees A (Owner) and themselves (Joined).
4. A (owner) → open the hunt → tap the end-date picker in the header → pick a later date → it persists (re-open / refresh confirms); the picker won't allow a date before the start (`minimumDate`).
5. A removes B (person-remove icon) → B, on refresh, no longer sees the hunt. Re-invite + accept, then B taps **Leave hunt** → A's roster drops B on refresh.
6. Decline path: A invites B again → B taps the ✕ on the invitation → it disappears for both.
7. A taps **Delete hunt** → confirms → the hunt is gone for A; B (was invited/joined) no longer sees it on refresh.
8. Non-friend guard: confirm the invite picker only ever lists accepted friends (no strangers), and already-invited/joined people don't reappear in the picker.

- [ ] **Step 3: Confirm existing features still work**

Quick regression: start/stop a hunt, trail + PositionDot render, Sessions log opens, Profile → Friends still works (add/accept), theme + TOPO/SAT toggles work, range steppers + Log out on Profile still work.

- [ ] **Step 4: Commit + push**

```bash
git add src/screens/GroupDetailScreen.js
git commit -m "feat: build out hunt detail - roster, invite friends, change end date, leave/remove/delete (phase 3)"
git push origin main-CleanVersion
```

---

## Completion: Security Review + final code review

Run in the **main session** (not as a build subagent) after Task 5 verifies:

- [ ] **Security Review skill** over the Phase 3 diff — focus areas:
  - **`hunt_groups` / `group_members` RLS:** can a non-member read a group or its roster? Can a non-owner invite, or invite a non-friend (RLS `are_friends` branch)? Can a member rewrite `group_id`/`user_id` (confirm the `group_members_status_only` trigger blocks it — the column grant alone is unreliable under Supabase default privileges)? Can anyone but the invitee accept, or anyone but self/owner delete a membership? Can `owner_id` be transferred via UPDATE (`WITH CHECK` pins it)?
  - **Final `profiles` SELECT:** does `shares_group_with` expose only owner/joined co-members (not merely *invited* strangers)? Confirm an invited-but-not-joined user does **not** gain profile visibility to the rest of the group.
  - **`SECURITY DEFINER` functions:** `search_path` pinned on all five, all read-only/no write-bypass, `list_my_groups` / `list_group_members` filtered to the caller (a stranger gets zero rows; `list_group_members` authorizes **members only** — owner + joined — so an invited user cannot enumerate the roster until they accept), and the roster RPC returns only `username`/`display_name` (no email/ranges).
  - No secrets/PII in source or commit messages.
- [ ] **Code Reviewer skill** pass — bugs, edge cases (decline-then-re-invite, leave-then-re-invite, owner deleting a group with pending invites, double-tap on accept/invite/remove, the optimistic end-date extend revert), maintainability, and the navigation params/`useFocusEffect` reload UX.
- [ ] Address any findings, then confirm Phase 3 complete and update this plan's status header + the spec's Phase 3 line and the `profiles` SELECT note (mirroring how Phases 1–2 were closed out).

---

## Self-Review (against the spec)

- **Spec coverage:** `hunt_groups` table + invariants (Task 1) ✓; `group_members` table + invariants incl. friends-only invite (Task 1) ✓; `is_group_member` + `shares_group_with` helpers, plus `is_group_owner` for the owner-only invite/remove checks (Task 1) ✓; final `profiles` SELECT broadened to the group branch (Task 1) ✓; `src/services/groups.js` create / extend / invite-friends-only / accept-decline / member list / leave-remove (Task 2) ✓; `GroupScreen` (new tab) + `GroupDetailScreen` (Tasks 3–5) ✓; reuse of `find_user_by_username`/friends — invites pick from the existing accepted-friends list rather than re-querying handles, so no enumeration (Task 5) ✓; Security Review at end (Completion) ✓. Deferred-by-design (later phases): `shared_trails`/`shared_waypoints` (Phase 4), `member_positions`/Realtime (Phase 5).
- **Placeholder scan:** the only placeholders are the intentional minimal `GroupScreen`/`GroupDetailScreen` in Task 3, both replaced with complete code in Tasks 4–5. No stubs ship — the owner's end-date control is a fully-wired `DateTimePicker` (`onChangeEnd`), and `GroupScreen` passes `startDate`/`endDate` in the navigation params it reads.
- **Type consistency:** `list_my_groups` columns (`group_id, name, start_date, end_date, owner_id, owner_username, owner_display_name, my_status, member_count, created_at`) match `listMyGroups()`'s documented shape and the fields `GroupScreen` reads; `list_group_members` columns (`user_id, username, display_name, status, is_me`) match `listGroupMembers()` and the fields `GroupDetailScreen` reads; the navigation params written by `GroupScreen` (`groupId, name, ownerId, myStatus, startDate, endDate`) match what `GroupDetailScreen` destructures (`startDate`, `endDate: initialEnd`); the invite picker reads `other_id/other_username/other_display_name/status` from `listFriendships()` (the Phase 2 RPC shape); error codes (`NOT_SIGNED_IN`/`ALREADY_MEMBER`/`42501`) emitted/handled match `friendlyGroupError`; date helpers (`toISODate`/`parseISODate`/`addDays`/`formatDateShort`) are used with consistent Date↔ISO types throughout.
```

