import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Pre-namespacing keys (global, shared across every account on the device).
const LEGACY_IDS_KEY = 'kudora_saved_hunt_ids';
const legacyHuntKey = (id) => `kudora_hunt_${id}`;

const idsKey = (uid) => `kudora_${uid}_saved_hunt_ids`;
const huntKey = (uid, id) => `kudora_${uid}_hunt_${id}`;

async function currentUid() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

// One-time move of pre-namespacing local hunts into the signed-in user's
// namespace, so existing recordings survive this update instead of becoming
// invisible to every account. Adopts into whichever account is first to read
// after the update ships. Safe to call repeatedly — a no-op once the legacy
// key is gone (its removal at the end IS the "already adopted" marker, no
// separate flag needed).
async function adoptLegacyHunts(uid) {
  const legacyRaw = await AsyncStorage.getItem(LEGACY_IDS_KEY);
  if (!legacyRaw) return;
  const legacyIds = JSON.parse(legacyRaw);
  const existingRaw = await AsyncStorage.getItem(idsKey(uid));
  const existingIds = existingRaw ? JSON.parse(existingRaw) : [];
  for (const id of legacyIds) {
    const raw = await AsyncStorage.getItem(legacyHuntKey(id));
    if (raw != null) await AsyncStorage.setItem(huntKey(uid, id), raw);
    await AsyncStorage.removeItem(legacyHuntKey(id));
  }
  const merged = [...legacyIds, ...existingIds.filter((i) => !legacyIds.includes(i))];
  await AsyncStorage.setItem(idsKey(uid), JSON.stringify(merged));
  await AsyncStorage.removeItem(LEGACY_IDS_KEY);
}

export async function saveHunt(hunt) {
  const uid = await currentUid();
  if (!uid) return;
  await AsyncStorage.setItem(huntKey(uid, hunt.id), JSON.stringify(hunt));
  const raw = await AsyncStorage.getItem(idsKey(uid));
  const ids = raw ? JSON.parse(raw) : [];
  const updated = [hunt.id, ...ids.filter((i) => i !== hunt.id)];
  await AsyncStorage.setItem(idsKey(uid), JSON.stringify(updated));
}

export async function loadAllHunts() {
  const uid = await currentUid();
  if (!uid) return [];
  await adoptLegacyHunts(uid);
  const raw = await AsyncStorage.getItem(idsKey(uid));
  if (!raw) return [];
  const ids = JSON.parse(raw);
  const results = await Promise.all(
    ids.map(async (id) => {
      const h = await AsyncStorage.getItem(huntKey(uid, id));
      return h ? JSON.parse(h) : null;
    })
  );
  return results.filter(Boolean);
}

export async function loadHunt(id) {
  const uid = await currentUid();
  if (!uid) return null;
  await adoptLegacyHunts(uid);
  const raw = await AsyncStorage.getItem(huntKey(uid, id));
  return raw ? JSON.parse(raw) : null;
}

export async function deleteHunt(id) {
  const uid = await currentUid();
  if (!uid) return;
  await AsyncStorage.removeItem(huntKey(uid, id));
  const raw = await AsyncStorage.getItem(idsKey(uid));
  if (!raw) return;
  const ids = JSON.parse(raw).filter((i) => i !== id);
  await AsyncStorage.setItem(idsKey(uid), JSON.stringify(ids));
}
