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
