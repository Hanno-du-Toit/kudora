import { supabase } from './supabase';

export async function getMyProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, safety_range_m, warning_range_m')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(patch) {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('Not signed in');
  const allowed = {};
  if (patch.display_name != null)    allowed.display_name = patch.display_name;
  if (patch.safety_range_m != null)  allowed.safety_range_m = patch.safety_range_m;
  if (patch.warning_range_m != null) allowed.warning_range_m = patch.warning_range_m;
  const { data, error } = await supabase
    .from('profiles')
    .update(allowed)
    .eq('id', user.id)
    .select('id, username, display_name, safety_range_m, warning_range_m')
    .single();
  if (error) throw error;
  return data;
}

// Exact-match availability via the SECURITY DEFINER RPC (returns [] when free).
export async function isUsernameAvailable(username) {
  const { data, error } = await supabase.rpc('find_user_by_username', {
    handle: username,
  });
  if (error) throw error;
  return !data || data.length === 0;
}
