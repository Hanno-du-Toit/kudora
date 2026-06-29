# Phase 2 — Friends Implementation Plan

> **Status: ✅ COMPLETE (2026-06-29).** All four tasks built, verified on two accounts
> (send / fake-handle / self-add / duplicate / accept / mutual visibility / unfriend /
> decline) with a hunt+sessions+theme regression check. Completion review done: Security
> Review surfaced one RLS gap (addressee could rewrite the friendship pair) — fixed by
> restricting `friendships` UPDATE to the `status` column + re-asserting addressee in
> `WITH CHECK` (re-run `0003_friendships.sql` in Supabase). Code Reviewer pass clean.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user find another user by exact `@handle`, send a friend request, and accept/decline/cancel/unfriend — a confirmed mutual friend graph that Phase 3 (hunt groups) builds on ("only friends can be invited").

**Architecture:** A new `friendships` table holds one row per unordered user pair with a `pending → accepted` status. RLS scopes every row to its two parties. An `are_friends(a,b)` `SECURITY DEFINER STABLE` helper backs the broadened `profiles` SELECT policy (self **or** accepted-friend). The Friends screen is driven by a single `SECURITY DEFINER` RPC `list_my_friendships()` that returns each counterpart's profile fields **even while a request is still pending** (when `profiles` RLS would otherwise hide a non-friend) — mutations go straight to the table under RLS. Friends is reached as a pushed screen inside the **Profile tab** via a new native-stack navigator.

**Tech Stack:** Expo SDK 54, React Native 0.81, `@supabase/supabase-js` v2, `@react-navigation/native` v7 + `@react-navigation/native-stack` v7 (**new — see decision below**), `react-native-screens` (already installed), AsyncStorage (Supabase session, already configured).

## Decision for your review (navigation)

Reaching Friends from inside the Profile tab needs a stack. **Recommended: add `@react-navigation/native-stack`** and wrap the Profile tab in a `ProfileStack` (`ProfileMain` → `Friends`). Rationale: it is the idiomatic React Navigation pattern, gives a real header + swipe-back, its only meaningful peer dep (`react-native-screens`) is already installed, and `npx expo install` pins an SDK-54-compatible version. **Fallback if you'd rather add no dependency:** render `FriendsScreen` as a local-state full-screen overlay inside `ProfileScreen` (zero new deps, no `App.js` change) — slightly less standard, no native back-gesture. The plan below assumes the recommended native-stack approach; say the word and I'll swap Task 3 to the overlay.

## Global Constraints

- **Offline-first is not violated here:** friends is inherently online (you need signal to add/accept). No existing local GPS/hunt flow is touched. Friends actions show loading states and friendly "no signal" errors; they never block the app.
- **Public repo:** no secrets, emails, or personal data committed. Only `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` via `process.env` (already in place).
- **Every new table:** `GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO anon, authenticated;` then `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` (CLAUDE.md mandatory policy).
- **RLS predicates that reference other tables run through `SECURITY DEFINER STABLE` helpers** (`are_friends`) so policies never self-reference (Supabase recursion gotcha). Helpers only *check* membership, never bypass it for writes.
- **No enumeration:** friend-add uses the existing exact-match `find_user_by_username` RPC — the user base cannot be scraped. `profiles` is never globally selectable.
- **Friendship invariants (verbatim from spec):** `status ∈ {pending, accepted}`; `requester_id <> addressee_id`; **unique on the unordered pair**; SELECT = either party; INSERT = requester only; UPDATE = addressee only, accept-only (`WITH CHECK (status = 'accepted')`); DELETE = either party.
- **Migration numbering:** next file is `0003_friendships.sql` (`0001_profiles.sql` and `0002_signup_hardening.sql` already exist and have been run).
- **Branch / push:** work continues on `main-CleanVersion`; commit + push to `origin/main-CleanVersion` after every task (CLAUDE.md push policy).
- **Verification model (same as Phase 1):** no automated test harness exists in this repo and none is added here. Verification is **Supabase SQL editor** for schema/RLS (two test users) + **Expo Go on two devices/accounts** for the app flow. Pure functions get a one-off `node` check. Do not add jest/testing-library.
- **Colours / UI:** primary action green `#5FCE5F` (`GREEN`); danger red `#E24B4A` (`RED_STOP`); surfaces/text via `useTheme()` (`T.*`). Min tap target 44×44. (Constants in `src/constants/themes.js`.)
- **Sensitive feature:** broadens `profiles` visibility, so the **Security Review skill** runs at the end (see Completion).

---

## File Structure

- `supabase/migrations/0003_friendships.sql` — **create**: `friendships` table + RLS, `are_friends` helper, `list_my_friendships` RPC, broadened `profiles` SELECT policy, `updated_at` trigger (reuses `set_updated_at` from 0001).
- `src/services/friends.js` — **create**: `listFriendships`, `sendFriendRequest`, `acceptRequest`, `removeFriendship`.
- `src/screens/FriendsScreen.js` — **create**: add-by-handle, incoming/outgoing requests, friends list, accept/decline/cancel/unfriend.
- `src/utils/friendErrors.js` — **create**: pure `friendlyFriendError(error)` mapper (node-testable, mirrors `friendlyAuthError` in `AuthScreen`).
- `App.js` — **modify**: replace the bare `Profile` tab with a `ProfileStack` (native-stack: `ProfileMain` → `Friends`); the other tabs and the auth gate are untouched.
- `src/screens/ProfileScreen.js` — **modify**: add a "Friends" navigation row (between the range settings and Log out) that calls `navigation.navigate('Friends')`.

> Navigation note: the **Group tab** is still Phase 3 (tabs stay Map / Sessions / Profile). Phase 2 only adds the Friends sub-screen under Profile.

---

## Task 1: Database migration — friendships, RLS, helper, list RPC, broadened profiles SELECT

**Files:**
- Create: `supabase/migrations/0003_friendships.sql`

**Interfaces:**
- Produces: table `public.friendships(id, requester_id, addressee_id, status, created_at, updated_at)`; helper `are_friends(a uuid, b uuid) → boolean`; RPC `list_my_friendships() → setof (id uuid, other_id uuid, other_username text, other_display_name text, status text, is_incoming boolean, created_at timestamptz)`; replaces `profiles` SELECT policy with self-or-friend.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0003_friendships.sql`:

```sql
-- 0003_friendships.sql — Phase 2: friend graph
-- Run after 0001_profiles.sql and 0002_signup_hardening.sql. Idempotent.

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint friendship_not_self check (requester_id <> addressee_id)
);

-- One row per unordered pair: blocks A→B and B→A both existing.
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

-- ── Mandatory CLAUDE.md table policy ─────────────────────────────────────────
grant select, insert, update, delete on public.friendships to anon, authenticated;
alter table public.friendships enable row level security;

-- ── RLS ───────────────────────────────────────────────────────────────────────
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select using (auth.uid() in (requester_id, addressee_id));

drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert with check (auth.uid() = requester_id and status = 'pending');

-- Accept only: addressee flips pending → accepted, cannot set any other status.
drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update using (auth.uid() = addressee_id) with check (status = 'accepted');

-- Either party: cancel request / decline / unfriend.
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete using (auth.uid() in (requester_id, addressee_id));

-- ── updated_at trigger (reuses set_updated_at from 0001) ──────────────────────
drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- ── Friendship helper (accepted only) ─────────────────────────────────────────
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a))
  );
$$;

grant execute on function public.are_friends(uuid, uuid) to anon, authenticated;

-- ── Broaden profiles SELECT: self OR accepted friend ──────────────────────────
-- (Phase 3 adds the shares_group_with branch.)
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    auth.uid() = id
    or public.are_friends(auth.uid(), id)
  );

-- ── Friends-screen data source ────────────────────────────────────────────────
-- SECURITY DEFINER so a still-PENDING requester's profile fields are returned
-- (profiles RLS would otherwise hide a non-friend). Filtered to the caller.
create or replace function public.list_my_friendships()
returns table (
  id                  uuid,
  other_id            uuid,
  other_username      text,
  other_display_name  text,
  status              text,
  is_incoming         boolean,
  created_at          timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    f.id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
    p.username,
    p.display_name,
    f.status,
    (f.addressee_id = auth.uid() and f.status = 'pending'),
    f.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by f.created_at desc;
$$;

grant execute on function public.list_my_friendships() to authenticated;
```

- [ ] **Step 2: Run the migration**

In the Supabase dashboard → **SQL Editor**, paste the full contents of `0003_friendships.sql` and run it. Expected: "Success. No rows returned."

- [ ] **Step 3: Verify schema + RLS objects exist (SQL editor)**

Run:

```sql
select tablename, rowsecurity from pg_tables where tablename = 'friendships';
select polname, cmd from pg_policies where tablename in ('friendships', 'profiles') order by tablename, polname;
select proname from pg_proc where proname in ('are_friends', 'list_my_friendships');
```

Expected: `friendships` has `rowsecurity = true`; four `friendships_*` policies (select/insert/update/delete) + one `profiles_select`; both functions present.

- [ ] **Step 4: Verify RLS behaviour with two users (SQL editor)**

Use two real `auth.users` ids (sign up two accounts first, or reuse Phase 1 test accounts). Replace `:a` / `:b` with their uuids. Run each block, impersonating with `set local`:

```sql
-- As A: send a request to B
set local role authenticated;
set local request.jwt.claim.sub = ':a';
insert into public.friendships (requester_id, addressee_id) values (':a', ':b');

-- As A again: duplicate / reverse must fail (unordered-pair unique index)
insert into public.friendships (requester_id, addressee_id) values (':b', ':a'); -- expect: duplicate key error

-- As B: list shows the incoming request with A's profile fields
set local request.jwt.claim.sub = ':b';
select other_username, status, is_incoming from public.list_my_friendships(); -- expect 1 row, is_incoming = true

-- As B: cannot read A's profile directly yet (still pending, not friends)
select count(*) from public.profiles where id = ':a'; -- expect 0

-- As B: accept
update public.friendships set status = 'accepted'
  where addressee_id = ':b' and requester_id = ':a';

-- As B: now A's profile is visible (are_friends true)
select count(*) from public.profiles where id = ':a'; -- expect 1

-- As B: cannot tamper status to anything but accepted
update public.friendships set status = 'pending' where requester_id = ':a'; -- expect 0 rows / WITH CHECK violation
```

Expected results are noted inline. Clean up test rows afterward: `delete from public.friendships where requester_id = ':a' or addressee_id = ':a';`

- [ ] **Step 5: Commit + push**

```bash
git add supabase/migrations/0003_friendships.sql
git commit -m "feat: friendships table, RLS, are_friends helper and list RPC (phase 2)"
git push origin main-CleanVersion
```

---

## Task 2: Friends service

**Files:**
- Create: `src/services/friends.js`

**Interfaces:**
- Consumes: `supabase` from `src/services/supabase.js`; RPCs `find_user_by_username(handle)` (from 0001) and `list_my_friendships()` (from Task 1); table `friendships`.
- Produces:
  - `listFriendships() → Promise<Array<{ id, other_id, other_username, other_display_name, status, is_incoming, created_at }>>`
  - `sendFriendRequest(handle: string) → Promise<{ id, username, display_name }>` (the resolved target profile)
  - `acceptRequest(friendshipId: string) → Promise<void>`
  - `removeFriendship(friendshipId: string) → Promise<void>` (cancel / decline / unfriend — all DELETE)
  - throws `Error` with `.code` set to one of `'SELF'`, `'NO_SUCH_USER'`, `'DUPLICATE'`, `'NOT_SIGNED_IN'` for the cases the UI maps to friendly text.

- [ ] **Step 1: Write `src/services/friends.js`**

```javascript
import { supabase } from './supabase';

function tagged(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// All friendships involving me (pending + accepted), each joined with the
// other party's profile. Powers the whole Friends screen.
export async function listFriendships() {
  const { data, error } = await supabase.rpc('list_my_friendships');
  if (error) throw error;
  return data ?? [];
}

// Resolve an exact @handle, then insert a pending request (RLS: requester = me).
export async function sendFriendRequest(handle) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw tagged('NOT_SIGNED_IN', 'Not signed in');

  const { data: found, error: findErr } = await supabase.rpc('find_user_by_username', {
    handle: (handle ?? '').trim().toLowerCase(),
  });
  if (findErr) throw findErr;
  const target = found?.[0];
  if (!target) throw tagged('NO_SUCH_USER', 'No user with that handle');
  if (target.id === user.id) throw tagged('SELF', 'You cannot add yourself');

  const { error } = await supabase.from('friendships').insert({
    requester_id: user.id,
    addressee_id: target.id,
    status: 'pending',
  });
  if (error) {
    if (error.code === '23505') throw tagged('DUPLICATE', 'Already requested or already friends');
    throw error;
  }
  return target;
}

// Addressee flips pending → accepted (RLS enforces addressee + accept-only).
export async function acceptRequest(friendshipId) {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId);
  if (error) throw error;
}

// Cancel (requester) / decline (addressee) / unfriend (either) — all DELETE.
export async function removeFriendship(friendshipId) {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);
  if (error) throw error;
}
```

- [ ] **Step 2: Verify it imports cleanly (no syntax errors)**

Run:

```bash
node --check src/services/friends.js
```

Expected: no output, exit 0. (ESM import is not executed by `--check`; it only parses. A clean parse is the bar here, matching the Phase 1 service check.)

- [ ] **Step 3: Commit + push**

```bash
git add src/services/friends.js
git commit -m "feat: friends service (list, request, accept, remove) (phase 2)"
git push origin main-CleanVersion
```

---

## Task 3: Navigation scaffold — ProfileStack + Friends entry point

**Files:**
- Modify: `App.js`
- Modify: `src/screens/ProfileScreen.js`
- Create: `src/screens/FriendsScreen.js` (placeholder this task; built out in Task 4)

**Interfaces:**
- Consumes: nothing new from earlier tasks (this is wiring only).
- Produces: a reachable `Friends` route inside the Profile tab; `ProfileScreen` receives the `navigation` prop and exposes a row that calls `navigation.navigate('Friends')`.

- [ ] **Step 1: Install native-stack (Expo-pinned)**

Run:

```bash
npx expo install @react-navigation/native-stack
```

Expected: adds `@react-navigation/native-stack` to `package.json` dependencies at an SDK-54-compatible version. (`react-native-screens` is already installed, so no extra peer install.)

- [ ] **Step 2: Create the placeholder `src/screens/FriendsScreen.js`**

This is replaced wholesale in Task 4 — it exists now only so the route registers and navigation can be verified.

```javascript
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../store/ThemeContext';

export default function FriendsScreen() {
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.root, { backgroundColor: T.bg, paddingTop: insets.top + 24 }]}>
      <Text style={{ color: T.textDim }}>Friends</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 3: Wrap the Profile tab in a native-stack in `App.js`**

Add the import near the other navigation imports:

```javascript
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FriendsScreen from './src/screens/FriendsScreen';
```

Add the stack navigator and component (place `const ProfileStack = ...` next to `const Tab = ...`, and the `ProfileStackScreen` function above `ThemedTabs`):

```javascript
const ProfileStack = createNativeStackNavigator();

function ProfileStackScreen() {
  const { T } = useTheme();
  return (
    <ProfileStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: T.headerBg },
        headerTintColor: T.headerText,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: T.bg },
      }}
    >
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} options={{ headerShown: false }} />
      <ProfileStack.Screen name="Friends" component={FriendsScreen} options={{ title: 'Friends' }} />
    </ProfileStack.Navigator>
  );
}
```

Then change the Profile tab to render the stack instead of the screen directly. Replace:

```javascript
        <Tab.Screen name="Profile" component={ProfileScreen} />
```

with:

```javascript
        <Tab.Screen name="Profile" component={ProfileStackScreen} options={{ headerShown: false }} />
```

(The `ProfileScreen` import stays — it's now referenced inside `ProfileStackScreen`.)

- [ ] **Step 4: Add the "Friends" row to `src/screens/ProfileScreen.js`**

Change the component signature to receive navigation:

```javascript
export default function ProfileScreen({ navigation }) {
```

Insert this row between the second `<Stepper .../>` (Warning distance) and the `<View style={{ flex: 1 }} />` spacer:

```javascript
      <TouchableOpacity
        style={[st.linkRow, { borderColor: T.cardBorder }]}
        onPress={() => navigation.navigate('Friends')}
        activeOpacity={0.8}
      >
        <Ionicons name="people-outline" size={20} color={T.text} />
        <Text style={[st.linkText, { color: T.text }]}>Friends</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={18} color={T.textDim} />
      </TouchableOpacity>
```

Add these two styles to the `st` StyleSheet:

```javascript
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 50,
    paddingHorizontal: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch', marginTop: 12 },
  linkText: { fontSize: 15, fontWeight: '600' },
```

- [ ] **Step 5: Verify navigation on device**

Run `npx expo start`, open in Expo Go, log in. On the Profile tab: tap **Friends** → the Friends screen pushes in with a "Friends" header and a back button → tap back → returns to Profile. Confirm the range steppers and Log out still work.

- [ ] **Step 6: Commit + push**

```bash
git add App.js src/screens/ProfileScreen.js src/screens/FriendsScreen.js package.json package-lock.json
git commit -m "feat: ProfileStack navigator and Friends entry point (phase 2)"
git push origin main-CleanVersion
```

---

## Task 4: Friends screen build-out (add, requests, accept/decline/cancel/unfriend)

**Files:**
- Create: `src/utils/friendErrors.js`
- Modify (replace): `src/screens/FriendsScreen.js`

**Interfaces:**
- Consumes: `listFriendships`, `sendFriendRequest`, `acceptRequest`, `removeFriendship` from `src/services/friends.js`; `validateUsername` from `src/utils/validators.js`; `useTheme`, `GREEN`, `RED_STOP`.
- Produces: `friendlyFriendError(error) → string`.

- [ ] **Step 1: Write the pure error mapper `src/utils/friendErrors.js`**

```javascript
// Pure mapper from a thrown friends-service error to user-facing copy.
// No RN/Supabase imports so it's trivially node-checkable.
export function friendlyFriendError(error) {
  switch (error?.code) {
    case 'SELF':         return 'You cannot add yourself';
    case 'NO_SUCH_USER': return 'No user with that handle';
    case 'DUPLICATE':    return 'Already requested or already friends';
    case 'NOT_SIGNED_IN':return 'You are signed out — log in again';
    default: break;
  }
  const m = (error?.message || '').toLowerCase();
  if (m.includes('network') || m.includes('fetch'))
    return 'No signal — try again when you have a connection';
  return error?.message || 'Something went wrong';
}
```

- [ ] **Step 2: Quick-check the mapper with node**

Run:

```bash
node -e "const {friendlyFriendError}=require('./src/utils/friendErrors.js'); console.log(friendlyFriendError({code:'SELF'})==='You cannot add yourself', friendlyFriendError({code:'NO_SUCH_USER'})==='No user with that handle', friendlyFriendError({message:'Network request failed'}).startsWith('No signal'), friendlyFriendError({})==='Something went wrong');"
```

Expected: `true true true true`. (If `require` errors on ESM, this repo's services use ESM `export`; in that case run the same assertions via `node --input-type=module` with `import`. The bar is: all four print `true`.)

- [ ] **Step 3: Replace `src/screens/FriendsScreen.js` with the full screen**

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
import { validateUsername } from '../utils/validators';
import { friendlyFriendError } from '../utils/friendErrors';
import {
  listFriendships, sendFriendRequest, acceptRequest, removeFriendship,
} from '../services/friends';

// Split the flat RPC rows into the three on-screen buckets.
function toSections(rows) {
  const incoming = [];
  const outgoing = [];
  const friends = [];
  for (const r of rows) {
    if (r.status === 'accepted') friends.push(r);
    else if (r.is_incoming) incoming.push(r);
    else outgoing.push(r);
  }
  const sections = [];
  if (incoming.length) sections.push({ key: 'incoming', title: 'Requests received', data: incoming });
  if (outgoing.length) sections.push({ key: 'outgoing', title: 'Requests sent', data: outgoing });
  sections.push({ key: 'friends', title: 'Friends', data: friends });
  return sections;
}

export default function FriendsScreen() {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [handle, setHandle] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await listFriendships();
      setRows(data);
    } catch (e) {
      setError(friendlyFriendError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onSend = async () => {
    setError(null);
    setNotice(null);
    const v = validateUsername(handle);
    if (!v.ok) return setError(v.error);
    setSending(true);
    try {
      const target = await sendFriendRequest(v.value);
      setNotice(`Request sent to @${target.username}`);
      setHandle('');
      await load();
    } catch (e) {
      setError(friendlyFriendError(e));
    } finally {
      setSending(false);
    }
  };

  const onAccept = async (id) => {
    try { await acceptRequest(id); await load(); }
    catch (e) { Alert.alert('Could not accept', friendlyFriendError(e)); }
  };

  const onRemove = (item) => {
    const labels = item.status === 'accepted'
      ? { title: 'Unfriend', msg: `Remove @${item.other_username} from your friends?`, action: 'Unfriend' }
      : item.is_incoming
        ? { title: 'Decline request', msg: `Decline @${item.other_username}'s request?`, action: 'Decline' }
        : { title: 'Cancel request', msg: `Cancel your request to @${item.other_username}?`, action: 'Cancel request' };
    Alert.alert(labels.title, labels.msg, [
      { text: 'Keep', style: 'cancel' },
      {
        text: labels.action, style: 'destructive',
        onPress: async () => {
          try { await removeFriendship(item.id); await load(); }
          catch (e) { Alert.alert('Could not update', friendlyFriendError(e)); }
        },
      },
    ]);
  };

  const inputStyle = [
    st.input,
    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderColor: T.cardBorder, color: T.text },
  ];

  const renderItem = ({ item }) => (
    <View style={[st.row, { borderColor: T.cardBorder }]}>
      <View style={{ flex: 1 }}>
        <Text style={[st.name, { color: T.text }]}>{item.other_display_name}</Text>
        <Text style={[st.handle, { color: T.textDim }]}>@{item.other_username}</Text>
      </View>
      {item.status === 'pending' && item.is_incoming && (
        <TouchableOpacity style={[st.accept, { backgroundColor: GREEN }]} onPress={() => onAccept(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.acceptText}>Accept</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => onRemove(item)} style={st.iconBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons
          name={item.status === 'accepted' ? 'person-remove-outline' : 'close'}
          size={20} color={RED_STOP}
        />
      </TouchableOpacity>
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
      <View style={st.addBox}>
        <TextInput
          style={inputStyle} placeholder="Add by username" placeholderTextColor={T.textDim}
          value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false}
          onSubmitEditing={onSend} returnKeyType="send"
        />
        <TouchableOpacity
          style={[st.addBtn, { backgroundColor: GREEN, opacity: sending ? 0.6 : 1 }]}
          onPress={onSend} disabled={sending} activeOpacity={0.85}
        >
          {sending ? <ActivityIndicator color="#06210a" /> : <Ionicons name="add" size={22} color="#06210a" />}
        </TouchableOpacity>
      </View>
      {error && <Text style={[st.error, { color: RED_STOP }]}>{error}</Text>}
      {notice && <Text style={[st.notice, { color: GREEN }]}>{notice}</Text>}

      <SectionList
        sections={toSections(rows)}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={[st.section, { color: T.textDim }]}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0
            ? <Text style={[st.empty, { color: T.textDim }]}>No friends yet — add one above.</Text>
            : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={GREEN} />
        }
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  addBox: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, fontSize: 16 },
  addBtn: { width: 50, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 13, marginTop: 8 },
  notice: { fontSize: 13, marginTop: 8 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 6 },
  empty: { fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 15, fontWeight: '700' },
  handle: { fontSize: 13, marginTop: 1 },
  accept: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#06210a', fontSize: 14, fontWeight: '800' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 4: Verify the full flow on two devices/accounts**

Run `npx expo start`. With **account A** (device 1) and **account B** (device 2):

1. A → Profile → Friends → type B's username → tap **+**. Expect "Request sent to @b" and B appears under **Requests sent**.
2. Bad input: type a non-existent handle → expect "No user with that handle"; type your own handle → "You cannot add yourself"; send the same request twice → "Already requested or already friends".
3. B → Friends (pull to refresh or re-focus). B sees A under **Requests received** with A's display name → tap **Accept**. A moves into **Friends** for B.
4. A → Friends (refresh). A now sees B under **Friends** (request auto-moved out of "sent").
5. Unfriend from either side (trash icon → confirm) → the other side, on refresh, no longer lists them.
6. Decline path: send A→B again, B taps the ✕ on the received request → declines; neither lists it.

- [ ] **Step 5: Confirm existing features still work**

Quick regression: start/stop a hunt, trail + PositionDot render, Sessions log opens, theme + TOPO/SAT toggles work, range steppers + Log out on Profile still work.

- [ ] **Step 6: Commit + push**

```bash
git add src/utils/friendErrors.js src/screens/FriendsScreen.js
git commit -m "feat: build out Friends screen - add, requests, accept and unfriend (phase 2)"
git push origin main-CleanVersion
```

---

## Completion: Security Review + final code review

Run in the **main session** (not as a build subagent) after Task 4 verifies:

- [x] **Security Review skill** over the Phase 2 diff — focus areas: `friendships` RLS (can a third party read/insert/accept someone else's row?), the broadened `profiles` SELECT (does `are_friends` leak anything beyond accepted friends? is the still-pending profile exposure via `list_my_friendships` intended and minimal — id/username/display_name only?), `SECURITY DEFINER` functions (`search_path` pinned, no write-bypass, exact-match lookup not enumerable), and no secrets/PII in source or commit messages.
  - **Finding (medium):** the `friendships_update` policy's `WITH CHECK` validated only `status = 'accepted'`, and the table had a full-column UPDATE grant. Because a `WITH CHECK` is not inherited from `USING`, an addressee of a pending row could rewrite `requester_id` to an arbitrary victim while flipping to `accepted`, forging an accepted friendship and exposing the victim's profile (username/display_name/ranges; escalates once Phase 3/5 key GPS off friendship). **Fixed** in `0003_friendships.sql`: UPDATE narrowed to the `status` column only (`revoke update` + `grant update (status)`) and `WITH CHECK` re-asserts `auth.uid() = addressee_id`. App accept path unchanged. **Re-run the migration in the Supabase SQL editor.**
  - Everything else clean: `are_friends` accepted-only; `list_my_friendships` filtered to caller, returns id/username/display_name only; both `SECURITY DEFINER` functions pin `search_path`, are read-only, granted to `authenticated`; exact-match lookup not enumerable; INSERT can't forge requester or pre-accept; no secrets/PII.
- [x] **Code Reviewer skill** pass — bugs, edge cases (duplicate/self/declined-then-re-sent request), maintainability, the optimistic-vs-reload UX. Clean: prior review commits handled the double-tap guard, friends-only empty footer, and `getUser()` destructure guard. Remaining notes are minor/acceptable (shared `actionBusy` flag, RLS-filtered updates no-op silently, one extra round-trip on self-handle) — no changes required.
- [x] Address any findings, then confirm Phase 2 complete and update this plan's status header + the spec's Phase 2 line (mirroring how Phase 1 was closed out).

---

## Self-Review (against the spec)

- **Spec coverage:** `friendships` table + invariants (Task 1) ✓; `are_friends` helper (Task 1) ✓; broadened `profiles` SELECT to include friends (Task 1) ✓; `src/services/friends.js` add-by-handle / requests / accept / decline / list / unfriend (Task 2) ✓; `src/screens/FriendsScreen.js` reached from Profile (Tasks 3–4) ✓; exact-match `find_user_by_username` reused for add (Task 2) ✓; Security Review at end (Completion) ✓. Deferred-by-design: `shares_group_with` branch of `profiles` SELECT (Phase 3), Group tab (Phase 3).
- **Placeholder scan:** the only "placeholder" is the intentional minimal `FriendsScreen` in Task 3, fully replaced with complete code in Task 4 — no TODO/TBD steps.
- **Type consistency:** RPC `list_my_friendships` columns (`id, other_id, other_username, other_display_name, status, is_incoming, created_at`) match `listFriendships()`'s documented shape and the fields `FriendsScreen` reads (`item.id`, `item.other_username`, `item.other_display_name`, `item.status`, `item.is_incoming`); `sendFriendRequest` returns the `find_user_by_username` row shape (`{id, username, display_name}`) and the screen reads `target.username`; error codes (`SELF`/`NO_SUCH_USER`/`DUPLICATE`/`NOT_SIGNED_IN`) emitted by the service match those handled in `friendlyFriendError`.
