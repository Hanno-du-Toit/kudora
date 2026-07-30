import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

// Desired share state: { [localHuntId]: { [groupId]: true } }. Only true entries
// are stored — unshare DELETES the entry, which is what makes an offline
// share-then-unshare net to a structural no-op for the reconciler.
const LEGACY_DESIRED_KEY = 'kudora_share_state_v1';
const desiredKey = (uid) => `kudora_${uid}_share_state_v1`;
// Reconciler's last-known server rows: { 'huntId|groupId': serverRowId }.
// Lets the UI label toggles offline (desired∧cached=Shared, desired∧¬cached=
// Waiting for signal, ¬desired∧cached=Removing…). Not adopted from the legacy
// key on migration — it's a pure cache the reconciler repopulates from the
// server on its next pass, so starting empty costs one settle, not data.
const cacheKey = (uid) => `kudora_${uid}_share_server_cache_v1`;

async function currentUid() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

async function readJSON(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// One-time move of pre-namespacing desired state into the signed-in user's
// namespace. Unlike the hunts themselves, this MUST be migrated rather than
// left to reset empty: desired state is the source of truth the reconciler
// diffs against the server, so an empty desired map would read as "unshare
// everything" on the next reconcile and delete real shared_trails rows.
// Same no-flag-needed pattern as huntStorage's adoption: legacy key's removal
// at the end is the marker.
async function adoptLegacyDesired(uid) {
  const legacyRaw = await AsyncStorage.getItem(LEGACY_DESIRED_KEY);
  if (!legacyRaw) return;
  const legacy = JSON.parse(legacyRaw);
  const existingRaw = await AsyncStorage.getItem(desiredKey(uid));
  const existing = existingRaw ? JSON.parse(existingRaw) : {};
  const merged = { ...legacy };
  for (const huntId of Object.keys(existing)) {
    merged[huntId] = { ...(merged[huntId] ?? {}), ...existing[huntId] };
  }
  await AsyncStorage.setItem(desiredKey(uid), JSON.stringify(merged));
  await AsyncStorage.removeItem(LEGACY_DESIRED_KEY);
}

export async function getDesired() {
  const uid = await currentUid();
  if (!uid) return {};
  await adoptLegacyDesired(uid);
  return readJSON(desiredKey(uid), {});
}

export async function setDesired(huntId, groupId, shared) {
  const uid = await currentUid();
  if (!uid) return;
  const all = await getDesired();
  if (shared) {
    all[huntId] = { ...(all[huntId] ?? {}), [groupId]: true };
  } else if (all[huntId]) {
    delete all[huntId][groupId];
    if (Object.keys(all[huntId]).length === 0) delete all[huntId];
  }
  await AsyncStorage.setItem(desiredKey(uid), JSON.stringify(all));
}

// Local hunt deleted → intent gone → reconciler unshares any server copies.
export async function removeHunt(huntId) {
  const uid = await currentUid();
  if (!uid) return;
  const all = await getDesired();
  if (all[huntId]) {
    delete all[huntId];
    await AsyncStorage.setItem(desiredKey(uid), JSON.stringify(all));
  }
}

export async function getServerCache() {
  const uid = await currentUid();
  if (!uid) return {};
  return readJSON(cacheKey(uid), {});
}

export async function setServerCache(map) {
  const uid = await currentUid();
  if (!uid) return;
  await AsyncStorage.setItem(cacheKey(uid), JSON.stringify(map ?? {}));
}
