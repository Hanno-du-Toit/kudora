# Kudora

**Family hunting GPS tracking app for iOS**

A personal GPS tracking app built for hunting with family. Track your trail live on a topographic or satellite map, drop named waypoints, see where your group walked, and map farm boundaries — all working fully offline in the bush.

![Platform](https://img.shields.io/badge/Platform-iOS-lightgrey?logo=apple&logoColor=white)
![Expo SDK](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.81-61dafb?logo=react&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Backend-3ecf8e?logo=supabase&logoColor=white)

---

## Screenshots

> Screenshots coming soon

---

## Features

- **Live GPS trail recording** on topographic and satellite maps
- **Drop named waypoints** — blinds, water points, camp locations
- **See family members' routes** after the hunt
- **Live position sharing** when signal is available
- **Farm boundary mapping** by walking or driving the perimeter
- **Safety radius warnings** when group members get too close
- **Backtrack mode** to follow your trail home
- **Works fully offline** — GPS records with zero signal

---

## Tech Stack

| Layer | Technology |
|---|---|
| App framework | [Expo](https://expo.dev) (React Native) — iOS |
| Map rendering | [react-native-maps](https://github.com/react-native-maps/react-native-maps) with OpenStreetMap / ESRI tiles |
| Backend | [Supabase](https://supabase.com) — auth, database, realtime sync |
| Background GPS | [expo-location](https://docs.expo.dev/versions/latest/sdk/location/) |
| Offline storage | [AsyncStorage](https://react-native-async-storage.github.io/async-storage/) |
| Navigation | [React Navigation](https://reactnavigation.org) — bottom tabs |

---

## Getting Started

For developers who want to run this locally:

**1. Clone the repo**
```bash
git clone https://github.com/Hanno-du-Toit/kudora.git
cd kudora
```

**2. Install dependencies**
```bash
npm install
```

**3. Set up environment variables**
```bash
cp .env.example .env
```
Open `.env` and fill in your Supabase project URL and anon key. These are available in your [Supabase dashboard](https://supabase.com/dashboard) under Project Settings → API.

**4. Start the dev server**
```bash
npx expo start
```

**5. Open on iPhone**

Download **Expo Go** from the App Store, then scan the QR code shown in the terminal. Make sure your phone and computer are on the same Wi-Fi network.

> **Note:** Background GPS recording (screen-off trail tracking) requires a development build via `eas build`. Foreground GPS recording works in Expo Go.

---

## Project Structure

```
src/
  components/map/     # Map overlays — trail, position dot, waypoints
  components/ui/      # Shared UI components
  screens/            # Top-level screens — Map, Sessions, Profile
  hooks/              # Logic hooks — useGPSTracking, etc.
  services/           # External integrations — supabase.js, maps.js
  constants/          # Colours, GPS task names, route names
  utils/              # Pure functions — distance calc, formatters
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
EXPO_PUBLIC_SUPABASE_URL=your-supabase-project-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Never commit `.env` — it is in `.gitignore`.

---

*This is a personal project built for private family use. Built with [Claude Code](https://claude.ai/code).*
