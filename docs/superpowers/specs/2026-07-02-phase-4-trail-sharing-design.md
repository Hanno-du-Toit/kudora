# Phase 4 — Per-Path Trail Sharing + Offline Sync — Design Spec

_Status: approved design (2026-07-03) — all 5 open questions resolved at their
recommendations (user). Child spec of `2026-06-19-social-foundation-design.md` (Phase 4
section); supersedes that section where they differ (deviations are called out inline)._

## Context

Phases 1–3 delivered auth, friends, and hunt outings (groups). Phase 4 connects the social
layer to the GPS core: a recorded hunt (local, AsyncStorage) can be **shared to an outing**,
after which every member of that outing sees the trail on a group map in the sharer's
colour. This is the first phase that puts **GPS coordinates in the database**, so it is a
flagged Security Review phase.

Nothing auto-uploads. Sharing is per-(trail, outing) and deliberate. Local storage remains
primary; the server copy is a projection of local intent.

## Decisions Locked (user, 2026-07-02)

1. **One row per shared trail.** GPS points live in a single `jsonb` array column
   (`trail_points`) — NOT one row per point. Live positions are Phase 5's separate concern
   (`member_positions`), untouched here.
2. **Sharing is desired state, not an operation queue.** Locally we store, per
   (local hunt, outing), a boolean "should be shared". An offline-aware **reconciler**
   diffs local desired state against the server's actual rows and pushes only the
   difference (insert what's missing, delete what's extra). Share-then-unshare while
   offline nets to **no local queue entry and no network call** — the desired flag is
   simply gone by the time the reconciler runs.

## Requirements

- **Server table + RLS:** outing members can read trails shared to outings they belong to;
  only the trail's owner can insert (share) or delete (unshare) their own trails.
- **Offline-first:** toggling share/unshare always succeeds instantly with no signal
  (writes local desired state only); the reconciler syncs when signal returns.
- **Rendering:** each member's shared trails draw on the group map in that member's
  assigned colour.

## Current State (verified by reading the code)

- Local hunt shape (`huntStorage.js` / `useGPSTracking.js`):
  `{ id: 'session_<ts>', startedAt ISO, endedAt ISO, distance (km float), duration (ms),
  avgSpeed (km/h), trailPoints: [{ latitude, longitude, speed?, accuracy?, timestamp? }],
  mapType ('topo'|'satellite') }`. Foreground and background recorders both apply the
  `isValidCoord` + accuracy + min-move filters before a point is stored.
- `SessionsScreen.js` owns `samplePoints(points, max)` and `regionForPoints(points)`
  (module-local — will be lifted to a shared util) and has a full-screen
  `HuntDetailView` with a floating top bar (back / delete) where the Share action goes.
- `TrailLayer` renders shadow+colour polylines but **hardcodes green** — gains a `color`
  prop (default unchanged).
- `is_group_member(gid, uid)` (SECURITY DEFINER STABLE, Phase 3) is exactly the predicate
  the new RLS needs. `listMyGroups()` / `listGroupMembers(gid)` already power the pickers.
- No sync/queue code exists yet; `src/store/` holds only contexts (Theme, Auth).

## Database (migration `0006_shared_trails.sql` — forward-only numbering)

### `shared_trails` — one row per (owner, outing, local hunt)

| column          | type        | notes                                                    |
|-----------------|-------------|----------------------------------------------------------|
| `id`            | uuid PK     | `gen_random_uuid()`                                      |
| `owner_id`      | uuid        | → `auth.users` cascade                                   |
| `group_id`      | uuid        | → `hunt_groups` cascade (outing deleted → trails gone)   |
| `local_hunt_id` | text        | the device hunt id; **unique (owner_id, group_id, local_hunt_id)** → idempotent re-share |
| `started_at`    | timestamptz | from hunt `startedAt`                                    |
| `ended_at`      | timestamptz | CHECK `ended_at >= started_at`                           |
| `distance_km`   | double precision | local units kept as-is (foundation spec said `distance_m`; deviating to avoid a conversion) |
| `duration_ms`   | bigint      |                                                          |
| `avg_speed_kmh` | double precision |                                                     |
| `map_type`      | text        | CHECK in ('topo','satellite')                            |
| `trail_points`  | jsonb       | CHECK is array, `jsonb_array_length` between 2 and 2000  |
| `created_at`    | timestamptz | default now(). **Rows are immutable** — no `updated_at`  |

Deviation from the foundation spec: no `name` column (local hunts are unnamed; the group
map labels trails by owner + date).

**RLS** (after the mandatory CLAUDE.md GRANT + ENABLE):
- SELECT: `auth.uid() = owner_id OR is_group_member(group_id, auth.uid())`
- INSERT: `auth.uid() = owner_id AND is_group_member(group_id, auth.uid())`
- DELETE: `auth.uid() = owner_id`
- UPDATE: **no policy at all.** Rows are immutable snapshots; re-share = delete + insert.
  With RLS enabled, no policy = default-deny for every role, which is grant-independent —
  so the Phase 3 status-only-trigger machinery is NOT needed here (that trigger existed
  because a legitimate UPDATE path had to stay open). `revoke update` is still run as
  defense-in-depth.

### `shared_waypoints` — table + RLS only (no capture UI yet, per foundation spec)

`id, owner_id, group_id (cascade), local_waypoint_id (unique with owner+group), name,
type CHECK in ('blind','water','camp','sighting','general'), latitude, longitude,
created_at_client, created_at`. Same RLS shape as `shared_trails` (member SELECT,
owner-only INSERT/DELETE, no UPDATE policy).

### Membership-exit cleanup (privacy)

`AFTER DELETE ON group_members` trigger (SECURITY DEFINER function, pinned search_path):
delete the departing member's `shared_trails` and `shared_waypoints` rows for that group.
Leaving or being removed from an outing takes your shared trails with you — group members
should not retain your GPS history after you exit. (Owner never has a member row; owner
exit = group delete, which cascades via `group_id`.) The client reconciler also drops the
corresponding desired flags when it discovers membership is gone.

**Indexes:** `shared_trails(group_id)`, `shared_trails(owner_id)`, `shared_waypoints(group_id)`.

## Client architecture

Three small units with one job each:

### 1. `src/store/shareState.js` — local desired state (AsyncStorage)

- Key `kudora_share_state_v1`: `{ [localHuntId]: { [groupId]: true } }`. Only `true`
  entries are stored; unshare deletes the entry. **This is what makes
  unshare-before-upload a structural no-op** — the reconciler never sees a tombstone,
  just absence.
- Key `kudora_share_server_cache_v1`: the reconciler's last-known server rows
  (`{ '<huntId>|<groupId>': serverRowId }`), so the Sessions UI can label each toggle
  offline: desired ∧ cached → "Shared"; desired ∧ ¬cached → "Waiting for signal";
  ¬desired ∧ cached → "Removing…".
- API: `getDesired()`, `setDesired(huntId, groupId, bool)`, `removeHunt(huntId)`
  (called on local hunt delete), `getServerCache()`, `setServerCache(map)`.

### 2. `src/services/sharedTrails.js` — thin server ops (supabase-js)

`listMyShareRefs()` (id, group_id, local_hunt_id where owner = me),
`listGroupTrails(groupId)` (full rows for the group map), `insertSharedTrail(row)`,
`deleteSharedTrail(id)`. No sync logic here.

### 3. `src/services/trailSync.js` — the reconciler

- **Pure, node-testable core:** `diffShares(desired, serverRefs) → { toInsert: [{huntId,
  groupId}], toDelete: [serverRowId] }`.
- `reconcileShares()`: load desired → fetch `listMyShareRefs()` → diff → for each insert,
  load the hunt from `huntStorage`, build the payload (below), insert; for each delete,
  delete by row id → update the server cache → return `{ uploaded, removed, revoked,
  failed }`.
- **Single-flight:** a module-level in-progress promise; concurrent triggers await the
  same run. Failures are silent (state unchanged, badge stays "Waiting for signal");
  the next trigger retries.
- **Error semantics per insert:** `23505` unique violation → already shared, treat as
  success; `42501` RLS denial → no longer a member of that outing → drop the desired
  flag (counted as `revoked`, surfaced once via the share panel); `23514` CHECK
  violation (e.g. <2 valid points) → drop the flag, mark unshareable; network error →
  keep the flag, retry on next trigger.
- **Triggers:** app start (once authed), connectivity regained
  (`@react-native-community/netinfo` listener — bundled in Expo Go, installed via
  `npx expo install`), app returning to foreground (AppState), Sessions screen focus,
  and immediately after any toggle. Wired once via a `useShareSync()` hook mounted in
  the authed tree in `App.js`.

### Upload payload contract

From the local hunt: `trail_points` = `trailPoints` filtered by `isValidCoord`, sampled
to at most `MAX_SHARED_TRAIL_POINTS = 1000` (lifted `samplePoints`), each point reduced
to `{ latitude, longitude, timestamp? }` (speed/accuracy stripped — not needed to draw a
polyline, and smaller payloads matter on farm signal). Metadata mapped 1:1
(`distance → distance_km`, etc.). A hunt with <2 valid points is unshareable (UI
disables the toggle with a hint).

## UI

### Share panel — `SessionsScreen` `HuntDetailView`

- A share icon joins the floating top bar (back / **share** / delete, all ≥44pt).
- Tapping opens a bottom panel (same card style as the stats panel) listing **my
  outings** (owner or joined, from `listMyGroups()`), each row: outing name + dates +
  a toggle + status line ("Shared" / "Waiting for signal" / "Removing…"). Toggling
  writes desired state instantly and kicks `reconcileShares()` — offline the toggle
  still flips, status shows "Waiting for signal".
- No outings → "You're not in any outings yet — create one on the Group tab."
- Deleting a local hunt also clears its desired flags → the reconciler unshares the
  server copies (see Open Question 2). The delete confirm warns when the hunt is shared.

### Group map — new `GroupMapScreen` (GroupStack: `GroupMain → GroupDetail → GroupMap`)

- Entry: a "Group map" row on `GroupDetailScreen` (members only — invitees can't open
  detail anyway).
- `useGroupTrails(groupId)` hook: `{ trails, loading, error, refresh }` from
  `listGroupTrails`. Roster names come from the existing `listGroupMembers`.
- Full-screen MapView (same tile treatment as `HuntDetailView`), region fitted over all
  trails' points (lifted `regionForPoints`), one `TrailLayer` per trail with
  `color={colorForMember(trail.owner_id, myId, memberIds)}`.
- Legend: colour-dot + display-name chips for members with ≥1 trail. Empty state:
  "No trails shared to this outing yet."
- Refresh on focus + a refresh button (map screens don't scroll, so no pull-to-refresh).

### Colours — `colorForMember` (pure util)

Viewer-relative, matching CLAUDE.md: **self is always `#5FCE5F` green**. Other members
get `['#F4A623' amber, '#6AB0E8' blue, '#C77DD8', '#E8875C']` by their position in the
group's member ids sorted ascending (deterministic on every device; wraps via modulo).
Two different viewers may see a third member in different colours — accepted at family
scale because "green = me" is the invariant that matters in the field.
`TrailLayer` gains an optional `color` prop (default `#5FCE5F`, existing callers
unchanged).

## Security (Security Review runs at Completion — flagged phase)

- GPS coordinates enter the DB for the first time: RLS above is the entire access
  story — owner + outing members only, verified with the two-account SQL script
  (non-member reads **zero rows**).
- No UPDATE policy on either table (immutable rows, default-deny; grant-independent).
- Membership-exit trigger prevents retained location history after leave/remove.
- `isValidCoord` filter before upload (no (0,0)/NaN in the DB); server CHECKs bound the
  payload (array type, 2–2000 points).
- Unshared hunts are never uploaded — desired state only ever inserts explicit shares.
- No PII beyond what Phase 3 already exposes (display names via existing RPCs).

## Verification (no test harness — same model as Phases 1–3)

- **SQL (user-run script):** two accounts — non-member gets zero rows; member reads the
  shared trail; only owner can insert/delete; any UPDATE fails; insert into a
  non-member outing fails; leave/remove wipes the leaver's rows (trigger); CHECKs
  reject <2 points and bad map_type.
- **Node:** `diffShares`, `colorForMember`, payload builder, share-state round-trip
  (pure functions).
- **Device (two accounts):** share online → appears on the other device in the sharer's
  colour; unshare → disappears; airplane-mode share → "Waiting for signal" → flushes on
  reconnect; airplane-mode share-then-unshare → nets to nothing after reconnect (no
  server row ever created); unshared hunts never visible; existing hunt/record/Sessions
  flows untouched.

## Open Questions — ALL RESOLVED at the recommendation (user, 2026-07-03)

1. **Where does the group map live?** Recommend: dedicated `GroupMapScreen` pushed from
   the outing detail (keeps the live-hunting Map tab untouched; Phase 5's live dots go
   on the main Map later). Alternative: overlay shared trails on the main Map tab behind
   an outing picker — more taps away from regression-free, so not recommended for v1.
2. **Deleting a local hunt that is shared:** recommend delete = unshare everywhere (the
   server copy is a projection of local intent; the confirm dialog warns). Alternative:
   server copy outlives the local hunt — but then nothing owns its lifecycle.
3. **Leave/remove wipes your shared trails (DB trigger)** — recommend yes (privacy
   default). Alternative: trails stay until manually unshared.
4. **Point cap 1000** (sampled, ~35–60 KB per trail) — acceptable resolution for a farm
   walk; raise/lower?
5. **New dependency `@react-native-community/netinfo`** (bundled in Expo Go) for
   signal-returns sync triggers — OK? Without it, sync still runs on app start /
   foreground / screen focus / toggle, just not the instant signal returns.

## Out of Scope (unchanged from foundation spec)

Waypoint capture UI (table only), live positions + safety (Phase 5), SOS, boundary
mapping, Mapbox/offline tiles, trail naming/editing, per-member custom colours.
