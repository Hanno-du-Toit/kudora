# GroupDetailScreen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hunt detail screen — sectioned member roster, owner-only inline invite-friend picker, editable end date, and leave/remove/delete — replacing the placeholder, plus two folded-in Task 4 fixes.

**Architecture:** A single-file themed `SectionList` screen matching the existing `FriendsScreen`/`GroupScreen` idiom. It reads from the already-existing `groups.js` / `friends.js` services and existing RLS/RPCs — **no migration or service-layer changes**. Permission gating derives from the `myStatus` route param.

**Tech Stack:** React Native (Expo SDK 54), `@react-navigation/native-stack`, `@react-native-community/datetimepicker`, Supabase JS, `@expo/vector-icons` Ionicons.

## Global Constraints

- **No migration changes.** All RLS policies and RPCs already exist in `supabase/migrations/0004_hunt_groups.sql`.
- **No service-layer changes.** Use existing `src/services/groups.js` functions verbatim: `listGroupMembers(groupId)`, `inviteFriend(groupId, userId)`, `removeMember(groupId, userId)`, `leaveGroup(groupId)`, `deleteGroup(groupId)`, `updateGroupEndDate(groupId, endDate)`; and `listFriendships()` from `src/services/friends.js`.
- **No test runner exists.** Pure functions are verified with `node -e` assertions. UI changes are verified on-device in Expo Go at each commit checkpoint (manual approval between tasks).
- **Match existing idiom:** `useTheme()` → `{ T, isDark }`; colors `GREEN` / `RED_STOP` from `../constants/themes`; errors via `friendlyGroupError`; destructive actions use `Alert`; `actionBusy` boolean guards mutations; `useFocusEffect` + `RefreshControl` for load/refresh; `useSafeAreaInsets` for padding.
- **Colours:** primary/confirm `GREEN` `#5FCE5F`; destructive `RED_STOP`; on-green button text `#06210a`.
- **Copy:** hunt is referred to in UI as an "Outing" where a noun is shown to the user (per the Task 4 rename); existing detail header title comes from `route.params.name`.
- **Route params available on GroupDetail:** `groupId`, `name`, `ownerId`, `myStatus` (`'owner'` | `'joined'`), `startDate` (`'YYYY-MM-DD'`), `endDate` (`'YYYY-MM-DD'`).

---

### Task 1: `formatDateFull` date helper

**Files:**
- Modify: `src/utils/dates.js`
- Test: inline `node -e` assertion (no test file — matches codebase)

**Interfaces:**
- Consumes: nothing.
- Produces: `formatDateFull(d: Date): string` — day + short month + year, e.g. `new Date(2026, 6, 6)` → `"6 Jul 2026"` (locale-formatted, like `formatDateShort`). Used by the detail screen date header.

- [ ] **Step 1: Write the failing check**

Run:
```bash
node -e "const {formatDateFull}=require('./src/utils/dates.js'); const s=formatDateFull(new Date(2026,6,6)); console.log(s); if(!(s.includes('Jul')&&s.includes('2026')&&s.includes('6'))) throw new Error('FAIL: '+s);"
```
Expected: FAIL — `formatDateFull is not a function` (it does not exist yet).

> Note: `dates.js` uses `export function`. `node -e require` works because Metro/Babel is not involved here and the file is otherwise CommonJS-compatible only via export syntax — if `require` errors on `export`, use the ESM form:
> ```bash
> node --input-type=module -e "import {formatDateFull} from './src/utils/dates.js'; const s=formatDateFull(new Date(2026,6,6)); console.log(s); if(!(s.includes('Jul')&&s.includes('2026')&&s.includes('6'))) throw new Error('FAIL: '+s);"
> ```
> Use whichever runs; prefer the `--input-type=module` form since the file uses ES `export`.

- [ ] **Step 2: Add the function**

Add to `src/utils/dates.js` immediately after `formatDateShort`:
```javascript
export function formatDateFull(d) {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
```

- [ ] **Step 3: Run the check to verify it passes**

Run:
```bash
node --input-type=module -e "import {formatDateFull} from './src/utils/dates.js'; const s=formatDateFull(new Date(2026,6,6)); console.log(s); if(!(s.includes('Jul')&&s.includes('2026')&&s.includes('6'))) throw new Error('FAIL: '+s);"
```
Expected: PASS — prints `6 Jul 2026` and exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/utils/dates.js
git commit -m "feat: add formatDateFull date helper (year-inclusive)"
git push origin main-CleanVersion
```

---

### Task 2: Detail screen skeleton — sectioned read-only roster + dates

**Files:**
- Modify (full rewrite): `src/screens/GroupDetailScreen.js`

**Interfaces:**
- Consumes: `formatDateFull` (Task 1); `listGroupMembers` from `../services/groups`; `parseISODate`, `formatDateFull` from `../utils/dates`; `friendlyGroupError` from `../utils/groupErrors`.
- Produces: the screen component and its internal state shape reused by later tasks — `roster` (array of `{ user_id, username, display_name, status, is_me }`), `load()` callback, `T`/`isDark` theme, `insets`, `isOwner` boolean, `endDate` string state, `actionBusy` state. Later tasks add the invite picker, date editor, and action buttons into this file.

- [ ] **Step 1: Replace the placeholder with the skeleton**

Overwrite `src/screens/GroupDetailScreen.js` entirely:
```javascript
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, SectionList, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { GREEN, RED_STOP } from '../constants/themes';
import { listGroupMembers } from '../services/groups';
import { friendlyGroupError } from '../utils/groupErrors';
import { parseISODate, formatDateFull } from '../utils/dates';

const STATUS_ORDER = { owner: 0, joined: 1, invited: 2 };
const SECTION_TITLE = { owner: 'Owner', joined: 'Joined', invited: 'Invited' };

// Group the flat roster rows into Owner / Joined / Invited sections (in that order).
function toSections(roster) {
  const buckets = { owner: [], joined: [], invited: [] };
  for (const m of roster) (buckets[m.status] ?? buckets.joined).push(m);
  return ['owner', 'joined', 'invited']
    .filter((k) => buckets[k].length)
    .map((k) => ({ key: k, title: SECTION_TITLE[k], data: buckets[k] }));
}

export default function GroupDetailScreen({ route, navigation }) {
  const { T, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const { groupId, name, ownerId, myStatus, startDate } = route.params ?? {};
  const isOwner = myStatus === 'owner';

  const [roster, setRoster] = useState([]);
  const [endDate, setEndDate] = useState(route.params?.endDate ?? '');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    setLoadError(null);
    try {
      const members = await listGroupMembers(groupId);
      setRoster(members);
    } catch (e) {
      setLoadError(friendlyGroupError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const Header = (
    <View>
      <View style={[st.card, { borderColor: T.cardBorder }]}>
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Starts</Text>
          <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(startDate))}</Text>
        </View>
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Ends</Text>
          <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(endDate))}</Text>
        </View>
      </View>
      {loadError && <Text style={[st.error, { color: RED_STOP }]}>{loadError}</Text>}
    </View>
  );

  const renderItem = ({ item }) => (
    <View style={[st.row, { borderColor: T.cardBorder }]}>
      <View style={{ flex: 1 }}>
        <Text style={[st.name, { color: T.text }]}>
          {item.display_name}{item.is_me ? ' (you)' : ''}
        </Text>
        {item.username ? <Text style={[st.handle, { color: T.textDim }]}>@{item.username}</Text> : null}
      </View>
      {item.status === 'invited' && (
        <Text style={[st.pending, { color: T.textDim }]}>pending</Text>
      )}
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
      <SectionList
        sections={toSections(roster)}
        keyExtractor={(item) => item.user_id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        renderSectionHeader={({ section }) => (
          <Text style={[st.section, { color: T.textDim }]}>{section.title}</Text>
        )}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={GREEN} />
        }
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, marginBottom: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  dateLabel: { fontSize: 14, fontWeight: '600' },
  dateValue: { fontSize: 15, fontWeight: '700' },
  error: { fontSize: 13, marginTop: 8 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '700' },
  handle: { fontSize: 13, marginTop: 1 },
  pending: { fontSize: 13, fontStyle: 'italic' },
});
```

- [ ] **Step 2: Smoke-test on device**

Run `npx expo start`, open the Group tab, tap an existing hunt. Expected: header shows Starts/Ends dates with the year; roster shows an **Owner** section with your name + `(you)`; no crash; pull-to-refresh works.

- [ ] **Step 3: Commit**

```bash
git add src/screens/GroupDetailScreen.js
git commit -m "feat: GroupDetailScreen roster + dates (read-only skeleton)"
git push origin main-CleanVersion
```

---

### Task 3: Owner-only inline invite-friend picker

**Files:**
- Modify: `src/screens/GroupDetailScreen.js`

**Interfaces:**
- Consumes: `roster` state, `load()`, `isOwner`, `actionBusy` (Task 2); `inviteFriend` from `../services/groups`; `listFriendships` from `../services/friends`.
- Produces: `friendships` state, `eligibleFriends` derived list, `inviteOpen` toggle, `onInvite(friendId)` handler — all reused only within this file.

- [ ] **Step 1: Add imports and the friend-load + invite logic**

In `src/screens/GroupDetailScreen.js`:

Add to the imports:
```javascript
import { TouchableOpacity, Alert } from 'react-native';
```
(Merge into the existing `react-native` import — the final import must read: `View, Text, StyleSheet, ActivityIndicator, SectionList, RefreshControl, TouchableOpacity, Alert`.)

Add these imports:
```javascript
import { Ionicons } from '@expo/vector-icons';
import { inviteFriend } from '../services/groups';
import { listFriendships } from '../services/friends';
```
(Extend the existing `../services/groups` import to `{ listGroupMembers, inviteFriend }` rather than adding a duplicate line.)

Add state after the existing `actionBusy` line:
```javascript
  const [friendships, setFriendships] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);
```

Update `load` to also fetch friendships (owner only) in parallel:
```javascript
  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    setLoadError(null);
    try {
      const [members, friends] = await Promise.all([
        listGroupMembers(groupId),
        isOwner ? listFriendships() : Promise.resolve([]),
      ]);
      setRoster(members);
      setFriendships(friends);
    } catch (e) {
      setLoadError(friendlyGroupError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, isOwner]);
```

Add the eligible-friends derivation and invite handler (after `load`/`useFocusEffect`):
```javascript
  // Accepted friends who are not already in the roster (owner/joined/invited).
  const rosterIds = new Set(roster.map((m) => m.user_id));
  const eligibleFriends = friendships.filter(
    (f) => f.status === 'accepted' && !rosterIds.has(f.other_id),
  );

  const onInvite = async (friendId) => {
    if (actionBusy) return;
    setActionBusy(true);
    try { await inviteFriend(groupId, friendId); await load(); }
    catch (e) { Alert.alert('Could not invite', friendlyGroupError(e)); }
    finally { setActionBusy(false); }
  };
```

- [ ] **Step 2: Render the picker in the Header (owner only)**

In the `Header` JSX, add — after the dates `card` `View` and before the `loadError` line:
```javascript
      {isOwner && (
        <View style={[st.card, { borderColor: T.cardBorder }]}>
          <TouchableOpacity
            style={st.inviteToggle} activeOpacity={0.7}
            onPress={() => setInviteOpen((o) => !o)}
          >
            <Ionicons name={inviteOpen ? 'chevron-down' : 'chevron-forward'} size={18} color={T.textDim} />
            <Text style={[st.inviteTitle, { color: T.text }]}>Invite a friend</Text>
          </TouchableOpacity>
          {inviteOpen && (
            eligibleFriends.length === 0 ? (
              <Text style={[st.inviteEmpty, { color: T.textDim }]}>
                {friendships.some((f) => f.status === 'accepted')
                  ? 'All your friends are already in this outing.'
                  : 'Add friends on the Friends tab first.'}
              </Text>
            ) : (
              eligibleFriends.map((f) => (
                <View key={f.other_id} style={[st.inviteRow, { borderColor: T.cardBorder }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.name, { color: T.text }]}>{f.other_display_name}</Text>
                    <Text style={[st.handle, { color: T.textDim }]}>@{f.other_username}</Text>
                  </View>
                  <TouchableOpacity
                    style={[st.inviteAdd, { backgroundColor: GREEN, opacity: actionBusy ? 0.5 : 1 }]}
                    onPress={() => onInvite(f.other_id)} disabled={actionBusy}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="add" size={20} color="#06210a" />
                  </TouchableOpacity>
                </View>
              ))
            )
          )}
        </View>
      )}
```

Add these styles to `st`:
```javascript
  inviteToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteTitle: { fontSize: 15, fontWeight: '700' },
  inviteEmpty: { fontSize: 13, marginTop: 10 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth },
  inviteAdd: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
```

- [ ] **Step 3: Smoke-test on device**

As an owner with at least one accepted friend not in the hunt: open the hunt → tap "Invite a friend" → list expands → tap `+` → the friend moves into the **Invited** section and disappears from the picker. With no eligible friends, the correct empty message shows. Non-owner: picker is absent.

- [ ] **Step 4: Commit**

```bash
git add src/screens/GroupDetailScreen.js
git commit -m "feat: owner-only inline invite-friend picker on hunt detail"
git push origin main-CleanVersion
```

---

### Task 4: Owner-editable end date (inline picker, save, revert-on-failure)

**Files:**
- Modify: `src/screens/GroupDetailScreen.js`

**Interfaces:**
- Consumes: `endDate` state, `isOwner`, `startDate`, `groupId` (Task 2); `updateGroupEndDate` from `../services/groups`; `toISODate`, `parseISODate` from `../utils/dates`.
- Produces: `onEndDateChange` handler (file-local).

- [ ] **Step 1: Add imports, handler, and the DateTimePicker**

In `src/screens/GroupDetailScreen.js`:

Add the DateTimePicker import (`GREEN`/`RED_STOP` are already imported from Task 2):
```javascript
import DateTimePicker from '@react-native-community/datetimepicker';
```

Extend the `../services/groups` import to include `updateGroupEndDate`:
```javascript
import { listGroupMembers, inviteFriend, updateGroupEndDate } from '../services/groups';
```

Extend the `../utils/dates` import to include `toISODate`:
```javascript
import { parseISODate, formatDateFull, toISODate } from '../utils/dates';
```

Add the handler (near `onInvite`):
```javascript
  const onEndDateChange = async (_e, picked) => {
    if (!picked) return;
    const nextISO = toISODate(picked);
    if (nextISO === endDate) return;
    const prevISO = endDate;
    setEndDate(nextISO); // optimistic
    setActionBusy(true);
    try {
      await updateGroupEndDate(groupId, nextISO);
    } catch (e) {
      setEndDate(prevISO); // revert on failure
      Alert.alert('Could not update end date', friendlyGroupError(e));
    } finally {
      setActionBusy(false);
    }
  };
```

- [ ] **Step 2: Replace the read-only Ends value with the owner picker**

In the `Header`, replace the **Ends** `dateRow` block:
```javascript
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Ends</Text>
          <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(endDate))}</Text>
        </View>
```
with:
```javascript
        <View style={st.dateRow}>
          <Text style={[st.dateLabel, { color: T.textDim }]}>Ends</Text>
          {isOwner ? (
            <DateTimePicker
              value={parseISODate(endDate)} mode="date" display="compact"
              minimumDate={parseISODate(startDate)}
              themeVariant={isDark ? 'dark' : 'light'} accentColor={GREEN}
              onChange={onEndDateChange} disabled={actionBusy}
            />
          ) : (
            <Text style={[st.dateValue, { color: T.text }]}>{formatDateFull(parseISODate(endDate))}</Text>
          )}
        </View>
```

- [ ] **Step 3: Smoke-test on device**

As owner: tap the Ends picker → choose a later date → value updates; leave and re-enter the hunt (or pull-to-refresh on the list) → new end date persists. The picker cannot select a date before Starts. As a joined member: Ends is read-only text.

- [ ] **Step 4: Commit**

```bash
git add src/screens/GroupDetailScreen.js
git commit -m "feat: owner-editable hunt end date with revert-on-failure"
git push origin main-CleanVersion
```

---

### Task 5: Leave / remove / delete actions

**Files:**
- Modify: `src/screens/GroupDetailScreen.js`

**Interfaces:**
- Consumes: `isOwner`, `roster`, `load()`, `actionBusy`, `groupId`, `name`, `navigation` (Task 2); `removeMember`, `leaveGroup`, `deleteGroup` from `../services/groups`; `RED_STOP` (imported in Task 2).
- Produces: `onRemove(member)`, `onLeave()`, `onDelete()` handlers (file-local).

- [ ] **Step 1: Add imports and the three handlers**

Extend the `../services/groups` import to:
```javascript
import { listGroupMembers, inviteFriend, updateGroupEndDate, removeMember, leaveGroup, deleteGroup } from '../services/groups';
```

Add handlers (near the other `on*` handlers):
```javascript
  const onRemove = (member) => {
    Alert.alert('Remove member', `Remove ${member.display_name} from "${name}"?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          if (actionBusy) return;
          setActionBusy(true);
          try { await removeMember(groupId, member.user_id); await load(); }
          catch (e) { Alert.alert('Could not remove', friendlyGroupError(e)); }
          finally { setActionBusy(false); }
        },
      },
    ]);
  };

  const onLeave = () => {
    Alert.alert('Leave outing', `Leave "${name}"?`, [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: async () => {
          if (actionBusy) return;
          setActionBusy(true);
          try { await leaveGroup(groupId); navigation.goBack(); }
          catch (e) { setActionBusy(false); Alert.alert('Could not leave', friendlyGroupError(e)); }
        },
      },
    ]);
  };

  const onDelete = () => {
    Alert.alert('Delete outing', `Delete "${name}"? This removes it for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (actionBusy) return;
          setActionBusy(true);
          try { await deleteGroup(groupId); navigation.goBack(); }
          catch (e) { setActionBusy(false); Alert.alert('Could not delete', friendlyGroupError(e)); }
        },
      },
    ]);
  };
```

- [ ] **Step 2: Add the remove (✕) button to non-owner, non-self roster rows**

Replace the `renderItem` "pending" tail so owners get a remove control. Change the trailing part of `renderItem` from:
```javascript
      {item.status === 'invited' && (
        <Text style={[st.pending, { color: T.textDim }]}>pending</Text>
      )}
```
to:
```javascript
      {item.status === 'invited' && (
        <Text style={[st.pending, { color: T.textDim }]}>pending</Text>
      )}
      {isOwner && item.status !== 'owner' && !item.is_me && (
        <TouchableOpacity
          style={[st.iconBtn, { opacity: actionBusy ? 0.5 : 1 }]}
          onPress={() => onRemove(item)} disabled={actionBusy}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={20} color={RED_STOP} />
        </TouchableOpacity>
      )}
```

- [ ] **Step 3: Add the footer action button (Delete for owner, Leave for member)**

Add a `ListFooterComponent` to the `SectionList`:
```javascript
        ListFooterComponent={
          <TouchableOpacity
            style={[st.dangerBtn, { borderColor: RED_STOP, opacity: actionBusy ? 0.5 : 1 }]}
            onPress={isOwner ? onDelete : onLeave} disabled={actionBusy}
            activeOpacity={0.85}
          >
            <Ionicons name={isOwner ? 'trash-outline' : 'exit-outline'} size={18} color={RED_STOP} />
            <Text style={[st.dangerText, { color: RED_STOP }]}>
              {isOwner ? 'Delete outing' : 'Leave outing'}
            </Text>
          </TouchableOpacity>
        }
```

Add styles:
```javascript
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 28 },
  dangerText: { fontSize: 15, fontWeight: '800' },
```

- [ ] **Step 4: Smoke-test on device**

As owner: remove (✕) a joined member and a pending invitee → both disappear after confirm. Tap **Delete outing** → confirm → returns to the list and the hunt is gone. As a joined member (second account): the footer shows **Leave outing** → confirm → returns to list, hunt gone; no remove ✕ buttons appear.

- [ ] **Step 5: Commit**

```bash
git add src/screens/GroupDetailScreen.js
git commit -m "feat: leave/remove/delete actions on hunt detail"
git push origin main-CleanVersion
```

---

### Task 6: Folded-in Task 4 fixes (GroupScreen error split + validator copy)

**Files:**
- Modify: `src/screens/GroupScreen.js`
- Modify: `src/utils/validators.js`
- Test: inline `node -e` assertion for the validator

**Interfaces:**
- Consumes: nothing new.
- Produces: no exported-signature changes; `validateGroupName` return values are unchanged in shape, only the empty-name message text changes.

- [ ] **Step 1: Fix the validator copy**

In `src/utils/validators.js`, change:
```javascript
  if (name.length === 0) return { ok: false, error: 'Name the hunt' };
```
to:
```javascript
  if (name.length === 0) return { ok: false, error: 'Name the outing' };
```

- [ ] **Step 2: Verify the validator copy**

Run:
```bash
node --input-type=module -e "import {validateGroupName} from './src/utils/validators.js'; const r=validateGroupName('  '); if(r.error!=='Name the outing') throw new Error('FAIL: '+JSON.stringify(r)); console.log('ok', r.error);"
```
Expected: PASS — prints `ok Name the outing`.

- [ ] **Step 3: Split the shared error state in GroupScreen**

In `src/screens/GroupScreen.js`:

Replace the single error state declaration:
```javascript
  const [error, setError] = useState(null);
```
with:
```javascript
  const [formError, setFormError] = useState(null);
  const [loadError, setLoadError] = useState(null);
```

In `load`, change the catch to write `loadError`:
```javascript
    } catch (e) {
      setLoadError(friendlyGroupError(e));
    } finally {
```

In `onCreate`, change the opening reset and the validation/catch to use `formError`:
```javascript
  const onCreate = async () => {
    setFormError(null);
    const v = validateGroupName(name);
    if (!v.ok) return setFormError(v.error);
```
and its catch:
```javascript
    } catch (e) {
      setFormError(friendlyGroupError(e));
    } finally {
```

- [ ] **Step 4: Render the two errors in their correct places**

In the `Header` create box, change the error line from:
```javascript
      {error && <Text style={[st.error, { color: RED_STOP }]}>{error}</Text>}
```
to:
```javascript
      {formError && <Text style={[st.error, { color: RED_STOP }]}>{formError}</Text>}
```

Add a list-level banner. Change the `ListHeaderComponent={Header}` usage so the banner renders above the sections but outside the create box — wrap it:
```javascript
        ListHeaderComponent={
          <View>
            {Header}
            {loadError && <Text style={[st.error, { color: RED_STOP }]}>{loadError}</Text>}
          </View>
        }
```
(Ensure `View` is imported in `GroupScreen.js` — it already is.)

- [ ] **Step 5: Smoke-test on device**

Empty-name create attempt shows "Name the outing" under the Create button. Simulate a load failure (e.g. airplane mode + pull-to-refresh): the message appears as a banner below the create box / above the sections, not under the Create button. A successful create still clears and reloads.

- [ ] **Step 6: Commit**

```bash
git add src/screens/GroupScreen.js src/utils/validators.js
git commit -m "fix: split GroupScreen form/load errors; validator outing copy"
git push origin main-CleanVersion
```

---

### Task 7: Review pass

**Files:** none (review only; apply fixes if surfaced)

- [ ] **Step 1: Code review**

Invoke the **Code Reviewer** skill over the diff for Tasks 1–6. Focus: correctness of the owner/member gating, `actionBusy` coverage on every mutation, no stray `#E24B4A` literal, no unused imports, styles referenced actually exist.

- [ ] **Step 2: Security review**

Invoke the **Security Review** skill — this touches group membership and sharing. Confirm: no client-side trust that could bypass RLS (all writes go through the existing owner/self-gated policies), no secrets/PII added, remove/delete cannot be driven against another group, invite only offers accepted friends.

- [ ] **Step 3: Apply any surfaced fixes, then commit**

If either review surfaces changes, apply them focused, re-run the relevant on-device smoke test, then:
```bash
git add -A
git commit -m "chore: address Task 5 review findings"
git push origin main-CleanVersion
```

- [ ] **Step 4: Report Task 5 complete**

Summarize what shipped and what still needs a second account to fully verify (joined-member Leave, invite/accept round-trip).

---

## Notes on verification honesty

- Only Tasks 1 and 6 have runnable automated checks (pure functions). Every UI task's real verification is the on-device smoke test at its checkpoint — do not claim a UI task "passes" without the device check, per the project's verification rules.
- Owner-vs-member branches that need a second account (Leave, full invite→accept) are explicitly deferred to on-device verification with the second account, consistent with Task 4's invitations testing.
