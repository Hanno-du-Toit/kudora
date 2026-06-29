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

export function validateGroupName(raw) {
  const name = (raw ?? '').trim();
  if (name.length === 0) return { ok: false, error: 'Name the hunt' };
  if (name.length > 40) return { ok: false, error: 'At most 40 characters' };
  return { ok: true, value: name };
}
