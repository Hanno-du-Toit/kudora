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
  const { data, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!data?.user) throw tagged('NOT_SIGNED_IN', 'Not signed in');
  const user = data.user;

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
