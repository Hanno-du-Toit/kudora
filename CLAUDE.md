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
- Branch when building a full new feature, merge when stable

### Commit message rules

- Use clean, clear, descriptive messages in plain language. Keep them short but
  accurate to what really happened.
- Never include any private or sensitive information in a commit message — no keys,
  tokens, emails, personal data, or account numbers.
- Be honest about what a commit actually does. Do not overstate it:
  - Only use `fix` when something is genuinely confirmed fixed and tested working —
    e.g. `fix GPS trail not rendering on cold start`.
  - If a change is an ATTEMPT that has not been confirmed working yet, prefix with
    `attempt:` or `try:` — e.g. `attempt: reduce position dot ghost on recording start`.
  - When iterating on the same bug across multiple commits, make that clear — e.g.
    `wip: position dot ghost - still investigating`.
  - Use `wip:` for incomplete work.
  - Once the user confirms something works, the next commit can say so — e.g.
    `confirmed: position dot ghost resolved`.
- Good examples: `add waypoint drop button`, `implement offline sync queue`,
  `attempt: clear corner ghost via marker remount`, `wip: Sessions list layout`.

### Push policy

- Always push to `origin/main-CleanVersion` immediately after every commit.
- Never leave commits unpushed — the user wants to see all progress on GitHub in real
  time. A commit is not "done" until it is pushed.

### Privacy

- This is a PUBLIC repo. Never commit `.env`, API keys, tokens, emails, personal data,
  node_modules, or build outputs.
- Double-check that no sensitive data is in any changed file before committing.

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
- The current-position dot (PositionDot) is two SCREEN-SPACE Markers: a static solid
  centre dot on top and a separate breathing-opacity halo underneath. This is the final
  design after trying both a custom-view animated Marker and native Circles, each of
  which failed:
  - Custom-view animated Marker: rasterises its children into an image, and with
    `tracksViewChanges` true iOS regenerates that image on every re-render — each regen
    can spawn a duplicate "ghost" at the (0,0) origin (the corner dot on START HUNT,
    since recording re-renders ~1×/sec). Workarounds (short tracks window, memo, key
    remount, markerHidden unmount) then froze the pulse / dulled the dot / made it vanish.
  - Native `<Circle>`: no ghost, but radius is map-space metres so the dot is tiny and
    disappears when zoomed out, and the ring gets CLIPPED into a hard-edged semicircle by
    the `shouldReplaceMapContent` tiles (overlays render below/around the replace layer).
  The Marker approach fixes both because Markers are constant pixel size at every zoom and
  live in the annotation layer ABOVE all overlays (never tile-clipped). Ghost-free rules:
  - Each marker keeps `tracksViewChanges` true only ~600 ms to capture one clean frame of
    its STATIC view, then false forever — the image is never regenerated, so no ghost.
  - The PULSE is a breathing OPACITY animation (Animated.Value loop on `MarkerAnimated`'s
    `opacity` prop). `opacity` is a native annotation property applied to the cached
    image, so it animates with NO regeneration. Do NOT animate scale/an expanding ring on
    a marker — scale only animates with `tracksViewChanges` true (→ ghost) or it freezes.
  - The dot `key` is `pos-${isDark}-${mapType}` so it remounts (and re-captures) when the
    tile layers reshuffle on theme / TOPO-SAT change, re-attaching the annotation. These
    transitions are calm (no re-render storm) so the brief capture window can't ghost.
    `isRecording` is deliberately NOT in the key — recording doesn't remount tiles, and a
    remount mid-recording would risk a ghost from the storm.
  - Contrast on BOTH themes: white disc + dark outline ring + bright `#5FCE5F` centre +
    green halo. Dark ring reads on light terrain, white ring + halo read on dark terrain.
  - Keep the `isValidCoord` guard in PositionDot so nothing ever renders at (0,0).
- Keep `showsUserLocation={false}` on the MapView (we draw our own dot; iOS's native blue
  location dot also flashes at 0,0 before its first fix), and `TrailLayer` must return
  null until it has ≥2 valid points (a 1-point/empty Polyline draws a leg to the origin).
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
