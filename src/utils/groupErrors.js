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
  // Postgres CHECK violation — only reachable one is hunt_groups' end >= start check.
  if (error?.code === '23514') return 'End date must be on or after the start date';
  const m = (error?.message || '').toLowerCase();
  if (m.includes('network') || m.includes('fetch'))
    return 'No signal — try again when you have a connection';
  return 'Something went wrong. Please try again.';
}
