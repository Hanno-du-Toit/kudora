import { supabase } from './supabase';

function tagged(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw tagged('NOT_SIGNED_IN', 'Not signed in');
  return data.user;
}

// Groups I own / joined / am invited to (incl. pending invites). Powers GroupScreen.
export async function listMyGroups() {
  const { data, error } = await supabase.rpc('list_my_groups');
  if (error) throw error;
  return data ?? [];
}

// Full roster (owner + members) for one group. Caller must be a member/invitee.
export async function listGroupMembers(groupId) {
  const { data, error } = await supabase.rpc('list_group_members', { gid: groupId });
  if (error) throw error;
  return data ?? [];
}

// Owner-only create. Dates are 'YYYY-MM-DD' strings.
export async function createGroup({ name, startDate, endDate }) {
  const user = await requireUser();

  const { data, error } = await supabase
    .from('hunt_groups')
    .insert({ name, owner_id: user.id, start_date: startDate, end_date: endDate })
    .select('id, name, start_date, end_date, owner_id')
    .single();
  if (error) throw error;
  return data;
}

// Owner-only: move the end date (DB CHECK forbids before start_date). 'YYYY-MM-DD'.
export async function updateGroupEndDate(groupId, endDate) {
  const { error } = await supabase
    .from('hunt_groups')
    .update({ end_date: endDate })
    .eq('id', groupId);
  if (error) throw error;
}

// Owner-only delete (cascades members).
export async function deleteGroup(groupId) {
  const { error } = await supabase.from('hunt_groups').delete().eq('id', groupId);
  if (error) throw error;
}

// Owner invites a friend (RLS enforces owner + friends-only + 'invited').
export async function inviteFriend(groupId, userId) {
  const user = await requireUser();
  const { error } = await supabase.from('group_members').insert({
    group_id: groupId, user_id: userId, invited_by: user.id, status: 'invited',
  });
  if (error) {
    if (error.code === '23505') throw tagged('ALREADY_MEMBER', 'Already invited or a member');
    throw error;
  }
}

// Invitee accepts: invited → joined (RLS: own row, accept-only).
export async function acceptInvite(groupId) {
  const user = await requireUser();
  const { error } = await supabase
    .from('group_members')
    .update({ status: 'joined' })
    .eq('group_id', groupId)
    .eq('user_id', user.id);
  if (error) throw error;
}

// Leave / decline (self). RLS: own row.
export async function leaveGroup(groupId) {
  const user = await requireUser();
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', user.id);
  if (error) throw error;
}

// Owner removes a member.
export async function removeMember(groupId, userId) {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}
