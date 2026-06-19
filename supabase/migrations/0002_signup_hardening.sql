-- 0002_signup_hardening.sql — guard handle_new_user against a missing/invalid username
-- Idempotent (create or replace); safe to run after 0001_profiles.sql.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text := lower(new.raw_user_meta_data->>'username');
begin
  if uname is null or uname !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username' using errcode = '23514';
  end if;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    uname,
    coalesce(new.raw_user_meta_data->>'display_name', uname)
  );
  return new;
end;
$$;
