# Phase 5 — Live Position + Safety Implementation Plan

> **Status: APPROVED (2026-08-26).** Spec
> (`docs/superpowers/specs/2026-08-26-phase-5-live-position-safety-design.md`) approved with all
> three original open items resolved (live dots → GroupMapScreen; Apple design guidance written
> directly into spec/tasks, no skill dependency; `expo-haptics` approved as a new dependency).
> RLS policies (Task 1) reviewed verbatim and approved, including the `shares_group_with`
> "any shared outing, ever" scope (accepted for a private family app; managed by closing finished
> outings rather than adding date-range scoping). Pre-existing `GroupMapScreen` hardcoded tile URL
> fixed as a standalone commit (`7a56a8a`) ahead of implementation. Execution: subagent-driven
> with review gates between tasks (Phase 4 model).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a hunter is actively recording, their live position uploads to the group; every
outing co-member sees everyone's live dot (member colour, grey when stationary) on the existing
Group map, and gets one haptic + banner alert on entering/leaving anyone's safety warning radius —
all built with Apple-HIG-consistent motion (springs for movement, eases for state change,
edge-triggered haptics, no continuous vibration).

**Architecture:** One `member_positions` row per user (upsert), matching the foundation spec.
Upload side: a heartbeat hook (`useLivePositionSync`) mounted in `MapScreen` alongside the
existing `useGPSTracking()` call, active only while `isRecording`. Read side for the group map:
`useGroupLivePositions` (fetch + Realtime subscribe, RLS-scoped) feeding a new `FriendDot` marker
component rendered on `GroupMapScreen` next to the existing Phase-4 trail polylines. A third,
non-visual hook (`useProximitySafety`) runs the ambient safety check independent of which screen
is open, also mounted in `MapScreen`, firing edge-triggered haptics + a spring-in/out banner.

**Tech Stack:** Expo SDK 54 / RN 0.81, `@supabase/supabase-js` v2 (first use of Realtime
`postgres_changes` in this app), react-native-maps 1.20, `expo-haptics` (**new** — bundled/pinned
by Expo, added via `npx expo install`), existing `Animated` API (no reanimated needed).

## Global Constraints

- **Offline-first stays intact elsewhere:** this phase does NOT touch trail recording, sharing, or
  historical hunts — local-first GPS/AsyncStorage flows are unmodified. Live position upload is a
  best-effort heartbeat (fails silently, retries next tick) — never blocks recording.
- **Verification model (Phases 1–4 convention):** no jest / testing-library — do NOT add them.
  Pure functions get one-off `node --input-type=module -e` checks; schema/RLS via user-run
  Supabase SQL editor scripts; app flows via Expo Go device checkpoints with two accounts
  (@hunter + @test). STOP at each device checkpoint for user confirmation.
- **Every new table:** `GRANT ... TO anon, authenticated;` + `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY;` (CLAUDE.md floor), then narrow with policies.
- **Migration numbering:** next file is `0007_member_positions.sql` (0001–0006 exist and are
  applied). Forward-only: never edit applied migrations.
- **Public repo:** no secrets, no UUIDs/emails/personal data in committed files.
- **UI:** tap targets ≥44×44pt; every network/GPS-adjacent action has a loading/fallback state;
  friendly errors; colours from `constants/themes.js` (`GREEN #5FCE5F`, `RED_STOP #E24B4A`, new
  `GREY_STATIONARY #888780`), surfaces via `useTheme()`.
- **Apple Design Standards (spec, "Apple Design Standards" section) — apply verbatim, not
  paraphrased, in every task that touches motion or haptics:** springs
  (`damping: 15, mass: 1, stiffness: 180`) for anything that physically appears/moves; 250ms
  `Easing.out(Easing.cubic)` timing for simple state/colour/text changes; haptics are
  edge-triggered only, never on a timer/loop (`Haptics.notificationAsync(Warning)` on entering a
  radius, `Haptics.impactAsync(Light)` on leaving); reuse `PositionDot`'s
  tracksViewChanges-true-for-600ms-then-false capture technique for any new `Marker`/
  `MarkerAnimated` — never animate a `View`'s `backgroundColor` directly inside a Marker.
- **Guard every coordinate** with `isValidCoord` before upload and before rendering.
- **Branch/push:** work on `main-CleanVersion`; commit + push after every task.
- **Sensitive phase:** live GPS coordinates continuously written to the DB → **Security Review
  skill at Completion** (mandatory, per CLAUDE.md + foundation spec — this is the second and last
  flagged phase after Phase 4).

---

## File Structure

- `supabase/migrations/0007_member_positions.sql` — **create**: `member_positions` table + RLS +
  Realtime publication.
- `src/constants/themes.js` — **modify**: add `GREY_STATIONARY` export.
- `src/constants/gps.js` — **modify**: add `LIVE_POSITION_UPLOAD_INTERVAL_MS`,
  `STATIONARY_DISTANCE_M`, `STATIONARY_WINDOW_MS`.
- `src/utils/positionFormat.js` — **create**: pure `computeIsMoving`, `formatLastSeen`.
- `src/services/memberPositions.js` — **create**: `upsertMyPosition`, `listPositionsForUsers`,
  `subscribeToPositions`.
- `src/hooks/useGPSTracking.js` — **modify**: `currentPosition` gains an `accuracy` field.
- `src/hooks/useLivePositionSync.js` — **create**: upload heartbeat hook.
- `src/hooks/useGroupLivePositions.js` — **create**: fetch + subscribe hook for the group map.
- `src/hooks/useProximitySafety.js` — **create**: background safety-radius hook.
- `src/components/map/FriendDot.js` — **create**: group-member live marker.
- `src/screens/GroupMapScreen.js` — **modify**: render `FriendDot`s + legend live-time captions.
- `src/screens/MapScreen.js` — **modify**: mount `useLivePositionSync` + `useProximitySafety` +
  render the proximity banner.
- `package.json` — **modify**: add `expo-haptics`.

---

## Task 1: Migration 0007 — member_positions, RLS, Realtime publication

**Files:**
- Create: `supabase/migrations/0007_member_positions.sql`
- Create: `.superpowers/sdd/phase5-rls-test.sql` (user-run verification; gitignored dir)

**Interfaces:**
- Produces: table `public.member_positions(user_id, latitude, longitude, accuracy, is_moving,
  updated_at)`, RLS policies, Realtime publication membership. Consumed by Task 3
  (`memberPositions.js`) via supabase-js.

- [ ] **Step 1: Write the migration**

```sql
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
alter publication supabase_realtime add table if not exists public.member_positions;
```

- [ ] **Step 2: Write the user-run RLS verification script**

Create `.superpowers/sdd/phase5-rls-test.sql`, same impersonation pattern as the Phase 4 script
(`set_config('request.jwt.claims', ...)` + `set local role authenticated`, inside rolled-back
transactions):

```sql
-- Pattern for each check (full script assembled at execution time with real ids):
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '<USER-UUID>', 'role', 'authenticated')::text, true);
set local role authenticated;
-- ... assertion query ...
rollback;
```

Checks (each PASS/FAIL row), using two real user ids where @hunter and @test share an outing:
(1) non-co-member SELECT on the other's row → **0 rows**; (2) co-member SELECT → 1 row; (3) owner
SELECT own row → 1 row (even before sharing any outing); (4) INSERT with a forged `user_id`
(not `auth.uid()`) → 42501; (5) owner INSERT own row → succeeds; (6) non-owner UPDATE of the
owner's row → 42501/0 rows; (7) owner UPDATE own row (e.g. `is_moving`) → succeeds; (8) INSERT at
`(0,0)` → 23514 CHECK violation; (9) INSERT with `latitude = 91` → 23514 CHECK violation; (10)
owner DELETE own row → succeeds, 0 rows remain.

- [ ] **Step 3: User runs 0007 in the Supabase SQL editor** — expect "Success". STOP if any error.
  (If `alter publication ... add table if not exists` errors on an older Postgres without
  `IF NOT EXISTS` support for that clause, drop `if not exists` and re-run — Supabase's managed
  Postgres is recent enough that this should not happen, but flag it if it does.)

- [ ] **Step 4: User runs phase5-rls-test.sql** — every row PASS. STOP on any FAIL/PARTIAL.

- [ ] **Step 5: Realtime sanity check (manual, in Supabase dashboard)** — Database → Replication →
  confirm `member_positions` is listed under the `supabase_realtime` publication.

- [ ] **Step 6: Commit + push**

```bash
git add supabase/migrations/0007_member_positions.sql
git commit -m "add member_positions migration (RLS, single-owner rows, realtime publication)"
git push origin main-CleanVersion
```

---

## Task 2: Pure utils — positionFormat, stationary constants

**Files:**
- Create: `src/utils/positionFormat.js`
- Modify: `src/constants/gps.js`, `src/constants/themes.js`

**Interfaces:**
- Consumes: `haversineKm` from `src/utils/geoUtils.js`.
- Produces: `computeIsMoving(anchor, current, nowMs, opts?) → { isMoving, anchor }`;
  `formatLastSeen(updatedAtISO, nowMs?) → string`; `GREY_STATIONARY` (theme colour);
  `LIVE_POSITION_UPLOAD_INTERVAL_MS`, `STATIONARY_DISTANCE_M`, `STATIONARY_WINDOW_MS` (gps
  constants).

- [ ] **Step 1: Add constants to `src/constants/gps.js`**

```js
// Heartbeat interval for uploading this device's live position to the group
// (member_positions) while actively recording. Distinct from the trail
// recorder's own watcher cadence — this just needs to be "responsive enough
// for a group map", not survey-grade.
export const LIVE_POSITION_UPLOAD_INTERVAL_MS = 10_000;

// Stationary-dot rule (CLAUDE.md Safety Features): grey out a member's dot if
// they haven't moved more than this far within this time window.
export const STATIONARY_DISTANCE_M = 10;
export const STATIONARY_WINDOW_MS = 5 * 60 * 1000;
```

- [ ] **Step 2: Add `GREY_STATIONARY` to `src/constants/themes.js`**

Add next to the existing `export const RED_STOP = '#E24B4A';`:

```js
export const GREY_STATIONARY = '#888780';
```

- [ ] **Step 3: Create `src/utils/positionFormat.js`**

```js
import { haversineKm } from './geoUtils';
import { STATIONARY_DISTANCE_M, STATIONARY_WINDOW_MS } from '../constants/gps';

// hasn't moved > distanceM from the anchor within the last windowMs → stationary.
// Resets the anchor (and reports moving) the instant the hunter actually moves.
// Pure — no IO, no Date.now() call inside (nowMs is passed in).
export function computeIsMoving(anchor, current, nowMs, {
  distanceM = STATIONARY_DISTANCE_M, windowMs = STATIONARY_WINDOW_MS,
} = {}) {
  if (!anchor) return { isMoving: true, anchor: { coord: current, time: nowMs } };
  const movedM = haversineKm(anchor.coord, current) * 1000;
  if (movedM > distanceM) return { isMoving: true, anchor: { coord: current, time: nowMs } };
  if (nowMs - anchor.time >= windowMs) return { isMoving: false, anchor };
  return { isMoving: true, anchor };
}

// updatedAtISO → "just now" / "Xm ago" / "Xh ago" / "Xd ago", relative to nowMs.
export function formatLastSeen(updatedAtISO, nowMs = Date.now()) {
  if (!updatedAtISO) return '';
  const deltaMs = nowMs - new Date(updatedAtISO).getTime();
  if (deltaMs < 60_000) return 'just now';
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 4: Node-verify the pure functions**

Run a `node --input-type=module` check: `computeIsMoving(null, {latitude:1,longitude:1}, 1000)` →
`isMoving true`, anchor set to that coord/time; same anchor, a point 15m away (roughly
`{latitude: anchor.lat + 0.000135, longitude: anchor.lng}`), any time → `isMoving true`, anchor
reset to the new point; same anchor, a point 2m away, `nowMs = anchor.time + 4*60*1000` (under 5
min) → `isMoving true`, anchor **unchanged**; same anchor, a point 2m away,
`nowMs = anchor.time + 6*60*1000` (over 5 min) → `isMoving false`. `formatLastSeen`:
`nowMs - updated = 30_000` → `'just now'`; `= 90_000` → `'1m ago'`; `= 3_700_000` → `'1h ago'`;
`= 200_000_000` → `'2d ago'`. Expected: all `true`. Then `node --check` on all three touched files.

- [ ] **Step 5: Commit + push**

```bash
git add src/utils/positionFormat.js src/constants/gps.js src/constants/themes.js
git commit -m "add live-position pure utils: stationary detection, relative-time formatting"
git push origin main-CleanVersion
```

---

## Task 3: memberPositions service + upload heartbeat, wired into MapScreen

**Files:**
- Create: `src/services/memberPositions.js`, `src/hooks/useLivePositionSync.js`
- Modify: `src/hooks/useGPSTracking.js`, `src/screens/MapScreen.js`

**Interfaces:**
- Consumes: `isValidCoord` (`geoUtils.js`), `computeIsMoving` (Task 2),
  `LIVE_POSITION_UPLOAD_INTERVAL_MS`/`MAX_ACCURACY_METERS` (`constants/gps.js`), `supabase`
  (`services/supabase.js`).
- Produces: `upsertMyPosition({latitude, longitude, accuracy, is_moving}) → Promise<void>`;
  `listPositionsForUsers(userIds) → Promise<rows>`; `subscribeToPositions(onChange) →
  unsubscribeFn`; `useLivePositionSync(currentPosition, isRecording)` (mount-once-per-screen hook,
  no return value); `currentPosition` from `useGPSTracking()` gains an `accuracy` field (was
  `{latitude, longitude}`, now `{latitude, longitude, accuracy}`).

- [ ] **Step 1: Add `accuracy` to `currentPosition` in `useGPSTracking.js`**

In the idle-watcher callback (`useGPSTracking.js`, the `idleWatcher.current = await
Location.watchPositionAsync(...)` block), change:

```js
const coord = {
  latitude: loc.coords.latitude,
  longitude: loc.coords.longitude,
};
```

to:

```js
const coord = {
  latitude: loc.coords.latitude,
  longitude: loc.coords.longitude,
  accuracy: loc.coords.accuracy ?? null,
};
```

And in the recording-watcher callback (the `recordingWatcher.current = await
Location.watchPositionAsync(...)` block), same change to its `coord` object (right above the
`isValidCoord(coord)` check). This is additive — `isValidCoord` only reads `latitude`/`longitude`
and every existing consumer of `currentPosition` (e.g. `PositionDot`) destructures only those two
fields, so nothing downstream breaks.

- [ ] **Step 2: Create `src/services/memberPositions.js`**

```js
import { supabase } from './supabase';

export async function upsertMyPosition({ latitude, longitude, accuracy, is_moving }) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) { const e = new Error('Not signed in'); e.code = 'NOT_SIGNED_IN'; throw e; }
  const { error: upsertError } = await supabase
    .from('member_positions')
    .upsert(
      {
        user_id: data.user.id,
        latitude,
        longitude,
        accuracy,
        is_moving,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  if (upsertError) throw upsertError;
}

export async function listPositionsForUsers(userIds) {
  if (!userIds?.length) return [];
  const { data, error } = await supabase
    .from('member_positions')
    .select('user_id, latitude, longitude, accuracy, is_moving, updated_at')
    .in('user_id', userIds);
  if (error) throw error;
  return data ?? [];
}

// No server-side filter — RLS already narrows the stream to rows the caller
// may see (own row, or anyone they share an outing with). Callers filter
// further by their own memberIds since a user may share multiple outings.
export function subscribeToPositions(onChange) {
  const channel = supabase
    .channel('member_positions_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'member_positions' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
```

- [ ] **Step 3: Create `src/hooks/useLivePositionSync.js`**

```js
import { useEffect, useRef } from 'react';
import { isValidCoord } from '../utils/geoUtils';
import { computeIsMoving } from '../utils/positionFormat';
import { upsertMyPosition } from '../services/memberPositions';
import { LIVE_POSITION_UPLOAD_INTERVAL_MS, MAX_ACCURACY_METERS } from '../constants/gps';

// Heartbeat upload of this device's own position to member_positions while
// actively recording. A FIXED INTERVAL (not a reaction to each GPS callback)
// is deliberate: it's what keeps "X min ago" advancing and is_moving correct
// even when the hunter is genuinely stationary and no new GPS fix arrives.
// Mounted in MapScreen — its own useEffect cleanup handles isRecording
// flipping false or the screen's watchers tearing down.
export function useLivePositionSync(currentPosition, isRecording) {
  const anchorRef = useRef(null);
  const positionRef = useRef(currentPosition);
  positionRef.current = currentPosition;

  useEffect(() => {
    if (!isRecording) { anchorRef.current = null; return undefined; }

    const tick = async () => {
      const coord = positionRef.current;
      if (!coord || !isValidCoord(coord)) return;
      if (coord.accuracy != null && coord.accuracy > MAX_ACCURACY_METERS) return;

      const { isMoving, anchor } = computeIsMoving(anchorRef.current, coord, Date.now());
      anchorRef.current = anchor;

      try {
        await upsertMyPosition({
          latitude: coord.latitude,
          longitude: coord.longitude,
          accuracy: coord.accuracy ?? null,
          is_moving: isMoving,
        });
      } catch {
        // Offline or transient error — next heartbeat retries. No local
        // queue: a stale "last known position" is an acceptable outcome
        // here (the row just doesn't advance until signal returns).
      }
    };

    tick(); // first upload immediately, don't wait a full interval
    const id = setInterval(tick, LIVE_POSITION_UPLOAD_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRecording]);
}
```

- [ ] **Step 4: Wire into `MapScreen.js`**

Add the import and call it right after the existing `useGPSTracking()` destructure (near
`MapScreen.js:34-44`):

```js
import { useLivePositionSync } from '../hooks/useLivePositionSync';
```

```js
const {
  isRecording,
  trailPoints,
  currentPosition,
  distance,
  elapsed,
  speed,
  startRecording,
  stopRecording,
} = useGPSTracking();

useLivePositionSync(currentPosition, isRecording);
```

- [ ] **Step 5: `node --check` on all touched files**, then `npx expo start` and confirm the app
  boots with no red screen and existing recording still works (start/stop a short hunt, trail
  still draws, distance still counts).

- [ ] **Step 6: DEVICE CHECKPOINT (STOP for user)** — @hunter: start recording → within ~10s a row
  appears in the `member_positions` table (Supabase table editor) for @hunter's user id, with
  sane `latitude`/`longitude`/`accuracy` and `is_moving = true`; stop recording → no more updates
  to that row (heartbeat stopped), but the row is **not deleted**; existing recording/trail/
  distance/Sessions flows all unaffected.

- [ ] **Step 7: Commit + push**

```bash
git add src/services/memberPositions.js src/hooks/useLivePositionSync.js src/hooks/useGPSTracking.js src/screens/MapScreen.js
git commit -m "add live position upload heartbeat while recording"
git push origin main-CleanVersion
```

---

## Task 4: FriendDot + useGroupLivePositions — live dots on the group map

**Files:**
- Create: `src/components/map/FriendDot.js`, `src/hooks/useGroupLivePositions.js`
- Modify: `src/screens/GroupMapScreen.js`

**Interfaces:**
- Consumes: `listPositionsForUsers`, `subscribeToPositions` (Task 3); `colorForMember`
  (`utils/memberColors.js`, Phase 4); `GREY_STATIONARY` (Task 2); `formatLastSeen` (Task 2);
  `isValidCoord`.
- Produces: `FriendDot({coordinate, color, isMoving})`; `useGroupLivePositions(memberIds) →
  {positions: {[userId]: row}, loading}`.

- [ ] **Step 1: Create `src/components/map/FriendDot.js`**

```js
import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { MarkerAnimated } from 'react-native-maps';
import { isValidCoord } from '../../utils/geoUtils';
import { GREY_STATIONARY } from '../../constants/themes';

// Group-member dot on the group map. Same white-disc/dark-ring construction
// as PositionDot (own dot) for contrast on any terrain/theme — only the inner
// fill colour differs (member colour, or GREY_STATIONARY when stationary).
//
// The colour <-> grey transition is an OPACITY CROSSFADE between two overlaid
// static dots (Apple Design Standards rule 3, Phase 5 spec) — never a live
// colour animation on one view, which would require permanent
// tracksViewChanges=true and reproduce the (0,0) ghost bug PositionDot works
// around (see CLAUDE.md Known Quirks).
export function FriendDot({ coordinate, color, isMoving }) {
  if (!isValidCoord(coordinate)) return null;
  return (
    <>
      <DotLayer coordinate={coordinate} color={color} visible={isMoving} />
      <DotLayer coordinate={coordinate} color={GREY_STATIONARY} visible={!isMoving} />
    </>
  );
}

const DotLayer = React.memo(function DotLayer({ coordinate, color, visible }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [tracks, setTracks] = useState(true);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Capture one clean static frame, then stop regenerating the marker
    // image forever — same ghost-avoidance rule as PositionDot.
    const stop = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(stop);
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      // First appearance: spring in (Apple Design Standards rule 1 —
      // physical motion, not a state change).
      Animated.spring(opacity, {
        toValue: visible ? 1 : 0,
        useNativeDriver: false,
        damping: 15,
        mass: 1,
        stiffness: 180,
      }).start();
      return;
    }
    // Later visibility changes (stationary <-> moving crossfade): a simple
    // ease, not a spring — this is a state change, not movement (rule 1).
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [visible, opacity]);

  return (
    <MarkerAnimated
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      opacity={opacity}
      tracksViewChanges={tracks}
    >
      <View style={styles.dotWrap}>
        <View style={styles.dotOuter}>
          <View style={[styles.dotInner, { backgroundColor: color }]} />
        </View>
      </View>
    </MarkerAnimated>
  );
});

const styles = StyleSheet.create({
  dotWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  dotOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  dotInner: { width: 12, height: 12, borderRadius: 6 },
});
```

- [ ] **Step 2: Create `src/hooks/useGroupLivePositions.js`**

```js
import { useState, useEffect, useCallback, useRef } from 'react';
import { listPositionsForUsers, subscribeToPositions } from '../services/memberPositions';

// Live positions for a specific set of member ids (a group's roster). Seeds
// from a fetch, then applies Realtime events for the lifetime of the mount.
// RLS already narrows the change stream to rows this user may see; this hook
// additionally filters to memberIds because a user may share multiple
// outings and this screen only cares about one.
export function useGroupLivePositions(memberIds) {
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(true);
  const memberIdSetRef = useRef(new Set());
  memberIdSetRef.current = new Set(memberIds);
  const idsKey = memberIds.join(',');

  const load = useCallback(async () => {
    if (!memberIds.length) { setPositions({}); setLoading(false); return; }
    try {
      const rows = await listPositionsForUsers(memberIds);
      const byId = {};
      for (const r of rows) byId[r.user_id] = r;
      setPositions(byId);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeToPositions((payload) => {
      const isDelete = payload.eventType === 'DELETE';
      const row = isDelete ? payload.old : payload.new;
      if (!row?.user_id || !memberIdSetRef.current.has(row.user_id)) return;
      setPositions((prev) => {
        if (isDelete) {
          const next = { ...prev };
          delete next[row.user_id];
          return next;
        }
        return { ...prev, [row.user_id]: row };
      });
    });
    return unsubscribe;
  }, []);

  return { positions, loading };
}
```

- [ ] **Step 3: Wire into `GroupMapScreen.js`**

Add imports:

```js
import { FriendDot } from '../components/map/FriendDot';
import { useGroupLivePositions } from '../hooks/useGroupLivePositions';
import { formatLastSeen } from '../utils/positionFormat';
```

After the existing `const { trails, loading, error, refresh } = useGroupTrails(groupId);` line,
add:

```js
const { positions: livePositions } = useGroupLivePositions(memberIds);
```

(Note: `memberIds` is already computed below in the current file as `members.map((m) =>
m.user_id)` — move that one line above this call so `memberIds` exists before it's used, since
JS `const` isn't hoisted.)

Extend the region-input point list — change:

```js
const allPoints = rendered.flatMap((r) => r.pts);
```

to:

```js
const livePoints = Object.values(livePositions).filter(isValidCoord);
const allPoints = [...rendered.flatMap((r) => r.pts), ...livePoints];
```

Render the dots — inside the `<MapView>`, right after the `{rendered.map(...)}` block:

```jsx
{Object.values(livePositions).map((p) => (
  <FriendDot
    key={p.user_id}
    coordinate={{ latitude: p.latitude, longitude: p.longitude }}
    color={colorForMember(p.user_id, myId, memberIds)}
    isMoving={p.is_moving}
  />
))}
```

Extend the legend to include members with a live position even if they have no shared trail yet,
and add a relative-time caption. Replace:

```js
const ownerIds = [...new Set(rendered.map((r) => r.trail.owner_id))];
const legend = ownerIds.map((id) => {
  const member = members.find((m) => m.user_id === id);
  return {
    id,
    color: colorForMember(id, myId, memberIds),
    name: member?.username ? `@${member.username}` : (id === myId ? 'You' : 'Member'),
  };
});
```

with:

```js
const ownerIds = [...new Set(rendered.map((r) => r.trail.owner_id))];
const legendIds = [...new Set([...ownerIds, ...Object.keys(livePositions)])];
const legend = legendIds.map((id) => {
  const member = members.find((m) => m.user_id === id);
  return {
    id,
    color: colorForMember(id, myId, memberIds),
    name: member?.username ? `@${member.username}` : (id === myId ? 'You' : 'Member'),
    lastSeen: livePositions[id]?.updated_at ?? null,
  };
});
```

Add a small crossfading time component above the `st` StyleSheet at the bottom of the file:

```jsx
function LegendTime({ text, color }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const prevText = useRef(text);

  useEffect(() => {
    if (prevText.current === text) return;
    prevText.current = text;
    opacity.setValue(0);
    // Simple ease crossfade — a relative-time label ticking up is a state
    // change, not movement (Apple Design Standards rule 1).
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [text, opacity]);

  return (
    <Animated.Text style={[st.legendTime, { color, opacity }]} numberOfLines={1}>
      {text}
    </Animated.Text>
  );
}
```

Add the two missing imports this needs at the top of the file: `Animated` from `react-native`
(added to the existing `import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator }
from 'react-native';` line) and `useRef`/`useEffect` (already imported at the top of the file).

Render it inside the existing legend chip map — change:

```jsx
{legend.map((l) => (
  <View key={l.id} style={[st.legendChip, { backgroundColor: T.card, borderColor: T.cardBorder }]}>
    <View style={[st.legendDot, { backgroundColor: l.color }]} />
    <Text style={[st.legendName, { color: T.text }]} numberOfLines={1}>
      {l.name}
    </Text>
  </View>
))}
```

to:

```jsx
{legend.map((l) => (
  <View key={l.id} style={[st.legendChip, { backgroundColor: T.card, borderColor: T.cardBorder }]}>
    <View style={[st.legendDot, { backgroundColor: l.color }]} />
    <View>
      <Text style={[st.legendName, { color: T.text }]} numberOfLines={1}>
        {l.name}
      </Text>
      {l.lastSeen && <LegendTime text={formatLastSeen(l.lastSeen)} color={T.textDim} />}
    </View>
  </View>
))}
```

Add one style to the `st` StyleSheet:

```js
legendTime: { fontSize: 11, marginTop: 1 },
```

- [ ] **Step 4: `node --check` on all touched files**, then `npx expo start` and confirm the app
  boots with no red screen.

- [ ] **Step 5: DEVICE CHECKPOINT (STOP for user)** — two accounts, both recording, sharing an
  outing: open Group map on @hunter's device → @test's dot appears in @test's assigned colour
  (amber/blue, not green) within ~10s and springs in smoothly (not a hard pop-in); legend shows
  @test with a ticking "Xm ago" caption; @test stops moving for 5+ minutes → @hunter sees @test's
  dot crossfade to grey (not an instant colour swap); @test starts moving again → dot crossfades
  back to their colour; @hunter's own dot also renders (green, "You"); a member with a live
  position but no shared trail yet still shows a dot + legend chip; solo Sessions/Map flows and
  Phase-4 trail rendering are all unaffected.

- [ ] **Step 6: Commit + push**

```bash
git add src/components/map/FriendDot.js src/hooks/useGroupLivePositions.js src/screens/GroupMapScreen.js
git commit -m "add live member dots (Apple-spring appear, crossfade stationary) to group map"
git push origin main-CleanVersion
```

---

## Task 5: Proximity safety — haptics + banner on MapScreen

**Files:**
- Create: `src/hooks/useProximitySafety.js`
- Modify: `src/screens/MapScreen.js`
- Run: `npx expo install expo-haptics`

**Interfaces:**
- Consumes: `subscribeToPositions` (Task 3); `getMyProfile` (`services/profiles.js`, Phase 1);
  `haversineKm`, `isValidCoord` (`geoUtils.js`); `RED_STOP` (`constants/themes.js`).
- Produces: `useProximitySafety(isRecording, myPosition) → { userId } | null` (mount-once-per-
  screen hook); `<ProximityBanner visible T />` component rendered in `MapScreen`.

- [ ] **Step 1: Install expo-haptics**

```bash
npx expo install expo-haptics
```

Commit `package.json` + lockfile as part of this task's Step 6 commit.

- [ ] **Step 2: Create `src/hooks/useProximitySafety.js`**

```js
import { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { haversineKm, isValidCoord } from '../utils/geoUtils';
import { subscribeToPositions } from '../services/memberPositions';
import { getMyProfile } from '../services/profiles';
import { supabase } from '../services/supabase';

// Background proximity safety check. Renders nothing itself — live DOTS stay
// GroupMapScreen-only (Phase 5 spec Decision 1), but the safety net is
// ambient: it runs whenever isRecording is true, wherever the user is in the
// app, because CLAUDE.md's Safety Features description ("vibrate warning if
// any group member's last known position is within a configurable distance")
// is written as an always-on safety net, not something tied to one screen.
// Mounted in MapScreen, which (per useGPSTracking's own doc comments) keeps
// its watchers running across tab switches via React Navigation's default
// keep-mounted behavior — this hook rides the same lifetime.
//
// Deliberately not scoped to one outing's memberIds: physical safety doesn't
// care which specific outing a nearby co-member's row came from, only that
// they're someone you share ground with. shares_group_with (the RLS predicate
// already gating this stream) is the right "family at large" scope here —
// same simplification Phase 1 already applies to profile visibility.
//
// Shows one nearby id at a time (family-scale simplification, matches the
// project's established "good enough" bar) and does not resolve a display
// name — the banner text is generic, keeping this hook self-contained
// without threading roster data through it.
export function useProximitySafety(isRecording, myPosition) {
  const [nearby, setNearby] = useState(null);
  const insideRef = useRef(new Set());
  const warningRangeRef = useRef(300);
  const myIdRef = useRef(null);
  const myPositionRef = useRef(myPosition);
  myPositionRef.current = myPosition;

  useEffect(() => {
    if (!isRecording) {
      insideRef.current = new Set();
      setNearby(null);
      return undefined;
    }

    let unsubscribe = () => {};
    let cancelled = false;

    (async () => {
      const [{ data: userData }, profile] = await Promise.all([
        supabase.auth.getUser(),
        getMyProfile().catch(() => null),
      ]);
      if (cancelled) return;
      myIdRef.current = userData?.user?.id ?? null;
      warningRangeRef.current = profile?.warning_range_m ?? 300;

      unsubscribe = subscribeToPositions((payload) => {
        if (payload.eventType === 'DELETE') return;
        const row = payload.new;
        if (!row?.user_id || row.user_id === myIdRef.current) return;
        const mine = myPositionRef.current;
        if (!mine || !isValidCoord(mine) || !isValidCoord(row)) return;

        const distanceM = haversineKm(mine, row) * 1000;
        const wasInside = insideRef.current.has(row.user_id);
        const isInside = distanceM < warningRangeRef.current;

        if (isInside && !wasInside) {
          insideRef.current.add(row.user_id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setNearby({ userId: row.user_id });
        } else if (!isInside && wasInside) {
          insideRef.current.delete(row.user_id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setNearby((cur) => (cur?.userId === row.user_id ? null : cur));
        }
      });
    })();

    return () => { cancelled = true; unsubscribe(); };
  }, [isRecording]);

  return nearby;
}
```

- [ ] **Step 3: Wire into `MapScreen.js`**

Add the import:

```js
import { useProximitySafety } from '../hooks/useProximitySafety';
import { Animated } from 'react-native'; // add Animated to the existing react-native import if not already present
import { RED_STOP } from '../constants/themes';
```

Right after the `useLivePositionSync(currentPosition, isRecording);` line added in Task 3:

```js
const nearby = useProximitySafety(isRecording, currentPosition);
```

Add the banner component in the same file, above the default export:

```jsx
function ProximityBanner({ visible, T }) {
  const translateY = useRef(new Animated.Value(-40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Presenting/dismissing an alert element is physical motion — spring for
    // the position, ease for the fade (Apple Design Standards rule 1).
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: visible ? 0 : -40,
        useNativeDriver: true,
        damping: 15,
        mass: 1,
        stiffness: 180,
      }),
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [visible, translateY, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        staticStyles.proximityBanner,
        { backgroundColor: T.card, borderColor: RED_STOP, opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={[staticStyles.proximityText, { color: RED_STOP }]}>
        Someone from your outing is close by
      </Text>
    </Animated.View>
  );
}
```

Render it inside the root `<View>`, as a sibling to the `<MapView>` (always mounted, never
conditionally — so both the spring-in and spring-out play):

```jsx
<ProximityBanner visible={!!nearby} T={T} />
```

Add to `staticStyles` (or the file's existing StyleSheet — match whatever it's actually named in
`MapScreen.js`):

```js
proximityBanner: {
  position: 'absolute',
  left: 16,
  right: 16,
  top: 100, // below the top HUD elements — adjust to sit clear of existing controls
  borderRadius: 12,
  borderWidth: StyleSheet.hairlineWidth,
  paddingVertical: 10,
  paddingHorizontal: 14,
  zIndex: 20,
},
proximityText: {
  fontSize: 13,
  fontWeight: '700',
  textAlign: 'center',
},
```

- [ ] **Step 4: `node --check` on all touched files**, then `npx expo start` and confirm the app
  boots with no red screen.

- [ ] **Step 5: DEVICE CHECKPOINT (STOP for user)** — two accounts, both recording, sharing an
  outing: @test walks within @hunter's `warning_range_m` (temporarily lower it via Profile → 
  Warning distance to make this easy to trigger on foot) → @hunter feels **one** haptic buzz (not
  repeating) and the banner springs in from the top; @test walks back out → @hunter feels a
  lighter haptic and the banner springs back out; this works whether @hunter has `MapScreen` or a
  different tab focused (confirms the "ambient, not screen-scoped" design); stopping recording
  clears any active banner and stops further haptics.

- [ ] **Step 6: Commit + push**

```bash
git add package.json package-lock.json src/hooks/useProximitySafety.js src/screens/MapScreen.js
git commit -m "add proximity safety check: edge-triggered haptics + spring banner"
git push origin main-CleanVersion
```

---

## Task 6: Full round-trip device verification (two accounts, no code)

**DEVICE CHECKPOINT (STOP for user), @hunter + @test, both actively recording and sharing an
outing:**

- [ ] 1. Open Group map on both devices → both dots appear on both screens, correct colours
  (self green on each device, the other in their assigned colour), spring in smoothly.
- [ ] 2. One account stays still 5+ minutes → their dot greys on the other's screen; resumes
  moving → dot returns to colour. Cross-check against the `is_moving` column in the Supabase table
  editor to confirm it's not just a client-side illusion.
- [ ] 3. One account walks within the other's `warning_range_m` → exactly one haptic + banner
  in, no repeat buzzing while they stay inside; walks back out → one lighter haptic + banner out.
- [ ] 4. Stop recording on one account → their dot/legend caption stays on the other's group map
  (last known position, "X min ago" keeps advancing in the legend text since it's computed from
  the stored `updated_at`, even though no new row arrives) — confirms the "don't delete on stop"
  decision behaves as intended.
- [ ] 5. Airplane mode on one account mid-hunt → their dot simply stops advancing on the other's
  screen (stale "X min ago"), no crash, no error surfaced to either user; signal returns → dot
  resumes.
- [ ] 6. Full regression sweep: record a hunt start-to-finish (own dot/trail draw correctly, no
  change from before this phase), Sessions list/detail, Sharing (Phase 4 ShareSheet), theme +
  TOPO/SAT toggles, Friends + outing flows, existing Phase-4 group-map trail rendering — all
  unchanged.
- [ ] Fix anything that fails (systematic-debugging), commit + push fixes, re-run the failed step.

---

## Task 7: Completion — Security Review + final code review + close-out

- [ ] 1. **Security Review skill** over the whole phase (live GPS coordinates now continuously
  written to the DB — second and last flagged phase): re-verify RLS answers from Task 1's script
  against final code; confirm the Realtime channel is genuinely RLS-filtered on-device with two
  accounts (not just assumed from Supabase's docs); check no coordinates/tokens ever hit
  `console.*`; confirm `upsertMyPosition` can only ever write `auth.uid()`'s own row (client never
  sends a `user_id`, relies on the DB default/RLS); confirm no code path uploads a position outside
  an active recording session.
- [ ] 2. **/code-review** (Code Reviewer pass) over the phase diff; triage findings — fix
  Critical/Important, ledger the rest.
- [ ] 3. Close-out: mark this plan ✅ COMPLETE in its header + the foundation spec's Phase 5 line;
  update `.superpowers/sdd/progress.md`; final commit + push.

---

## Self-Review Notes (writing-plans checklist)

- **Spec coverage:** migration/RLS/Realtime → Task 1; stationary + relative-time pure utils →
  Task 2; upload heartbeat (incl. the `currentPosition.accuracy` gap found while writing this
  plan — `useGPSTracking` never exposed it before, needed for the spec's accuracy-filter promise)
  → Task 3; `FriendDot` + live dots + legend captions (Apple Design Standards rules 1/3/4/5) →
  Task 4; proximity safety (rule 2 haptics + rule 1 banner motion) → Task 5; device round-trip →
  Task 6; Security Review → Task 7. All three Decisions Locked and both architecture notes from
  the spec are reflected in task scope (proximity check is screen-independent per Task 5's
  design; no stop-sharing UI is added, matching the spec's explicit deferral).
- **Type consistency:** `computeIsMoving(anchor, current, nowMs, opts) → {isMoving, anchor}`
  matches between Task 2's definition and Task 3's `useLivePositionSync` usage;
  `formatLastSeen(iso, nowMs?)` matches between Task 2 and Task 4's `LegendTime`;
  `upsertMyPosition`/`listPositionsForUsers`/`subscribeToPositions` signatures match between
  Task 3's definition and Tasks 4/5's usage; `FriendDot({coordinate, color, isMoving})` matches
  between Task 4's definition and its call site; `useProximitySafety(isRecording, myPosition) →
  {userId}|null` matches between Task 5's definition and `MapScreen`'s usage.
- **No placeholders:** every step shows the actual code, not a description of it; the one
  genuinely open engineering judgment call (proximity check's `shares_group_with`-wide scope
  rather than one-outing scope) is explained inline with its rationale rather than left as a
  "handle appropriately."
