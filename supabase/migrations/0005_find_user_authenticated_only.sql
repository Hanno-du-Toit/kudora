-- 0005_find_user_authenticated_only.sql — Phase 1 close-out: anon-oracle fix
-- Forward-only patch (0001 granted execute to anon; applied files stay untouched).
--
-- find_user_by_username is SECURITY DEFINER and bypasses profiles RLS by design
-- (exact-match friend lookup). With the anon grant, an UNAUTHENTICATED caller
-- could probe usernames as an existence oracle. Signed-in users are enough for
-- every real caller (Friends search), so restrict it to authenticated.
--
-- Note the PUBLIC revoke: Postgres grants EXECUTE on new functions to PUBLIC by
-- default, so revoking only anon would leave anon covered via PUBLIC. Idempotent.

revoke execute on function public.find_user_by_username(text) from public, anon;
grant execute on function public.find_user_by_username(text) to authenticated;

-- The pre-auth SIGNUP form checked availability through find_user_by_username,
-- which the revoke above breaks (permission denied as anon). Replace it with a
-- BOOLEAN-only probe: signup already reveals existence (the "taken" error), so
-- a yes/no answer leaks nothing new to anon — unlike the full lookup, which
-- handed anon the uuid + display_name.
create or replace function public.username_available(handle text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles p where p.username = lower(handle)
  );
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
