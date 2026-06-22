# Phase 1 — Auth + Profile Implementation Plan

> ✅ **STATUS: COMPLETE (2026-06-22).** All 5 tasks implemented, committed, and pushed to
> `origin/main-CleanVersion`. Both Supabase migrations run; "Confirm email" disabled in the
> dashboard. Verified on device: signup, login, logout, and session persistence across
> restart all work. Final review pass done (commit `9828c41`: hardened signup trigger,
> auth error handling, offline-friendly profile reads).
>
> **Three flagged items — user decisions (2026-06-22):**
> 1. **Username uniqueness** — leave as is (case-insensitive `unique(lower(username))`); no
>    additional reservation/normalisation work.
> 2. **`find_user_by_username` RPC** — keep as-is for now (exact-match, `SECURITY DEFINER`).
> 3. **Profile labels** — "Visible range" (`safety_range_m`) / "Warning distance"
>    (`warning_range_m`) wording is approved, no change.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the existing single-user app behind email/password authentication, give every user a unique `@handle` + display name, and build out the Profile screen (identity, two range settings, logout).

**Architecture:** A new `AuthProvider` (mirroring the existing `ThemeProvider` context pattern) holds the Supabase session. `App.js` becomes a gate: no session → `AuthScreen` (login/signup toggle, no navigator needed); session → the existing tab navigator, untouched. Profiles are created atomically by a Postgres `handle_new_user` trigger from signup metadata, so the client never does an authenticated insert. Profile lookups for availability/friend-add go through a `SECURITY DEFINER` RPC so the `profiles` table is never globally readable.

**Tech Stack:** Expo SDK 54, React Native 0.81, `@supabase/supabase-js` v2, `@react-navigation/*` v7 (already installed), AsyncStorage (Supabase session storage, already configured).

## Global Constraints

- **Offline-first is not violated here:** auth/profile is inherently online, but no existing local GPS/hunt flow may break. Existing GPS/Sessions/Map code is not modified in this phase.
- **Public repo:** no secrets, emails, or personal data committed. Only `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` via `process.env` (already in place).
- **Every new table:** `GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO anon, authenticated;` then `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` (CLAUDE.md mandatory policy).
- **RLS predicates** that reference other tables use `SECURITY DEFINER STABLE` helpers (none needed in Phase 1 — `profiles` SELECT is self-only here; Phases 2/3 broaden it).
- **Username rule (verbatim):** `^[a-z0-9_]{3,20}$`, lowercase only. Enforced in the DB (CHECK) and client (`validateUsername`).
- **Range defaults (verbatim):** `safety_range_m` default `5000`; `warning_range_m` default `300`. Both user-adjustable, both on `profiles`.
- **Branch / push:** work continues on `main-CleanVersion`; commit + push to `origin/main-CleanVersion` after every task (CLAUDE.md push policy).
- **Verification model:** no automated test harness exists in this repo. Verification is **Expo Go on device** + **Supabase SQL editor** for RLS/schema, matching CLAUDE.md and the spec. Pure validators get a one-off `node` check. Do not add jest/testing-library in this phase.
- **Colours:** primary action green `#5FCE5F` (`GREEN` from `src/constants/themes.js`); danger red `#E24B4A` (`RED_STOP`). Use `useTheme()` (`T.*`) for surfaces/text. Min tap target 44×44.

---

## Supabase dashboard prerequisite (do this once, before Task 1 verification)

In the Supabase dashboard → **Authentication → Sign In / Providers → Email**: **disable "Confirm email"** so signup returns a session immediately (frictionless for a private 3-person family app). If you choose to leave confirmation **on**, signup will not return a session and the app shows a "check your email, then log in" notice (handled in Task 4) — both paths work, but disabling is the recommended default for this app.

---

## File Structure

- `supabase/migrations/0001_profiles.sql` — **create**: `profiles` table, RLS, `find_user_by_username` RPC, `handle_new_user` + `set_updated_at` triggers.
- `src/utils/validators.js` — **create**: pure `validateUsername` (+ `USERNAME_RE`).
- `src/services/profiles.js` — **create**: `getMyProfile`, `updateMyProfile`, `isUsernameAvailable`.
- `src/store/AuthContext.js` — **create**: `AuthProvider`, `useAuth` (session, loading, signIn, signUp, signOut).
- `src/screens/auth/AuthScreen.js` — **create**: login/signup toggle form (the only pre-auth screen).
- `App.js` — **modify**: add `SafeAreaProvider` + `AuthProvider`, add the session gate; existing tab navigator extracted into a `ThemedTabs` component unchanged.
- `src/screens/ProfileScreen.js` — **modify**: replace the stub with identity + range settings + logout.

> Navigation note: the **Group tab** from the spec is added in **Phase 3** (when `GroupScreen` exists); Phase 1 keeps the existing 3 tabs (Map / Sessions / Profile). The **Friends** entry point on Profile is added in **Phase 2** (when `FriendsScreen` exists). This keeps Phase 1 free of dead placeholders.

---

## Task 1: Database migration — profiles, RLS, RPC, trigger

**Files:**
- Create: `supabase/migrations/0001_profiles.sql`

**Interfaces:**
- Produces: table `public.profiles(id, username, display_name, safety_range_m, warning_range_m, created_at, updated_at)`; RPC `find_user_by_username(handle text) → setof (id uuid, username text, display_name text)`; trigger that auto-creates a profile row from `auth.users.raw_user_meta_data` keys `username`, `display_name`.

- [x] **Step 1: Write the migration file**

Create `supabase/migrations/0001_profiles.sql`:

```sql
-- 0001_profiles.sql — Phase 1: accounts + profiles

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text not null,
  display_name    text not null,
  safety_range_m  integer not null default 5000,
  warning_range_m integer not null default 300,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,20}$')
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- ── Mandatory CLAUDE.md table policy ─────────────────────────────────────────
grant select, insert, update, delete on public.profiles to anon, authenticated;
alter table public.profiles enable row level security;

-- ── RLS: self-only in Phase 1 (Phases 2/3 broaden SELECT to friends/group) ───
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ── Exact-match lookup RPC (bypasses RLS so it cannot be used to enumerate) ───
create or replace function public.find_user_by_username(handle text)
returns table (id uuid, username text, display_name text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where p.username = lower(handle)
  limit 1;
$$;

grant execute on function public.find_user_by_username(text) to anon, authenticated;

-- ── Auto-create the profile row on signup (atomic with auth.users insert) ─────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    coalesce(new.raw_user_meta_data->>'display_name',
             new.raw_user_meta_data->>'username')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Keep updated_at fresh ─────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
```

- [x] **Step 2: Run the migration**

Paste the whole file into the Supabase dashboard **SQL editor** and run it.
Expected: "Success. No rows returned."

- [x] **Step 3: Verify schema + RLS objects exist**

Run in the SQL editor:

```sql
select relrowsecurity from pg_class where relname = 'profiles';                 -- expect: true
select count(*) from pg_policies where tablename = 'profiles';                  -- expect: 3
select proname from pg_proc where proname in ('find_user_by_username','handle_new_user'); -- expect both rows
select tgname from pg_trigger where tgname = 'on_auth_user_created';            -- expect 1 row
```

Expected: `relrowsecurity = true`, 3 policies, both functions present, trigger present.

- [x] **Step 4: Commit + push**

```bash
git add supabase/migrations/0001_profiles.sql
git commit -m "feat: profiles table, RLS, lookup RPC and signup trigger (phase 1)"
git push origin main-CleanVersion
```

---

## Task 2: Pure validator + profiles service

**Files:**
- Create: `src/utils/validators.js`
- Create: `src/services/profiles.js`

**Interfaces:**
- Produces: `validateUsername(raw) → { ok: true, value } | { ok: false, error }`; `USERNAME_RE`.
- Produces: `getMyProfile() → Promise<profile|null>`; `updateMyProfile(patch) → Promise<profile>` (patch keys: `display_name`, `safety_range_m`, `warning_range_m`); `isUsernameAvailable(username) → Promise<boolean>`.
- Consumes: `supabase` from `src/services/supabase.js`; RPC `find_user_by_username` from Task 1.

- [x] **Step 1: Write `src/utils/validators.js`**

```js
// Pure validators — no RN/Supabase imports so they're trivially testable.
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function validateUsername(raw) {
  const username = (raw ?? '').trim().toLowerCase();
  if (username.length === 0) return { ok: false, error: 'Pick a username' };
  if (username.length < 3) return { ok: false, error: 'At least 3 characters' };
  if (username.length > 20) return { ok: false, error: 'At most 20 characters' };
  if (!USERNAME_RE.test(username)) return { ok: false, error: 'Only a–z, 0–9 and _' };
  return { ok: true, value: username };
}
```

- [x] **Step 2: Quick-check the validator with node**

Run:

```bash
node -e "const r=/^[a-z0-9_]{3,20}$/; for (const s of ['ab','Hanno','hanno_01','no spaces','ok_handle']) console.log(s, r.test(s.trim().toLowerCase()))"
```

Expected output:
```
ab false
Hanno true
hanno_01 true
no spaces false
ok_handle true
```
(`Hanno` → `hanno` after lowercasing, so it passes the regex; `validateUsername` lowercases before testing.)

- [x] **Step 3: Write `src/services/profiles.js`**

```js
import { supabase } from './supabase';

export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, safety_range_m, warning_range_m')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(patch) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const allowed = {};
  if (patch.display_name != null)    allowed.display_name = patch.display_name;
  if (patch.safety_range_m != null)  allowed.safety_range_m = patch.safety_range_m;
  if (patch.warning_range_m != null) allowed.warning_range_m = patch.warning_range_m;
  const { data, error } = await supabase
    .from('profiles')
    .update(allowed)
    .eq('id', user.id)
    .select('id, username, display_name, safety_range_m, warning_range_m')
    .single();
  if (error) throw error;
  return data;
}

// Exact-match availability via the SECURITY DEFINER RPC (returns [] when free).
export async function isUsernameAvailable(username) {
  const { data, error } = await supabase.rpc('find_user_by_username', {
    handle: username,
  });
  if (error) throw error;
  return !data || data.length === 0;
}
```

- [x] **Step 4: Verify it imports cleanly (no syntax errors)**

Run:

```bash
npx expo start -c
```

Expected: Metro bundler starts and the QR code appears with no red bundling error mentioning `validators.js` or `profiles.js`. (Functional verification happens in Task 4, once auth exists.) Stop the bundler after confirming.

- [x] **Step 5: Commit + push**

```bash
git add src/utils/validators.js src/services/profiles.js
git commit -m "feat: username validator and profiles service (phase 1)"
git push origin main-CleanVersion
```

---

## Task 3: AuthContext provider

**Files:**
- Create: `src/store/AuthContext.js`

**Interfaces:**
- Produces: `<AuthProvider>` and `useAuth() → { session, loading, signIn(email, password), signUp({ email, password, username, displayName }) → data, signOut() }`. `signUp` returns the Supabase `data` (its `session` is `null` when email confirmation is on).
- Consumes: `supabase` from `src/services/supabase.js`.

- [x] **Step 1: Write `src/store/AuthContext.js`**

```js
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => setSession(nextSession)
    );
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async ({ email, password, username, displayName }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: displayName } },
    });
    if (error) throw error;
    return data; // data.session is null if email confirmation is enabled
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [x] **Step 2: Verify it bundles**

Run `npx expo start -c`; expected: no red bundling error referencing `AuthContext.js`. Stop after confirming. (Behavioural verification is Task 4.)

- [x] **Step 3: Commit + push**

```bash
git add src/store/AuthContext.js
git commit -m "feat: AuthContext session provider (phase 1)"
git push origin main-CleanVersion
```

---

## Task 4: Auth screen + session gate (first end-to-end deliverable)

**Files:**
- Create: `src/screens/auth/AuthScreen.js`
- Modify: `App.js`

**Interfaces:**
- Consumes: `useAuth` (Task 3), `useTheme` (`src/store/ThemeContext.js`), `validateUsername` (Task 2), `isUsernameAvailable` (Task 2), `GREEN` (`src/constants/themes.js`).
- Produces: a working signup/login/logout loop; `App.js` renders `AuthScreen` when no session, the existing tabs when a session exists.

- [x] **Step 1: Write `src/screens/auth/AuthScreen.js`**

```js
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../store/ThemeContext';
import { useAuth } from '../../store/AuthContext';
import { GREEN } from '../../constants/themes';
import { validateUsername, isUsernameAvailable } from '../../utils/validators';
import { isUsernameAvailable as checkUsername } from '../../services/profiles';

function friendlyAuthError(error) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Wrong email or password';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'That email is already registered';
  if (m.includes('username') || m.includes('duplicate') || m.includes('profiles_'))
    return 'That username is taken';
  if (m.includes('network') || m.includes('fetch'))
    return 'No signal — try again when you have a connection';
  if (m.includes('password')) return 'Password must be at least 6 characters';
  return error?.message || 'Something went wrong';
}

export default function AuthScreen() {
  const { T, isDark } = useTheme();
  const { signIn, signUp } = useAuth();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const inputStyle = [
    styles.input,
    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderColor: T.cardBorder, color: T.text },
  ];

  const submit = async () => {
    setError(null);
    setNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) return setError('Enter a valid email');
    if (password.length < 6) return setError('Password must be at least 6 characters');

    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(cleanEmail, password);
        // onAuthStateChange flips the app to the tabs automatically.
      } else {
        const u = validateUsername(username);
        if (!u.ok) { setBusy(false); return setError(u.error); }
        if (!displayName.trim()) { setBusy(false); return setError('Enter a display name'); }
        const free = await checkUsername(u.value);
        if (!free) { setBusy(false); return setError('That username is taken'); }
        const data = await signUp({
          email: cleanEmail, password,
          username: u.value, displayName: displayName.trim(),
        });
        if (!data.session) {
          setMode('login');
          setNotice('Account created. Check your email to confirm, then log in.');
        }
      }
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 64,
          paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.brand, { color: GREEN }]}>KUDORA</Text>
        <Text style={[styles.subtitle, { color: T.textDim }]}>
          {isSignup ? 'Create your account' : 'Welcome back'}
        </Text>

        {isSignup && (
          <>
            <TextInput
              style={inputStyle} placeholder="Display name"
              placeholderTextColor={T.textDim} value={displayName}
              onChangeText={setDisplayName} autoCapitalize="words"
            />
            <TextInput
              style={inputStyle} placeholder="Username (a–z, 0–9, _)"
              placeholderTextColor={T.textDim} value={username}
              onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
            />
          </>
        )}

        <TextInput
          style={inputStyle} placeholder="Email" placeholderTextColor={T.textDim}
          value={email} onChangeText={setEmail} autoCapitalize="none"
          autoCorrect={false} keyboardType="email-address"
        />
        <TextInput
          style={inputStyle} placeholder="Password" placeholderTextColor={T.textDim}
          value={password} onChangeText={setPassword} secureTextEntry
        />

        {error && <Text style={[styles.error, { color: '#E24B4A' }]}>{error}</Text>}
        {notice && <Text style={[styles.notice, { color: GREEN }]}>{notice}</Text>}

        <TouchableOpacity
          style={[styles.button, { backgroundColor: GREEN, opacity: busy ? 0.6 : 1 }]}
          onPress={submit} disabled={busy} activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color="#06210a" />
            : <Text style={styles.buttonText}>{isSignup ? 'Sign up' : 'Log in'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switch}
          onPress={() => { setMode(isSignup ? 'login' : 'signup'); setError(null); setNotice(null); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.switchText, { color: T.textDim }]}>
            {isSignup ? 'Already have an account? Log in'
                      : "New here? Create an account"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 28, gap: 14 },
  brand: { fontSize: 34, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
  input: {
    height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, fontSize: 16,
  },
  error: { fontSize: 13, marginTop: 2 },
  notice: { fontSize: 13, marginTop: 2 },
  button: {
    height: 52, borderRadius: 12, alignItems: 'center',
    justifyContent: 'center', marginTop: 6,
  },
  buttonText: { color: '#06210a', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  switch: { alignItems: 'center', paddingVertical: 14 },
  switchText: { fontSize: 14 },
});
```

> Note: `validateUsername` is imported from `utils/validators`; `isUsernameAvailable` is the service from `services/profiles` (aliased `checkUsername` to avoid a name clash). The `import { isUsernameAvailable } from '../../utils/validators'` line is dead — remove it; only `validateUsername` comes from validators. (Corrected in Step 1 final form below.)

Fix the imports at the top to exactly:

```js
import { validateUsername } from '../../utils/validators';
import { isUsernameAvailable as checkUsername } from '../../services/profiles';
```

- [x] **Step 2: Rewrite `App.js` with the gate**

Replace the entire contents of `App.js` with:

```js
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ThemeProvider, useTheme } from './src/store/ThemeContext';
import { AuthProvider, useAuth } from './src/store/AuthContext';
import { GREEN } from './src/constants/themes';
import MapScreen from './src/screens/MapScreen';
import SessionsScreen from './src/screens/SessionsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/auth/AuthScreen';

const Tab = createBottomTabNavigator();

function ThemedTabs() {
  const { T } = useTheme();
  return (
    <NavigationContainer>
      <StatusBar style={T.statusBar} />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: T.headerBg, borderBottomColor: T.headerBorder },
          headerTintColor: T.headerText,
          tabBarStyle: { backgroundColor: T.tabBar, borderTopColor: T.tabBarBorder },
          tabBarActiveTintColor: T.tabBarActive,
          tabBarInactiveTintColor: T.tabBarInactive,
          tabBarIcon: ({ color, size }) => {
            const icons = { Map: 'map', Sessions: 'trail-sign', Profile: 'person' };
            return <Ionicons name={icons[route.name]} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Map" component={MapScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Sessions" component={SessionsScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function Root() {
  const { session, loading } = useAuth();
  const { T } = useTheme();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style={T.statusBar} />
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }
  if (!session) {
    return (
      <>
        <StatusBar style={T.statusBar} />
        <AuthScreen />
      </>
    );
  }
  return <ThemedTabs />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
```

- [x] **Step 3: Verify the full auth loop on device**

Run `npx expo start -c`, open in Expo Go. Then:
1. App opens to the **KUDORA** auth screen (no tabs visible).
2. Tap "New here? Create an account", enter a display name, a username (e.g. `testuser`), a real email, and a password ≥ 6 chars → **Sign up**. With email-confirmation disabled you land on the **Map** tab immediately.
3. Go to the **Profile** tab → kill and reopen the app → it reopens **already logged in** on the tabs (session persisted via AsyncStorage).
4. Try to sign up again with the **same username** (different email) → inline error **"That username is taken"**.
5. (Logout is wired in Task 5; for now confirm the signed-in/persisted state.)

- [x] **Step 4: Verify the profile row was created (SQL editor)**

```sql
select id, username, display_name, safety_range_m, warning_range_m from public.profiles;
```
Expected: one row for your test user, `safety_range_m = 5000`, `warning_range_m = 300`, `username` lowercased.

- [x] **Step 5: Commit + push**

```bash
git add App.js src/screens/auth/AuthScreen.js
git commit -m "feat: email/password auth screen and session gate (phase 1)"
git push origin main-CleanVersion
```

---

## Task 5: Profile screen build-out (identity, range settings, logout)

**Files:**
- Modify: `src/screens/ProfileScreen.js`

**Interfaces:**
- Consumes: `getMyProfile`, `updateMyProfile` (Task 2); `useAuth` (session email + `signOut`); `useTheme`; `GREEN`, `RED_STOP`.
- Produces: the finished Profile screen (no new exports).

- [x] **Step 1: Rewrite `src/screens/ProfileScreen.js`**

```js
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { getMyProfile, updateMyProfile } from '../services/profiles';

const SAFETY = { min: 1000, max: 20000, step: 500 };   // metres (1–20 km)
const WARNING = { min: 50, max: 1000, step: 50 };       // metres

function clampStep(value, dir, { min, max, step }) {
  const next = value + dir * step;
  return Math.max(min, Math.min(max, next));
}

function Stepper({ label, value, unit, T, onChange }) {
  return (
    <View style={st.settingRow}>
      <Text style={[st.settingLabel, { color: T.text }]}>{label}</Text>
      <View style={st.stepper}>
        <TouchableOpacity style={[st.stepBtn, { borderColor: T.cardBorder }]}
          onPress={() => onChange(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="remove" size={18} color={T.text} />
        </TouchableOpacity>
        <Text style={[st.stepValue, { color: GREEN }]}>{unit(value)}</Text>
        <TouchableOpacity style={[st.stepBtn, { borderColor: T.cardBorder }]}
          onPress={() => onChange(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="add" size={18} color={T.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { T } = useTheme();
  const { session, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getMyProfile()
        .then((p) => { if (active) { setProfile(p); setLoading(false); } })
        .catch(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [])
  );

  const persistRange = async (field, value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));   // optimistic
    try {
      await updateMyProfile({ [field]: value });
    } catch {
      Alert.alert('Could not save', 'No signal — your change may not have saved.');
    }
  };

  const confirmLogout = () => {
    Alert.alert('Log out', 'Sign out of Kudora on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: T.bg }]}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  return (
    <View style={[st.root, { backgroundColor: T.bg, paddingTop: insets.top + 24,
      paddingBottom: insets.bottom + 24 }]}>
      <View style={[st.avatar, { backgroundColor: 'rgba(95,206,95,0.15)' }]}>
        <Text style={[st.avatarText, { color: GREEN }]}>
          {(profile?.display_name || '?').slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <Text style={[st.name, { color: T.text }]}>{profile?.display_name || '—'}</Text>
      <Text style={[st.handle, { color: T.textDim }]}>@{profile?.username || '—'}</Text>
      <Text style={[st.email, { color: T.textDim }]}>{session?.user?.email || ''}</Text>

      <View style={[st.divider, { backgroundColor: T.divider }]} />

      <Stepper
        label="Visible range" T={T}
        value={profile?.safety_range_m ?? 5000}
        unit={(m) => `${(m / 1000).toFixed(1)} km`}
        onChange={(dir) =>
          persistRange('safety_range_m', clampStep(profile?.safety_range_m ?? 5000, dir, SAFETY))}
      />
      <Stepper
        label="Warning distance" T={T}
        value={profile?.warning_range_m ?? 300}
        unit={(m) => `${m} m`}
        onChange={(dir) =>
          persistRange('warning_range_m', clampStep(profile?.warning_range_m ?? 300, dir, WARNING))}
      />

      <View style={{ flex: 1 }} />

      <TouchableOpacity style={[st.logout, { borderColor: T.cardBorder }]}
        onPress={confirmLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color={RED_STOP} />
        <Text style={[st.logoutText, { color: RED_STOP }]}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center',
    justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 30, fontWeight: '800' },
  name: { fontSize: 22, fontWeight: '800', letterSpacing: 0.3 },
  handle: { fontSize: 14, marginTop: 2 },
  email: { fontSize: 13, marginTop: 6 },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 24 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', paddingVertical: 12 },
  settingLabel: { fontSize: 15, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 15, fontWeight: '700', minWidth: 64, textAlign: 'center' },
  logout: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 50,
    paddingHorizontal: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch', justifyContent: 'center' },
  logoutText: { fontSize: 15, fontWeight: '700' },
});
```

- [x] **Step 2: Verify on device**

Run `npx expo start -c`, open in Expo Go, go to the **Profile** tab:
1. Shows your avatar initial, display name, `@username`, and email.
2. Tap **+/−** on "Visible range" and "Warning distance" — values change and clamp at the bounds (Visible 1.0–20.0 km in 0.5 km steps; Warning 50–1000 m in 50 m steps).
3. Leave Profile, return → the saved values persist (re-loaded from the DB).
4. Tap **Log out** → confirm → app returns to the **KUDORA** auth screen.
5. Log back in → land on the tabs; Profile shows the same saved ranges.

- [x] **Step 3: Verify the ranges saved (SQL editor)**

```sql
select username, safety_range_m, warning_range_m from public.profiles;
```
Expected: the values you set with the steppers (e.g. `safety_range_m = 6000`, `warning_range_m = 350`).

- [x] **Step 4: Confirm existing features still work**

Still in Expo Go: open **Map**, press **Start Hunt**, confirm the position dot + trail render and the timer runs; **Stop**; open **Sessions** and confirm the hunt appears. Toggle the theme. Nothing regressed.

- [x] **Step 5: Commit + push**

```bash
git add src/screens/ProfileScreen.js
git commit -m "feat: build out Profile screen with range settings and logout (phase 1)"
git push origin main-CleanVersion
```

---

## Phase 1 Done-When

- A new user can sign up (unique handle + display name), is auto-given a `profiles` row (`5000`/`300` defaults), and lands in the app.
- Session persists across app restarts; login and logout work; taken usernames are rejected.
- Profile shows identity + email and lets the user adjust and persist both range settings.
- `profiles` has RLS on (self-only SELECT/INSERT/UPDATE) and is not globally readable; lookups go through the `find_user_by_username` RPC.
- All existing GPS/Sessions/Map/theme features still work, now behind the auth gate.
- **Security Review skill** re-run over the auth + profile surface before calling the phase complete (CLAUDE.md How-to-Operate step 8).

## Self-Review notes (done while writing this plan)

- **Spec coverage:** auth (Task 4), unique handle + display name (Tasks 1, 2, 4), profile build-out + two range settings (Task 5), `profiles` table + RLS + lookup RPC (Task 1). Friends entry point and Group tab are explicitly deferred to Phases 2/3 (no dead placeholders). ✓
- **`profiles` SELECT** is self-only in Phase 1 because `are_friends`/`shares_group_with` don't exist yet; the lookup RPC covers cross-user availability without exposing the table. Phases 2/3 will broaden the SELECT policy. ✓
- **Type consistency:** `validateUsername` (validators) vs `isUsernameAvailable`/`checkUsername` (profiles) names are consistent across Tasks 2 and 4; the stray validators import is called out and corrected in Task 4 Step 1. ✓
- **Email confirmation:** handled both ways (instant session, or "check your email" notice) so the phase ships regardless of the dashboard setting. ✓
