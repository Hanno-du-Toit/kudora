# Kudora Social Foundation — Design Spec

_Status: approved design (2026-06-19). Implementation plan to follow via writing-plans._

## Context

Kudora is a personal family hunting GPS app (Expo / react-native-maps / Supabase) used by
Hanno, his dad, and his brother. Today it is **single-user and fully local**: the Supabase
client is wired up but unused, there is **no authentication**, and hunts are saved only to
AsyncStorage. This work lays the **social foundation** — accounts, friends, and multi-day
hunt groups with per-path sharing and live position — so the family can see each other's
routes and stay safe while hunting together.

The defining constraints (from CLAUDE.md): **offline-first** (farms have no signal — local
storage is primary, sync is secondary and always opt-in), **public GitHub repo** (no secrets,
no personal data in source), and **strict RLS** (a user's location/trails are only readable by
members of a hunt group they've joined; friend data only by confirmed friends; unshared paths
never visible to anyone). All existing features (GPS recording, trails, sessions, themes, the
PositionDot/TrailLayer work) must keep working throughout.

This spec was produced via the brainstorming workflow. Four foundational decisions were
confirmed by the user (phased build; the existing Hunt **is** the shareable path; live
position = persisted positions table **+** Realtime; waypoints get a table now but capture-UI
later), plus three follow-up calls (see Decisions Locked below).

## Decisions Locked

1. **Two separate range settings** (they were conflated in CLAUDE.md):
   - `safety_range_m` (default **5000**) — visibility range: how far away a group member can
     still be shown on my map.
   - `warning_range_m` (default **300**) — close-proximity safety vibrate threshold.
   - Both user-adjustable, both stored on `profiles`.
2. **Navigation**: add a 4th **Group** tab → tabs become **Map / Sessions / Group / Profile**.
   **Friends** is reached from inside the Profile screen.
3. **`member_positions` = one row per user** (no per-group visibility control). Family hunts
   together; keep it simple.

## Current State (verified by reading the code)

- `App.js` — boots straight into a 3-tab navigator (Map / Sessions / Profile). No auth gate.
- `src/services/supabase.js` — client configured with `persistSession`, `autoRefreshToken`,
  AsyncStorage. **Unused so far.** Anon key via `process.env` (correct).
- `src/services/huntStorage.js` — local-only hunt CRUD in AsyncStorage. Hunt shape:
  `{ id, startedAt, endedAt, distance, duration, avgSpeed, trailPoints[], mapType }`.
- `src/hooks/useGPSTracking.js` — foreground + background GPS, drift filters, saves the hunt
  via `saveHunt`. This is where Phase 5 will tap last-known position for upload.
- `src/screens/ProfileScreen.js` — **stub** (just a label). Built out in Phase 1.
- `src/screens/SessionsScreen.js` — hunt log + detail view (local). Gains a "Share" action
  in Phase 4. `regionForPoints`, `samplePoints` here are reusable for the group map.
- Waypoints are described in CLAUDE.md but **not implemented in code** — table only for now.
- `src/utils/geoUtils.js` — `haversineKm`, `isValidCoord`, `formatElapsed` (reuse for
  distance/proximity and coordinate guarding before any upsert).

## Database Schema (Supabase / Postgres)

Delivered as **per-phase SQL migration files** under `supabase/migrations/` (each phase ships
its own tables so each phase is independently testable). **Every** table runs the mandatory
CLAUDE.md policy on creation:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO anon, authenticated;
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
```

All membership/friendship predicates run through **`SECURITY DEFINER` STABLE helper
functions** so RLS policies never self-reference (avoids the Supabase RLS infinite-recursion
gotcha). Helpers are written to only *check* membership — never to bypass it.

**Helper functions**
- `are_friends(a uuid, b uuid) → bool` — an `accepted` friendship exists between a and b.
- `is_group_member(gid uuid, uid uuid) → bool` — uid is the group owner or a `joined` member.
- `shares_group_with(a uuid, b uuid) → bool` — a and b are both owner/joined in a common group.
- `find_user_by_username(handle text) → (id, username, display_name)` — exact-match only, so
  the user base **cannot be enumerated/scraped** for friend-add.

**`profiles`** — `id` (= `auth.users.id`, on delete cascade), `username` (unique,
`CHECK ~ '^[a-z0-9_]{3,20}$'`), `display_name` (not null), `safety_range_m` (default 5000),
`warning_range_m` (default 300), `created_at`, `updated_at`.
- SELECT: self **or** `are_friends(auth.uid(), id)` **or** `shares_group_with(auth.uid(), id)`
  (not globally readable). INSERT/UPDATE: `auth.uid() = id`.

**`friendships`** — `id`, `requester_id`, `addressee_id`, `status ∈ {pending, accepted}`,
`requester_id <> addressee_id`, **unique on the unordered pair**
(`unique index on (least(requester_id,addressee_id), greatest(...))`), timestamps.
- SELECT: `auth.uid() in (requester_id, addressee_id)`.
- INSERT: `auth.uid() = requester_id`.
- UPDATE: `auth.uid() = addressee_id` with `WITH CHECK (status = 'accepted')` (accept only).
- DELETE: either party (cancel request / decline / unfriend).

**`hunt_groups`** — `id`, `name`, `owner_id`, `start_date`, `end_date`
(`CHECK end_date >= start_date`, extendable via UPDATE), timestamps.
- SELECT: `is_group_member(id, auth.uid())`. INSERT/UPDATE/DELETE: `auth.uid() = owner_id`.

**`group_members`** — `id`, `group_id` (cascade), `user_id`, `status ∈ {invited, joined}`,
`invited_by`, **unique (group_id, user_id)**.
- SELECT: `is_group_member(group_id, auth.uid())` OR `auth.uid() = user_id` (see your own invite).
- INSERT: owner of the group AND `are_friends(owner, user_id)` AND `status = 'invited'`
  (enforces "only friends can be invited").
- UPDATE: `auth.uid() = user_id`, invited→joined (accept).
- DELETE: group owner (remove) OR `auth.uid() = user_id` (leave/decline).

**`shared_trails`** — `id`, `owner_id`, `group_id` (cascade), `local_hunt_id`
(**unique (owner_id, group_id, local_hunt_id)** for idempotent re-share), `name`,
`started_at`, `ended_at`, `distance_m`, `duration_ms`, `avg_speed`, `map_type`,
`trail_points jsonb`.
- SELECT: `auth.uid() = owner_id` OR `is_group_member(group_id, auth.uid())`.
- INSERT: `auth.uid() = owner_id` AND `is_group_member(group_id, owner_id)`.
- UPDATE/DELETE: `auth.uid() = owner_id` (DELETE = unshare; local hunt stays on device).
- *Unshared paths are never inserted, so never visible to anyone.*
- Scaling note: `trail_points` as jsonb is fine for a family app; if trails get huge later,
  move to a points table / PostGIS. Sample/compact points before upload.

**`shared_waypoints`** — same access shape as `shared_trails`. `owner_id`, `group_id`
(cascade), `local_waypoint_id` (unique with owner+group), `name`,
`type ∈ {blind, water, camp, sighting, general}`, `latitude`, `longitude`,
`created_at_client`. **Table + RLS now; drop/capture UI deferred.**

**`member_positions`** — `user_id` PK (cascade), `latitude`, `longitude`, `accuracy`,
`is_moving`, `updated_at`. **One row per user (upsert).**
- SELECT: `auth.uid() = user_id` OR `shares_group_with(auth.uid(), user_id)`.
- INSERT/UPDATE (upsert): `auth.uid() = user_id`. DELETE: `auth.uid() = user_id` (stop sharing).
- **Realtime enabled** (added to `supabase_realtime` publication). RLS applies to the change
  stream, so members only receive position rows they're allowed to see.

**Indexes**: `profiles unique(lower(username))`; `friendships(requester_id)`,
`(addressee_id)`; `group_members(group_id)`, `(user_id)`; `shared_trails(group_id)`,
`(owner_id)`; `shared_waypoints(group_id)`; `member_positions(updated_at)`.

## Security (from the Security Review skill, applied to this design)

- **RLS on every table** (mandatory) + `SECURITY DEFINER` helpers to prevent policy recursion.
- **Location privacy**: positions/trails readable only by joined members of a shared group;
  last-known position is deletable; unshared trails are never uploaded.
- **No enumeration**: `profiles` is not globally selectable; friend-add uses an exact-match RPC.
- **Input validation**: username regex + length (DB CHECK + client), `end_date >= start_date`
  (DB CHECK), waypoint type enum (CHECK), and `isValidCoord` guard before any position/trail
  upsert (reuse `src/utils/geoUtils.js`).
- **Parameterized** everywhere via supabase-js / RPC args (no string-built SQL).
- **Secrets**: only the anon key, via `process.env` (already correct). `.env` stays gitignored.
- **Session storage**: RN keeps the Supabase session in AsyncStorage (already configured); the
  web-only "httpOnly cookie" rule does not apply. Note `expo-secure-store` as a later hardening
  option.
- **No location or tokens in logs**; friendly user-facing errors only.
- Run the **Security Review skill** again at the end of the sensitive phases (1, 4, 5).

## Phased Build Order

Each phase = its own SQL migration + app code, **verified with two real accounts on two
devices**, then commit + push to `origin/main-CleanVersion` (per CLAUDE.md push policy).
Security Review on phases 1, 4, 5.

### Phase 1 — Auth + Profile
- `src/store/AuthContext.js` — wrap app; subscribe to `supabase.auth.onAuthStateChange`;
  expose session/loading/signOut. `App.js` gate: no session → Auth stack (Login / Signup);
  session → existing tabs (now Map / Sessions / Group / Profile).
- `src/screens/auth/LoginScreen.js`, `SignupScreen.js` — email/password; signup also takes
  display name + unique handle (availability via `find_user_by_username`), then inserts the
  `profiles` row. Loading states + friendly errors ("No signal, try again").
- `src/services/profiles.js` — get/update own profile, handle lookup.
- Build out `src/screens/ProfileScreen.js` — display name, `@handle`, email, the two range
  settings (`safety_range_m`, `warning_range_m`), **Friends** entry point, logout.
- *Migration:* `profiles` + helper (`find_user_by_username`) + RLS.
- Existing GPS/Sessions/Map untouched, now behind auth.

### Phase 2 — Friends
- `src/services/friends.js`, `src/screens/FriendsScreen.js` (reached from Profile):
  add-by-handle, incoming/outgoing requests, accept/decline, friends list, unfriend.
- *Migration:* `friendships` + `are_friends` + RLS.

### Phase 3 — Hunt Groups
- `src/services/groups.js`, `src/screens/GroupScreen.js` (the new tab) +
  `GroupDetailScreen.js`: create group (name + start/end date), extend end date, invite
  friends only, accept/decline invite, member list, leave/remove.
- *Migration:* `hunt_groups`, `group_members`, `is_group_member`, `shares_group_with` + RLS.

### Phase 4 — Per-path sharing + offline sync
- Extend the local Hunt with optional sync metadata; add a **"Share to group"** action in
  `SessionsScreen` (pick a group) → upload to `shared_trails`; unshare deletes the server copy.
- `src/store/syncQueue.js` — offline-first queue: record the share intent locally, flush when
  online (offline-first is non-negotiable).
- `src/hooks/useGroupTrails.js` — load a group's shared trails; `src/components/map/TrailLayer`
  reused to render each member's trail in their colour (green/amber/blue) on the Group map;
  a small `colorForMember` util.
- *Migration:* `shared_trails` + `shared_waypoints` + RLS.

### Phase 5 — Live position + safety
- `src/hooks/useGroupSession.js` (or `useLivePositions`) — upsert `member_positions` from the
  GPS watcher when online and in an active group; subscribe to group members via Realtime
  (clean up the channel in the `useEffect` return — CLAUDE.md quirk).
- `src/components/map/FriendDot.js` — member dot in their colour, "X min ago" from
  `updated_at`, grey when `is_moving` is false (stationary).
- Safety vibrate using `warning_range_m`; member visibility filtered by `safety_range_m`.
  (SOS ping noted as a follow-on, not in this foundation.)
- *Migration:* `member_positions` + Realtime publication + RLS.

## Verification (per phase)

- **DB/RLS**: in the Supabase SQL editor, exercise each policy with two test users — confirm a
  non-member gets **zero rows** from `shared_trails` / `member_positions`, a non-friend cannot
  read a profile, only the addressee can accept a friendship, only a group owner can invite,
  and only friends can be invited. Confirm Realtime respects RLS (member B receives A's
  position only while they share a joined group).
- **App**: two accounts on two devices — sign up/in persists across restart; can't take an
  existing handle; friend request → accept → both see each other; create a group with a date
  range and extend it; share one path and confirm it appears (correct colour) for the other
  member while an **unshared** path never does; offline-share flushes on reconnect; live dots
  update, last-known shows "X min ago" after signal drops, stationary dot greys, and the
  proximity vibrate fires within `warning_range_m`.
- Existing flows still work: start/stop hunt, trail + PositionDot render, Sessions log, theme
  and TOPO/SAT toggles.

## Out of Scope (this foundation)

Waypoint drop/capture UI (table only), SOS ping, boundary mapping, sector assignment, and any
Mapbox/offline-tile swap. These build on top of the schema once the foundation is in.
