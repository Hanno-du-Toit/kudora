# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project

Kudora — a personal family hunting GPS tracking app for iOS. Built with Expo (React Native),
react-native-maps, and Supabase. Used by Hanno, his dad, and his brother while hunting together.

Core purpose: track GPS trails offline, drop waypoints, see each other's routes after the hunt
(or live when signal is available), and map farm boundaries by walking or driving them.

## Tech Stack

- **Expo SDK** (latest stable) — React Native framework, no Mac required for builds
- **expo-location** — background GPS tracking
- **expo-task-manager** — keeps GPS running when screen is off
- **react-native-maps** — map rendering, trail drawing
- **Supabase** — auth, database, realtime subscriptions
- **EAS Build** — cloud iOS builds without a Mac
- **React Navigation** — screen navigation
- **AsyncStorage** — local offline data persistence

## Environment Variables

All secrets live in `.env` and are referenced via `process.env`. Never hardcode any of the
following in source files:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

The `.env` file is in `.gitignore` — never commit it. Use `.env.example` with placeholder
values so other developers know what variables are needed.

## Security Rules

This is a **public GitHub repository**. These rules are non-negotiable:

- No API keys, tokens, or secrets anywhere in source code
- No hardcoded user IDs, email addresses, or personal information
- No Supabase service role keys anywhere — only the anon key on the client
- All Supabase tables must have RLS enabled
- GPS coordinates stored in the database belong to authenticated users only — RLS policies
  must enforce that users can only read their own data or data explicitly shared with them

## Supabase Table Policy

When creating any new table, always run this SQL immediately after creation:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table_name TO anon, authenticated;
ALTER TABLE public.your_table_name ENABLE ROW LEVEL SECURITY;
```

Then add appropriate RLS policies. Never leave a table without RLS.

## Architecture

```
src/
  components/       # Reusable UI components, organised by feature
    map/            # Map-related components (TrailLayer, WaypointMarker, FriendDot)
    ui/             # Generic UI (Button, Badge, BottomSheet)
  screens/          # Top-level screen components
  hooks/            # Data and logic (useGPSTracking, useOfflineSync, useGroupSession)
  services/         # External integrations (supabase.js, maps.js)
  store/            # Local state (session, offline queue)
  constants/        # Colours, map styles, safety radius values, route names
  utils/            # Pure utility functions (distance calc, coordinate helpers)
```

## Core Features and How They Work

### GPS Trail Recording
- Uses `expo-location` with `startLocationUpdatesAsync` in a background task
- GPS points stored locally first (AsyncStorage), synced to Supabase when signal returns
- Trail drawn on map as a `Polyline` in react-native-maps
- Each hunt session has a unique ID — points accumulate under that session

### Offline Maps
Currently using react-native-maps with OpenStreetMap (free, no API key). Mapbox can be swapped in later for offline map support.

### Waypoints and Markers
- Tapping the map or pressing the waypoint button saves current GPS coords
- Waypoints have a name, type (blind, water, camp, sighting, general), and timestamp
- Stored locally and synced to Supabase — shared with group members

### Family Group and Route Sharing
- Each user belongs to a group (family unit)
- After a hunt, all GPS trails auto-sync and become visible to group members
- Live positions share via Supabase Realtime when signal is available
- Last known position always shown on map with a "X min ago" timestamp

### Boundary Mapping
- "Map mode" lets user walk or drive a boundary — records a closed polygon
- Saved permanently with a name (e.g. "Noord plaas", "Rivier kant")
- Shown as a semi-transparent overlay on the map for all hunts
- Can assign sectors to group members for a specific hunt

### Safety Features
- Dynamic safety radius: vibrate warning if any group member's last known position
  is within a configurable distance (default 300m)
- Stationary detection: if a member hasn't moved more than 10m in 5 minutes,
  their dot turns grey to show they are stationary (likely in a blind)
- Boundary warnings: vibrate when approaching a mapped boundary line
- SOS ping: sends current GPS coords to all group members instantly

## How to Operate

1. **Check existing components first** — before building anything new, check `src/components/`
   and `src/hooks/`. Reuse and extend rather than duplicate.

2. **Offline first** — always assume no signal. GPS data must be saved locally before any
   network call. Sync is secondary, local storage is primary.

3. **When things fail** — read the full error, fix it, verify it works, then move on.
   Don't leave broken code or workarounds behind.

4. **Keep changes focused** — only touch files related to the task. Don't refactor
   unrelated code while fixing something else.

5. **Verify before committing** — make sure the change works before committing.
   Never commit broken code.

6. **Document quirks** — when you discover react-native-maps constraints, Supabase RLS gotchas,
   or expo-location background task behaviour, note it here so it doesn't happen again.

## Git Workflow

- Commit after every meaningful working change
- Commit messages: short and descriptive — `add waypoint drop button`,
  `fix GPS trail not rendering on cold start`, `implement offline sync queue`
- Never commit: `.env`, API keys, node_modules, build outputs
- Branch when building a full new feature, merge when stable

## UI Standards

- Dark map-first aesthetic — the map is always the hero, UI sits on top of it
- Bottom sheet panels for controls, not full-screen overlays
- Minimum tap target size 44x44pt — this is used with gloves in the field
- Every action must have a loading state — GPS ops and network calls take time
- Friendly error messages — "No signal, saved locally" not "Network request failed"
- Colour system:
  - User's own trail: bright green `#5FCE5F`
  - Dad's trail: amber `#F4A623`
  - Brother's trail: blue `#6AB0E8`
  - Waypoints: yellow `#F4C542`
  - Water points: blue `#6AB0E8`
  - Camp: green `#5FCE5F`
  - Danger/boundary warning: red `#E24B4A`
  - Stationary member dot: grey `#888780`

## Known Quirks and Decisions

- Background GPS on iOS requires `UIBackgroundModes: location` in app.json and the
  user to select "Always" for location permission — prompt this clearly in onboarding
- Supabase Realtime connections should be cleaned up in `useEffect` return functions
  to avoid memory leaks on screen unmount
- expo-task-manager background tasks must be registered at the top level of the app,
  not inside components
- GPS accuracy: use `Accuracy.BestForNavigation` during active hunt,
  `Accuracy.Balanced` in background to preserve battery
- react-native-maps drops a `<Marker>`'s native annotation when sibling map children
  remount or the children set changes (e.g. `<UrlTile>` layers remounting on theme
  toggle via a changed `key`, or the topo tile fragment mounting/unmounting on
  TOPO↔SAT switch). The marker's React element is preserved, so RN-maps never re-adds
  the orphaned annotation and the marker silently vanishes. Fix: give the marker a
  `key` that changes whenever the tile layers change (`pos-${isDark}-${mapType}` for
  the position dot in MapScreen) so it remounts as a fresh instance and RN-maps adds a
  new annotation. The GPS watcher and `currentPosition` state live in `useGPSTracking`
  and are fully decoupled from theme, so they keep running across toggles — only the
  native marker needed the remount fix.
- The (0,0) "ghost" dot in the top-left corner on START HUNT is the iOS custom-view
  `<Marker>` regenerating its image while `tracksViewChanges` is true. Every
  regeneration can spawn a duplicate annotation at the map origin. The recording screen
  re-renders ~once a second (elapsed/trail/stats), so a long tracking window guarantees
  ghosts. The fix is layered — all of these together, in order of importance:
  1. `tracksViewChanges` is true only briefly to capture one clean frame, then flips to
     `false` (PositionDot uses a ~700ms `setTimeout`, and also stops the pulse loop).
     After it settles RN-maps never regenerates the image, so no ghost in steady state.
     The dot still follows GPS — the `coordinate` prop moves the marker natively.
  2. `PositionDot` is wrapped in `React.memo` so the per-second recording re-render
     storm never reaches the marker at all. (Memo is safe here because re-attaching the
     marker after a theme/map/recording change happens via the `key` and the
     `markerHidden` unmount below — NOT via re-renders — so memo only filters the
     harmless storm.)
  3. The marker `key` includes `isRecording` (`pos-${isDark}-${mapType}-${isRecording}`)
     so it remounts on recording start/stop, re-running the short capture cycle. (A
     remount reliably clears any existing ghost — confirmed because manually toggling
     theme/map after START HUNT cleared it.)
  4. `markerHidden` flag in MapScreen flips true for ~400ms when `isRecording` changes,
     fully UNMOUNTING the dot across the transition so the old native annotation is
     disposed before the fresh one mounts. The dot renders only when
     `currentPosition && isValidCoord(currentPosition) && !markerHidden` (triple guard).
  Note `showsUserLocation` MUST stay `false` (we draw our own dot; iOS's native blue dot
  also flashes at 0,0 before its first fix), and `TrailLayer` must return null until it
  has ≥2 valid points (a 1-point/empty Polyline draws a leg to the origin). Both were
  already in place — they are NOT the ghost source, the Marker regeneration is.
- GPS drift while stationary (e.g. sitting in a blind, or indoors) otherwise inflates
  distance and jitters the trail. Two filters in the recording path guard against it,
  applied in BOTH the foreground watcher (useGPSTracking) and the background task
  (index.js) so live and saved distance agree: (1) discard fixes whose reported
  `accuracy` is worse than `MAX_ACCURACY_METERS` (20 m); (2) only record a trail point
  / add to distance once the fix is at least `MIN_MOVE_METERS` (5 m) from the last
  recorded point. Both thresholds live in `src/constants/gps.js`. The live position dot
  still updates on sub-threshold moves so it stays responsive — only the trail/distance
  are gated.
- Guard every marker/polyline coordinate with `isValidCoord` (utils/geoUtils) — it
  rejects null/NaN and the {0,0} "null island" fix. An empty/uninitialised GPS fix is
  {0,0} and otherwise renders a stray marker or a polyline leg at the map origin. Both
  the GPS watchers in useGPSTracking and the render layers (PositionDot, TrailLayer)
  apply this guard.

## Build and Deployment

- Development: `npx expo start` → scan QR with Expo Go on iPhone
- Production build: `eas build --platform ios --profile preview` (installs via link, no App Store)
- EAS project configured in `eas.json`
- Never store `eas.json` secrets in the repo — use EAS environment variables for production keys
