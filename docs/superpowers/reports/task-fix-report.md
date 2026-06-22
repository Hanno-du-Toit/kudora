# Phase 1 Review Fix Report

Commit: 9828c41  
Branch: main-CleanVersion  
Date: 2026-06-19

## Changes Applied

### Fix 1 — AuthScreen.js: friendlyAuthError new branch
Added `if (m.includes('database error') || m.includes('saving new user'))` branch between the username-taken check and the network check. Em-dash in "No signal — try again when you have a connection" preserved verbatim.

### Fix 2 — profiles.js: getMyProfile uses getSession
Replaced `supabase.auth.getUser()` with `supabase.auth.getSession()` + `session?.user` in both `getMyProfile` and `updateMyProfile`. Avoids network round-trip; reads from local cache.

### Fix 3 — ProfileScreen.js: persistRange rollback on failure
Added `const previous = profile?.[field]` capture before optimistic update. On catch: `setProfile((prev) => ({ ...prev, [field]: previous }))` reverts the value. Alert message updated to "your change was not saved." Em-dash preserved.

### Fix 4 — AuthContext.js: signOut error guard
Wrapped `supabase.auth.signOut()` in try/catch; failure logs `[Auth] signOut failed:` instead of throwing.

### Fix 5 — supabase/migrations/0002_signup_hardening.sql (new file)
Created `create or replace function public.handle_new_user()` trigger that validates `uname` against `^[a-z0-9_]{3,20}$` and raises `23514` on failure. Idempotent; safe to run after 0001_profiles.sql.

## Verification

All 5 edits applied exactly as specified. Em-dashes ("—") confirmed present in the two strings that contain them (Fix 1 network error message, Fix 3 alert message). No other lines were touched in any file.
