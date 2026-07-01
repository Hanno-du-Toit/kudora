# Task 5 — GroupDetailScreen build-out (design)

**Date:** 2026-07-01
**Branch:** main-CleanVersion
**Phase:** 3 (hunt groups), Task 5

## Goal

Replace the placeholder `src/screens/GroupDetailScreen.js` with a working hunt
detail screen: member roster, owner-only invite-friend picker, editable end
date, and leave/remove/delete actions. Fold in two deferred Task 4 fixes.

The single most important user-facing outcome: **the owner can delete a hunt they
created.**

## Constraints

- **No migration changes.** All required RLS policies and RPCs already exist in
  `0004_hunt_groups.sql`.
- **No service-layer changes.** Every operation already exists in
  `src/services/groups.js`: `listGroupMembers`, `inviteFriend`, `removeMember`,
  `leaveGroup`, `deleteGroup`, `updateGroupEndDate`. Friend data comes from
  `listFriendships` in `src/services/friends.js`.
- **Offline-first is not in play here** — these are online group-management
  actions (invite/remove/delete) that inherently require the server; they surface
  friendly errors when there is no signal rather than queueing.
- Match the existing single-file screen idiom (`FriendsScreen.js`,
  `GroupScreen.js`): themed `SectionList`, `useTheme` (`T`, `isDark`), `GREEN` /
  `RED_STOP`, `friendlyGroupError`, `Alert` confirms for destructive actions,
  `actionBusy` guard, `useFocusEffect` load, `RefreshControl`.

## Data available

- **Route params** (passed from `GroupScreen` `renderItem`): `groupId`, `name`,
  `ownerId`, `myStatus` (`'owner'` | `'joined'`), `startDate`, `endDate`.
  Invited users cannot reach this screen — `GroupScreen` disables tapping an
  invite row — so `myStatus` is only ever `owner` or `joined`.
- **`listGroupMembers(groupId)`** → rows of `{ user_id, username, display_name,
  status, is_me }` where `status` ∈ `owner` | `joined` | `invited`, already
  ordered owner → joined → invited, then by username.
- **`listFriendships()`** → rows of `{ id, other_id, other_username,
  other_display_name, status, is_incoming, created_at }`.

## Screen structure

Single file. A themed `SectionList` (roster) with a header block and a footer
action button.

### 1. Header block

- **Dates.** `Starts <date>` read-only. `Ends <date>`:
  - **Owner:** tappable inline `DateTimePicker` (`mode="date"`,
    `display="compact"`, `minimumDate={startDate}`, themed accent `GREEN`). On
    change, save immediately via `updateGroupEndDate(groupId, toISODate(next))`,
    hold the value in local state for instant redisplay, and surface failures
    with an `Alert` (revert local state on failure).
  - **Non-owner (joined):** read-only text.
  - End date is freely editable within `>= startDate` (matches the DB
    `hunt_group_dates` CHECK), i.e. it can move earlier or later, not extend-only.
- **Owner-only "Invite a friend"** expandable row with a ▸/▾ affordance.
  Expanded, it lists **eligible friends** and each row has a `+` to invite.

### 2. Invite picker (owner only)

- **Eligible = accepted friends not already in the roster.** Compute from
  `listFriendships()` filtered to `status === 'accepted'`, minus any `other_id`
  that already appears in the roster `user_id` set (covers owner, joined, and
  already-invited members so we never offer a duplicate).
- Tapping `+` calls `inviteFriend(groupId, friendId)`, then reloads the roster
  (the friend now appears under **Invited**) and re-filters the eligible list.
  `actionBusy` guards double-taps. A `23505` duplicate maps through
  `friendlyGroupError` to "Already invited or a member".
- **Empty states:** if the user has accepted friends but all are already in the
  hunt → "All your friends are already in this hunt." If the user has no accepted
  friends at all → "Add friends on the Friends tab first."

### 3. Roster

- Sectioned **Owner / Joined / Invited** using `SectionList` section headers
  (same visual style as `GroupScreen`/`FriendsScreen` section headers).
- Each row: display name (with `(you)` appended on the own row via `is_me`),
  `@username`. **Invited** rows show a muted "pending" tag.
- **Owner** sees a remove (✕, `RED_STOP`) button on every row that is **not the
  owner row and not self** → destructive `Alert` confirm → `removeMember(groupId,
  user_id)` → reload roster. This removes both joined members and pending
  invitees.

### 4. Footer action

- **Owner:** red **Delete hunt** button → destructive `Alert` ("Delete
  \"<name>\"? This removes it for everyone.") → `deleteGroup(groupId)` →
  `navigation.goBack()`.
- **Joined member:** red **Leave hunt** button → destructive `Alert` → 
  `leaveGroup(groupId)` → `navigation.goBack()`.

On returning to `GroupScreen`, its `useFocusEffect` reload refreshes the list, so
a deleted/left hunt disappears and date changes appear without extra plumbing.

## Data flow

- On focus (`useFocusEffect`), load roster + friendships in parallel
  (`Promise.all`); friendships only strictly needed for the owner's picker but
  loading unconditionally keeps the code simple and the payload is small.
- Initial full-screen `ActivityIndicator` while loading (matches existing
  screens), then the list.
- `actionBusy` boolean guards every mutating action.
- Errors: `friendlyGroupError` for copy. Load failures render as an inline
  list-level banner; action failures use `Alert`.
- `RefreshControl` for pull-to-refresh.
- Permission gating derives from `myStatus === 'owner'` (route param); `ownerId`
  is available if a defensive cross-check is wanted.

## Small util addition

Add `formatDateFull(d)` to `src/utils/dates.js` — day + short month + **year**
(e.g. "6 Jul 2026") — for the detail date display. `formatDateShort` (no year)
stays unchanged for the compact list rows on `GroupScreen`.

## Folded-in Task 4 fixes

1. **`GroupScreen.js` shared error state.** Split the single `error` state into
   `formError` (validation, rendered inside the create box under the Create
   button) and `loadError` (list fetch failures, rendered as a list-level banner
   above the sections / as the list header area, not under the Create button).
   `onCreate` writes `formError`; `load` writes `loadError`.
2. **`validators.js` copy.** `validateGroupName` empty-name message
   `"Name the hunt"` → `"Name the outing"` for consistency with the Outing
   rename.

## Out of scope (later phases)

- Live member positions / map integration / "X min ago" (Phase 5).
- Sector assignment.
- Editing the hunt **name** or **start date** (only end date is editable here).
- Offline queueing of group-management actions.

## Testing / verification

- Pure additions are node-checkable: `formatDateFull` and the `validators.js`
  copy change.
- On-device: owner opens a hunt → sees roster, edits end date, invites a friend
  (needs the invitee to exist as an accepted friend), removes a member, deletes
  the hunt and lands back on the list. Joined-member and full invite/accept
  round-trips need a second account (carried over from Task 4's invitations
  verification).

## Execution plan (subagent-driven, manual approval between steps)

1. `formatDateFull` in `utils/dates.js` + `GroupDetailScreen` skeleton: load
   roster, render sectioned read-only roster + read-only dates.
2. Owner invite picker (eligible-friend filter, expand/collapse, invite + reload).
3. Owner editable end date (inline picker, save, revert-on-failure).
4. Leave / remove / delete actions with destructive confirms + `goBack`.
5. Task 4 fixes: `GroupScreen` error split + `validators` copy.
6. Review pass: Code Reviewer, plus Security Review (touches group membership /
   sharing), plus any Refactoring-Expert cleanup surfaced.
