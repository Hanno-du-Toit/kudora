import { supabase } from './supabase';

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) { const e = new Error('Not signed in'); e.code = 'NOT_SIGNED_IN'; throw e; }
  return data.user;
}

// My rows only (SELECT policy also shows me other members' trails — filter).
export async function listMyShareRefs() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from('shared_trails')
    .select('id, group_id, local_hunt_id')
    .eq('owner_id', user.id);
  if (error) throw error;
  return data ?? [];
}

// Everything shared to one outing (RLS: members only). Powers the group map.
export async function listGroupTrails(groupId) {
  const { data, error } = await supabase
    .from('shared_trails')
    .select('id, owner_id, local_hunt_id, started_at, ended_at, distance_km, trail_points')
    .eq('group_id', groupId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertSharedTrail(row) {
  const { data, error } = await supabase
    .from('shared_trails')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSharedTrail(id) {
  const { error } = await supabase.from('shared_trails').delete().eq('id', id);
  if (error) throw error;
}
