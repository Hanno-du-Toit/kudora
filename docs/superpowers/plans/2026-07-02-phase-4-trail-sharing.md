# Phase 4 — Per-Path Trail Sharing + Offline Sync Implementation Plan

> **Status: ✅ COMPLETE (2026-07-30).** All 7 tasks done and device-verified; Security
> Review PASS (no Critical/Important); final code-review fixes landed (698737b, c5022ea —
> map centring pending device confirmation). Originally APPROVED 2026-07-03. Spec
> (`docs/superpowers/specs/2026-07-02-phase-4-trail-sharing-design.md`) approved with all
> 5 open questions resolved at their recommendations: (1) dedicated GroupMapScreen,
> (2) local delete = unshare, (3) leave/remove wipes shares via DB trigger, (4) 1000-point
> cap, (5) netinfo dependency. Execution: subagent-driven with review gates between tasks
> (Phase 3 model).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recorded hunt can be shared to / unshared from any of my outings — offline-safe via desired-state reconciliation — and every outing member sees shared trails on a group map in the sharer's colour.

**Architecture:** One `shared_trails` row per (owner, outing, local hunt) with `trail_points jsonb` (spec Decision 1). Locally, a desired-state map in AsyncStorage (`shareState`) records "should be shared" per (hunt, outing); a single-flight reconciler (`trailSync`) diffs desired vs. actual server rows and pushes only the difference (spec Decision 2) — share-then-unshare offline nets to a no-op because the desired entry is simply gone. UI: a share sheet in the Sessions hunt detail (toggles + sync status) and a new `GroupMapScreen` in the GroupStack rendering each member's trails via `TrailLayer` in `colorForMember` colours.

**Tech Stack:** Expo SDK 54 / RN 0.81, `@supabase/supabase-js` v2, react-native-maps, AsyncStorage, `@react-native-community/netinfo` (**new** — bundled in Expo Go, added via `npx expo install`), React Navigation v7 (existing GroupStack).

## Global Constraints

- **Offline-first:** share/unshare toggles NEVER block on the network — they write local desired state and return; the reconciler syncs later. Local hunt data is never mutated by sync.
- **Verification model (Phases 1–3 convention):** no jest / testing-library — do NOT add them. Pure functions get one-off `node --input-type=module -e` checks; schema/RLS via user-run Supabase SQL editor scripts; app flows via Expo Go device checkpoints with two accounts (@hunter + @test). STOP at each device checkpoint for user confirmation.
- **Every new table:** `GRANT ... TO anon, authenticated;` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` (CLAUDE.md floor), then narrow. `shared_trails` / `shared_waypoints` get **no UPDATE policy at all** (immutable rows — RLS default-deny is grant-independent, so no Phase 3-style column trigger is needed).
- **Migration numbering:** next file is `0006_shared_trails.sql` (0001–0005 exist and are applied). Forward-only: never edit applied migrations.
- **Public repo:** no secrets, no UUIDs/emails/personal data in committed files.
- **UI:** tap targets ≥44×44pt; every network/GPS action has a loading state; friendly errors ("No signal — will sync when you're back online"), reuse `friendlyGroupError`; colours `GREEN #5FCE5F`, `RED_STOP #E24B4A`, surfaces via `useTheme()`.
- **Copy:** group hunts are called **outings** (Phase 3 sweep).
- **Guard every coordinate** with `isValidCoord` before upload and before rendering.
- **Branch/push:** work on `main-CleanVersion`; commit + push after every task.
- **Sensitive phase:** GPS coordinates enter the DB → **Security Review skill at Completion** (mandatory, per CLAUDE.md + foundation spec).

---

## File Structure

- `supabase/migrations/0006_shared_trails.sql` — **create**: `shared_trails` + `shared_waypoints` + RLS + membership-exit cleanup trigger + indexes.
- `src/constants/sharing.js` — **create**: `MAX_SHARED_TRAIL_POINTS`, `MEMBER_TRAIL_COLORS`.
- `src/utils/mapUtils.js` — **create**: `samplePoints`, `regionForPoints` (lifted verbatim from SessionsScreen).
- `src/utils/memberColors.js` — **create**: pure `colorForMember(userId, myId, memberIds)`.
- `src/utils/trailPayload.js` — **create**: pure `buildTrailPayload(hunt, groupId, ownerId)`.
- `src/store/shareState.js` — **create**: AsyncStorage desired-state + server-cache CRUD.
- `src/services/sharedTrails.js` — **create**: thin supabase ops (`listMyShareRefs`, `listGroupTrails`, `insertSharedTrail`, `deleteSharedTrail`).
- `src/services/trailSync.js` — **create**: `diffShares` (pure) + `reconcileShares` (single-flight) + `onShareSync` listeners.
- `src/hooks/useShareSync.js` — **create**: mount-once sync triggers (start / NetInfo / AppState).
- `src/hooks/useGroupTrails.js` — **create**: fetch a group's shared trails.
- `src/components/sessions/ShareSheet.js` — **create**: per-outing share toggles + status.
- `src/components/map/TrailLayer.js` — **modify**: optional `color` prop (default `#5FCE5F`).
- `src/screens/SessionsScreen.js` — **modify**: import lifted utils; share button + ShareSheet in `HuntDetailView`; delete-unshares warning.
- `src/screens/GroupMapScreen.js` — **create**: group map + legend.
- `src/screens/GroupDetailScreen.js` — **modify**: "Group map" entry row.
- `App.js` — **modify**: register `GroupMap` in GroupStack; call `useShareSync()` in `ThemedTabs`.

---

## Task 1: Migration 0006 — shared_trails, shared_waypoints, RLS, cleanup trigger

**Files:**
- Create: `supabase/migrations/0006_shared_trails.sql`
- Create: `.superpowers/sdd/phase4-rls-test.sql` (user-run verification; gitignored dir)

**Interfaces:**
- Produces: tables `public.shared_trails(id, owner_id, group_id, local_hunt_id, started_at, ended_at, distance_km, duration_ms, avg_speed_kmh, map_type, trail_points, created_at)` and `public.shared_waypoints(id, owner_id, group_id, local_waypoint_id, name, type, latitude, longitude, created_at_client, created_at)`; trigger `group_members_cleanup_shares`. Consumed by Tasks 3/5 via supabase-js.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Write the user-run RLS verification script**

Create `.superpowers/sdd/phase4-rls-test.sql`. It impersonates each account with
`set local role authenticated` + `request.jwt.claims`, inside rolled-back transactions,
using the same `forge_results` reporting pattern as the Phase 3 forge test. It must cover,
with two real user ids (@hunter owns an outing, @test joined):

```sql
-- Pattern for each check (full script assembled at execution time with real ids):
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '<USER-UUID>', 'role', 'authenticated')::text, true);
set local role authenticated;
-- ... assertion query ...
rollback;
```

Checks (each PASS/FAIL row): (1) non-member SELECT on a shared trail → **0 rows**;
(2) member SELECT → 1 row; (3) owner SELECT own row → 1 row; (4) member (non-owner)
DELETE → 0 rows deleted; (5) non-member INSERT (forged owner_id = self, group they're
not in) → 42501; (6) any UPDATE by owner → 42501/0 rows (no policy); (7) INSERT with 1
point → 23514 CHECK; (8) after deleting @test's membership row, @test's shared_trails
rows for that group are gone (cleanup trigger); (9) same non-member zero-rows check on
`shared_waypoints`.

- [ ] **Step 3: User runs 0006 in the Supabase SQL editor** — expect "Success". STOP if any error.

- [ ] **Step 4: User runs phase4-rls-test.sql** — every row PASS. STOP on any FAIL/PARTIAL.

- [ ] **Step 5: Commit + push**

```bash
git add supabase/migrations/0006_shared_trails.sql
git commit -m "add shared_trails + shared_waypoints migration (RLS, immutable rows, leave-cleanup trigger)"
git push origin main-CleanVersion
```

---

## Task 2: Pure utils — mapUtils, sharing constants, colorForMember, buildTrailPayload

**Files:**
- Create: `src/utils/mapUtils.js`, `src/constants/sharing.js`, `src/utils/memberColors.js`, `src/utils/trailPayload.js`
- Modify: `src/screens/SessionsScreen.js` (delete local `samplePoints`/`regionForPoints`, import from `../utils/mapUtils`)

**Interfaces:**
- Consumes: `isValidCoord` from `src/utils/geoUtils.js`.
- Produces: `samplePoints(points, max=80) → array`; `regionForPoints(points) → {latitude, longitude, latitudeDelta, longitudeDelta}`; `MAX_SHARED_TRAIL_POINTS = 1000`; `MEMBER_TRAIL_COLORS = ['#F4A623', '#6AB0E8', '#C77DD8', '#E8875C']`; `colorForMember(userId, myId, memberIds) → '#rrggbb'`; `buildTrailPayload(hunt, groupId, ownerId) → row-object | null`.

- [ ] **Step 1: Create `src/utils/mapUtils.js`** — move `regionForPoints` and `samplePoints` from `SessionsScreen.js` lines 40–67 **verbatim** (add `export`). No behavior change.

- [ ] **Step 2: Create `src/constants/sharing.js`**

```js
// Cap on points uploaded per shared trail — sampled client-side; the DB CHECK
// allows up to 2000 as headroom so the cap can be raised without a migration.
export const MAX_SHARED_TRAIL_POINTS = 1000;

// Other members' trail colours on the group map (self is always GREEN).
// Assigned by position in the group's member ids sorted ascending (deterministic
// on every device), wrapping via modulo. First two match CLAUDE.md (dad amber,
// brother blue).
export const MEMBER_TRAIL_COLORS = ['#F4A623', '#6AB0E8', '#C77DD8', '#E8875C'];
```

- [ ] **Step 3: Create `src/utils/memberColors.js`**

```js
import { MEMBER_TRAIL_COLORS } from '../constants/sharing';

const GREEN = '#5FCE5F';

// Viewer-relative colour: self is ALWAYS green ("green = me" is the field
// invariant); everyone else gets a stable palette slot from the sorted member
// ids so the assignment is identical on every device and across sessions.
export function colorForMember(userId, myId, memberIds) {
  if (userId === myId) return GREEN;
  const others = [...new Set(memberIds)].filter((id) => id !== myId).sort();
  const idx = others.indexOf(userId);
  if (idx === -1) return MEMBER_TRAIL_COLORS[0];
  return MEMBER_TRAIL_COLORS[idx % MEMBER_TRAIL_COLORS.length];
}
```

- [ ] **Step 4: Create `src/utils/trailPayload.js`**

```js
import { isValidCoord } from './geoUtils';
import { samplePoints } from './mapUtils';
import { MAX_SHARED_TRAIL_POINTS } from '../constants/sharing';

// Local hunt → shared_trails row. Returns null when the hunt has fewer than 2
// valid points (unshareable; the DB CHECK would reject it anyway). Points are
// reduced to {latitude, longitude, timestamp?} — speed/accuracy are not needed
// to draw a polyline and payload size matters on farm signal.
export function buildTrailPayload(hunt, groupId, ownerId) {
  const valid = (hunt?.trailPoints ?? []).filter(isValidCoord);
  if (valid.length < 2) return null;
  const pts = samplePoints(valid, MAX_SHARED_TRAIL_POINTS).map((p) => {
    const out = { latitude: p.latitude, longitude: p.longitude };
    if (p.timestamp != null) out.timestamp = p.timestamp;
    return out;
  });
  return {
    owner_id: ownerId,
    group_id: groupId,
    local_hunt_id: hunt.id,
    started_at: hunt.startedAt,
    ended_at: hunt.endedAt,
    distance_km: hunt.distance ?? 0,
    duration_ms: hunt.duration ?? 0,
    avg_speed_kmh: hunt.avgSpeed ?? 0,
    map_type: hunt.mapType === 'satellite' ? 'satellite' : 'topo',
    trail_points: pts,
  };
}
```

- [ ] **Step 5: Update `SessionsScreen.js`** — delete its local `regionForPoints`/`samplePoints`, add `import { regionForPoints, samplePoints } from '../utils/mapUtils';`.

- [ ] **Step 6: Node-verify the pure functions**

Run (from repo root) a `node --input-type=module` check that: `colorForMember(me, me, ids)` → `#5FCE5F`; two non-self members get `#F4A623`/`#6AB0E8` by sorted order regardless of `memberIds` array order; `buildTrailPayload` returns null for `{trailPoints: [{latitude:0, longitude:0}]}`; a 3000-point hunt yields ≤1000 points; payload `map_type` falls back to `'topo'`. Expected: all `true`. Then `node --check` on all touched files.

- [ ] **Step 7: Commit + push**

```bash
git add src/utils/mapUtils.js src/constants/sharing.js src/utils/memberColors.js src/utils/trailPayload.js src/screens/SessionsScreen.js
git commit -m "add sharing utils: mapUtils lift, member colours, trail payload builder"
git push origin main-CleanVersion
```

---

## Task 3: shareState store, sharedTrails service, trailSync reconciler

**Files:**
- Create: `src/store/shareState.js`, `src/services/sharedTrails.js`, `src/services/trailSync.js`

**Interfaces:**
- Consumes: `buildTrailPayload` (Task 2), `loadHunt` from `src/services/huntStorage.js`, `supabase` from `src/services/supabase.js`.
- Produces: `getDesired() → Promise<{[huntId]: {[groupId]: true}}>`; `setDesired(huntId, groupId, shared) → Promise<void>`; `removeHunt(huntId) → Promise<void>`; `getServerCache() → Promise<{['huntId|groupId']: rowId}>`; `setServerCache(map)`; `listMyShareRefs() → Promise<[{id, group_id, local_hunt_id}]>`; `listGroupTrails(groupId) → Promise<rows>`; `insertSharedTrail(row)`; `deleteSharedTrail(id)`; `diffShares(desired, refs) → {toInsert: [{huntId, groupId}], toDelete: [rowId]}`; `reconcileShares() → Promise<{uploaded, removed, revoked, failed}>`; `onShareSync(fn) → unsubscribe`.

- [ ] **Step 1: Create `src/store/shareState.js`**

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

// Desired share state: { [localHuntId]: { [groupId]: true } }. Only true entries
// are stored — unshare DELETES the entry, which is what makes an offline
// share-then-unshare net to a structural no-op for the reconciler.
const DESIRED_KEY = 'kudora_share_state_v1';
// Reconciler's last-known server rows: { 'huntId|groupId': serverRowId }.
// Lets the UI label toggles offline (desired∧cached=Shared, desired∧¬cached=
// Waiting for signal, ¬desired∧cached=Removing…).
const CACHE_KEY = 'kudora_share_server_cache_v1';

async function readJSON(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function getDesired() {
  return readJSON(DESIRED_KEY, {});
}

export async function setDesired(huntId, groupId, shared) {
  const all = await getDesired();
  if (shared) {
    all[huntId] = { ...(all[huntId] ?? {}), [groupId]: true };
  } else if (all[huntId]) {
    delete all[huntId][groupId];
    if (Object.keys(all[huntId]).length === 0) delete all[huntId];
  }
  await AsyncStorage.setItem(DESIRED_KEY, JSON.stringify(all));
}

// Local hunt deleted → intent gone → reconciler unshares any server copies.
export async function removeHunt(huntId) {
  const all = await getDesired();
  if (all[huntId]) {
    delete all[huntId];
    await AsyncStorage.setItem(DESIRED_KEY, JSON.stringify(all));
  }
}

export async function getServerCache() {
  return readJSON(CACHE_KEY, {});
}

export async function setServerCache(map) {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(map ?? {}));
}
```

- [ ] **Step 2: Create `src/services/sharedTrails.js`**

```js
import { supabase } from './supabase';

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) { const e = new Error('Not signed in'); e.code = 'NOT_SIGNED_IN'; throw e; }
  return data.user;
}

// My rows only (SELECT policy also shows me other members' trails — filter).
export async function listMyShareRefs() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from('shared_trails')
    .select('id, group_id, local_hunt_id')
    .eq('owner_id', user.id);
  if (error) throw error;
  return data ?? [];
}

// Everything shared to one outing (RLS: members only). Powers the group map.
export async function listGroupTrails(groupId) {
  const { data, error } = await supabase
    .from('shared_trails')
    .select('id, owner_id, local_hunt_id, started_at, ended_at, distance_km, trail_points')
    .eq('group_id', groupId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertSharedTrail(row) {
  const { data, error } = await supabase
    .from('shared_trails')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSharedTrail(id) {
  const { error } = await supabase.from('shared_trails').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 3: Create `src/services/trailSync.js`**

```js
import { getDesired, setDesired, getServerCache, setServerCache } from '../store/shareState';
import { listMyShareRefs, insertSharedTrail, deleteSharedTrail } from './sharedTrails';
import { loadHunt } from './huntStorage';
import { buildTrailPayload } from '../utils/trailPayload';
import { supabase } from './supabase';

const keyOf = (huntId, groupId) => `${huntId}|${groupId}`;

// Pure diff between desired state and actual server rows — the whole sync
// contract (spec Decision 2). Node-testable: no IO.
export function diffShares(desired, serverRefs) {
  const desiredKeys = new Set();
  for (const huntId of Object.keys(desired ?? {})) {
    for (const groupId of Object.keys(desired[huntId] ?? {})) {
      if (desired[huntId][groupId]) desiredKeys.add(keyOf(huntId, groupId));
    }
  }
  const toInsert = [];
  const toDelete = [];
  const serverKeys = new Set();
  for (const r of serverRefs ?? []) {
    const k = keyOf(r.local_hunt_id, r.group_id);
    serverKeys.add(k);
    if (!desiredKeys.has(k)) toDelete.push(r.id);
  }
  for (const k of desiredKeys) {
    if (!serverKeys.has(k)) {
      const [huntId, groupId] = k.split('|');
      toInsert.push({ huntId, groupId });
    }
  }
  return { toInsert, toDelete };
}

const listeners = new Set();
export function onShareSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let inFlight = null;

// Reconcile local desired state with the server. Single-flight: concurrent
// triggers share one run. Never throws — offline just leaves state pending
// for the next trigger.
export function reconcileShares() {
  if (inFlight) return inFlight;
  inFlight = doReconcile().finally(() => { inFlight = null; });
  return inFlight;
}

async function doReconcile() {
  const summary = { uploaded: 0, removed: 0, revoked: 0, failed: 0 };
  try {
    const { data } = await supabase.auth.getUser();
    if (!data?.user) return summary;
    const me = data.user.id;

    const desired = await getDesired();
    const refs = await listMyShareRefs();
    const { toInsert, toDelete } = diffShares(desired, refs);

    for (const { huntId, groupId } of toInsert) {
      try {
        const hunt = await loadHunt(huntId);
        if (!hunt) { await setDesired(huntId, groupId, false); continue; }
        const payload = buildTrailPayload(hunt, groupId, me);
        if (!payload) { await setDesired(huntId, groupId, false); summary.revoked += 1; continue; }
        await insertSharedTrail(payload);
        summary.uploaded += 1;
      } catch (e) {
        if (e?.code === '23505') {
          // Already on the server (race with an earlier run) — success.
          summary.uploaded += 1;
        } else if (e?.code === '42501' || e?.code === '23514') {
          // Not a member of that outing anymore / payload rejected by CHECK:
          // the share can never succeed — drop the desired flag.
          await setDesired(huntId, groupId, false);
          summary.revoked += 1;
        } else {
          summary.failed += 1; // offline etc. — keep the flag, retry later
        }
      }
    }

    for (const id of toDelete) {
      try { await deleteSharedTrail(id); summary.removed += 1; }
      catch { summary.failed += 1; }
    }

    // Refresh the offline status cache from the server's post-reconcile truth.
    try {
      const after = await listMyShareRefs();
      const cache = {};
      for (const r of after) cache[keyOf(r.local_hunt_id, r.group_id)] = r.id;
      await setServerCache(cache);
    } catch {}
  } catch {
    summary.failed += 1; // couldn't even list — fully offline
  }
  for (const fn of listeners) { try { fn(summary); } catch {} }
  return summary;
}
```

- [ ] **Step 4: Node-verify `diffShares`** — desired `{h1:{g1:true}}` + refs `[]` → 1 insert; desired `{}` + refs `[{id:'r1', group_id:'g1', local_hunt_id:'h1'}]` → toDelete `['r1']`; matching pair → both empty; the offline share-then-unshare case is the second scenario's mirror: entry never written → refs empty → **no-op**. Expected: all `true`. `node --check` all three files.

- [ ] **Step 5: Commit + push**

```bash
git add src/store/shareState.js src/services/sharedTrails.js src/services/trailSync.js
git commit -m "add share desired-state store, sharedTrails service, reconciling sync worker"
git push origin main-CleanVersion
```

---

## Task 4: Sync triggers + ShareSheet UI in Sessions

**Files:**
- Create: `src/hooks/useShareSync.js`, `src/components/sessions/ShareSheet.js`
- Modify: `App.js` (call `useShareSync()` inside `ThemedTabs`), `src/screens/SessionsScreen.js` (share button + sheet + delete-unshare)
- Run: `npx expo install @react-native-community/netinfo`

**Interfaces:**
- Consumes: `reconcileShares`, `onShareSync` (Task 3); `getDesired`, `setDesired`, `removeHunt`, `getServerCache` (Task 3); `listMyGroups` (`src/services/groups.js`); `friendlyGroupError` (`src/utils/groupErrors.js`).
- Produces: `useShareSync()` (mount-once hook); `<ShareSheet hunt visible onClose T isDark insets />`.

- [x] **Step 1: Install netinfo** — `npx expo install @react-native-community/netinfo` (bundled in Expo Go; expo pins the SDK-54 version). Commit `package.json` + lockfile.

- [x] **Step 2: Create `src/hooks/useShareSync.js`**

```js
import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { reconcileShares } from '../services/trailSync';

// Mounted ONCE in the authed tree (ThemedTabs). Fires the reconciler on app
// start, when connectivity returns, and when the app comes to the foreground.
// reconcileShares is single-flight and never throws, so triggers are cheap.
export function useShareSync() {
  useEffect(() => {
    reconcileShares();
    const unsubNet = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) reconcileShares();
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') reconcileShares();
    });
    return () => { unsubNet(); appSub.remove(); };
  }, []);
}
```

In `App.js` `ThemedTabs`, add `useShareSync();` beside the existing `useTheme()` call (and the import).

- [x] **Step 3: Create `src/components/sessions/ShareSheet.js`**

A bottom card (same visual language as `HuntDetailView`'s stats panel: `T.card` background, hairline border, `insets.bottom` padding) shown when `visible`. Behavior:

- On open: `Promise.all([listMyGroups(), getDesired(), getServerCache()])`; keep outings where `my_status` is `'owner'`/`'joined'`; loading spinner (`GREEN`) while fetching; `friendlyGroupError` text on failure.
- Each outing row (≥44pt): name + `formatDateShort` range on the left; on the right a `Switch` (`trackColor` `GREEN`) + status caption under the name — derive with the pure helper inside the file:

```js
// desired/cached → user-facing sync status for one (hunt, outing) toggle
export function shareStatus(desired, cached) {
  if (desired && cached) return 'Shared';
  if (desired && !cached) return 'Waiting for signal';
  if (!desired && cached) return 'Removing…';
  return null;
}
```

- Toggle handler: `await setDesired(hunt.id, groupId, next)` → optimistic row update → `reconcileShares()` (not awaited for UI, but subscribe via `onShareSync` while mounted to re-read the cache and settle statuses).
- Unshareable hunt (`buildTrailPayload(hunt, g, 'x') === null`): render a single caption "This hunt is too short to share (needs 2+ GPS points)." and disable all switches.
- No outings: "You're not in any outings yet — create one on the Group tab."
- A `revoked > 0` sync summary shows one inline caption: "Removed from an outing — that share was cancelled."

- [x] **Step 4: Wire into `HuntDetailView` (`SessionsScreen.js`)**

- Top bar gains a middle share button (same `floatBtn` style, `share-outline` icon, ≥44pt) → `setShareOpen(true)`; render `<ShareSheet hunt={hunt} visible={shareOpen} onClose={() => setShareOpen(false)} T={T} isDark={isDark} insets={insets} />` above the stats panel.
- `handleDelete`: first `const desired = await getDesired();` — if `desired[hunt.id]` has entries, the Alert message becomes `` `Remove this hunt from ${formatDate(hunt.startedAt)}? It is shared to ${n} outing${n===1?'':'s'} — deleting also removes it there. This cannot be undone.` ``; on confirm, after `deleteHuntFromStorage(hunt.id)` also `await removeHunt(hunt.id); reconcileShares();`.

- [x] **Step 5: `node --check`** on all four touched JS files; then run `npx expo start` and confirm the app boots with no red screen.

- [x] **Step 6: DEVICE CHECKPOINT (STOP for user)** — online, @hunter: open a hunt → share button visible; sheet lists outings; toggle ON → status settles to "Shared"; Supabase table editor shows one `shared_trails` row (points ≤1000); toggle OFF → row gone; re-share → exactly one row (idempotent); delete a shared hunt → warning copy mentions the outing count, server row disappears. PASSED 2026-07-21 (7/7, plus bonus unshareable-hunt check on a ~1-point hunt).

- [x] **Step 7: Commit + push**

```bash
git add package.json package-lock.json src/hooks/useShareSync.js src/components/sessions/ShareSheet.js src/screens/SessionsScreen.js App.js
git commit -m "add share sheet + offline-aware sync triggers for trail sharing"
git push origin main-CleanVersion
```

---

## Task 5: Group map — TrailLayer colour, useGroupTrails, GroupMapScreen

**Files:**
- Modify: `src/components/map/TrailLayer.js`, `src/screens/GroupDetailScreen.js`, `App.js`
- Create: `src/hooks/useGroupTrails.js`, `src/screens/GroupMapScreen.js`

**Interfaces:**
- Consumes: `listGroupTrails` (Task 3), `listGroupMembers` (`services/groups.js`), `colorForMember` + `regionForPoints` (Task 2), `isValidCoord`.
- Produces: `TrailLayer({ points, color = '#5FCE5F' })`; `useGroupTrails(groupId) → { trails, loading, error, refresh }`; GroupStack route `GroupMap` with params `{ groupId, name }`.

- [ ] **Step 1: `TrailLayer` colour prop** — signature `({ points, color = '#5FCE5F' })`; the second Polyline's `strokeColor` becomes `{color}`; shadow line unchanged. Existing callers untouched (default preserved).

- [ ] **Step 2: Create `src/hooks/useGroupTrails.js`**

```js
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { listGroupTrails } from '../services/sharedTrails';
import { friendlyGroupError } from '../utils/groupErrors';

export function useGroupTrails(groupId) {
  const [trails, setTrails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try { setTrails(await listGroupTrails(groupId)); }
    catch (e) { setError(friendlyGroupError(e)); }
    finally { setLoading(false); }
  }, [groupId]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  return { trails, loading, error, refresh };
}
```

- [ ] **Step 3: Create `src/screens/GroupMapScreen.js`**

Full-screen MapView mirroring `HuntDetailView`'s map config (satellite base, theme-aware carto `UrlTile` topo layer, `showsUserLocation={false}`). Content:

- `useGroupTrails(groupId)` + `listGroupMembers(groupId)` (for names; on focus). `myId` from `supabase.auth.getUser()` once.
- Per trail: `const pts = (trail.trail_points ?? []).filter(isValidCoord);` skip if `<2`; `<TrailLayer key={trail.id} points={pts} color={colorForMember(trail.owner_id, myId, memberIds)} />` where `memberIds` = roster `user_id`s.
- `initialRegion={regionForPoints(allValidPointsConcatenated)}`.
- Legend: absolute-positioned row of chips above the bottom inset — colour dot + `display_name` for each owner with ≥1 rendered trail.
- Floating refresh button (44pt, `refresh` icon) → `refresh()`; `ActivityIndicator` overlay while loading; `error` banner in `RED_STOP`; empty state card: "No trails shared to this outing yet."

- [ ] **Step 4: Entry point + route** — `GroupDetailScreen`: a "Group map" row card under the dates card (chevron-forward, ≥44pt) → `navigation.navigate('GroupMap', { groupId, name })`. `App.js` GroupStack: register `GroupMap` with `title: route.params?.name ?? 'Group map'` and the same custom back button pattern as `GroupDetail` (back label "Outings" → use label `route.params?.name` truncated or plain chevron; match `GroupDetail`'s headerLeft with label omitted).

- [ ] **Step 5: `node --check`** all touched files; boot check via `npx expo start`.

- [x] **Step 6: DEVICE CHECKPOINT (STOP for user)** — two accounts: @hunter shares a hunt to the outing → @test opens Group map: trail renders in @test's view with @hunter's assigned colour (amber/blue, NOT green); @test shares one → @hunter sees own trail green + @test's in a palette colour; legend names/colours match; @hunter unshares → gone from @test's map after refresh; own solo-hunt map flows unaffected. COMPLETE 2026-07-25 after cache clear; see progress.md for the 2 follow-up fixes (refresh reconcile + @username legend).

- [x] **Step 7: Commit + push**

```bash
git add src/components/map/TrailLayer.js src/hooks/useGroupTrails.js src/screens/GroupMapScreen.js src/screens/GroupDetailScreen.js App.js
git commit -m "add group map with member-coloured shared trails"
git push origin main-CleanVersion
```

---

## Task 6: Offline round-trip verification (device-only, no code)

**DEVICE CHECKPOINT (STOP for user), all on @hunter unless noted:**

- [x] 1. Airplane mode ON → share a hunt → toggle flips instantly, status "Waiting for signal"; close/reopen sheet — state persists. PASS 2026-07-30.
- [x] 2. Still offline: kill + relaunch the app → sheet still shows "Waiting for signal" (desired state survived). SKIPPED 2026-07-30 — Expo Go cannot cold-launch offline (bundle download needs network); not a code issue, re-verify in a standalone (EAS) build.
- [x] 3. Airplane mode OFF → within a few seconds (netinfo trigger) status settles to "Shared"; @test sees the trail. PASS 2026-07-30 (row confirmed in table editor).
- [x] 4. Airplane mode ON → share a second hunt, then unshare it, both offline → airplane OFF → **no row ever appears** in `shared_trails` for that hunt (net no-op — spec Decision 2's acceptance test). PASS 2026-07-30.
- [x] 5. Airplane mode ON → unshare the Task-4 trail → "Removing…" → airplane OFF → row deleted, @test's map clears. PASS 2026-07-30.
- [x] 6. @test leaves the outing (or @hunter removes them) → @test's previously shared rows vanish for remaining members (cleanup trigger, visible in table editor); @test's own sheet settles the flag off via the revoked path on next sync. PASS 2026-07-30 (@test removed from outing, zero @test rows remain in shared_trails; trigger behaviour matches RLS-test check 8).
- [x] 7. Regression: record a hunt start-to-finish, Sessions list/detail, theme + TOPO/SAT toggles, Friends + outing flows — all unchanged. PASS 2026-07-30.
- [x] Fix anything that fails (systematic-debugging), commit + push fixes, re-run the failed step. — Nothing failed; no fixes needed.

---

## Task 7: Completion — Security Review + final code review + close-out

- [x] 1. **Security Review skill** over the whole phase (GPS coordinates now in DB — flagged phase): re-verify RLS answers from Task 1's script against final code; check no coordinates/tokens logged; confirm unshared hunts have no upload path; confirm reconciler can't be tricked into sharing to a foreign group (RLS is the backstop). PASS 2026-07-30 — all 5 checks verified, no Critical/Important findings (details in `.superpowers/sdd/progress.md`).
- [x] 2. **/code-review** (Code Reviewer pass) over the phase diff; triage findings — fix Critical/Important, ledger the rest. DONE 2026-07-30 — user-triaged: 3 fixes applied (group-map centring via animateToRegion [confirmed real on device: map opened on fallback region], dead import removed, refresh spinner), remainder ledgered.
- [x] 3. Close-out: mark Phase 4 ✅ COMPLETE in this plan's header + the foundation spec's Phase 4 line; update `.superpowers/sdd/progress.md`; final commit + push. DONE 2026-07-30.

---

## Self-Review Notes (writing-plans checklist)

- **Spec coverage:** tables/RLS/trigger → Task 1; payload/colours/utils → Task 2; desired-state + reconciler + error semantics → Task 3; share UI + triggers + delete-unshare → Task 4; group map + colour rendering → Task 5; offline acceptance incl. the no-op test → Task 6; Security Review → Task 7. Open Questions 1–5 assumed at their recommendations (header warning).
- **Type consistency:** `setDesired(huntId, groupId, bool)` / `getServerCache()` names match across Tasks 3–4; `colorForMember(userId, myId, memberIds)` matches Tasks 2/5; `listGroupTrails` column list matches GroupMapScreen usage; `TrailLayer` prop `color` matches Task 5 usage.
- **No placeholders:** UI tasks describe exact behavior + reuse named existing styles/components rather than dumping full JSX; all logic-bearing code is written out.
