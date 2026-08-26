# Phase 5 — Live Position + Safety — Design Spec

_Status: approved design (2026-08-26). Child spec of `2026-06-19-social-foundation-design.md`
(Phase 5 section); supersedes that section where they differ (deviations called out inline)._

## Context

Phases 1–4 delivered auth, friends, hunt outings (groups), and per-path trail sharing. Phase 5
connects the **live** GPS stream to the social layer: while an outing is underway, group members
see each other's live position and get a proximity safety alert if someone gets too close (or,
read the other way, confirmation everyone's spread out safely). This is the **second** phase that
puts live GPS coordinates in the database (Phase 4 was historical trail snapshots; this is a
continuously-updated row) — **flagged Security Review phase**, same as Phase 1 and 4.

Nothing changes about existing recording, sharing, or the group map's trail rendering. This phase
is additive: one new table, one new upload hook, one new subscribe hook, dots on top of the
existing group map, and a background proximity check.

## Decisions Locked (user, 2026-08-26)

1. **Live position dots render on `GroupMapScreen`**, alongside the existing shared-trail
   polylines from Phase 4 — not on the main hunting `MapScreen`. `MapScreen` stays exactly as it
   is today (own trail + own `PositionDot` only); opening the group map is how you check on
   everyone.
2. **Apple design guidance is written directly into this spec and the task briefs** (see
   "Apple Design Standards" below) — no skill/tool dependency. The `apple-design` skill the user
   expected does not exist on this machine (checked project skills, user skills, and every
   installed plugin/marketplace cache); rather than reference something that might not resolve
   for whoever implements this, the concrete rules are inlined.
3. **`expo-haptics` is a new dependency**, installed via `npx expo install expo-haptics`
   (Expo-SDK-pinned, same pattern as `@react-native-community/netinfo` in Phase 4).

## Requirements (from foundation spec, carried forward)

- Upsert `member_positions` from the GPS watcher while online and actively recording a hunt.
- Realtime subscription so group co-members' dots update live, no polling.
- `FriendDot`: member-colour marker (reuses Phase 4's `colorForMember`), grey when stationary.
- Safety proximity check against `warning_range_m` (own profile setting, Phase 1); visibility
  scoped by RLS the same way Phase 4's shared trails are (co-members of any shared outing) —
  `safety_range_m` governs the group-map fetch/subscription scope (see Decision 2 in "Client
  architecture" below for exactly how).
- Stationary detection reuses the rule already documented in CLAUDE.md: **grey dot if the member
  hasn't moved more than 10 m in 5 minutes**.

## Current State (verified by reading the code)

- `useGPSTracking.js` is called **only inside `MapScreen.js`** — it is not lifted to a shared
  context. Its `idleWatcher` (always-on, `Accuracy.Balanced`) keeps `currentPosition` fresh even
  when not recording; the `recordingWatcher` (`Accuracy.BestForNavigation`) only runs between
  `startRecording`/`stopRecording` and is what drives `trailPoints`/`distance`. Because React
  Navigation's bottom-tab navigator keeps inactive tab screens mounted (not unmounted) by default,
  `MapScreen`'s watchers keep running when the user switches to another tab — this is already
  relied on for background trail recording and is exactly what lets a Phase-5 upload hook live
  inside `MapScreen` without needing to lift GPS state to the app root.
- `ProfileScreen.js` **already has** `safety_range_m` (default 5000 m, stepped 1–20 km) and
  `warning_range_m` (default 300 m, stepped 50–1000 m) live and user-editable (Phase 1). Phase 5
  is the first phase to actually *use* these values — nothing to add on the profile side.
- `GroupDetailScreen.js` already has a "Group map" row (`st.mapRow`, ≥44pt) navigating to
  `GroupMapScreen` (Phase 4). Phase 5 extends that screen; no new nav entry needed.
- `GroupMapScreen.js` (Phase 4) already has: `myId` (own `auth.uid()`), `members`/`memberIds`
  (`listGroupMembers`), `colorForMember`, a `mapRef` + one-shot `animateToRegion`, and a legend
  chip pattern (`colour dot + name`) at the bottom. Phase 5 adds a second data source (live
  positions) alongside the existing `useGroupTrails`, and extends the legend chips with a
  relative-time caption. **Note (out of scope, flagging only):** this screen's `UrlTile` still
  uses the old hardcoded Carto URLs (`a.basemaps.cartocdn.com`) that caused the "API KEY REQUIRED"
  watermark fixed elsewhere in `MapScreen.js`/`SessionsScreen.js` — it was missed because it
  wasn't touched by those fixes. Not part of this phase; call out separately.
- `PositionDot.js` is the reusable ghost-avoidance pattern: a `Marker` (solid dot) +
  `MarkerAnimated` (breathing-opacity halo), each with `tracksViewChanges` true for ~600 ms to
  capture one clean static frame then false forever — because a custom-view `Marker` rasterises
  its children into an image and iOS regenerates that image (spawning a duplicate at the (0,0)
  origin) every time `tracksViewChanges` is true during a re-render storm. `FriendDot` reuses this
  exact technique; it must **not** invent a new animation approach that re-triggers
  `tracksViewChanges`.
- `TrailLayer.js` already takes an optional `color` prop (default green) — the precedent Phase 5's
  `FriendDot` colour prop follows.
- `constants/themes.js` has `GREEN` and `RED_STOP` exported but **no stationary-grey constant** —
  CLAUDE.md's UI Standards table lists `#888780` for "Stationary member dot" but it was never
  added as a named export. Phase 5 adds it.
- `constants/gps.js` has `MIN_MOVE_METERS` (5) and `MAX_ACCURACY_METERS` (20) — reused as-is for
  filtering fixes before they're uploaded to `member_positions` (never upload a fix the trail
  recorder itself would have discarded).
- No `expo-haptics`, no lifted GPS context, no `member_positions` table/migration exist yet.
  `@supabase/supabase-js` v2.108 (Realtime `postgres_changes` supported, used already nowhere in
  this app yet — Phase 4 is fetch-and-refresh, not subscribed).

## Apple Design Standards (baked in, no skill dependency)

These rules apply to every new Phase-5 UI element (`FriendDot`, the GroupMapScreen legend's live
caption, the MapScreen proximity banner) and are referenced by exact name in each task's steps —
an implementer should not need to look anything up externally.

1. **Springs for movement/appearance, eases for simple value changes.** A dot's first appearance
   (a member's live row loads) animates in with `Animated.spring(scale/opacity, { toValue: 1,
   useNativeDriver: true, damping: 15, mass: 1, stiffness: 180 })` — this approximates iOS's
   default `UISpringTimingParameters` settle curve (~350 ms to rest, slight overshoot). A colour
   or text change (e.g. the legend's "3m ago" ticking up) crossfades with
   `Animated.timing({ duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true })`
   — no spring, because nothing is "moving" physically, just changing state. This split (spring =
   physical motion, ease = state change) is a real HIG distinction, not a stylistic default.
2. **No continuous/looping haptics.** Apple reserves sustained/repeating haptic feedback for a
   narrow set of system contexts (e.g. CarPlay turn-by-turn); a family safety app firing a buzz
   every tick while inside the warning radius reads as broken, not urgent, and drains the battery
   fastest at the exact moment it matters most. Every haptic call in this phase is **edge­-
   triggered** — fired once on the transition, never on a timer:
   - Entering the warning radius (was-outside → now-inside):
     `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)`.
   - Leaving the warning radius (was-inside → now-outside), a lighter confirmation, not a repeat
     of the warning: `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)`.
3. **Reuse the proven ghost-avoidance technique, don't reinvent it.** `FriendDot`'s stationary
   (member-colour ↔ grey) transition is built as two overlaid static `Marker` views cross-fading
   via `opacity` (exactly `PositionDot`'s halo technique — animate the native `opacity` prop, not
   the underlying view/colour), each captured once via the `tracksViewChanges`-true-for-600ms-
   then-false pattern. Animating a `View`'s `backgroundColor` directly inside a `Marker` would
   require permanent `tracksViewChanges={true}` and reproduce the (0,0) ghost bug documented in
   CLAUDE.md's Known Quirks.
4. **Timing values, not invented ones.** Dot appear/disappear: ~350 ms spring (rule 1). Colour/
   text crossfade: 250 ms ease (rule 1). The breathing halo pulse (if `FriendDot` gets one — see
   Task 4) reuses `PositionDot`'s existing 1150 ms-out/1150 ms-in loop verbatim, so a hunter
   looking at their own dot and a friend's dot on the same screen sees one consistent rhythm, not
   two competing ones.
5. **Contrast and legibility carry over unchanged.** `FriendDot` keeps `PositionDot`'s white-disc
   + dark-outline-ring construction (readable on both light and dark terrain, both themes) —
   only the inner fill colour changes (member colour, or grey when stationary).

## Database (migration `0007_member_positions.sql` — forward-only numbering)

### `member_positions` — one row per user (upsert), matches foundation spec

| column       | type             | notes                                              |
|--------------|------------------|-----------------------------------------------------|
| `user_id`    | uuid PK          | → `auth.users` cascade                              |
| `latitude`   | double precision | CHECK between -90 and 90                             |
| `longitude`  | double precision | CHECK between -180 and 180                           |
| `accuracy`   | double precision | nullable — reported GPS accuracy in metres           |
| `is_moving`  | boolean          | not null default true — client-computed (10m/5min)   |
| `updated_at` | timestamptz      | not null default now(), bumped on every upsert       |

Deviation from the foundation spec's column list: adds the not-null-island CHECK (same pattern as
`shared_waypoints` in Phase 4) since this is a raw lat/lng row, not an array — `isValidCoord`'s
client-side guard is the primary defence but the DB gets a backstop too.

```sql
constraint member_positions_not_null_island check (not (latitude = 0 and longitude = 0))
```

**RLS** (after the mandatory CLAUDE.md GRANT + ENABLE):
- SELECT: `auth.uid() = user_id OR public.shares_group_with(auth.uid(), user_id)` — reuses the
  Phase 3 helper as-is, no new predicate needed.
- INSERT: `auth.uid() = user_id`.
- UPDATE: `auth.uid() = user_id` (`using` and `with check` both, since only the owner's row can
  ever ​be touched — unlike `friendships`/`group_members` there is no two-party record here, so
  the Phase 3 column-restriction-trigger lesson doesn't apply: there is nothing to protect a
  column *from*, the whole row is single-owner).
- DELETE: `auth.uid() = user_id` — kept per the foundation spec's shape even though no UI calls it
  this phase (see "Out of Scope").
- **Realtime:** `alter publication supabase_realtime add table public.member_positions;` — RLS
  applies to the change stream per Supabase's Realtime+RLS integration, so a client only receives
  `postgres_changes` events for rows it's allowed to `SELECT` (own row, or a row belonging to
  anyone they share an outing with).

**Index:** `member_positions(updated_at)` per foundation spec (supports any future staleness
queries; not required by Phase 5's own reads, which are always by `user_id`).

## Client architecture

### 1. `src/services/memberPositions.js` — thin server ops (supabase-js)

- `upsertMyPosition({ latitude, longitude, accuracy, is_moving })` → upserts the caller's row
  (`user_id` set server-side from `auth.uid()` via the RLS `with check`, not sent by the client).
- `listPositionsForUsers(userIds)` → initial snapshot for a set of member ids (used to seed
  `GroupMapScreen` before the Realtime channel's first event arrives).
- `subscribeToPositions(onChange)` → wraps a single `supabase.channel(...).on('postgres_changes',
  { event: '*', schema: 'public', table: 'member_positions' }, onChange).subscribe()`; returns an
  unsubscribe function. **No server-side filter** — RLS already narrows the stream to rows the
  caller may see; the caller filters further by `memberIds` client-side (a user may share
  multiple outings, and this screen only cares about one).

### 2. `src/hooks/useLivePositionSync.js` — the upload side, mounted in `MapScreen`

Consumes `currentPosition`, `isRecording` (from the existing `useGPSTracking()` call already in
`MapScreen`). While `isRecording` is true, runs a heartbeat: every
`LIVE_POSITION_UPLOAD_INTERVAL_MS` (10 000 ms — new constant in `constants/gps.js`, distinct from
the trail recorder's 5 s/2 m watcher config), if `currentPosition` passes `isValidCoord`, computes
`is_moving` via the pure `computeIsMoving` helper (Task 2) against a `useRef`-held anchor
`{ coord, time }`, and calls `upsertMyPosition`. **A fixed-interval heartbeat (not a reaction to
each GPS callback)** is deliberate: it's what keeps "X min ago" advancing and `is_moving` correct
even during the exact scenario stationary detection cares about — long stretches with no new GPS
callback because the hunter hasn't moved. When `isRecording` becomes false, the interval is
cleared and no more uploads happen; the last row is **not deleted** (see Decision below), so
"last known position … X min ago" keeps working after the hunt ends, matching CLAUDE.md's existing
description of that feature.

Pure helper (`src/utils/positionFormat.js`):
```js
// hasn't moved > 10m from the anchor within the last 5 minutes → stationary.
// Resets the anchor (and reports moving) the instant the hunter actually moves.
export function computeIsMoving(anchor, current, nowMs, {
  distanceM = 10, windowMs = 5 * 60 * 1000,
} = {}) {
  if (!anchor) return { isMoving: true, anchor: { coord: current, time: nowMs } };
  const movedM = haversineKm(anchor.coord, current) * 1000;
  if (movedM > distanceM) return { isMoving: true, anchor: { coord: current, time: nowMs } };
  if (nowMs - anchor.time >= windowMs) return { isMoving: false, anchor };
  return { isMoving: true, anchor };
}
```

### 3. `src/hooks/useGroupLivePositions.js` — the read side, for `GroupMapScreen`

`useGroupLivePositions(memberIds) → { positions, loading }`. On mount/`memberIds` change: fetch
`listPositionsForUsers(memberIds)` for the initial snapshot, then `subscribeToPositions` and merge
any event whose `new.user_id` (or `old.user_id` for deletes) is in `memberIds` into local state;
unsubscribe in the `useEffect` cleanup (CLAUDE.md Realtime-cleanup quirk). `positions` is keyed by
`user_id` for O(1) lookup when rendering dots/legend.

### 4. `src/components/map/FriendDot.js` — the marker

`FriendDot({ coordinate, color, isMoving })` — same `Marker`+`MarkerAnimated` shape as
`PositionDot`, `isValidCoord` guard first (never render at (0,0)), fill colour is `color` when
`isMoving`, crossfades to `GREY_STATIONARY` (`#888780`, new export in `constants/themes.js`) when
not, per Apple Design Standards rule 3 (opacity cross-fade between two overlaid static views, not
a live colour animation). No breathing halo in v1 — that's reserved for the user's own
`PositionDot` so a busy group map with several dots doesn't turn into a wall of pulsing halos;
`FriendDot` is the solid-dot layer only. (If this reads as visually flat once on-device, a future
pass can add a *much* subtler halo — not blocking this phase.)

### 5. `GroupMapScreen.js` changes

- `useGroupLivePositions(memberIds)` alongside the existing `useGroupTrails(groupId)`.
- Render one `<FriendDot key={p.user_id} coordinate={{latitude, longitude}}
  color={colorForMember(p.user_id, myId, memberIds)} isMoving={p.is_moving} />` per position row
  (including the caller's own row — same "self is always green" rule the trails already use, via
  the same `colorForMember` call).
- The existing legend chip gains a second line: relative time from `formatLastSeen(updated_at)`
  (Task 2, `src/utils/positionFormat.js`; `"just now"` / `"3m ago"` / `"2h ago"` / `"3d ago"`),
  crossfading on tick per Apple Design Standards rule 1. A member with a shared trail but no live
  position row keeps today's colour-dot-only chip unchanged.
- `region`/`animateToRegion` inputs extend to include live-position coordinates alongside trail
  points, so a member with a live dot but no shared trail yet still pulls the initial framing
  toward them.

### 6. `src/hooks/useProximitySafety.js` — background safety check, mounted in `MapScreen`

**Architecture note (flagging, not an open question):** live dots are GroupMapScreen-only per
Decision 1, but CLAUDE.md's existing Safety Features description ("vibrate warning if any group
member's last known position is within a configurable distance") is written as an ambient safety
net while hunting — not something that should only work while a specific screen happens to be
open. This hook reconciles the two: it renders **nothing** (no dots, no map UI — that stays
GroupMapScreen-only) and runs purely in the background whenever `isRecording` is true, wherever
the user is in the app (mounted inside `MapScreen`, which per the "Current State" section above
keeps running via its GPS watchers even when another tab is focused, same as trail recording
already does today).

While `isRecording`: subscribes to the same `subscribeToPositions` stream (own channel instance;
Realtime channels are cheap and this keeps the hook self-contained rather than threading a shared
subscription through two independent hooks), computes `haversineKm(myPosition, theirs) * 1000` for
every row **from the RLS-visible stream directly** — deliberately not scoped to one outing's
`memberIds`, since a hunter's physical safety doesn't care which specific outing a nearby co-
member's row came from, only that they're a real person you share ground with (`shares_group_with`
already is the correct "family at large" scope; this matches how `profiles` visibility already
works without a date-range filter, per Phase 1). For each user_id, tracks a `Set` of "currently
inside `warning_range_m`" ids in a `useRef`; on each update, for every row: if distance <
`warning_range_m` and the id was **not** already in the set → fire the entering-radius haptic
(Apple Design Standards rule 2) + surface a `RED_STOP`-coloured banner ("⚠ <name> is close by") on
`MapScreen`, spring-in per rule 1; if distance ≥ `warning_range_m` and the id **was** in the set →
fire the light leaving-radius haptic, spring-out the banner if it was showing for that id. The
`warning_range_m` threshold comes from the caller's own `getMyProfile()` (already used by
`ProfileScreen`), fetched once per mount (range changes take effect on next hunt, not
retroactively — acceptable at family scale, same "good enough" bar Phase 4 applied elsewhere).

## Security (Security Review runs at Completion — flagged phase)

- Second phase to put **live, continuously-updated** GPS coordinates in the DB. RLS is the entire
  access story: own row, or a row belonging to anyone `shares_group_with` — verified with the
  two-account SQL script (non-co-member reads **zero rows**, same shape as Phase 4's script).
- Realtime + RLS: confirm the `postgres_changes` stream itself is RLS-filtered (Supabase's
  documented behaviour, but verify empirically with two accounts — one should never receive the
  other's row over the channel if they don't share a group).
- `isValidCoord` filter before every upload (no (0,0)/NaN reaches the DB); `MAX_ACCURACY_METERS`
  filter reused so a wildly inaccurate fix never gets shared either.
- No new PII beyond what Phase 3/4 already expose (position + accuracy only — no free text).
- `warning_range_m`/`safety_range_m` are read, never written, by this phase's code (Phase 1 already
  owns writing them) — confirm no path lets a different user overwrite someone else's range.
- Upload only happens while `isRecording` — confirm there is no code path that upserts a position
  outside an active recording session (privacy: the app should never phone home your location just
  because it's open).

## Out of Scope (unchanged from foundation spec, plus this phase's own deferrals)

SOS ping (explicitly deferred in the foundation spec — "a follow-on, not in this foundation"),
boundary mapping/warnings, waypoint capture UI, Mapbox/offline tiles. **New deferrals from this
spec:** an explicit "stop sharing my location" UI action (the `DELETE` RLS policy exists for a
future phase to use; this phase's only lifecycle event is "stop recording" and it deliberately
does *not* delete the row, per CLAUDE.md's "always shown … X min ago" description); a breathing
halo on `FriendDot` (solid dot only, see component notes); fixing `GroupMapScreen`'s stale
hardcoded Carto tile URL (flagged in Current State, unrelated bug, separate fix).

## Verification (no test harness — same model as Phases 1–4)

- **SQL (user-run script):** two accounts, one shares an outing with the other, one doesn't —
  non-co-member SELECT → zero rows; co-member SELECT → 1 row; only the owner can INSERT/UPDATE/
  DELETE their own row; a forged `user_id` on INSERT fails; CHECK rejects (0,0) and out-of-range
  lat/lng.
- **Node:** `computeIsMoving` (moves past threshold → resets anchor + moving; stays under distance
  past the time window → not moving; stays under both → moving), `formatLastSeen` (a handful of
  fixed now-vs-updated_at deltas → expected strings).
- **Device (two accounts, both actively recording):** open Group map on device A → device B's dot
  appears in B's assigned colour within a few seconds of B moving; B stops moving for 5+ minutes →
  A sees B's dot turn grey; B walks within A's `warning_range_m` → A feels one haptic buzz and sees
  the banner, not a repeating buzz; B walks back out → a lighter haptic, banner clears; stopping
  the hunt leaves the last dot/legend time in place (not removed) on the group map; existing
  hunt/record/Sessions/Sharing/Group-map-trails flows all unchanged.

## Open Questions for Review — ALL RESOLVED (user, 2026-08-26)

All three original open items (design-guidance source, live-dot surface, haptics dependency) were
resolved in this session (Decisions Locked above). RLS policies reviewed verbatim by the user and
approved, including the `shares_group_with` "any shared outing, ever" scope — accepted as-is for a
private family app, managed by keeping finished outings closed rather than by adding date-range
scoping to the policy. `GroupMapScreen`'s pre-existing stale hardcoded Carto tile URL (flagged
inline above) was fixed as a standalone commit (`7a56a8a`) ahead of Phase 5 implementation, per
user instruction — no longer a carried note.
