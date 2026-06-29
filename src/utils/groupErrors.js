// Pure mapper from a thrown groups-service error to user-facing copy.
// No RN/Supabase imports so it's trivially node-checkable. Mirrors friendErrors.js.
export function friendlyGroupError(error) {
  switch (error?.code) {
    case 'NOT_SIGNED_IN':  return 'You are signed out — log in again';
    case 'ALREADY_MEMBER': return 'Already invited or a member';
    default: break;
  }
  // Postgres RLS violation (e.g. inviting a non-friend, acting without permission).
  if (error?.code === '42501') return 'You do not have permission for that';
  const m = (error?.message || '').toLowerCase();
  if (m.includes('network') || m.includes('fetch'))
    return 'No signal — try again when you have a connection';
  return error?.message || 'Something went wrong';
}
